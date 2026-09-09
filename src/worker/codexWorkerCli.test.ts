import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Codex Worker 执行边界", () => {
  it("为 Codex 生产执行设置可配置的超时", () => {
    const source = readFileSync(resolve("src/worker/codexWorkerCli.ts"), "utf8");

    expect(source).toContain('process.env.CODEX_WORKER_EXECUTION_TIMEOUT_MS ?? "300000"');
    expect(source).toContain('], codexExecutionTimeoutMs);');
  });

  it("允许领取并执行豆包语音任务", () => {
    const source = readFileSync(resolve("src/worker/codexWorkerCli.ts"), "utf8");

    expect(source).toContain('row.provider !== "volcengine_tts"');
    expect(source).toContain('volcengineTtsApiKey: taskPackage.provider === "volcengine_tts"');
  });

  it("按 Worker 容量请求平台计算的并发约束", () => {
    const source = readFileSync(resolve("src/worker/codexWorkerCli.ts"), "utf8");

    expect(source).toContain('process.env.CODEX_WORKER_CAPACITY ?? "2"');
    expect(source).toContain("p_worker_capacity: workerCapacity");
  });

  it("长任务通过同一尝试的租约心跳续租", () => {
    const source = readFileSync(resolve("src/worker/codexWorkerCli.ts"), "utf8");

    expect(source).toContain('supabase.rpc("refresh_worker_task_lease"');
    expect(source).toContain("const workerLeaseHeartbeatMs = 5 * 60 * 1000;");
    expect(source).toContain("startLeaseHeartbeat(row.task_id, row.attempt)");
    expect(source).toContain("stopLeaseHeartbeat();");
  });

  it("单段和多段裁剪只映射第一条音频流", () => {
    const source = readFileSync(resolve("src/worker/codexWorkerCli.ts"), "utf8");

    expect(source.split('"0:a:0?"').length - 1).toBe(2);
    expect(source).not.toContain('"-map", "0:a?"');
  });

  it("视频时长校验使用可配置的帧级尾差", () => {
    const source = readFileSync(resolve("src/worker/codexWorkerCli.ts"), "utf8");

    expect(source).toContain("videoDurationMeetsMinimum(duration, minimumDurationSeconds, frameRate, allowedFrames)");
    expect(source).toContain("视频不可播放或时长不足");
  });
});
