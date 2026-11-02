import {NativePublicationUnknownError} from './workerOutcome.js';
export type DispatchScope = { taskId?: string; episodeId?: string };
export interface WorkerDatabasePort {
  rpc(name: string, args: Record<string, unknown>): Promise<unknown[]>;
  plan(scope: DispatchScope): Promise<number>;
}
export interface WorkerDispatchOptions {
  projectRoot: string;
  database: WorkerDatabasePort;
  environment?: NodeJS.ProcessEnv;
  concurrency: number;
  signal?: AbortSignal;
}

export interface ClaimedTaskRow {
  task_id: string;
  attempt: number;
  lease_token: string;
  [key: string]: unknown;
}

// The executor is a process boundary. Real-DB verification may supply a
// controlled executor without replacing queue/claim/result behavior.
export interface WorkerDispatchExecutor {
  prepare(): Promise<void>;
  execute(task: ClaimedTaskRow): Promise<unknown>;
}

// tasks is the durable queue: its ID identifies a frozen input. All entry points
// scan the same rows, then let the fenced DB claim decide capacity and ownership.
// A process-local wake is only a latency hint, never an execution/status record.
// A scan reserves available slots and returns without waiting for executors.
// The service scheduler owns scan serialization and wake/interval lifecycle.
export function createWorkerTaskConsumer(options: WorkerDispatchOptions, executor: WorkerDispatchExecutor, onAvailable: () => void) {
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency <= 0) throw new Error("Worker concurrency must be a positive integer.");
  const active = new Set<Promise<void>>();
  const capacity = Number((options.environment ?? process.env).CODEX_WORKER_CAPACITY ?? "2");
  if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new Error("Worker capacity must be a positive integer.");
  let prepared = false;
  let scanning: Promise<void> | undefined;
  async function scan(scope: DispatchScope = {}) {
    if (scanning) return scanning;
    scanning = scanOnce(scope);
    try { await scanning; } finally { scanning = undefined; }
  }
  async function scanOnce(scope: DispatchScope) {
    if (options.signal?.aborted) return;
    if (!scope.taskId) await plan(scope);
    while (active.size < options.concurrency && !options.signal?.aborted) {
      const rows = await options.database.rpc("claim_next_worker_task", { p_worker_capacity: capacity });
      if (!rows.length) break;
      const task = rows[0] as ClaimedTaskRow;
      if (typeof task.task_id !== "string" || typeof task.lease_token !== "string" || !Number.isSafeInteger(task.attempt)) throw new Error("领取的任务缺少有效租约。");
      try {
        if (!prepared) { await executor.prepare(); prepared = true; }
      } catch (error) { await reportLaunchFailure(task, error); throw error; }
      const operation = (async () => {
        try {
          await executor.execute(task);
        } catch (error) {
          await reportLaunchFailure(task, error);
        }
      })();
      active.add(operation);
      void operation.finally(() => { active.delete(operation); onAvailable(); }).catch(() => undefined);
    }
  }
  async function plan(scope: DispatchScope = {}) {
    if (options.signal?.aborted) return;
    await options.database.plan(scope);
  }
  return {
    scan, plan, activeCount: () => active.size,
    settled: () => Promise.all(active),
  };

  async function reportLaunchFailure(task: ClaimedTaskRow, error: unknown) {
    // SQL retains the publication fence across lease expiry and process restart.
    // A generic failed result must never replace a possibly committed result.
    if(error instanceof NativePublicationUnknownError)return;
    // A stale/cancelled lease must not report into a new attempt. The fenced
    // result RPC is authoritative; process exit alone never frees a DB lease.
    const shouldRetry = Number.isSafeInteger(task.max_attempts) && task.attempt + 1 < Number(task.max_attempts);
    const result = { version: "worker-result/v1", taskId: task.task_id, status: "failed", artifacts: [], validation: { passed: false, checks: [] }, actualCostCents: 0, blockers: [], retry: { shouldRetry, reason: "Worker process exited before completion." }, nextStep: shouldRetry ? "Retry after the local Worker is available." : "Resolve the Worker failure before explicitly retrying this task." };
    try { await options.database.rpc("report_worker_result", { p_task_id: task.task_id, p_attempt: task.attempt, p_lease_token: task.lease_token, p_result: result }); }
    catch {
      // Cancellation, completed result or a reclaimed lease can win this race.
      // Preserve its authoritative state and rely on lease recovery if needed.
      void error;
    }
  }
}
