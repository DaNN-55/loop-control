import {reviewRenderFromSnapshot} from './history/reviewRenderV1.js';
import {artifactManifest,requiredString,requiredPositiveNumber,requiredNonNegativeNumber,stringArray,requiredSoundtrackKind,requiredShotType,isRecord} from './taskSnapshotFields.js';
// Current media execution, validation, progress and fenced result reporting.
import {NativePublicationUnknownError} from '../orchestration/workerOutcome.js';
import type {FrozenVideoVisualInput} from '../videoVisualInputs.js';
import {videoAdapters} from "./videoProviderCatalog.js";
import {
  createWorkerTaskPackage,
  missingVisualAssetAdapterMessage,
  workerPreflightVersion,
  type ArtifactManifest,
  type WorkerResult,
  type WorkerTaskPackageInput,
  type WorkerTaskPackage,
  type PromptContextSnapshot,
  type WorkerPreflightResult,
  type WorkerPreflightCheck,
  validateWorkerResult,
} from "./contracts.js";
import { registeredAdapters } from "./registeredAdapters.js";
import {VideoGenerationError} from './videoGenerationError.js';
import {ProviderRequestRejectedError,ProviderOutcomeUnknownError,ProviderRequestNotSentError} from "./providerOutcome.js";
import { validateStoryboardManifest } from "./contracts.js";
import type { StoryboardStructureRevision } from "./storyboardRevision.js";

export interface ClaimedWorkerTask {
  taskId: string;
  taskType: string;
  attempt: number;
  budgetLimitCents: number;
  maxAttempts: number;
  provider: "codex" | "volcengine_tts" | "pexels" | "ffmpeg" | "freesound" | "openchatcut" | "openai" | "whisperx" | "bailian" | "volcengine" | "minimax" | "kling";
  model: string;
  promptVersion: string;
  episodeId: string;
  accountId: string;
  blueprintVersionId: string;
  title: string;
  allowedAssetRoot: string;
  inputSnapshot: unknown;
}

export interface MediaTaskDependencies {
  claimNextTask(): Promise<ClaimedWorkerTask | null>;
  verifyAssetRoot(allowedAssetRoot: string): Promise<void>;
  verifyArtifacts(taskPackage: WorkerTaskPackage, artifacts: ArtifactManifest[], storyboard?: WorkerResult["storyboard"]): Promise<void>;
  execute(taskPackage: WorkerTaskPackage): Promise<string>;
  preflight?(taskPackage: WorkerTaskPackage): Promise<WorkerPreflightResult>;
  reportProgress?(taskId: string, attempt: number, progress: WorkerProgress): Promise<void>;
  reportResult(taskId: string, attempt: number, result: WorkerResult): Promise<void>;
  actualCostCents: number;
}

export type WorkerProgressStep = "preflight" | "input_validation" | "provider_execution" | "output_validation";

export interface WorkerProgress {
  version: "worker-progress/v1";
  step: WorkerProgressStep;
  detail: string;
  observedAt: string;
}

export type MediaTaskRunResult =
  | { status: "idle" }
  | { status: "completed" | "blocked" | "failed"; taskId: string };

