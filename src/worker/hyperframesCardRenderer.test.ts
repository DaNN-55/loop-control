import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerTaskPackage } from "./contracts";
import { executeHyperframesCardVideo } from "./hyperframesCardRenderer";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("HyperFrames 卡片视频", () => {
  it("按冻结的 A-roll 分镜渲染并校验 MP4", async () => {
    const root = await mkdtemp(join(tmpdir(), "hyperframes-card-"));
    directories.push(root);
    const taskPackage = createWorkerTaskPackage({
      task: { id: "card-task", type: "generate_a_roll", attempt: 0, budgetLimitCents: 0, maxAttempts: 1, provider: "hyperframes", model: "hyperframes@0.7.109", promptVersion: "card-video-v1" },
      episode: { id: "episode-1", accountId: "account-1", blueprintVersionId: "blueprint-1", title: "测试" },
      capability: "a_roll_generation", aRoll: { adapter: "hyperframes_card_video", shot: { id: "shot-1", scriptSegment: "雨落在旧街。", durationSeconds: 3, shotType: "a_roll", productionMethod: "卡片", inputBasis: [{ relativePath: "episodes/episode-1/script.md", sha256: "a".repeat(64) }, { relativePath: "episodes/episode-1/visual.png", sha256: "b".repeat(64) }], targetSpec: "9:16" } },
      allowedTools: ["read", "write"], allowedAssetRoot: root, output: { requiredArtifactTypes: ["a_roll_video"], contentType: "video/mp4", relativePath: "episodes/episode-1/a-roll/shot-1.mp4", reviewStage: "production_ready" }, inputArtifacts: [{ artifactType: "main_script", relativePath: "episodes/episode-1/script.md", sha256: "a".repeat(64), fileSize: 1 }, { artifactType: "static_visual", relativePath: "episodes/episode-1/visual.png", sha256: "b".repeat(64), fileSize: 1 }],
    });
    const run = vi.fn(async (_command: string, args: string[]) => { if (args[0] === "render") await writeFile(args.at(-1)!, "mp4"); });
    const validateMp4 = vi.fn();

    const result = JSON.parse(await executeHyperframesCardVideo({ taskPackage, run, validateMp4 }));

    expect(result).toMatchObject({ status: "completed", artifacts: [{ artifactType: "a_roll_video", relativePath: "episodes/episode-1/a-roll/shot-1.mp4" }] });
    expect(validateMp4).toHaveBeenCalledWith(expect.stringMatching(/episodes\/episode-1\/a-roll\/shot-1\.mp4$/), 3);
    await expect(readFile(join(run.mock.calls[0][1][1], "index.html"), "utf8")).resolves.toContain("雨落在旧街。");
  });
});
