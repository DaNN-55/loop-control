import { describe, expect, it } from "vitest";
import { createWorkerTaskPackage, validateWorkerResult } from "./contracts";
import type { WorkerTaskPackageInput } from "./contracts";

const packageInput: WorkerTaskPackageInput = {
  task: {
    id: "task-1",
    type: "draft_brief",
    attempt: 0,
    budgetLimitCents: 0,
    maxAttempts: 2,
    provider: "codex",
    model: "gpt-5.6-codex",
    promptVersion: "brief-v1",
  },
  episode: {
    id: "episode-1",
    accountId: "account-1",
    blueprintVersionId: "blueprint-3",
    title: "一个可验证的选题",
  },
  capability: "visual_planning",
  allowedTools: ["read", "write"],
  allowedAssetRoot: "/Volumes/Media/tk-workflow/account-1",
  output: { requiredArtifactTypes: ["brief"], contentType: "text/markdown", relativePath: "episodes/episode-1/brief.md", reviewStage: "visual_review" },
  inputArtifacts: [
    {
      artifactType: "research_notes",
      relativePath: "episodes/episode-1/research.md",
      sha256: "a".repeat(64),
      fileSize: 128,
    },
  ],
};
const storyboardHarness = { id: "harness-storyboard-1", version: 1, content: "根据已审核输入生成可执行分镜。", contentHash: "d".repeat(64), adapter: "codex" as const, model: "gpt-5.6-codex", promptVersion: "storyboard-planning-v1" };