export async function runMediaTask(dependencies: MediaTaskDependencies): Promise<MediaTaskRunResult> {
  const task = await dependencies.claimNextTask();
  if (!task) return { status: "idle" };

  let taskPackage: WorkerTaskPackage;
  try {
    taskPackage = createTaskPackage(task);
  } catch (error) {
    const missingVisualAssetAdapter = errorMessage(error) === missingVisualAssetAdapterMessage;
    const result = createBlockedResult(task.taskId, dependencies.actualCostCents, error, missingVisualAssetAdapter ? "capability_registration" : undefined);
    if (missingVisualAssetAdapter) {
      const check: WorkerPreflightCheck = {
        capability: "static_visual_generation",
        check: "capability_registration",
        phase: "preflight",
        status: "unavailable",
        reason: missingVisualAssetAdapterMessage,
        action: "contact_environment_admin",
        scope: "worker",
      };
      result.preflight = { version: workerPreflightVersion, checks: [check] };
      result.blockers = [preflightBlocker(check)];
      result.nextStep = "Register an image-generation Adapter in the Worker environment before creating a new task attempt.";
    }
    await dependencies.reportResult(task.taskId, task.attempt, result);
    return { status: "blocked", taskId: task.taskId };
  }

  await reportProgress(dependencies, task, "preflight", "正在检查执行器、模型、连接和本机依赖。");
  const preflight = dependencies.preflight && !taskPackage.storyboardRevision ? await runPreflight(dependencies.preflight, taskPackage) : undefined;
  if(preflight)preflight.checks=preflight.checks.map(check=>currentRequestCheck(task,check));
  if (preflight) {
    if (preflight.checks.some((check) => check.status !== "passed")) {
      const result = createPreflightResult(taskPackage, dependencies.actualCostCents, preflight);
      await dependencies.reportResult(task.taskId, task.attempt, result);
      return { status: result.status, taskId: task.taskId };
    }
  }

  await reportProgress(dependencies, task, "input_validation", "正在验证媒体库与冻结输入。");
  try {
    await dependencies.verifyAssetRoot(taskPackage.assets.allowedRoot);
  } catch (error) {
    const check: WorkerPreflightCheck = {
      capability: taskPackage.capability,
      check: "asset_root",
      phase: "preflight",
      status: "unavailable",
      reason: errorMessage(error),
      action: "contact_environment_admin",
      scope: "worker",
    };
    const result = createBlockedResult(task.taskId, dependencies.actualCostCents, error, "asset_root_unavailable");
    result.preflight = appendPreflight(preflight, check);
    result.blockers = [{ ...preflightBlocker(check), code: "asset_root_unavailable", detail: check.reason }];
    await dependencies.reportResult(task.taskId, task.attempt, result);
    return { status: "blocked", taskId: task.taskId };
  }

  try {
    await dependencies.verifyArtifacts(taskPackage, taskPackage.assets.inputs);
  } catch (error) {
    await dependencies.reportResult(task.taskId, task.attempt, addPreflight(createBlockedResult(task.taskId, dependencies.actualCostCents, error, "input_artifacts_invalid"), preflight));
    return { status: "blocked", taskId: task.taskId };
  }

  await reportProgress(dependencies, task, "provider_execution", `正在由 ${task.provider} 执行 ${task.taskType}。`);
  try {
    const output = await dependencies.execute(taskPackage);
    const candidate = parseMediaTaskOutput(output, dependencies.actualCostCents);
    const result = validateWorkerResult(candidate, taskPackage);
    if (preflight) result.preflight = preflight;
    await reportProgress(dependencies, task, "output_validation", "执行已返回，正在校验并登记产物。");
    await dependencies.verifyArtifacts(taskPackage, result.artifacts, result.storyboard);
    await dependencies.reportResult(task.taskId, task.attempt, result);
    return { status: result.status, taskId: task.taskId };
  } catch (error) {
    if(error instanceof NativePublicationUnknownError)throw error;
    const failure = executionPreflightCheck(taskPackage, error);
    const executionCheck = failure?currentRequestCheck(task,failure):undefined;
    const result = createFailedResult(taskPackage, dependencies.actualCostCents, error);
    if (executionCheck) result.blockers = [preflightBlocker(executionCheck)];
    await dependencies.reportResult(task.taskId, task.attempt, addPreflight(result, executionCheck ? appendPreflight(preflight, executionCheck) : preflight));
    return { status: result.status, taskId: task.taskId };
  }
}

function currentRequestCheck(task:ClaimedWorkerTask,check:WorkerPreflightCheck):WorkerPreflightCheck {
 const snapshot=isRecord(task.inputSnapshot)?task.inputSnapshot:{};
 return check.action==='edit_blueprint'&&(snapshot.production_selection||snapshot.workspace_preparation)?{...check,action:'select_production',scope:'episode'}:check;
}

async function reportProgress(dependencies: MediaTaskDependencies, task: ClaimedWorkerTask, step: WorkerProgressStep, detail: string): Promise<void> {
  if (!dependencies.reportProgress) return;
  try {
    await dependencies.reportProgress(task.taskId, task.attempt, { version: "worker-progress/v1", step, detail, observedAt: new Date().toISOString() });
  } catch {
    // Progress is observability evidence; a transient reporting failure must not fail the production task itself.
  }
}

async function runPreflight(preflight: NonNullable<MediaTaskDependencies["preflight"]>, taskPackage: WorkerTaskPackage): Promise<WorkerPreflightResult> {
  try {
    return await preflight(taskPackage);
  } catch (error) {
    return {
      version: workerPreflightVersion,
      checks: [{
        capability: taskPackage.capability,
        check: "preflight",
        phase: "preflight",
        status: "unavailable",
        reason: errorMessage(error),
        action: "contact_environment_admin",
        scope: "worker",
      }],
    };
  }
}

