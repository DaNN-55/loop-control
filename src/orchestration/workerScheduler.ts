import { createWorkerTaskConsumer, type DispatchScope, type WorkerDispatchExecutor, type WorkerDispatchOptions } from "./workerDispatch.js";
import { assertPreparedRuntime } from "./runtimeBuild.js";

export async function startWorkerScheduler(options: WorkerDispatchOptions, executor?: WorkerDispatchExecutor) {
  if (!executor) await assertPreparedRuntime(options.projectRoot);
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let stopped = false, fast = false, global = false, scans = 0;
  let lastScanAt: string | null = null, lastError: string | null = null, planningError: string | null = null;
  let pump: Promise<void> | undefined, planning: Promise<void> | undefined;
  let planAgain = false;
  const episodes = new Set<string>();
  const consumer = createWorkerTaskConsumer({ ...options, signal }, executor, () => wake());

  function wake(scope: DispatchScope = {}) {
    if (stopped || signal.aborted) return;
    if (scope.taskId) fast = true;
    else if (scope.episodeId) episodes.add(scope.episodeId);
    else global = true;
    startPump();
  }
  function startPump() {
    if (!pump && !stopped && !signal.aborted && (fast || global || episodes.size)) pump = scanPending().finally(() => { pump = undefined; startPump(); });
  }
  async function scanPending() {
    while (!stopped && !signal.aborted && (fast || global || episodes.size)) {
      let scope: DispatchScope = {};
      if (fast) { fast = false; scope = { taskId: "wake" }; }
      else if (global) { global = false; episodes.clear(); }
      else { const id = episodes.values().next().value!; episodes.delete(id); scope = { episodeId: id }; }
      scans++; lastScanAt = new Date().toISOString();
      try {
        if (!scope.taskId) startPlanning(scope);
        await consumer.scan({ taskId: "wake" }); lastError = null;
      }
      catch (error) { if(stopped || signal.aborted)continue; const message = error instanceof Error ? error.message : "Worker scan failed"; if(lastError!==message)console.error(`Worker调度扫描失败：${message}`); lastError = message; }
    }
  }
  // Planning may wait on a business transaction. It is separately serialized,
  // so an immediate wake never waits behind the full sequence of planner RPCs.
  function startPlanning(scope: DispatchScope) {
    if (planning) { planAgain = true; return; }
    planning = (async () => {
      try { await consumer.plan(scope); planningError = null; }
      catch (error) { if (!stopped) planningError = error instanceof Error ? error.message : "Worker planning failed"; }
    })().finally(() => {
      planning = undefined;
      if (planAgain) { planAgain = false; wake(); }
      else wake({ taskId: "planned" });
    });
  }
  // Leave one second of the five-second ready-to-claim budget for RPC and scheduling.
  const timer = setInterval(() => wake(), 4000);
  timer.unref?.();
  wake();
  return {
    wake,
    status: () => ({ stopped, scans, lastScanAt, lastError: lastError ?? planningError, scanning: Boolean(pump), planning: Boolean(planning), activeWorkers: consumer.activeCount() }),
    async stop() {
      stopped = true; clearInterval(timer); controller.abort();
      await pump; await planning; await consumer.settled();
    },
  };
}
