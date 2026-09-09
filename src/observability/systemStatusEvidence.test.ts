import { describe, expect, it, vi } from "vitest";
import { executionStartedWorker, ExpiringProbeCache, summarizeN8nExecutions, supabaseControlDataEvidence, type N8nExecutionEvidenceRow } from "./systemStatusEvidence";

function execution(id: number, workflowName: string, startedAt: string, status = "success", output?: unknown): N8nExecutionEvidenceRow {
  const data = output === undefined ? null : JSON.stringify([`npm output\n${JSON.stringify(output)}`]);
  return { data, id, startedAt, status, workflowName };
}

describe("system status evidence", () => {
  it("区分空调度检查和实际启动 Worker 的派发", () => {
    const rows = [
      execution(3, "Loop Control — 任务派发", "2026-09-09 07:15:04.238", "success", { mode: "dispatch", plannedTasks: 0, workers: [] }),
      execution(2, "Loop Control — 任务派发", "2026-09-09 07:00:04.424", "success", { mode: "dispatch", plannedTasks: 1, workers: [{ status: "completed" }] }),
    ];

    expect(summarizeN8nExecutions(rows)).toMatchObject({
      lastScheduleCheckAt: "2026-09-09T07:15:04.238Z",
      lastWorkerDispatchAt: "2026-09-09T07:00:04.424Z",
    });
    expect(executionStartedWorker(rows[0].data)).toBe(false);
    expect(executionStartedWorker(rows[1].data)).toBe(true);
  });

  it("输出通知链最近一次的成功或失败", () => {
    const evidence = summarizeN8nExecutions([
      execution(4, "Loop Control — 状态变更提醒", "2026-09-09 07:00:06.063", "error"),
      execution(3, "Loop Control — 审核提醒", "2026-09-08 14:30:06.008"),
    ]);

    expect(evidence.lastNotification).toEqual({ at: "2026-09-09T07:00:06.063Z", state: "failure", workflowName: "Loop Control — 状态变更提醒" });
  });

  it("首次立即返回待确认，后台更新后在 TTL 内复用结果", async () => {
    let now = 1_000;
    const cache = new ExpiringProbeCache<string>(300_000, () => now);
    const load = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");

    expect(cache.read("probe", "pending", load)).toBe("pending");
    expect(load).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(cache.read("probe", "pending", load)).toBe("first"));
    now += 15_000;
    expect(cache.read("probe", "pending", load)).toBe("first");
    now += 300_000;
    expect(cache.read("probe", "pending", load)).toBe("first");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(cache.read("probe", "pending", load)).toBe("second"));
  });

  it("只在 Owner 成员关系和激活蓝图都可读时确认控制数据正常", () => {
    expect(supabaseControlDataEvidence({ activeBlueprintsReadable: true, hasOwnerMembership: true, ownerMembershipsReadable: true }).state).toBe("healthy");
    expect(supabaseControlDataEvidence({ activeBlueprintsReadable: false, hasOwnerMembership: true, ownerMembershipsReadable: true })).toMatchObject({ state: "unknown", detail: expect.stringContaining("无法读取激活蓝图") });
    expect(supabaseControlDataEvidence({ activeBlueprintsReadable: true, hasOwnerMembership: false, ownerMembershipsReadable: true })).toMatchObject({ state: "unknown", detail: expect.stringContaining("未读取到 Owner") });
  });
});
