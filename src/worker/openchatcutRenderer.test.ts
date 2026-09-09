import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createWorkerTaskPackage } from "./contracts";
import { executeOpenChatCutRender } from "./openchatcutRenderer";

describe("OpenChatCut Worker render", () => {
  it("通过同一执行边界渲染本地卡片视频", async () => {
    const root = await mkdtemp(join(tmpdir(), "openchatcut-card-"));
    try {
      const taskPackage = createWorkerTaskPackage({
        task: { id: "card-task", type: "generate_a_roll", attempt: 0, budgetLimitCents: 0, maxAttempts: 1, provider: "openchatcut", model: "openchatcut@0.2.14", promptVersion: "card-video-v1" },
        episode: { id: "episode-1", accountId: "account-1", blueprintVersionId: "blueprint-1", title: "测试" },
        capability: "a_roll_generation",
        aRoll: { adapter: "openchatcut_card_video", shot: { id: "shot-1", scriptSegment: "雨落在旧街。", durationSeconds: 3, shotType: "a_roll", productionMethod: "卡片", inputBasis: [{ relativePath: "episodes/episode-1/script.md", sha256: "a".repeat(64) }, { relativePath: "episodes/episode-1/visual.png", sha256: "b".repeat(64) }], targetSpec: "9:16" } },
        allowedTools: ["read", "write"],
        allowedAssetRoot: root,
        output: { requiredArtifactTypes: ["a_roll_video"], contentType: "video/mp4", relativePath: "episodes/episode-1/a-roll/shot-1.mp4", reviewStage: "production_ready" },
        inputArtifacts: [{ artifactType: "main_script", relativePath: "episodes/episode-1/script.md", sha256: "a".repeat(64), fileSize: 1 }, { artifactType: "static_visual", relativePath: "episodes/episode-1/visual.png", sha256: "b".repeat(64), fileSize: 1 }],
      });
      const run = vi.fn(async (_command: string, args: string[]) => {
        const spec = JSON.parse(await readFile(args[0], "utf8")) as { outputPath: string; state: { items: Array<{ props?: { text?: string } }> } };
        expect(spec.state.items[0]?.props?.text).toContain("雨落在旧街。");
        await writeFile(spec.outputPath, "mp4");
      });
      const validateMp4 = vi.fn();
      const result = JSON.parse(await executeOpenChatCutRender({ taskPackage, run, validateMp4, inspectMp4: async () => ({ durationSeconds: 3, width: 1080, height: 1920, hasAudio: false, blackFrameCount: 0 }) }));

      expect(result).toMatchObject({ status: "completed", artifacts: [{ artifactType: "a_roll_video" }] });
      expect(run).toHaveBeenCalledWith("openchatcut", [expect.stringMatching(/spec\.json$/)]);
      expect(validateMp4).toHaveBeenCalledWith(expect.stringMatching(/shot-1\.mp4$/), 3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
