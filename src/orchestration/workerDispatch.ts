import { spawn } from "node:child_process";
import { join } from "node:path";
import { assertPreparedRuntime } from "./runtimeBuild.js";

export type DispatchScope = { taskId?: string; episodeId?: string };
export interface WorkerDispatchOptions {
  projectRoot: string;
  supabaseUrl: string;
  serviceRoleKey: string;
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
export async function dispatchWorkerTasks(options: WorkerDispatchOptions, scope: DispatchScope = {}, executor?: WorkerDispatchExecutor) {
  const consumer = createWorkerTaskConsumer(options, executor);
  do {
    await consumer.scan(scope);
    if (consumer.activeCount()) { await consumer.nextCompletion(); continue; }
    const delay = await consumer.retryDelay();
    if (!delay || options.signal?.aborted) break;
    await new Promise(resolve => setTimeout(resolve, Math.max(50, Math.min(1000, delay))));
  } while (!options.signal?.aborted);
  await consumer.settled();
  return consumer.summary();
}

// A scan reserves available slots and returns without waiting for executors.
// The service scheduler owns scan serialization and wake/interval lifecycle.
export function createWorkerTaskConsumer(options: WorkerDispatchOptions, executor?: WorkerDispatchExecutor, onAvailable?: () => void) {
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency <= 0) throw new Error("Worker concurrency must be a positive integer.");
  const workers: unknown[] = [];
  const active = new Set<Promise<void>>();
  const capacity = Number((options.environment ?? process.env).CODEX_WORKER_CAPACITY ?? "2");
  if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new Error("Worker capacity must be a positive integer.");
  let prepared = false, claimedTasks = 0, plannedTasks = 0, productionReady = 0, reviewPackages = 0;
  let scanning: Promise<void> | undefined;
  async function scan(scope: DispatchScope = {}) {
    if (scanning) return scanning;
    scanning = scanOnce(scope);
    try { await scanning; } finally { scanning = undefined; }
  }
  async function scanOnce(scope: DispatchScope) {
    if (options.signal?.aborted) return;
    if (!executor) await assertPreparedRuntime(options.projectRoot);
    if (!scope.taskId) await plan(scope);
    while (active.size < options.concurrency && !options.signal?.aborted) {
      const rows = await rpc("claim_next_worker_task", { p_worker_capacity: capacity });
      if (!rows.length) break;
      const task = rows[0] as ClaimedTaskRow;
      if (typeof task.task_id !== "string" || typeof task.lease_token !== "string" || !Number.isSafeInteger(task.attempt)) throw new Error("领取的任务缺少有效租约。");
      claimedTasks++;
      try {
        if (!prepared) { if (executor) await executor.prepare(); prepared = true; }
      } catch (error) { await reportLaunchFailure(task, error); throw error; }
      const operation = (async () => {
        try {
          const result = executor ? await executor.execute(task) : JSON.parse((await runCommand(process.execPath, [join(options.projectRoot, "dist/worker/worker/codexWorkerCli.js"), "--claimed-task"], JSON.stringify(task))).stdout.trim().split("\n").at(-1) ?? "null");
          if (!onAvailable) workers.push(result);
        } catch (error) {
          await reportLaunchFailure(task, error);
          if (!onAvailable) workers.push({ status: "failed", taskId: task.task_id, detail: "Worker process failed; inspect the task attempt." });
        }
      })();
      active.add(operation);
      void operation.finally(() => { active.delete(operation); onAvailable?.(); }).catch(() => undefined);
    }
  }
  async function plan(scope: DispatchScope = {}) {
    if (options.signal?.aborted) return;
    if (!executor) await assertPreparedRuntime(options.projectRoot);
    const expiredBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    if (!scope.episodeId && !active.size && !await hasPendingWork(expiredBefore)) return;
    plannedTasks += (await planTasks(scope.episodeId)).length;
    productionReady += (await orchestrateTasks("advance_production_ready_episodes", scope.episodeId ? { p_episode_id: scope.episodeId } : {})).length;
    reviewPackages += (await orchestrateTasks(scope.episodeId ? "create_pre_render_review_packages_for_episode" : "create_pre_render_review_packages", scope.episodeId ? { p_episode_id: scope.episodeId } : {})).length;
  }
  return {
    scan, plan, activeCount: () => active.size,
    nextCompletion: () => Promise.race(active), settled: () => Promise.all(active),
    retryDelay: async () => { const [delay] = await rpc("worker_retry_delay_ms", {}); return typeof delay === "number" && delay > 0 ? delay : 0; },
    summary: () => ({ plannedTasks, queuedTasks: claimedTasks, workers, productionReadyEpisodes: productionReady, preRenderReviewPackages: reviewPackages }),
  };

