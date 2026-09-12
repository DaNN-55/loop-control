export interface ProvidedScriptDispatchDependencies<TTask, TWorkerResult> {
  planTasks(): Promise<TTask[]>;
  runWorker(task: TTask): Promise<TWorkerResult>;
  runExistingWorker?(): Promise<TWorkerResult>;
  prepareWorkers?(): Promise<void>;
  concurrency?: number;
}

export async function dispatchProvidedScriptWork<TTask, TWorkerResult>(dependencies: ProvidedScriptDispatchDependencies<TTask, TWorkerResult>): Promise<{ plannedTasks: number; workers: TWorkerResult[] }> {
  const workers: TWorkerResult[] = [];
  let prepared = false;
  if (dependencies.runExistingWorker) {
    await dependencies.prepareWorkers?.();
    prepared = true;
    workers.push(await dependencies.runExistingWorker());
  }
  const tasks = await dependencies.planTasks();
  if (tasks.length > 0 && !prepared) await dependencies.prepareWorkers?.();
  workers.push(...await runWithConcurrency(tasks, dependencies.concurrency ?? 1, dependencies.runWorker));
  return { plannedTasks: tasks.length, workers };
}

export async function runWithConcurrency<TTask, TResult>(tasks: TTask[], concurrency: number, run: (task: TTask) => Promise<TResult>): Promise<TResult[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) throw new Error("Worker concurrency must be a positive integer.");
  const results = new Array<TResult>(tasks.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await run(tasks[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