function createTaskPackage(task: ClaimedWorkerTask): WorkerTaskPackage {
  const snapshot = isRecord(task.inputSnapshot) ? task.inputSnapshot : {};
  const output = outputContract(snapshot);
  return createWorkerTaskPackage({
    task: {
      id: task.taskId,
      type: task.taskType,
      attempt: task.attempt,
      budgetLimitCents: task.budgetLimitCents,
      maxAttempts: task.maxAttempts,
      provider: task.provider,
      model: task.model,
      promptVersion: task.promptVersion,
    },
    episode: {
      id: task.episodeId,
      accountId: task.accountId,
      blueprintVersionId: task.blueprintVersionId,
      title: task.title,
    },
    capability: requiredString(snapshot.capability, "任务缺少能力声明。"),
    ...(typeof snapshot.credential_ref === "string" ? { credentialRef: snapshot.credential_ref } : {}),
    acousticAlignment: acousticAlignmentInput(snapshot),
    promptContext: promptContext(snapshot),
    promptHarness: promptHarness(snapshot),
    commission: commission(snapshot),
    seriesBaseline: seriesBaseline(snapshot),
    visualAssetPreparation: visualAssetPreparation(snapshot),
    reviewFeedback: reviewFeedback(snapshot),
    reviewAnnotations: reviewAnnotations(snapshot),
    storyboardRevision: storyboardRevision(snapshot, inputArtifacts(snapshot)),
    aRoll: aRoll(snapshot),
    media: media(snapshot),
    reviewRender: reviewRenderFromSnapshot(snapshot),
    finalRender: finalRender(snapshot),
    allowedTools: stringArray(snapshot.allowed_tools, "任务允许工具清单格式无效。"),
    allowedAssetRoot: task.allowedAssetRoot,
    ...(snapshot.native_episode_relative_path!==undefined?{episodeRelativePath:requiredString(snapshot.native_episode_relative_path,"冻结生产单目录无效。")} : {}),
    ...(snapshot.native_episode_directory_identity!==undefined?{episodeDirectoryIdentity:snapshot.native_episode_directory_identity as WorkerTaskPackageInput['episodeDirectoryIdentity']}:{}),
    output,
    inputArtifacts: inputArtifacts(snapshot),
  });
}

function acousticAlignmentInput(snapshot: Record<string, unknown>): WorkerTaskPackageInput["acousticAlignment"] {
  if (snapshot.acoustic_alignment === undefined) return undefined;
  if (!isRecord(snapshot.acoustic_alignment)) throw new Error("声学对齐冻结输入格式无效。");
  const value = snapshot.acoustic_alignment;
  return {
    confirmedText: requiredString(value.confirmed_text, "声学对齐缺少 Owner 字幕正文。"),
    textFingerprint: requiredString(value.text_fingerprint, "声学对齐缺少字幕正文版本。"),
    ...(typeof value.audio_relative_path === "string" ? { audioRelativePath: value.audio_relative_path } : {}),
    ...(typeof value.audio_sha256 === "string" ? { audioSha256: value.audio_sha256 } : {}),
    ...(typeof value.input_version === "string" ? { inputVersion: value.input_version } : {}),
    ...(typeof value.speaking_rate === "number" ? { speakingRate: value.speaking_rate } : {}),
    ...(value.strategy === "auto" || value.strategy === "local" ? { strategy: value.strategy } : {}),
    ...(typeof value.voice === "string" ? { voice: value.voice } : {}),
  };
}

function storyboardRevision(snapshot: Record<string, unknown>, frozenInputs: ArtifactManifest[]): StoryboardStructureRevision | undefined {
  if (snapshot.storyboard_revision === undefined) return undefined;
  if (!isRecord(snapshot.storyboard_revision) || snapshot.storyboard_revision.version !== "storyboard-revision/v1" || typeof snapshot.storyboard_revision.base_review_package_id !== "string" || typeof snapshot.storyboard_revision.input_fingerprint !== "string" || !isRecord(snapshot.storyboard_revision.operation) || !isRecord(snapshot.storyboard_revision.storyboard)) throw new Error("分镜结构修订任务格式无效。");
  const revision = snapshot.storyboard_revision;
  const storyboard = validateStoryboardManifest(revision.storyboard, frozenInputs);
  return {
    version: "storyboard-revision/v1",
    baseReviewPackageId: revision.base_review_package_id as string,
    inputFingerprint: revision.input_fingerprint as string,
    operation: revision.operation as StoryboardStructureRevision["operation"],
    storyboard,
  };
}

function promptContext(snapshot: Record<string, unknown>): WorkerTaskPackageInput["promptContext"] {
  const value = snapshot.prompt_context;
  if (value === undefined) return undefined;
  if (!isRecord(value) || value.version !== "prompt-context/v1" || typeof value.blueprint_version_id !== "string" || typeof value.hash !== "string" || !isRecord(value.account_hard_constraints) || !isRecord(value.account_defaults) || !isRecord(value.episode_input)) throw new Error("任务 Prompt 上下文格式无效。");
  return {
    version: "prompt-context/v1",
    blueprintVersionId: value.blueprint_version_id,
    ...(typeof value.series_version_id === "string" ? { seriesVersionId: value.series_version_id } : {}),
    accountHardConstraints: value.account_hard_constraints,
    accountDefaults: value.account_defaults,
    ...(value.series_baseline && isRecord(value.series_baseline) ? { seriesBaseline: value.series_baseline } : {}),
    episodeInput: value.episode_input,
    ...(value.review_feedback && isRecord(value.review_feedback) ? { reviewFeedback: value.review_feedback } : {}),
    hash: value.hash,
  } satisfies PromptContextSnapshot;
}