  function requestSignal() { return options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000); }
  function headers() { return { apikey: options.serviceRoleKey, Authorization: `Bearer ${options.serviceRoleKey}` }; }
  function runCommand(command: string, argumentsList: string[], input?: string): Promise<{ stdout: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, argumentsList, { cwd: options.projectRoot, env: options.environment ?? process.env, detached: process.platform !== "win32", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const kill = (signal: NodeJS.Signals) => {
        if (!child.pid) return;
        try { process.kill(process.platform === "win32" ? child.pid : -child.pid, signal); } catch { /* Already exited. */ }
      };
      const stop = () => { kill("SIGTERM"); killTimer = setTimeout(() => kill("SIGKILL"), 2000); killTimer.unref?.(); };
      options.signal?.addEventListener("abort", stop, { once: true });
      child.once("close", () => { options.signal?.removeEventListener("abort", stop); if (killTimer) clearTimeout(killTimer); });
      if (options.signal?.aborted) stop();
      if (input !== undefined) { child.stdin?.on("error", () => undefined); child.stdin?.end(input); }
      let stdout = "", stderr = "";
      child.stdout!.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.once("error", reject);
      child.once("close", code => code === 0 ? resolve({ stdout }) : reject(new Error(stderr.trim() || `Worker 命令退出状态 ${code ?? "unknown"}。`)));
    });
  }
  async function rpc(name: string, args: Record<string, unknown>, allowDuringStop = false): Promise<unknown[]> {
    const response = await fetch(new URL(`/rest/v1/rpc/${name}`, options.supabaseUrl), {
      method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify(args), signal: allowDuringStop ? AbortSignal.timeout(4000) : requestSignal(),
    });
    if (!response.ok) throw new Error(`Worker RPC ${name} 返回 HTTP ${response.status}`);
    const rows: unknown = await response.json();
    return Array.isArray(rows) ? rows : [rows];
  }
  async function reportLaunchFailure(task: ClaimedTaskRow, error: unknown) {
    // A stale/cancelled lease must not report into a new attempt. The fenced
    // result RPC is authoritative; process exit alone never frees a DB lease.
    const result = { version: "worker-result/v1", taskId: task.task_id, status: "failed", artifacts: [], validation: { passed: false, checks: [] }, actualCostCents: 0, blockers: [], retry: { shouldRetry: true, reason: "Worker process exited before completion." }, nextStep: "Retry after the local Worker is available." };
    try { await rpc("report_worker_result", { p_task_id: task.task_id, p_attempt: task.attempt, p_lease_token: task.lease_token, p_result: result }, true); }
    catch {
      // Cancellation, completed result or a reclaimed lease can win this race.
      // Preserve its authoritative state and rely on lease recovery if needed.
      void error;
    }
  }
  async function hasPendingWork(expiredBefore: string): Promise<boolean> {
    for (const [table, filters] of [
      ["tasks", { or: `(status.eq.ready,and(status.eq.running,or(claimed_at.is.null,claimed_at.lte.${expiredBefore})))` }],
      ["episodes", { stage: "in.(script_approved,visual_approved,storyboard_approved,production_ready,render_ready,qc_passed)" }],
    ] as const) {
      const endpoint = new URL(`/rest/v1/${table}`, options.supabaseUrl);
      endpoint.searchParams.set("select", "id");
      endpoint.searchParams.set("limit", "1");
      for (const [key, value] of Object.entries(filters)) endpoint.searchParams.set(key, value);
      const response = await fetch(endpoint, { headers: headers(), signal: requestSignal() });
      if (!response.ok) throw new Error(`检查持久任务队列失败：Supabase 返回 HTTP ${response.status}`);
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw new Error("持久任务队列格式无效。");
      if (rows.length) return true;
    }
    return false;
  }

  async function planTasks(episodeId?: string): Promise<Array<{ id: string }>> {
    const args: Record<string, string> = episodeId ? { p_episode_id: episodeId } : {};
    const scoped = (name: string) => episodeId ? `${name}_for_episode` : name;
    const initial = await Promise.all([
      orchestrateTasks(scoped("orchestrate_provided_script_tasks"), args),
      orchestrateTasks(scoped("orchestrate_storyboard_tasks"), args),
    ]);
    const tasks = initial.flat();
    for (const name of [
      "orchestrate_b_roll_tasks", scoped("orchestrate_a_roll_tasks"), "orchestrate_narration_tasks",
      "orchestrate_soundtrack_tasks", "orchestrate_embedded_audio_tasks", "orchestrate_review_render_tasks", "orchestrate_final_render_tasks",
    ]) tasks.push(...await orchestrateTasks(name, args));
    return tasks;
  }

  async function orchestrateTasks(functionName: string, args: Record<string, string> = {}): Promise<Array<{ id: string }>> {
    const { supabaseUrl: url, serviceRoleKey } = options;
    const endpoint = new URL(`/rest/v1/rpc/${functionName}`, url);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(args), signal: requestSignal(),
    });
    if (!response.ok) throw new Error(`创建 Worker 任务失败：Supabase 返回 HTTP ${response.status}`);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload) || payload.some((task) => !isRecord(task) || typeof task.id !== "string")) throw new Error("创建 Worker 任务失败：Supabase 返回格式无效。");
    return payload as Array<{ id: string }>;
  }

}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
