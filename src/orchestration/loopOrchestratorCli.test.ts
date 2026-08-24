import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("定向生产单调度", () => {
  it("会为指定生产单安排核心、声轨与人工视频派生音频任务", () => {
    const source = readFileSync(resolve("src/orchestration/loopOrchestratorCli.ts"), "utf8");
    const scopedPlanner = source.slice(source.indexOf("async function planScopedMediaTasks"), source.indexOf("async function planWorkerTasks"));

    expect(scopedPlanner).toContain('orchestrateTasks("orchestrate_provided_script_tasks_for_episode", { p_episode_id: episodeId })');
    expect(scopedPlanner).toContain('orchestrateTasks("orchestrate_storyboard_tasks_for_episode", { p_episode_id: episodeId })');
    expect(scopedPlanner).toContain('orchestrateTasks("orchestrate_soundtrack_tasks", { p_episode_id: episodeId })');
    expect(scopedPlanner).toContain('orchestrateTasks("orchestrate_embedded_audio_tasks", { p_episode_id: episodeId })');
  });

  it("全局调度会创建声轨任务", () => {
    const source = readFileSync(resolve("src/orchestration/loopOrchestratorCli.ts"), "utf8");
    const workerPlanner = source.slice(source.indexOf("async function planWorkerTasks"), source.indexOf("async function orchestrateTasks"));

    expect(workerPlanner).toContain('orchestrateTasks("orchestrate_soundtrack_tasks")');
  });
});