function finalRender(snapshot: Record<string, unknown>): WorkerTaskPackageInput["finalRender"] {
  if (snapshot.capability !== "final_rendering") return undefined;
  const value = snapshot.final_render;
  if (!isRecord(value)) throw new Error("最终渲染任务冻结工程格式无效。");
  const sourceProject = artifactManifest(value.source_project, "最终渲染任务缺少审核工程证据。");
  const sourceRuntime = artifactManifest(value.source_runtime, "最终渲染任务缺少审核运行时证据。");
  const sourceQcReport = artifactManifest(value.source_qc_report, "最终渲染任务缺少 QC 报告证据。");
  const review = reviewRenderFromSnapshot({ capability: "review_rendering", review_render: value.review_render });
  if (!review) throw new Error("最终渲染任务缺少审核工程。");
  return { sourceReviewPackageId: requiredString(value.source_review_package_id, "最终渲染任务缺少审核包。"), sourceProject, sourceRuntime, sourceQcReport, projectRelativePath: requiredString(value.project_relative_path, "最终渲染任务缺少工程路径。"), projectRevision: requiredPositiveNumber(value.project_revision, "最终渲染任务缺少工程修订。"), reviewRender: review };
}



































function media(snapshot: Record<string, unknown>): WorkerTaskPackageInput["media"] {
  const value = snapshot.media;
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("媒体任务冻结配置格式无效。");
  if(value.adapter==='openai_images') {
    const image=value.static_visual;
    if(!isRecord(image))throw Error('图片生成输入无效。');
    return {adapter:'openai_images',staticVisual:{prompt:requiredString(image.prompt,'缺少图片提示词。'),settings:image.settings as import('../imageGeneration.js').ImageGenerationSettings,references:image.references as Array<ArtifactManifest&{mimeType:string}>}};
  }
  if (value.adapter === "volcengine_tts") {
    const narration = value.narration;
    if (!isRecord(narration) || !isRecord(narration.voice)) throw new Error("旁白任务冻结配置无效。");
    return {
      adapter: value.adapter,
      narration: {
        text: requiredString(narration.text, "旁白任务缺少冻结文本。"),
        voice: {
          languageCode: requiredString(narration.voice.language_code, "旁白任务缺少语言。"),
          name: requiredString(narration.voice.name, "旁白任务缺少声音。"),
          speakingRate: requiredPositiveNumber(narration.voice.speaking_rate, "旁白任务缺少有效语速。"),
        },
      },
    };
  }
  if (value.adapter === "wan_video" || videoAdapters.includes(String(value.adapter))) {
    const video = value.video ?? value.wan_video;
    if(!isRecord(video))throw new Error('缺少冻结视频配置。');
    const advanced=Array.isArray(video.visual_inputs);
    if(!advanced&&!isRecord(video.first_frame))throw new Error('视频镜头缺少冻结首帧。');
    return { adapter: value.adapter as "wan_video" | "seedance_video" | "minimax_video" | "kling_video", wanVideo: { ...(video.candidate_only===true?{candidateOnly:true}:{}),...(value.adapter==='minimax_video'&&video.resolution!=null?{resolution:requiredString(video.resolution,'缺少 MiniMax 分辨率。')} :{}),settings:video.settings as import('../videoGenerationSettings.js').WanGenerationSettings,composition:video.composition as import('../videoGenerationSettings.js').FirstFrameComposition,...(advanced?{visualInputs:video.visual_inputs as FrozenVideoVisualInput[],visualMode:requiredString(video.visual_mode,'缺少视频生成模式。'),...(video.reference_ratio!=null?{referenceRatio:video.reference_ratio as import('../videoVisualInputs.js').VideoOutputRatio}:{})}:{firstFrame:video.first_frame as unknown as ArtifactManifest,imageMime:requiredString(video.image_mime,'缺少首帧 MIME。')}), prompt: requiredString(video.prompt, "缺少视频提示词。"), durationSeconds: requiredPositiveNumber(video.duration_seconds, "缺少视频时长。") } };
  }
  if (value.adapter === "pexels_video") {
    // Older snapshots retain b_roll; new snapshots store one neutral video payload.
    const bRoll = value.video ?? value.b_roll;
    if(isRecord(bRoll)&&isRecord(bRoll.request))return {adapter:'pexels_video',bRoll:{query:requiredString(bRoll.query,'Pexels 任务缺少检索词。'),targetDurationSeconds:requiredPositiveNumber(bRoll.target_duration_seconds,'Pexels 任务缺少目标窗口。'),request:bRoll.request as unknown as import('./pexelsVideos.js').PexelsVideoRequest}};
    if (!isRecord(bRoll) || !isRecord(bRoll.shot) || !Array.isArray(bRoll.shot.inputBasis)) throw new Error("镜头视频任务冻结配置无效。");
    return {
      adapter: "pexels_video",
      bRoll: {
        ...(bRoll.request ? {request:bRoll.request as import('./pexelsVideos.js').PexelsVideoRequest} : {}),
        query: requiredString(bRoll.query, "镜头视频任务缺少冻结检索词。"),
        targetDurationSeconds: requiredPositiveNumber(bRoll.target_duration_seconds, "镜头视频任务缺少有效时长。"),
        shot: {
          id: requiredString(bRoll.shot.id, "镜头视频任务缺少镜头 ID。"),
          scriptSegment: requiredString(bRoll.shot.scriptSegment, "镜头视频任务缺少脚本片段。"),
          durationSeconds: requiredPositiveNumber(bRoll.shot.durationSeconds, "镜头视频任务缺少镜头时长。"),
          shotType: requiredShotType(bRoll.shot.shotType),
          productionMethod: requiredString(bRoll.shot.productionMethod, "镜头视频任务缺少制作方法。"),
          inputBasis: bRoll.shot.inputBasis.map((input) => {
            if (!isRecord(input)) throw new Error("B-roll 输入依据格式无效。");
            return { relativePath: requiredString(input.relativePath, "B-roll 输入依据缺少路径。"), sha256: requiredString(input.sha256, "B-roll 输入依据缺少哈希。") };
          }),
          targetSpec: requiredString(bRoll.shot.targetSpec, "镜头视频任务缺少目标规格。"),
        },
      },
    };
  }
  if (value.adapter === "openchatcut_card_video") {
    const cardVideo = value.card_video;
    if (!isRecord(cardVideo) || !isRecord(cardVideo.shot) || !Array.isArray(cardVideo.shot.inputBasis)) throw new Error("B-roll 卡片视频冻结配置无效。");
    return {
      adapter: "openchatcut_card_video",
      cardVideo: {
        shot: {
          id: requiredString(cardVideo.shot.id, "B-roll 卡片视频缺少镜头 ID。"),
          scriptSegment: requiredString(cardVideo.shot.scriptSegment, "B-roll 卡片视频缺少脚本片段。"),
          durationSeconds: requiredPositiveNumber(cardVideo.shot.durationSeconds, "B-roll 卡片视频缺少镜头时长。"),
          shotType: requiredShotType(cardVideo.shot.shotType),
          productionMethod: requiredString(cardVideo.shot.productionMethod, "B-roll 卡片视频缺少制作方法。"),
          inputBasis: cardVideo.shot.inputBasis.map((input) => {
            if (!isRecord(input)) throw new Error("B-roll 卡片视频输入依据格式无效。");
            return { relativePath: requiredString(input.relativePath, "B-roll 卡片视频输入依据缺少路径。"), sha256: requiredString(input.sha256, "B-roll 卡片视频输入依据缺少哈希。") };
          }),
          targetSpec: requiredString(cardVideo.shot.targetSpec, "B-roll 卡片视频缺少目标规格。"),
        },
      },
    };
  }
  if (value.adapter === "ffmpeg_extract_audio") {
    const embeddedAudio = value.embedded_audio;
    if (!isRecord(embeddedAudio)) throw new Error("派生音频任务冻结配置无效。");
    return {
      adapter: "ffmpeg_extract_audio",
      embeddedAudio: {
        sourceRelativePath: requiredString(embeddedAudio.source_relative_path, "派生音频任务缺少冻结视频路径。"),
        durationSeconds: requiredPositiveNumber(embeddedAudio.duration_seconds, "派生音频任务缺少有效时长。"),
        ...(embeddedAudio.start_seconds!==undefined?{startSeconds:requiredNonNegativeNumber(embeddedAudio.start_seconds,"原声源入点无效。")}:{ }),
      },
    };
  }
  if (value.adapter === "ffmpeg_trim_video") {
    const videoClip = value.video_clip;
    const videoClips = value.video_clips;
    if (!isRecord(videoClip) && !isRecord(videoClips)) throw new Error("镜头裁剪任务冻结配置无效。");
    if (isRecord(videoClips)) {
      if (!Array.isArray(videoClips.segments) || videoClips.segments.length === 0) throw new Error("镜头裁剪任务缺少冻结片段。");
      return {
        adapter: "ffmpeg_trim_video",
        videoClips: {
          sourceRelativePath: requiredString(videoClips.source_relative_path, "镜头裁剪任务缺少冻结视频路径。"),
          segments: videoClips.segments.map((segment) => {
            if (!isRecord(segment)) throw new Error("镜头裁剪任务片段格式无效。");
            return { startSeconds: requiredNonNegativeNumber(segment.start_seconds, "镜头裁剪任务缺少有效入点。"), endSeconds: requiredPositiveNumber(segment.end_seconds, "镜头裁剪任务缺少有效出点。") };
          }),
          targetDurationSeconds: requiredPositiveNumber(videoClips.target_duration_seconds, "镜头裁剪任务缺少有效总时长。"),
        },
      };
    }
    if (!isRecord(videoClip)) throw new Error("镜头裁剪任务冻结配置无效。");
    return {
      adapter: "ffmpeg_trim_video",
      videoClip: {
        sourceRelativePath: requiredString(videoClip.source_relative_path, "镜头裁剪任务缺少冻结视频路径。"),
        startSeconds: requiredNonNegativeNumber(videoClip.start_seconds, "镜头裁剪任务缺少有效入点。"),
        endSeconds: requiredPositiveNumber(videoClip.end_seconds, "镜头裁剪任务缺少有效出点。"),
        targetDurationSeconds: requiredPositiveNumber(videoClip.target_duration_seconds, "镜头裁剪任务缺少有效目标时长。"),
      },
    };
  }
  if (value.adapter === "freesound_preview") {
    const soundtrack = value.soundtrack;
    if (!isRecord(soundtrack) || !isRecord(soundtrack.cue)) throw new Error("声轨任务冻结配置无效。");
    return {
      adapter: "freesound_preview",
      soundtrack: {
        query: requiredString(soundtrack.query, "声轨任务缺少冻结检索词。"),
        ...(soundtrack.candidate_index===undefined?{}:{candidateIndex:Number(soundtrack.candidate_index)}),
        targetDurationSeconds: requiredPositiveNumber(soundtrack.target_duration_seconds, "声轨任务缺少有效时长。"),
        cue: {
          id: requiredString(soundtrack.cue.id, "声轨任务缺少声轨 ID。"),
          kind: requiredSoundtrackKind(soundtrack.cue.kind),
          description: requiredString(soundtrack.cue.description, "声轨任务缺少声轨说明。"),
          searchQuery: requiredString(soundtrack.cue.search_query, "声轨任务缺少冻结检索词。"),
          startSeconds: requiredNonNegativeNumber(soundtrack.cue.start_seconds, "声轨任务缺少有效起始时间。"),
          durationSeconds: requiredPositiveNumber(soundtrack.cue.duration_seconds, "声轨任务缺少有效时长。"),
        },
      },
    };
  }
  throw new Error("媒体任务声明了不支持的适配器。");
}

