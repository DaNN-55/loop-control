import { describe, expect, it, vi } from "vitest";
import { dispatchProvidedScriptWork } from "./providedScriptDispatch";

describe("已提供脚本调度", () => {
  it("先冻结待执行任务，再按并发上限启动 Worker", async () => {
    const events: string[] = [];
    const planTasks = vi.fn(async () => {
      events.push("plan");
      return [{ id: "task-1" }];
    });
    const runWorker = vi.fn(async (task: { id: string }) => {
      events.push(`worker:${task.id}`);
      return { status: "completed", taskId: task.id };
    });

    await expect(dispatchProvidedScriptWork({ concurrency: 2, planTasks, runWorker })).resolves.toEqual({
      plannedTasks: 1,
      workers: [{ status: "completed", taskId: "task-1" }],
    });
    expect(events).toEqual(["plan", "worker:task-1"]);
  });

  it("不超过指定并发", async () => {
    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const promise = dispatchProvidedScriptWork({
      concurrency: 2,
      planTasks: async () => [{ id: "task-1" }, { id: "task-2" }, { id: "task-3" }],
      runWorker: async (task) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => release.push(resolve));
        active -= 1;
        return task.id;
      },
    });
    await vi.waitFor(() => expect(release).toHaveLength(2));
    release.shift()?.();
    await vi.waitFor(() => expect(release).toHaveLength(2));
    release.shift()?.();
    release.shift()?.();
    await expect(promise).resolves.toMatchObject({ plannedTasks: 3, workers: ["task-1", "task-2", "task-3"] });
    expect(peak).toBe(2);
  });

  it("没有新规划任务时仍会领取已有 ready 任务", async () => {
    const prepareWorkers = vi.fn(async () => undefined);
    const runExistingWorker = vi.fn(async () => ({ status: "completed", taskId: "existing-ready-task" }));
    await expect(dispatchProvidedScriptWork({ planTasks: async () => [], prepareWorkers, runExistingWorker, runWorker: async () => ({ status: "idle", taskId: "unused" }) })).resolves.toEqual({
      plannedTasks: 0,
      workers: [{ status: "completed", taskId: "existing-ready-task" }],
    });
    expect(prepareWorkers).toHaveBeenCalledOnce();
    expect(runExistingWorker).toHaveBeenCalledOnce();
  });

  it("新任务规划时也领取已有任务，保证可恢复超时租约", async () => {
    const events: string[] = [];

    await expect(dispatchProvidedScriptWork({
      planTasks: async () => [{ id: "new-task" }],
      runWorker: async (task) => { events.push(task.id); return task.id; },
      runExistingWorker: async () => { events.push("existing-task"); return "existing-task"; },
    })).resolves.toEqual({ plannedTasks: 1, workers: ["existing-task", "new-task"] });
    expect(events).toEqual(["existing-task", "new-task"]);
  });

  it("新任务规划失败时也先领取已有 ready 任务", async () => {
    const runExistingWorker = vi.fn(async () => "existing-task");

    await expect(dispatchProvidedScriptWork({
      planTasks: async () => { throw new Error("Supabase 返回 HTTP 504"); },
      runWorker: async () => "unused",
      runExistingWorker,
    })).rejects.toThrow("Supabase 返回 HTTP 504");
    expect(runExistingWorker).toHaveBeenCalledOnce();
  });

  it("没有待领取任务时不准备或启动 Worker", async () => {
    const prepareWorkers = vi.fn(async () => undefined);
    const runWorker = vi.fn(async () => ({ status: "unused" }));

    await expect(dispatchProvidedScriptWork({ planTasks: async () => [], prepareWorkers, runWorker })).resolves.toEqual({ plannedTasks: 0, workers: [] });
    expect(prepareWorkers).not.toHaveBeenCalled();
    expect(runWorker).not.toHaveBeenCalled();
  });
});
