import { describe, expect, it, vi } from "vitest";
import { runCodexWorker } from "./codexRunner";

const claimedTask = {
  taskId: "task-1",
  taskType: "draft_brief",
  attempt: 0,
  budgetLimitCents: 0,
  maxAttempts: 2,
  provider: "codex" as const,
  model: "gpt-5.6-codex",
  promptVersion: "brief-v1",
  episodeId: "episode-1",
  accountId: "account-1",
  blueprintVersionId: "blueprint-1",
  title: "一个可验证的选题",
  allowedAssetRoot: "/Volumes/Media/loop-control/account-1",
  inputSnapshot: {
    capability: "visual_planning",
    allowed_tools: ["read", "write"],
    output: { required_artifact_types: ["brief"], content_type: "text/markdown", relative_path: "episodes/episode-1/brief.md", review_stage: "visual_review" },
    input_artifacts: [],
  },
};

describe("本地 Codex Worker runner", () => {
  it("没有 ready 任务时保持空闲，不调用 Codex", async () => {
    const execute = vi.fn();
    const reportResult = vi.fn();

    await expect(runCodexWorker({ claimNextTask: async () => null, reportResult, execute, verifyAssetRoot: async () => undefined, verifyArtifacts: async () => undefined, actualCostCents: 0 })).resolves.toEqual({ status: "idle" });
    expect(execute).not.toHaveBeenCalled();
    expect(reportResult).not.toHaveBeenCalled();
  });

  it("关闭字幕时接受空字幕正文并进入审核渲染执行", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("stop after package validation"));
    const reportResult = vi.fn();
    const relativePath = "episodes/episode-1/materials/shot.mp4";
    const sha256 = "a".repeat(64);

    await expect(runCodexWorker({
      claimNextTask: async () => ({ ...claimedTask, taskId: "review-render-disabled-subtitle", taskType: "generate_review_render", provider: "openchatcut", model: "openchatcut@0.2.14", promptVersion: "review-render-v1", inputSnapshot: {
        capability: "review_rendering", allowed_tools: ["read", "write"],
        output: { required_artifact_types: ["render", "review_render_project", "review_qc_report"], content_type: "video/mp4", relative_path: "episodes/episode-1/review-render/v1/review-render.mp4", review_stage: "qc_review" },
        input_artifacts: [{ artifactType: "source_video", relativePath, sha256, fileSize: 10 }],
        review_render: {
          project_relative_path: "episodes/episode-1/review-render/v1/index.html", project_revision: 1, pre_render_review_package_id: "package-1", confirmation_mode: "shot_preparation",
          confirmed_shots: [{ shot_id: "shot-1", confirmation_status: "confirmed", input_fingerprint: "1".repeat(32), source_material_revision_id: "material-1", clip_segments: [{ start_seconds: 0, end_seconds: 2 }], audio_mode: "none", audio_track_id: null, subtitle_text: "", subtitles_enabled: false }],
          adjustments: { aspect_ratio: "9:16", width: 1080, height: 1920, captions_enabled: true, caption_style: "minimal", pacing: "standard", crop: "cover", transition: "cut", layout: "lower_third", narration_gain_db: 0, bgm_gain_db: -12, sfx_gain_db: -6, reason: "生成审核视频。" },
          storyboard: { version: "storyboard/v1", audioCues: [], shots: [{ id: "shot-1", scriptSegment: "等待转场", durationSeconds: 2, shotType: "b_roll", productionMethod: "素材", inputBasis: [{ relativePath, sha256 }], targetSpec: "9:16" }] },
          members: [{ member_key: "shot:shot-1", member_kind: "shot_media", source_material_revision_id: "material-1", clip_segments: [{ start_seconds: 0, end_seconds: 2 }], input_fingerprint: "1".repeat(32), audio_mode: "none", audio_track_id: null, subtitle_text: "", subtitles_enabled: false, relative_path: relativePath, sha256, start_seconds: 0, duration_seconds: 2 }],
        },
      } }),
      reportResult, execute, verifyAssetRoot: async () => undefined, verifyArtifacts: async () => undefined, actualCostCents: 0,
    })).resolves.toEqual({ status: "failed", taskId: "review-render-disabled-subtitle" });

    expect(execute).toHaveBeenCalledOnce();
  });

  it("将冻结裁剪配置解析为 Worker 的 ffmpeg 视频输入", async () => {
    const execute = vi.fn().mockResolvedValue(JSON.stringify({
      version: "worker-result/v1",
      taskId: "task-clip",
      status: "completed",
      artifacts: [{ artifactType: "a_roll_video", relativePath: "episodes/episode-1/shot-clips/shot-1.mp4", sha256: "a".repeat(64), fileSize: 128 }],
      validation: { passed: true, checks: [] },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." },
      nextStep: "Await the next controlled production step.",
    }));

    await runCodexWorker({
      claimNextTask: async () => ({
        ...claimedTask,
        taskId: "task-clip",
        taskType: "generate_a_roll",
        provider: "ffmpeg",
        model: "ffmpeg",
        promptVersion: "shot-clip-v1",
        inputSnapshot: {
          capability: "shot_clip_preparation",
          allowed_tools: ["read", "write"],
          media: { adapter: "ffmpeg_trim_video", video_clip: { source_relative_path: "episodes/episode-1/materials/source.mp4", start_seconds: 1, end_seconds: 4, target_duration_seconds: 3 } },
          output: { required_artifact_types: ["a_roll_video"], content_type: "video/mp4", relative_path: "episodes/episode-1/shot-clips/shot-1.mp4", review_stage: "production_ready" },
          input_artifacts: [{ artifactType: "source_video", relativePath: "episodes/episode-1/materials/source.mp4", sha256: "b".repeat(64), fileSize: 10 }],
        },
      }),
      reportResult: vi.fn().mockResolvedValue(undefined),
      execute,
      verifyAssetRoot: async () => undefined,
      verifyArtifacts: async () => undefined,
      actualCostCents: 0,
    });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ provider: "ffmpeg", media: { adapter: "ffmpeg_trim_video", videoClip: { sourceRelativePath: "episodes/episode-1/materials/source.mp4", startSeconds: 1, endSeconds: 4, targetDurationSeconds: 3 } } }));
  });

  it("将多段裁剪配置按原顺序交给 Worker", async () => {
    const execute = vi.fn().mockResolvedValue(JSON.stringify({
      version: "worker-result/v1", taskId: "task-multi-clip", status: "completed", artifacts: [],
      validation: { passed: true, checks: [] }, actualCostCents: 0, blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." }, nextStep: "Done.",
    }));
    await runCodexWorker({
      claimNextTask: async () => ({ ...claimedTask, taskId: "task-multi-clip", taskType: "generate_a_roll", provider: "ffmpeg", model: "ffmpeg", promptVersion: "shot-clip-v2", inputSnapshot: {
        capability: "shot_clip_preparation", allowed_tools: ["read", "write"],
        media: { adapter: "ffmpeg_trim_video", video_clips: { source_relative_path: "episodes/episode-1/materials/source.mp4", segments: [{ start_seconds: 1, end_seconds: 2 }, { start_seconds: 4, end_seconds: 6 }], target_duration_seconds: 3 } },
        output: { required_artifact_types: ["a_roll_video"], content_type: "video/mp4", relative_path: "episodes/episode-1/shot-clips/shot-1.mp4", review_stage: "production_ready" },
        input_artifacts: [{ artifactType: "source_video", relativePath: "episodes/episode-1/materials/source.mp4", sha256: "b".repeat(64), fileSize: 10 }],
      } }), reportResult: vi.fn(), execute, verifyAssetRoot: async () => undefined, verifyArtifacts: async () => undefined, actualCostCents: 0,
    });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ media: { adapter: "ffmpeg_trim_video", videoClips: { sourceRelativePath: "episodes/episode-1/materials/source.mp4", segments: [{ startSeconds: 1, endSeconds: 2 }, { startSeconds: 4, endSeconds: 6 }], targetDurationSeconds: 3 } } }));
  });

  it("将通过校验的 Codex 结果回写给同一个任务", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    const preflight = vi.fn().mockResolvedValue({
      version: "worker-preflight/v1",
      checks: [{ capability: "visual_planning", check: "capability_registration", phase: "preflight", status: "passed", reason: "Worker 已注册 codex 执行路径。", action: "none", scope: "worker" }],
    });
    const execute = vi.fn().mockResolvedValue(JSON.stringify({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "completed",
      artifacts: [{ artifactType: "brief", relativePath: "episodes/episode-1/brief.md", sha256: "a".repeat(64), fileSize: 128 }],
      validation: { passed: true, checks: [{ name: "schema", passed: true, detail: "brief is complete" }] },
      actualCostCents: 999,
      blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." },
      nextStep: "Create the script draft task.",
    }));

    await expect(runCodexWorker({ claimNextTask: async () => claimedTask, reportResult, execute, preflight, verifyAssetRoot: async () => undefined, verifyArtifacts: async () => undefined, actualCostCents: 0 })).resolves.toEqual({ status: "completed", taskId: "task-1" });
    expect(reportResult).toHaveBeenCalledWith("task-1", 0, expect.objectContaining({ actualCostCents: 0, status: "completed", preflight: expect.objectContaining({ version: "worker-preflight/v1" }) }));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account-1", episode: expect.objectContaining({ blueprintVersionId: "blueprint-1" }) }));
  });

  it("把已冻结的脚本委托内容原样交给 Worker", async () => {
    const execute = vi.fn().mockResolvedValue(JSON.stringify({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "completed",
      artifacts: [{ artifactType: "script", relativePath: "episodes/episode-1/generated-script-v1.md", sha256: "a".repeat(64), fileSize: 128 }],
      validation: { passed: true, checks: [{ name: "schema", passed: true, detail: "script is complete" }] },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." },
      nextStep: "Submit the script for Owner review.",
    }));
    const reportResult = vi.fn().mockResolvedValue(undefined);

    await runCodexWorker({
      claimNextTask: async () => ({
        ...claimedTask,
        taskType: "draft_script",
        inputSnapshot: {
          capability: "script_writing",
          commission: { creative_direction: "雨夜民俗悬疑", core_content: "仪式感与人物抉择" },
          harness: { id: "harness-1", version: 2, content: "开头三秒提出冲突。", content_hash: "a".repeat(64), adapter: "codex", model: "gpt-5.6-codex", prompt_version: "script-writing-v2" },
          review_feedback: { review_package_id: "review-1", reason: "补充人物动机", actor_id: "owner-1" },
          allowed_tools: ["read", "write"],
          output: { required_artifact_types: ["script"], content_type: "text/markdown", relative_path: "episodes/episode-1/generated-script-v1.md", review_stage: "script_review" },
          input_artifacts: [],
        },
      }),
      reportResult,
      execute,
      verifyAssetRoot: async () => undefined,
      verifyArtifacts: async () => undefined,
      actualCostCents: 0,
    });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      commission: { creativeDirection: "雨夜民俗悬疑", coreContent: "仪式感与人物抉择" },
      promptHarness: { id: "harness-1", version: 2, content: "开头三秒提出冲突。", contentHash: "a".repeat(64), adapter: "codex", model: "gpt-5.6-codex", promptVersion: "script-writing-v2" },
      reviewFeedback: { reviewPackageId: "review-1", reason: "补充人物动机" },
    }));
  });

  it("把已冻结的系列基准原样交给视觉 Worker", async () => {
    const execute = vi.fn().mockResolvedValue(JSON.stringify({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "completed",
      artifacts: [{ artifactType: "visual_brief", relativePath: "episodes/episode-1/brief.md", sha256: "a".repeat(64), fileSize: 128 }],
      validation: { passed: true, checks: [{ name: "schema", passed: true, detail: "visual brief is complete" }] },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." },
      nextStep: "Submit the visual package for Owner review.",
    }));

    await runCodexWorker({
      claimNextTask: async () => ({
        ...claimedTask,
        inputSnapshot: {
          ...claimedTask.inputSnapshot,
          series_baseline: { version_id: "series-version-3", version: 3, rules: { visual_style: "写实雨夜" } },
        },
      }),
      reportResult: vi.fn().mockResolvedValue(undefined),
      execute,
      verifyAssetRoot: async () => undefined,
      verifyArtifacts: async () => undefined,
      actualCostCents: 0,
    });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      seriesBaseline: { versionId: "series-version-3", version: 3, rules: { visual_style: "写实雨夜" } },
    }));
  });

  it("没有系列基准时省略可选字段", async () => {
    const execute = vi.fn().mockResolvedValue(JSON.stringify({
      version: "worker-result/v1", taskId: "task-1", status: "completed", artifacts: [],
      validation: { passed: true, checks: [] }, actualCostCents: 0, blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." }, nextStep: "Done.",
    }));

    await runCodexWorker({
      claimNextTask: async () => ({ ...claimedTask, inputSnapshot: { ...claimedTask.inputSnapshot, series_baseline: null } }),
      reportResult: vi.fn().mockResolvedValue(undefined),
      execute,
      verifyAssetRoot: async () => undefined,
      verifyArtifacts: async () => undefined,
      actualCostCents: 0,
    });

    expect(execute.mock.calls[0]?.[0]).not.toHaveProperty("seriesBaseline");
  });

  it("把冻结的外部视觉输入交给视觉资产准备，不调用 SVG 占位路径", async () => {
    const execute = vi.fn().mockResolvedValue(JSON.stringify({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "completed",
      artifacts: [{ artifactType: "visual_asset_manifest", relativePath: "episodes/episode-1/visual-assets-v1.md", sha256: "a".repeat(64), fileSize: 128 }],
      validation: { passed: true, checks: [{ name: "manifest", passed: true, detail: "外部视觉素材与缺失项已列出。" }] },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." },
      nextStep: "Submit the visual asset manifest for Owner review.",
    }));
    const externalInput = { artifactType: "external_visual_input", relativePath: "episodes/episode-1/materials/character.png", sha256: "b".repeat(64), fileSize: 128 };

    await runCodexWorker({
      claimNextTask: async () => ({
        ...claimedTask,
        taskType: "prepare_visual_brief",
        inputSnapshot: {
          capability: "visual_planning",
          visual_assets: { external_inputs: [externalInput] },
          allowed_tools: ["read", "write"],
          output: { required_artifact_types: ["visual_asset_manifest"], content_type: "text/markdown", relative_path: "episodes/episode-1/visual-assets-v1.md", review_stage: "visual_review" },
          input_artifacts: [
            { artifactType: "main_script", relativePath: "episodes/episode-1/main-script.md", sha256: "c".repeat(64), fileSize: 128 },
            externalInput,
          ],
        },
      }),
      reportResult: vi.fn().mockResolvedValue(undefined),
      execute,
      verifyAssetRoot: async () => undefined,
      verifyArtifacts: async () => undefined,
      actualCostCents: 0,
    });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      visualAssetPreparation: { externalInputs: [externalInput] },
      output: expect.objectContaining({ requiredArtifactTypes: ["visual_asset_manifest"] }),
    }));
  });

  it("把冻结的分层 Prompt 上下文传给 Codex Worker", async () => {
    const execute = vi.fn().mockResolvedValue(JSON.stringify({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "completed",
      artifacts: [],
      validation: { passed: true, checks: [] },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." },
      nextStep: "Submit the visual package for Owner review.",
    }));

    await runCodexWorker({
      claimNextTask: async () => ({ ...claimedTask, inputSnapshot: { ...claimedTask.inputSnapshot, prompt_context: { version: "prompt-context/v1", blueprint_version_id: "blueprint-1", series_version_id: "series-version-3", account_hard_constraints: { restrictions: ["不得承诺医疗效果"] }, account_defaults: { positioning: "民俗短视频" }, series_baseline: { version_id: "series-version-3", version: 3, rules: { visual_style: "写实雨夜" } }, episode_input: { commission: { creative_direction: "克制", core_content: "人物选择" } }, review_feedback: { reason: "补充人物动机" }, hash: "context-hash-1" } } }),
      reportResult: vi.fn().mockResolvedValue(undefined),
      execute,
      verifyAssetRoot: async () => undefined,
      verifyArtifacts: async () => undefined,
      actualCostCents: 0,
    });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ promptContext: expect.objectContaining({ version: "prompt-context/v1", blueprintVersionId: "blueprint-1", seriesVersionId: "series-version-3", hash: "context-hash-1" }) }));
  });

  it("把逐镜头批注和已批准视觉依据冻结给分镜 Worker", async () => {
    const verifyArtifacts = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue(JSON.stringify({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "completed",
      artifacts: [{ artifactType: "storyboard", relativePath: "episodes/episode-1/storyboard-v2.json", sha256: "a".repeat(64), fileSize: 128 }],
      storyboard: {
        version: "storyboard/v1",
        shots: [{
          id: "shot-02",
          scriptSegment: "铜铃声切入。",
          durationSeconds: 4,
          shotType: "b_roll",
          productionMethod: "素材库特写",
          inputBasis: [
            { relativePath: "episodes/episode-1/main-script.md", sha256: "c".repeat(64) },
            { relativePath: "episodes/episode-1/visual-brief-v1.md", sha256: "b".repeat(64) },
          ],
          targetSpec: "9:16，1080×1920，24fps",
        }],
      },
      validation: { passed: true, checks: [{ name: "schema", passed: true, detail: "storyboard is complete" }] },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." },
      nextStep: "Submit the storyboard for Owner review.",
    }));

    await runCodexWorker({
      claimNextTask: async () => ({
        ...claimedTask,
        taskType: "draft_storyboard",
        inputSnapshot: {
          capability: "storyboard_planning",
          harness: { id: "harness-storyboard-1", version: 3, content: "先确定镜头叙事目的，再编排可执行声画。", content_hash: "d".repeat(64), adapter: "codex", model: "gpt-5.6-luna", prompt_version: "storyboard-planning-v3" },
          review_annotations: [{ shot_id: "shot-02", reason: "铜铃特写需要延长。" }],
          allowed_tools: ["read", "write"],
          output: { required_artifact_types: ["storyboard"], content_type: "application/json", relative_path: "episodes/episode-1/storyboard-v2.json", review_stage: "storyboard_review" },
          input_artifacts: [
            { artifactType: "main_script", relativePath: "episodes/episode-1/main-script.md", sha256: "c".repeat(64), fileSize: 128 },
            { artifactType: "visual_brief", relativePath: "episodes/episode-1/visual-brief-v1.md", sha256: "b".repeat(64), fileSize: 128 },
          ],
        },
      }),
      reportResult: vi.fn().mockResolvedValue(undefined),
      execute,
      verifyAssetRoot: async () => undefined,
      verifyArtifacts,
      actualCostCents: 0,
    });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      promptHarness: { id: "harness-storyboard-1", version: 3, content: "先确定镜头叙事目的，再编排可执行声画。", contentHash: "d".repeat(64), adapter: "codex", model: "gpt-5.6-luna", promptVersion: "storyboard-planning-v3" },
      reviewAnnotations: [{ shotId: "shot-02", reason: "铜铃特写需要延长。" }],
      output: expect.objectContaining({ reviewStage: "storyboard_review" }),
      assets: expect.objectContaining({ inputs: [expect.objectContaining({ artifactType: "main_script" }), expect.objectContaining({ artifactType: "visual_brief" })] }),
    }));
    expect(verifyArtifacts).toHaveBeenLastCalledWith(expect.any(Object), [expect.objectContaining({ artifactType: "storyboard" })], expect.objectContaining({ version: "storyboard/v1", shots: [expect.objectContaining({ id: "shot-02" })] }));
  });

  it("阻塞未冻结 Adapter 与 Prompt Harness 的分镜任务，且不调用 Codex", async () => {
    const execute = vi.fn();
    const reportResult = vi.fn().mockResolvedValue(undefined);

    await expect(runCodexWorker({
      claimNextTask: async () => ({
        ...claimedTask,
        taskType: "draft_storyboard",
        inputSnapshot: {
          capability: "storyboard_planning",
          allowed_tools: ["read", "write"],
          output: { required_artifact_types: ["storyboard"], content_type: "application/json", relative_path: "episodes/episode-1/storyboard-v1.json", review_stage: "storyboard_review" },
          input_artifacts: [],
        },
      }),
      execute,
      reportResult,
      verifyAssetRoot: async () => undefined,
      verifyArtifacts: async () => undefined,
      actualCostCents: 0,
    })).resolves.toEqual({ status: "blocked", taskId: "task-1" });

    expect(execute).not.toHaveBeenCalled();
    expect(reportResult).toHaveBeenCalledWith("task-1", 0, expect.objectContaining({ blockers: [expect.objectContaining({ detail: expect.stringContaining("Prompt Harness") })] }));
  });

  it("把冻结的 A-roll 镜头、适配器与输入交给 Worker", async () => {
    const execute = vi.fn().mockResolvedValue(JSON.stringify({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "blocked",
      artifacts: [],
      validation: { passed: false, checks: [] },
      actualCostCents: 0,
      blockers: [{ code: "adapter_unavailable", detail: "The declared adapter is unavailable." }],
      retry: { shouldRetry: false, reason: "Owner action is required." },
      nextStep: "Configure the frozen adapter.",
    }));

    await runCodexWorker({
      claimNextTask: async () => ({
        ...claimedTask,
        taskType: "generate_a_roll",
        inputSnapshot: {
          capability: "a_roll_generation",
          executor: { adapter: "codex", model: "gpt-5.6-luna", prompt_version: "a-roll-v1", provider: "codex" },
          allowed_tools: ["read", "write"],
          shot: {
            id: "shot-01",
            scriptSegment: "林砚进入古宅。",
            durationSeconds: 4,
            shotType: "a_roll",
            productionMethod: "数字人表演",
            inputBasis: [
              { relativePath: "episodes/episode-1/main-script.md", sha256: "a".repeat(64) },
              { relativePath: "episodes/episode-1/visual-brief.md", sha256: "b".repeat(64) },
            ],
            targetSpec: "9:16，1080×1920，24fps",
          },
          output: { required_artifact_types: ["a_roll_video"], content_type: "video/mp4", relative_path: "episodes/episode-1/a-roll/shot-01.mp4", review_stage: "production_ready" },
          input_artifacts: [
            { artifactType: "main_script", relativePath: "episodes/episode-1/main-script.md", sha256: "a".repeat(64), fileSize: 128 },
            { artifactType: "visual_brief", relativePath: "episodes/episode-1/visual-brief.md", sha256: "b".repeat(64), fileSize: 128 },
          ],
        },
      }),
      reportResult: vi.fn().mockResolvedValue(undefined),
      execute,
      verifyAssetRoot: async () => undefined,
      verifyArtifacts: async () => undefined,
      actualCostCents: 0,
    });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      aRoll: expect.objectContaining({ adapter: "codex", shot: expect.objectContaining({ id: "shot-01", shotType: "a_roll" }) }),
      assets: expect.objectContaining({ inputs: [expect.objectContaining({ artifactType: "main_script" }), expect.objectContaining({ artifactType: "visual_brief" })] }),
    }));
  });

  it("缺少资产根目录时写入 blocked，不调用 Codex", async () => {
    const execute = vi.fn();
    const reportResult = vi.fn().mockResolvedValue(undefined);

    await expect(runCodexWorker({ claimNextTask: async () => ({ ...claimedTask, allowedAssetRoot: "" }), reportResult, execute, verifyAssetRoot: async () => undefined, verifyArtifacts: async () => undefined, actualCostCents: 0 })).resolves.toEqual({ status: "blocked", taskId: "task-1" });
    expect(execute).not.toHaveBeenCalled();
    expect(reportResult).toHaveBeenCalledWith("task-1", 0, expect.objectContaining({ status: "blocked", blockers: expect.any(Array) }));
  });

  it("没有视觉输入且图片 Adapter 未注册时回写 Worker 能力阻塞", async () => {
    const execute = vi.fn();
    const reportResult = vi.fn().mockResolvedValue(undefined);

    await expect(runCodexWorker({
      claimNextTask: async () => ({
        ...claimedTask,
        taskType: "prepare_visual_brief",
        inputSnapshot: {
          capability: "visual_planning",
          visual_assets: { external_inputs: [] },
          allowed_tools: ["read", "write"],
          output: { required_artifact_types: ["visual_asset_manifest"], content_type: "text/markdown", relative_path: "episodes/episode-1/visual-assets-v1.md", review_stage: "visual_review" },
          input_artifacts: [{ artifactType: "main_script", relativePath: "episodes/episode-1/main-script.md", sha256: "a".repeat(64), fileSize: 128 }],
        },
      }),
      reportResult,
      execute,
      verifyAssetRoot: async () => undefined,
      verifyArtifacts: async () => undefined,
      actualCostCents: 0,
    })).resolves.toEqual({ status: "blocked", taskId: "task-1" });

    expect(execute).not.toHaveBeenCalled();
    expect(reportResult).toHaveBeenCalledWith("task-1", 0, expect.objectContaining({
      status: "blocked",
      preflight: expect.objectContaining({ checks: [expect.objectContaining({ capability: "static_visual_generation", check: "capability_registration", action: "contact_environment_admin", scope: "worker" })] }),
      blockers: [expect.objectContaining({ code: "capability_registration", check: "capability_registration", action: "contact_environment_admin", scope: "worker" })],
    }));
  });

  it("资产根目录不可访问时写入 blocked，不调用 Codex", async () => {
    const execute = vi.fn();
    const reportResult = vi.fn().mockResolvedValue(undefined);

    await expect(runCodexWorker({
      claimNextTask: async () => claimedTask,
      reportResult,
      execute,
      actualCostCents: 0,
      verifyAssetRoot: async () => { throw new Error("资产根目录未挂载或不可写。"); },
      verifyArtifacts: async () => undefined,
    })).resolves.toEqual({ status: "blocked", taskId: "task-1" });

    expect(execute).not.toHaveBeenCalled();
    expect(reportResult).toHaveBeenCalledWith("task-1", 0, expect.objectContaining({
      status: "blocked",
      preflight: expect.objectContaining({ checks: [expect.objectContaining({ check: "asset_root", action: "contact_environment_admin" })] }),
      blockers: [expect.objectContaining({ code: "asset_root_unavailable", check: "asset_root", action: "contact_environment_admin" })],
    }));
  });

  it("在执行前回写结构化 preflight 阻塞，不调用 Worker", async () => {
    const execute = vi.fn();
    const reportResult = vi.fn().mockResolvedValue(undefined);
    const preflight = vi.fn().mockResolvedValue({
      version: "worker-preflight/v1",
      checks: [{
        capability: "b_roll_generation",
        check: "credential_presence",
        phase: "preflight",
        status: "unavailable",
        reason: "PEXELS_API_KEY 未配置。",
        action: "contact_environment_admin",
        scope: "worker",
      }],
    });

    await expect(runCodexWorker({ claimNextTask: async () => claimedTask, reportResult, execute, preflight, verifyAssetRoot: async () => undefined, verifyArtifacts: async () => undefined, actualCostCents: 0 })).resolves.toEqual({ status: "blocked", taskId: "task-1" });

    expect(preflight).toHaveBeenCalledWith(expect.objectContaining({ capability: "visual_planning" }));
    expect(execute).not.toHaveBeenCalled();
    expect(reportResult).toHaveBeenCalledWith("task-1", 0, expect.objectContaining({
      status: "blocked",
      preflight: expect.objectContaining({ version: "worker-preflight/v1" }),
      blockers: [expect.objectContaining({ check: "credential_presence", action: "contact_environment_admin", scope: "worker" })],
    }));
  });

  it("把 B-roll 的冻结连接引用交给预检和 Worker", async () => {
    const inputBasis = [
      { relativePath: "episodes/episode-1/script.md", sha256: "a".repeat(64) },
      { relativePath: "episodes/episode-1/visual.png", sha256: "b".repeat(64) },
    ];
    const preflight = vi.fn().mockResolvedValue({
      version: "worker-preflight/v1",
      checks: [{ capability: "b_roll_generation", check: "credential_presence", phase: "preflight", status: "unavailable", reason: "Pexels 连接缺少凭据。", action: "contact_environment_admin", scope: "worker" }],
    });

    await runCodexWorker({
      claimNextTask: async () => ({
        ...claimedTask,
        taskType: "generate_b_roll",
        provider: "pexels",
        model: "pexels-video-v1",
        promptVersion: "b-roll-v1",
        inputSnapshot: {
          capability: "b_roll_generation",
          credential_ref: "11111111-1111-4111-8111-111111111111",
          media: { adapter: "pexels_video", b_roll: { query: "rainy street", target_duration_seconds: 3, shot: { id: "shot-1", scriptSegment: "rainy street", durationSeconds: 3, shotType: "b_roll", productionMethod: "Pexels", inputBasis, targetSpec: "9:16" } } },
          allowed_tools: ["read", "write"],
          output: { required_artifact_types: ["b_roll_asset"], content_type: "video/mp4", relative_path: "episodes/episode-1/b-roll/shot-1.mp4", review_stage: "production_ready" },
          input_artifacts: [{ artifactType: "main_script", ...inputBasis[0], fileSize: 128 }, { artifactType: "static_visual", ...inputBasis[1], fileSize: 128 }],
        },
      }),
      preflight,
      reportResult: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn(),
      verifyAssetRoot: async () => undefined,
      verifyArtifacts: async () => undefined,
      actualCostCents: 0,
    });

    expect(preflight).toHaveBeenCalledWith(expect.objectContaining({ credentialRef: "11111111-1111-4111-8111-111111111111", media: { adapter: "pexels_video", bRoll: expect.any(Object) } }));
  });

  it("把 retryable preflight 报告为可自动重试的失败", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn();

    await expect(runCodexWorker({
      claimNextTask: async () => claimedTask,
      reportResult,
      execute,
      preflight: async () => ({
        version: "worker-preflight/v1",
        checks: [{ capability: "visual_planning", check: "network_request", phase: "preflight", status: "retryable", reason: "供应商连接暂时失败。", action: "retry", scope: "worker" }],
      }),
      verifyAssetRoot: async () => undefined,
      verifyArtifacts: async () => undefined,
      actualCostCents: 0,
    })).resolves.toEqual({ status: "failed", taskId: "task-1" });

    expect(execute).not.toHaveBeenCalled();
    expect(reportResult).toHaveBeenCalledWith("task-1", 0, expect.objectContaining({
      status: "failed",
      retry: { shouldRetry: true, reason: "供应商连接暂时失败。" },
      blockers: [expect.objectContaining({ action: "retry", status: "retryable" })],
    }));
  });

  it("输入产物校验失败时写入 blocked，不调用 Codex", async () => {
    const execute = vi.fn();
    const reportResult = vi.fn().mockResolvedValue(undefined);

    await expect(runCodexWorker({
      claimNextTask: async () => ({
        ...claimedTask,
        inputSnapshot: {
          ...claimedTask.inputSnapshot,
          input_artifacts: [{ artifactType: "research_notes", relativePath: "episodes/episode-1/research.md", sha256: "a".repeat(64), fileSize: 128 }],
        },
      }),
      reportResult,
      execute,
      actualCostCents: 0,
      verifyAssetRoot: async () => undefined,
      verifyArtifacts: async (_taskPackage, artifacts) => {
        if (artifacts[0]?.artifactType === "research_notes") throw new Error("research.md 的 SHA-256 不匹配。");
      },
    })).resolves.toEqual({ status: "blocked", taskId: "task-1" });

    expect(execute).not.toHaveBeenCalled();
    expect(reportResult).toHaveBeenCalledWith("task-1", 0, expect.objectContaining({
      status: "blocked",
      blockers: [expect.objectContaining({ code: "input_artifacts_invalid" })],
    }));
  });

  it("产物文件无法验证时不回写 completed，而是回写 failed", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue(JSON.stringify({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "completed",
      artifacts: [{ artifactType: "brief", relativePath: "episodes/episode-1/brief.md", sha256: "a".repeat(64), fileSize: 128 }],
      validation: { passed: true, checks: [{ name: "schema", passed: true, detail: "brief is complete" }] },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." },
      nextStep: "Create the script draft task.",
    }));

    await expect(runCodexWorker({
      claimNextTask: async () => claimedTask,
      reportResult,
      execute,
      verifyAssetRoot: async () => undefined,
      verifyArtifacts: async (_taskPackage, artifacts) => {
        if (artifacts.length > 0) throw new Error("brief.md 的 SHA-256 不匹配。");
      },
      actualCostCents: 0,
    })).resolves.toEqual({ status: "failed", taskId: "task-1" });

    expect(reportResult).toHaveBeenCalledWith("task-1", 0, expect.objectContaining({ status: "failed" }));
  });

  it("Codex 执行失败时按任务重试上限回写 failed", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);

    await expect(runCodexWorker({ claimNextTask: async () => claimedTask, reportResult, execute: async () => { throw new Error("temporary provider failure"); }, verifyAssetRoot: async () => undefined, verifyArtifacts: async () => undefined, actualCostCents: 0 })).resolves.toEqual({ status: "failed", taskId: "task-1" });
    expect(reportResult).toHaveBeenCalledWith("task-1", 0, expect.objectContaining({ status: "failed", retry: { shouldRetry: true, reason: "temporary provider failure" } }));
  });

  it("真实网络失败回写 execution 阶段网络检查", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);

    await expect(runCodexWorker({ claimNextTask: async () => claimedTask, reportResult, execute: async () => { throw new Error("供应商网络连接超时"); }, verifyAssetRoot: async () => undefined, verifyArtifacts: async () => undefined, actualCostCents: 0 })).resolves.toEqual({ status: "failed", taskId: "task-1" });

    expect(reportResult).toHaveBeenCalledWith("task-1", 0, expect.objectContaining({
      status: "failed",
      preflight: expect.objectContaining({ checks: [expect.objectContaining({ check: "network_connectivity", phase: "execution", status: "retryable", action: "retry" })] }),
      blockers: [expect.objectContaining({ check: "network_connectivity", status: "retryable", action: "retry" })],
    }));
  });

  it("真实模型权限失败回写 execution 阶段模型权限检查", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);

    await expect(runCodexWorker({ claimNextTask: async () => claimedTask, reportResult, execute: async () => { throw new Error("模型没有权限访问当前模型"); }, verifyAssetRoot: async () => undefined, verifyArtifacts: async () => undefined, actualCostCents: 0 })).resolves.toEqual({ status: "failed", taskId: "task-1" });

    expect(reportResult).toHaveBeenCalledWith("task-1", 0, expect.objectContaining({
      status: "failed",
      preflight: expect.objectContaining({ checks: [expect.objectContaining({ check: "model_permission", phase: "execution", status: "unavailable", action: "contact_environment_admin" })] }),
      blockers: [expect.objectContaining({ check: "model_permission", status: "unavailable", action: "contact_environment_admin" })],
    }));
  });

  it("OpenAI Images 模型拒绝要求修改蓝图，认证拒绝要求管理连接", async () => {
    const reportResult = vi.fn().mockResolvedValue(undefined);
    const imageTask = { ...claimedTask, inputSnapshot: { capability: "visual_planning", allowed_tools: ["read", "write"], output: { required_artifact_types: ["brief"], content_type: "text/markdown", relative_path: "episodes/episode-1/brief.md", review_stage: "visual_review" }, input_artifacts: [], visual_assets: { external_inputs: [], image_generation: { provider: "openai", adapter: "openai_images", model: "bad-model", credential_ref: "11111111-1111-4111-8111-111111111111" } } } };

    await runCodexWorker({ claimNextTask: async () => imageTask, reportResult, execute: async () => { throw new Error("OpenAI Images HTTP 400: model unsupported"); }, verifyAssetRoot: async () => undefined, verifyArtifacts: async () => undefined, actualCostCents: 0 });
    expect(reportResult).toHaveBeenCalledWith("task-1", 0, expect.objectContaining({ blockers: [expect.objectContaining({ capability: "static_visual_generation", check: "model_permission", action: "edit_blueprint", scope: "blueprint" })] }));

    reportResult.mockClear();
    await runCodexWorker({ claimNextTask: async () => imageTask, reportResult, execute: async () => { throw new Error("OpenAI Images HTTP 401: invalid api key"); }, verifyAssetRoot: async () => undefined, verifyArtifacts: async () => undefined, actualCostCents: 0 });
    expect(reportResult).toHaveBeenCalledWith("task-1", 0, expect.objectContaining({ blockers: [expect.objectContaining({ capability: "static_visual_generation", check: "credential_validity", action: "manage_connection", scope: "connection" })] }));
  });
});