function seriesBaseline(snapshot: Record<string, unknown>): WorkerTaskPackageInput["seriesBaseline"] {
  const value = snapshot.series_baseline;
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value) || !isRecord(value.rules) || typeof value.version !== "number" || !Number.isInteger(value.version) || value.version < 1) throw new Error("任务系列基准格式无效。");
  return {
    versionId: requiredString(value.version_id, "任务系列基准缺少版本。"),
    version: value.version,
    rules: value.rules,
  };
}

function visualAssetPreparation(snapshot: Record<string, unknown>): WorkerTaskPackageInput["visualAssetPreparation"] {
  const value = snapshot.visual_assets;
  if (value === undefined) return undefined;
  if (!isRecord(value) || !Array.isArray(value.external_inputs)) throw new Error("视觉资产准备冻结配置格式无效。");
  const imageGeneration = value.image_generation;
  if (imageGeneration === undefined || imageGeneration === null) return { externalInputs: value.external_inputs as ArtifactManifest[] };
  if (!isRecord(imageGeneration)) throw new Error("视觉资产准备图片 Adapter 格式无效。");
  return {
    externalInputs: value.external_inputs as ArtifactManifest[],
    imageGeneration: {
      provider: requiredString(imageGeneration.provider, "视觉资产准备图片 Adapter 缺少 Provider。"),
      adapter: requiredString(imageGeneration.adapter, "视觉资产准备图片 Adapter 缺少 Adapter。"),
      model: requiredString(imageGeneration.model, "视觉资产准备图片 Adapter 缺少模型。"),
      credentialRef: requiredString(imageGeneration.credential_ref, "视觉资产准备图片 Adapter 缺少外部连接。"),
    },
  };
}

