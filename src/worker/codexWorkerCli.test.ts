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
});
