import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("定向生产单调度", () => {
  it("会为人工视频安排派生音频任务", () => {
    const source = readFileSync(resolve("src/orchestration/loopOrchestratorCli.ts"), "utf8");
    const scopedPlanner = source.slice(source.indexOf("async function planScopedMediaTasks"), source.indexOf("async function planWorkerTasks"));

    expect(scopedPlanner).toContain('orchestrateTasks("orchestrate_embedded_audio_tasks", { p_episode_id: episodeId })');
  });
});