function commission(snapshot: Record<string, unknown>): WorkerTaskPackageInput["commission"] {
  const value = snapshot.commission;
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("任务脚本委托格式无效。");
  return {
    creativeDirection: requiredString(value.creative_direction, "任务脚本委托缺少创作方向。"),
    coreContent: requiredString(value.core_content, "任务脚本委托缺少核心内容。"),
  };
}

function promptHarness(snapshot: Record<string, unknown>): WorkerTaskPackageInput["promptHarness"] {
  const value = snapshot.harness;
  if (value === undefined) return undefined;
  if (!isRecord(value) || value.adapter !== "codex" || typeof value.version !== "number" || !Number.isInteger(value.version) || value.version < 1) throw new Error("任务 Prompt Harness 格式无效。");
  return {
    id: requiredString(value.id, "任务 Prompt Harness 缺少标识。"),
    version: value.version,
    content: requiredString(value.content, "任务 Prompt Harness 缺少冻结内容。"),
    contentHash: requiredString(value.content_hash, "任务 Prompt Harness 缺少内容哈希。"),
    adapter: "codex",
    model: requiredString(value.model, "任务 Prompt Harness 缺少模型。"),
    promptVersion: requiredString(value.prompt_version, "任务 Prompt Harness 缺少版本。"),
  };
}

function reviewFeedback(snapshot: Record<string, unknown>): WorkerTaskPackageInput["reviewFeedback"] {
  const value = snapshot.review_feedback;
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("任务审核反馈格式无效。");
  return {
    reviewPackageId: requiredString(value.review_package_id, "任务审核反馈缺少审核包。"),
    reason: requiredString(value.reason, "任务审核反馈缺少修改理由。"),
  };
}