describe("Worker 契约", () => {
  it("构建包含固定账号、蓝图、预算和禁止事项的任务包", () => {
    expect(createWorkerTaskPackage(packageInput)).toMatchObject({
      version: "worker-task/v1",
      provider: "codex",
      capability: "visual_planning",
      allowedTools: ["read", "write"],
      accountId: "account-1",
      episode: { id: "episode-1", blueprintVersionId: "blueprint-3" },
      budget: { limitCents: 0, maxAttempts: 2, attempt: 0 },
      assets: { allowedRoot: "/Volumes/Media/tk-workflow/account-1" },
      output: { requiredArtifactTypes: ["brief"], contentType: "text/markdown", relativePath: "episodes/episode-1/brief.md", reviewStage: "visual_review" },
      forbiddenActions: ["approve", "publish", "change_blueprint", "change_episode_stage"],
    });
  });

  it("在 B-roll Worker 任务包中冻结非秘密连接引用", () => {
    const inputBasis = [
      { relativePath: "episodes/episode-1/script.md", sha256: "a".repeat(64) },
      { relativePath: "episodes/episode-1/visual.png", sha256: "b".repeat(64) },
    ];
    const taskPackage = createWorkerTaskPackage({
      ...packageInput,
      task: { ...packageInput.task, type: "generate_b_roll", provider: "pexels", model: "pexels-video-v1", promptVersion: "b-roll-v1" },
      capability: "b_roll_generation",
      credentialRef: "pexels-default",
      media: { adapter: "pexels_video", bRoll: { query: "rainy street", targetDurationSeconds: 3, shot: { id: "shot-1", scriptSegment: "rainy street", durationSeconds: 3, shotType: "b_roll", productionMethod: "Pexels", inputBasis, targetSpec: "9:16" } } },
      output: { requiredArtifactTypes: ["b_roll_asset"], contentType: "video/mp4", relativePath: "episodes/episode-1/b-roll/shot-1.mp4", reviewStage: "production_ready" },
      inputArtifacts: [{ artifactType: "main_script", ...inputBasis[0], fileSize: 128 }, { artifactType: "static_visual", ...inputBasis[1], fileSize: 128 }],
    });

    expect(taskPackage).toMatchObject({ provider: "pexels", credentialRef: "pexels-default", media: { adapter: "pexels_video" } });
  });

  it("把固定的系列基准原样放入视觉 Worker 任务包", () => {
    const taskPackage = createWorkerTaskPackage({
      ...packageInput,
      seriesBaseline: {
        versionId: "series-version-3",
        version: 3,
        rules: { characters: [{ name: "林砚", visual: "深色雨衣" }], visual_style: "写实雨夜" },
      },
    });

    expect(taskPackage.seriesBaseline).toEqual({
      versionId: "series-version-3",
      version: 3,
      rules: { characters: [{ name: "林砚", visual: "深色雨衣" }], visual_style: "写实雨夜" },
    });
  });

  it("没有导入视觉素材且没有已登记图片 Adapter 时阻塞视觉资产准备", () => {
    expect(() => createWorkerTaskPackage({
      ...packageInput,
      visualAssetPreparation: { externalInputs: [] },
    } as unknown as WorkerTaskPackageInput)).toThrow("视觉资产准备");
  });

  it("把冻结的分层 Prompt 上下文原样交给 Worker", () => {
    const taskPackage = createWorkerTaskPackage({
      ...packageInput,
      promptContext: {
        version: "prompt-context/v1",
        blueprintVersionId: "blueprint-3",
        seriesVersionId: "series-version-3",
        accountHardConstraints: { forbidden_topics: ["医疗承诺"] },
        accountDefaults: { positioning: "民俗短视频" },
        seriesBaseline: { visual_style: "写实雨夜" },
        episodeInput: { commission: { creativeDirection: "克制", coreContent: "人物选择" } },
        reviewFeedback: { reason: "补充人物动机" },
        hash: "context-hash-1",
      },
    });

    expect(taskPackage.promptContext).toMatchObject({ version: "prompt-context/v1", blueprintVersionId: "blueprint-3", seriesVersionId: "series-version-3", hash: "context-hash-1" });
  });

  it("拒绝缺少资产根目录或预算已耗尽的任务包", () => {
    expect(() => createWorkerTaskPackage({ ...packageInput, allowedAssetRoot: "" })).toThrow("allowedAssetRoot");
    expect(() => createWorkerTaskPackage({ ...packageInput, task: { ...packageInput.task, attempt: 2 } })).toThrow("maxAttempts");
    expect(() => createWorkerTaskPackage({ ...packageInput, inputArtifacts: [{ ...packageInput.inputArtifacts[0], relativePath: "../outside.md" }] })).toThrow("相对路径");
  });

  it("只接受在预算内、带验证结果的完整 Worker 结果", () => {
    const taskPackage = createWorkerTaskPackage(packageInput);
    const result = validateWorkerResult({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "completed",
      artifacts: [{ artifactType: "brief", relativePath: "episodes/episode-1/brief.md", sha256: "b".repeat(64), fileSize: 256 }],
      validation: { passed: true, checks: [{ name: "schema", passed: true, detail: "brief fields are present" }] },
      preflight: {
        version: "worker-preflight/v1",
        checks: [{ capability: "visual_planning", check: "capability_registration", phase: "preflight", status: "passed", reason: "Worker 已通过执行路径校验。", action: "none", scope: "worker" }],
      },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." },
      nextStep: "Create the script draft task.",
    }, taskPackage);
    expect(result).toMatchObject({ status: "completed", actualCostCents: 0, preflight: { version: "worker-preflight/v1" } });

    expect(() => validateWorkerResult({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "completed",
      artifacts: [{ artifactType: "brief", relativePath: "episodes/episode-1/brief.md", sha256: "b".repeat(64), fileSize: 256 }],
      validation: { passed: true, checks: [{ name: "schema", passed: true, detail: "brief fields are present" }] },
      preflight: { version: "worker-preflight/v1", checks: [{ capability: "visual_planning", check: "network", phase: "preflight", status: "retryable", reason: "暂时失败。", action: "not_a_real_action", scope: "worker" }] },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." },
      nextStep: "Create the script draft task.",
    }, taskPackage)).toThrow("Worker preflight");

    expect(() => validateWorkerResult({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "completed",
      artifacts: [],
      validation: { passed: true, checks: [] },
      actualCostCents: 1,
      blockers: [],
      retry: { shouldRetry: false, reason: "Budget exceeded." },
      nextStep: "Continue.",
    }, taskPackage)).toThrow("预算");
  });

  it("要求 blocked 结果明确说明阻塞原因", () => {
    expect(() => validateWorkerResult({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "blocked",
      artifacts: [],
      validation: { passed: false, checks: [] },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: false, reason: "Missing inputs need owner action." },
      nextStep: "Wait.",
    }, createWorkerTaskPackage(packageInput))).toThrow("blockers");
  });

  it("只允许未达最大尝试次数的失败任务重试", () => {
    expect(validateWorkerResult({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "failed",
      artifacts: [],
      validation: { passed: false, checks: [{ name: "provider", passed: false, detail: "temporary service failure" }] },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: true, reason: "Retry after the provider recovers." },
      nextStep: "Retry the same task.",
    }, createWorkerTaskPackage(packageInput))).toMatchObject({ status: "failed", retry: { shouldRetry: true } });

    expect(() => validateWorkerResult({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "failed",
      artifacts: [],
      validation: { passed: false, checks: [] },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: true, reason: "Keep retrying." },
      nextStep: "Retry.",
    }, createWorkerTaskPackage({ ...packageInput, task: { ...packageInput.task, attempt: 1 } }))).toThrow("重试");
  });

  it("允许分镜任务在阻塞时返回空分镜内容", () => {
    const taskPackage = createWorkerTaskPackage({
      ...packageInput,
      capability: "storyboard_planning",
      promptHarness: storyboardHarness,
      output: { requiredArtifactTypes: ["storyboard"], contentType: "application/json", relativePath: "episodes/episode-1/storyboard-v1.json", reviewStage: "storyboard_review" },
    });
    const blockedResult = {
      version: "worker-result/v1",
      taskId: "task-1",
      status: "blocked",
      artifacts: [],
      storyboard: null,
      validation: { passed: false, checks: [] },
      actualCostCents: 0,
      blockers: [{ code: "missing_input", detail: "Approved visual input is missing." }],
      retry: { shouldRetry: false, reason: "Owner action is required." },
      nextStep: "Provide the approved visual input.",
    };

    expect(validateWorkerResult(blockedResult, taskPackage)).toMatchObject({ status: "blocked" });
    expect(() => validateWorkerResult({ ...blockedResult, storyboard: undefined }, taskPackage)).toThrow("空分镜内容");
  });

  it("要求结果匹配任务输出类型，并使用资产根目录下的相对路径", () => {
    const taskPackage = createWorkerTaskPackage(packageInput);

    expect(() => validateWorkerResult({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "completed",
      artifacts: [{ artifactType: "script", relativePath: "episodes/episode-1/script.md", sha256: "c".repeat(64), fileSize: 256 }],
      validation: { passed: true, checks: [{ name: "schema", passed: true, detail: "valid" }] },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." },
      nextStep: "Continue.",
    }, taskPackage)).toThrow("必需产物");

    expect(() => validateWorkerResult({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "completed",
      artifacts: [{ artifactType: "brief", relativePath: "../outside.md", sha256: "c".repeat(64), fileSize: 256 }],
      validation: { passed: true, checks: [{ name: "schema", passed: true, detail: "valid" }] },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." },
      nextStep: "Continue.",
    }, taskPackage)).toThrow("相对路径");

    expect(() => validateWorkerResult({
      version: "worker-result/v1",
      taskId: "another-task",
      status: "completed",
      artifacts: [{ artifactType: "brief", relativePath: "episodes/episode-1/brief.md", sha256: "c".repeat(64), fileSize: 256 }],
      validation: { passed: true, checks: [{ name: "schema", passed: true, detail: "valid" }] },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." },
      nextStep: "Continue.",
    }, taskPackage)).toThrow("当前任务");

    expect(() => validateWorkerResult({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "completed",
      artifacts: [{ artifactType: "brief", relativePath: "episodes/episode-1/brief-v2.md", sha256: "c".repeat(64), fileSize: 256 }],
      validation: { passed: true, checks: [{ name: "schema", passed: true, detail: "valid" }] },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." },
      nextStep: "Continue.",
    }, taskPackage)).toThrow("冻结输出路径");
  });

  it("要求静态视觉产物使用可预览图片路径", () => {
    const taskPackage = createWorkerTaskPackage({
      ...packageInput,
      output: { ...packageInput.output, requiredArtifactTypes: ["visual_brief", "visual_reference_group", "static_visual"], relativePath: "episodes/episode-1/visual-brief.md" },
    });

    expect(() => validateWorkerResult({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "completed",
      artifacts: [
        { artifactType: "visual_brief", relativePath: "episodes/episode-1/visual-brief.md", sha256: "c".repeat(64), fileSize: 256 },
        { artifactType: "visual_reference_group", relativePath: "episodes/episode-1/references.md", sha256: "d".repeat(64), fileSize: 256 },
        { artifactType: "static_visual", relativePath: "episodes/episode-1/static-visual.md", sha256: "e".repeat(64), fileSize: 256 },
      ],
      validation: { passed: true, checks: [{ name: "schema", passed: true, detail: "valid" }] },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." },
      nextStep: "Continue.",
    }, taskPackage)).toThrow("可预览图片");

    expect(() => validateWorkerResult({
      version: "worker-result/v1",
      taskId: "task-1",
      status: "completed",
      artifacts: [
        { artifactType: "visual_brief", relativePath: "episodes/episode-1/visual-brief.md", sha256: "c".repeat(64), fileSize: 256 },
        { artifactType: "visual_reference_group", relativePath: "episodes/episode-1/references.md", sha256: "d".repeat(64), fileSize: 256 },
        { artifactType: "static_visual", relativePath: "episodes/episode-1/static-visual.svg", sha256: "e".repeat(64), fileSize: 256 },
      ],
      validation: { passed: true, checks: [{ name: "schema", passed: true, detail: "valid" }] },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." },
      nextStep: "Continue.",
    }, taskPackage)).toThrow("SVG");
  });

  it("只接受可追溯到冻结脚本和视觉依据的唯一分镜镜头", () => {
    const taskPackage = createWorkerTaskPackage({
      ...packageInput,
      capability: "storyboard_planning",
      promptHarness: storyboardHarness,
      output: { requiredArtifactTypes: ["storyboard"], contentType: "application/json", relativePath: "episodes/episode-1/storyboard-v1.json", reviewStage: "storyboard_review" },
      inputArtifacts: [
        { artifactType: "main_script", relativePath: "episodes/episode-1/main-script.md", sha256: "a".repeat(64), fileSize: 128 },
        { artifactType: "visual_brief", relativePath: "episodes/episode-1/visual-brief-v1.md", sha256: "b".repeat(64), fileSize: 128 },
      ],
    });
    const result = {
      version: "worker-result/v1",
      taskId: "task-1",
      status: "completed",
      artifacts: [{ artifactType: "storyboard", relativePath: "episodes/episode-1/storyboard-v1.json", sha256: "c".repeat(64), fileSize: 256 }],
      storyboard: {
        version: "storyboard/v1",
        shots: [{
          id: "shot-01",
          scriptSegment: "林砚进入古宅。",
          durationSeconds: 3,
          shotType: "a_roll",
          productionMethod: "实拍",
          inputBasis: [
            { relativePath: "episodes/episode-1/main-script.md", sha256: "a".repeat(64) },
            { relativePath: "episodes/episode-1/visual-brief-v1.md", sha256: "b".repeat(64) },
          ],
          targetSpec: "9:16，1080×1920，24fps",
        }],
      },
      validation: { passed: true, checks: [{ name: "schema", passed: true, detail: "valid storyboard" }] },
      actualCostCents: 0,
      blockers: [],
      retry: { shouldRetry: false, reason: "Completed successfully." },
      nextStep: "Submit storyboard for review.",
    };

    expect(validateWorkerResult(result, taskPackage)).toMatchObject({ storyboard: result.storyboard });
    expect(() => validateWorkerResult({ ...result, storyboard: { ...result.storyboard, shots: [{ ...result.storyboard.shots[0], inputBasis: [{ relativePath: "episodes/episode-1/visual-brief-v1.md", sha256: "b".repeat(64) }] }] } }, taskPackage)).toThrow("主脚本");
    expect(() => validateWorkerResult({ ...result, storyboard: { ...result.storyboard, shots: [result.storyboard.shots[0], result.storyboard.shots[0]] } }, taskPackage)).toThrow("不能重复");
  });
});
