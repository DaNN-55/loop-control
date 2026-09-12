import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createWorkerTaskPackage } from "./contracts";
import { executeOpenChatCutRender, reviewRenderMinimumDurationSeconds } from "./openchatcutRenderer";
import { confirmedTtsRender } from "./openchatcutProject.fixture";

describe("OpenChatCut Worker render", () => {
  it("按已确认的实际镜头时长校验同步预览，而不是沿用旧分镜计划时长", () => {
    const render = confirmedTtsRender();
    render.storyboard.shots[0].durationSeconds = 3;
    render.members[0].durationSeconds = 2.424;
    render.confirmedShots[0].durationDecision = {
      version: "shot-duration/v1",
      audioMode: "tts",
      plannedDurationSeconds: 3,
      actualAudioDurationSeconds: 2.424,
      clipDurationSeconds: 2.424,
      studioAdoptedDurationSeconds: 2.424,
      planDeltaSeconds: -0.576,
      audioVideoDeltaSeconds: 0,
      frameRate: 30,
      allowedFrames: 2,
      frameToleranceSeconds: 2 / 30,
      status: "synchronized",
    };

    expect(reviewRenderMinimumDurationSeconds(render)).toBe(2.424);
  });

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

  it("在启动 OpenChatCut 前拒绝被篡改的冻结 Studio 工程", async () => {
    const root = await mkdtemp(join(tmpdir(), "openchatcut-frozen-integrity-"));
    const episodeId = "00000000-0000-4000-8000-000000000106";
    const relativePath = `episodes/${episodeId}/openchatcut-frozen/00000000-0000-4000-8000-000000000001/project.json`;
    try {
      await mkdir(join(root, relativePath, ".."), { recursive: true });
      await writeFile(join(root, relativePath), "{}\n");
      const render = confirmedTtsRender();
      render.studioProject = { relativePath, sha256: "f".repeat(64), fileSize: 3 };
      render.projectRelativePath = `episodes/${episodeId}/review-render/v1/index.html`;
      const taskPackage = createWorkerTaskPackage({
        task: { id: "review-task", type: "generate_review_render", attempt: 0, budgetLimitCents: 0, maxAttempts: 1, provider: "openchatcut", model: "openchatcut@0.2.14", promptVersion: "review-render-v1" },
        episode: { id: episodeId, accountId: "account-1", blueprintVersionId: "blueprint-1", title: "测试" },
        capability: "review_rendering", allowedTools: ["read", "write"], allowedAssetRoot: root,
        reviewRender: render,
        output: { requiredArtifactTypes: ["review_render_video", "review_render_project", "review_render_runtime", "review_qc_report"], contentType: "video/mp4", relativePath: `episodes/${episodeId}/review-render/v1/review.mp4`, reviewStage: "pre_render" },
        inputArtifacts: render.members.map((member) => ({ artifactType: member.memberKind, relativePath: member.relativePath, sha256: member.sha256, fileSize: 1 })),
      });
      await expect(executeOpenChatCutRender({ taskPackage, run: vi.fn(), validateMp4: vi.fn(), inspectMp4: vi.fn() })).rejects.toThrow("大小或哈希不一致");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