function reviewAnnotations(snapshot: Record<string, unknown>): WorkerTaskPackageInput["reviewAnnotations"] {
  const value = snapshot.review_annotations;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("任务镜头批注格式无效。");
  return value.map((annotation) => {
    if (!isRecord(annotation)) throw new Error("任务镜头批注格式无效。");
    return {
      shotId: requiredString(annotation.shot_id, "任务镜头批注缺少镜头。"),
      reason: requiredString(annotation.reason, "任务镜头批注缺少内容。"),
    };
  });
}

function aRoll(snapshot: Record<string, unknown>): WorkerTaskPackageInput["aRoll"] {
  if (snapshot.capability !== "a_roll_generation" || (isRecord(snapshot.media) && (snapshot.media.adapter === "wan_video" || videoAdapters.includes(String(snapshot.media.adapter))))) return undefined;
  const executor = snapshot.executor;
  const shot = snapshot.shot;
  if (!isRecord(executor) || !isRecord(shot)) throw new Error("A-roll 任务缺少冻结执行器或镜头。");
  const inputBasis = shot.inputBasis;
  if (!Array.isArray(inputBasis)) throw new Error("A-roll 任务缺少冻结镜头输入。");
  return {
    adapter: requiredString(executor.adapter, "A-roll 任务缺少冻结适配器。"),
    shot: {
      id: requiredString(shot.id, "A-roll 任务缺少镜头 ID。"),
      scriptSegment: requiredString(shot.scriptSegment, "A-roll 任务缺少脚本片段。"),
      durationSeconds: requiredPositiveNumber(shot.durationSeconds, "A-roll 任务缺少有效时长。"),
      shotType: requiredShotType(shot.shotType),
      productionMethod: requiredString(shot.productionMethod, "A-roll 任务缺少制作方法。"),
      inputBasis: inputBasis.map((input) => {
        if (!isRecord(input)) throw new Error("A-roll 任务的输入依据格式无效。");
        return { relativePath: requiredString(input.relativePath, "A-roll 输入依据缺少路径。"), sha256: requiredString(input.sha256, "A-roll 输入依据缺少哈希。") };
      }),
      targetSpec: requiredString(shot.targetSpec, "A-roll 任务缺少目标规格。"),
    },
  };
}

export function parseMediaTaskOutput(output: string, actualCostCents: number): unknown {
  const parsed: unknown = JSON.parse(output);
  if (!isRecord(parsed)) throw new Error("媒体执行器必须返回一个 JSON 对象。");
  return { ...parsed, actualCostCents };
}

function outputContract(snapshot: Record<string, unknown>): WorkerTaskPackageInput["output"] {
  const output = snapshot.output;
  if (!isRecord(output)) throw new Error("任务缺少输出产物 Schema。");
  return {
    requiredArtifactTypes: stringArray(output.required_artifact_types, "任务缺少输出产物 Schema。"),
    contentType: requiredString(output.content_type, "任务缺少输出内容类型。"),
    relativePath: requiredString(output.relative_path, "任务缺少冻结输出路径。"),
    reviewStage: requiredString(output.review_stage, "任务缺少输出审核阶段。"),
  };
}

function inputArtifacts(snapshot: Record<string, unknown>): ArtifactManifest[] {
  const artifacts = snapshot.input_artifacts;
  if (artifacts === undefined) return [];
  if (!Array.isArray(artifacts)) throw new Error("任务输入产物清单格式无效。");
  return artifacts as ArtifactManifest[];
}















function createBlockedResult(taskId: string, actualCostCents: number, error: unknown, code = "task_package_invalid"): WorkerResult {
  return {
    version: "worker-result/v1",
    taskId,
    status: "blocked",
    artifacts: [],
    validation: { passed: false, checks: [] },
    actualCostCents,
    blockers: [{ code, detail: errorMessage(error) }],
    retry: { shouldRetry: false, reason: "Owner action is required before retrying this task." },
    nextStep: "Correct the task package and create a new task attempt.",
  };
}

function createPreflightResult(taskPackage: WorkerTaskPackage, actualCostCents: number, preflight: WorkerPreflightResult): WorkerResult {
  const failedChecks = preflight.checks.filter((check) => check.status !== "passed");
  const retryable = failedChecks.length > 0 && failedChecks.every((check) => check.status === "retryable" && check.action === "retry");
  const shouldRetry = retryable && taskPackage.budget.attempt + 1 < taskPackage.budget.maxAttempts;
  const reason = failedChecks.map((check) => check.reason).join("；");
  return {
    version: "worker-result/v1",
    taskId: taskPackage.task.id,
    status: retryable ? "failed" : "blocked",
    artifacts: [],
    validation: {
      passed: false,
      checks: preflight.checks.map((check) => ({ name: `preflight:${check.check}`, passed: check.status === "passed", detail: check.reason })),
    },
    preflight,
    actualCostCents,
    blockers: failedChecks.map((check) => preflightBlocker(check)),
    retry: { shouldRetry, reason },
    nextStep: shouldRetry ? "Retry the task after the temporary dependency failure recovers." : "Resolve the Worker preflight blocker before retrying this task.",
  };
}

function addPreflight(result: WorkerResult, preflight: WorkerPreflightResult | undefined): WorkerResult {
  return preflight ? { ...result, preflight } : result;
}

function appendPreflight(preflight: WorkerPreflightResult | undefined, check: WorkerPreflightCheck): WorkerPreflightResult {
  return { version: workerPreflightVersion, checks: [...(preflight?.checks ?? []), check] };
}

function preflightBlocker(check: WorkerPreflightCheck): NonNullable<WorkerResult["blockers"]>[number] {
  return {
    code: check.check,
    detail: check.reason,
    capability: check.capability,
    check: check.check,
    phase: check.phase,
    status: check.status,
    action: check.action,
    scope: check.scope,
  };
}

function createFailedResult(taskPackage: WorkerTaskPackage, actualCostCents: number, error: unknown): WorkerResult {
  const unknown = error instanceof ProviderOutcomeUnknownError||error instanceof VideoGenerationError&&error.outcome==='unknown';
  return {
    version: "worker-result/v1",
    taskId: taskPackage.task.id,
    status: unknown ? "blocked" : "failed",
    artifacts: [],
    validation: { passed: false, checks: [{ name: "codex_execution", passed: false, detail: errorMessage(error) }] },
    actualCostCents,
    blockers: (error instanceof ProviderRequestNotSentError||error instanceof ProviderRequestRejectedError)?[{code:error.code,detail:error.message}]:error instanceof VideoGenerationError?[{code:error.code,detail:error.message}]:[],
    retry: {
      shouldRetry: !unknown && !(error instanceof ProviderRequestNotSentError||error instanceof ProviderRequestRejectedError) && taskPackage.budget.attempt + 1 < taskPackage.budget.maxAttempts,
      reason: errorMessage(error),
    },
    nextStep: unknown ? "先核对请求账本及供应商记录，再由 Owner 明确决定后续操作；不会自动重发。" : "Retry only after the reported failure is understood.",
  };
}

function executionPreflightCheck(taskPackage: WorkerTaskPackage, error: unknown): WorkerPreflightCheck | undefined {
  const detail = errorMessage(error);
  if(error instanceof ProviderOutcomeUnknownError||error instanceof VideoGenerationError&&error.outcome==='unknown')return {capability:taskPackage.capability,check:"provider_result_unknown",phase:"execution",status:"blocked",reason:detail,action:"contact_environment_admin",scope:"worker"};
  const imageGeneration = taskPackage.visualAssetPreparation?.imageGeneration;
  const isOpenAiStaticVisual = (taskPackage.provider === "openai" && taskPackage.media?.adapter === "openai_images") || (imageGeneration?.provider === "openai" && imageGeneration.adapter === "openai_images");
  const managedAdapter = taskPackage.media?.adapter ?? taskPackage.aRoll?.adapter;
  const adapterResolution = registeredAdapters.resolve({ capability: taskPackage.capability, provider: taskPackage.provider, adapter: managedAdapter });
  const isManagedConnection = isOpenAiStaticVisual || (adapterResolution.kind === "registered" && adapterResolution.choice.connection.kind === "owner_managed");
  const capability = isOpenAiStaticVisual ? "static_visual_generation" : taskPackage.capability;
  if (isOpenAiStaticVisual && /HTTP (400|404)/i.test(detail)) {
    return { capability, check: "model_permission", phase: "execution", status: "unavailable", reason: detail, action: "edit_blueprint", scope: "blueprint" };
  }
  if (isOpenAiStaticVisual && /HTTP (401|403)|api[ _-]?key|credential|token|凭据|密钥|令牌/i.test(detail)) {
    return { capability, check: "credential_validity", phase: "execution", status: "unavailable", reason: detail, action: "manage_connection", scope: "connection" };
  }

  if (isManagedConnection && /api[ _-]?key|credential|token|401|403|凭据|密钥|令牌/i.test(detail)) {
    return {
      capability: taskPackage.capability,
      check: "credential_validity",
      phase: "execution",
      status: "unavailable",
      reason: detail,
      action: "manage_connection",
      scope: "connection",
    };
  }
  if (/api[ _-]?key|credential|token|401|403|凭据|密钥|令牌/i.test(detail)) {
    return {
      capability: taskPackage.capability,
      check: "credential_validity",
      phase: "execution",
      status: "unavailable",
      reason: detail,
      action: "contact_environment_admin",
      scope: "worker",
    };
  }
  if (/fetch failed|network|timeout|timed out|econnreset|econnrefused|etimedout|socket|dns|connection|连接|网络|超时/i.test(detail)) {
    return {
      capability: taskPackage.capability,
      check: "network_connectivity",
      phase: "execution",
      status: "retryable",
      reason: detail,
      action: "retry",
      scope: "worker",
    };
  }
  return undefined;
}



function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown worker error.";
}
