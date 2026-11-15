// Versioned decoder for frozen review-render / shot-preparation v1 snapshots.
import type {WorkerTaskPackageInput,ReviewRenderAdjustments,StoryboardManifest,ShotPreparationContract} from '../contracts.js';
import {applyScriptRenderSettings} from '../scriptRenderSettings.js';
import {defaultAllowedDurationFrames,defaultDurationFrameRate,shotDurationDecisionFromJson} from '../durationDecision.js';
import {isValidShotComposition,normalizeShotComposition,shotTransitionModes,type ShotComposition,type ShotTransitionMode} from '../../shotComposition.js';
import {isValidShotCaptionContract,normalizeShotCaptionContract,type ShotCaptionContract} from '../../shotCaptions.js';
import {isValidShotAudioMix,normalizeShotAudioMix} from '../../shotAudioMix.js';
import {requiredBoolean,requiredString,requiredPositiveNumber,requiredNonNegativeNumber,isRecord} from '../taskSnapshotFields.js';

export function reviewRenderFromSnapshot(snapshot: Record<string, unknown>): WorkerTaskPackageInput["reviewRender"] {
  if (snapshot.capability !== "review_rendering") return undefined;
  const value = snapshot.review_render;
  if (!isRecord(value) || !isRecord(value.storyboard) || !Array.isArray(value.members)) throw new Error("审核渲染任务冻结工程格式无效。");
  const storyboard = value.storyboard;
  if (storyboard.version !== "storyboard/v1" || !Array.isArray(storyboard.shots) || !Array.isArray(storyboard.audioCues)) throw new Error("审核渲染任务缺少冻结分镜。");
  if (value.confirmation_mode !== "shot_preparation" || !Array.isArray(value.confirmed_shots)) throw new Error("OpenChatCut 新工程缺少版本化镜头准备契约。");
  const render:NonNullable<WorkerTaskPackageInput["reviewRender"]> = {
    projectRelativePath: requiredString(value.project_relative_path, "审核渲染任务缺少工程路径。"),
    projectRevision: requiredPositiveNumber(value.project_revision, "审核渲染任务缺少工程修订。"),
    preRenderReviewPackageId: requiredString(value.pre_render_review_package_id, "审核渲染任务缺少预渲染审核包。"),
    confirmationMode: requiredConfirmationMode(value.confirmation_mode),
    confirmedShots: confirmedShots(value.confirmed_shots),
    ...(value.studio_project === undefined && (!isRecord(value.adjustments) || value.adjustments.studio_project === undefined) ? {} : { studioProject: studioProject(value.studio_project ?? (value.adjustments as Record<string, unknown>).studio_project) }),
    ...(value.studio_project_revision === undefined && (!isRecord(value.adjustments) || value.adjustments.studio_project_revision === undefined) ? {} : { studioProjectRevision: requiredString(value.studio_project_revision ?? (value.adjustments as Record<string, unknown>).studio_project_revision, "Studio 冻结工程缺少修订号。") }),
    adjustments: reviewRenderAdjustments(value.adjustments),
    storyboard: storyboard as unknown as StoryboardManifest,
    members: value.members.map((member) => {
      if (!isRecord(member)) throw new Error("审核渲染任务成员格式无效。");
      const subtitlesEnabled = member.subtitles_enabled === undefined || member.subtitles_enabled === null ? undefined : requiredBoolean(member.subtitles_enabled, "审核渲染成员字幕开关格式无效。");
      return {
        memberKey: requiredString(member.member_key, "审核渲染成员缺少标识。"),
        memberKind: requiredReviewRenderMemberKind(member.member_kind),
        ...(member.audio_kind === "bgm" || member.audio_kind === "sfx" ? { audioKind: member.audio_kind } : {}),
        ...(member.task_id === undefined || member.task_id === null ? {} : { taskId: requiredString(member.task_id, "审核渲染成员缺少任务版本。") }),
        ...(member.artifact_id === undefined || member.artifact_id === null ? {} : { artifactId: requiredString(member.artifact_id, "审核渲染成员缺少产物版本。") }),
        ...(member.source_material_revision_id === undefined || member.source_material_revision_id === null ? {} : { sourceMaterialRevisionId: requiredString(member.source_material_revision_id, "审核渲染成员缺少原片版本。") }),
        ...(member.clip_segments === undefined || member.clip_segments === null ? {} : { clipSegments: clipSegments(member.clip_segments) }),
        ...(member.composition === undefined || member.composition === null ? {} : { composition: shotComposition(member.composition, Array.isArray(member.clip_segments) ? member.clip_segments.length : 1) }),
        ...(member.preparation_contract === undefined || member.preparation_contract === null ? {} : { preparationContract: shotPreparationContract(member.preparation_contract) }),
        ...(member.audio_track_id === null ? { audioTrackId: null } : member.audio_track_id === undefined ? {} : { audioTrackId: requiredString(member.audio_track_id, "审核渲染成员缺少音轨版本。") }),
        ...(member.input_fingerprint === undefined || member.input_fingerprint === null ? {} : { inputFingerprint: requiredString(member.input_fingerprint, "审核渲染成员缺少输入版本。") }),
        ...(member.audio_mode === undefined || member.audio_mode === null ? {} : { audioMode: requiredAudioMode(member.audio_mode) }),
        ...(member.subtitle_text === undefined || member.subtitle_text === null ? {} : { subtitleText: requiredSubtitleText(member.subtitle_text, subtitlesEnabled !== false, "审核渲染成员缺少字幕文本。") }),
        ...(subtitlesEnabled === undefined ? {} : { subtitlesEnabled }),
        ...(member.duration_decision === undefined || member.duration_decision === null ? {} : { durationDecision: shotDurationDecisionFromJson(member.duration_decision) }),
        relativePath: requiredString(member.relative_path, "审核渲染成员缺少路径。"),
        sha256: requiredString(member.sha256, "审核渲染成员缺少哈希。"),
        startSeconds: requiredNonNegativeNumber(member.start_seconds, "审核渲染成员缺少起始时间。"),
        durationSeconds: requiredPositiveNumber(member.duration_seconds, "审核渲染成员缺少时长。"),
      };
    }),
  };
  return applyScriptRenderSettings(render,snapshot.script_production);
}

function confirmedShots(value: unknown): NonNullable<WorkerTaskPackageInput["reviewRender"]>["confirmedShots"] {
  if (!Array.isArray(value)) throw new Error("逐镜头 Studio 确认快照格式无效。");
  return value.map((shot) => {
    if (!isRecord(shot)) throw new Error("逐镜头 Studio 确认快照格式无效。");
    const subtitlesEnabled = requiredBoolean(shot.subtitles_enabled, "确认快照字幕开关格式无效。");
    const segments = shot.clip_segments === undefined || shot.clip_segments === null ? undefined : clipSegments(shot.clip_segments);
    return {
      shotId: requiredString(shot.shot_id, "确认快照缺少镜头标识。"),
      confirmationStatus: requiredConfirmationStatus(shot.confirmation_status),
      inputFingerprint: requiredString(shot.input_fingerprint, "确认快照缺少输入指纹。"),
      ...(shot.video_artifact_id === undefined || shot.video_artifact_id === null ? {} : { videoArtifactId: requiredString(shot.video_artifact_id, "确认快照缺少视频版本。") }),
      ...(shot.video_task_id === undefined || shot.video_task_id === null ? {} : { videoTaskId: requiredString(shot.video_task_id, "确认快照缺少视频任务版本。") }),
      ...(shot.source_material_revision_id === undefined || shot.source_material_revision_id === null ? {} : { sourceMaterialRevisionId: requiredString(shot.source_material_revision_id, "确认快照缺少原片版本。") }),
      ...(segments === undefined ? {} : { clipSegments: segments }),
      composition: shotComposition(shot.composition, segments?.length ?? 1),
      preparationContract: shotPreparationContract(shot.preparation_contract),
      audioMode: requiredAudioMode(shot.audio_mode),
      audioTrackId: shot.audio_track_id === null ? null : requiredString(shot.audio_track_id, "确认快照缺少音轨版本。"),
      subtitleText: requiredSubtitleText(shot.subtitle_text, subtitlesEnabled, "确认快照缺少字幕文本。"),
      subtitlesEnabled,
      ...(shot.duration_decision === undefined || shot.duration_decision === null ? {} : { durationDecision: shotDurationDecisionFromJson(shot.duration_decision) }),
    };
  });
}

function shotPreparationContract(value: unknown): ShotPreparationContract {
  if (!isRecord(value) || value.version !== "shot-preparation/v1") throw new Error("镜头准备契约格式无效。");
  const segments = clipSegments(value.clip_segments);
  const captions = shotCaptionContract(value.captions);
  const audioMode = requiredAudioMode(value.audio_mode);
  const audioMixCandidate = jsonKeysToCamel(value.audio_mix);
  const audioMix = normalizeShotAudioMix(audioMixCandidate, { audioMode, audioTrackId: value.audio_track_id === null ? null : typeof value.audio_track_id === "string" ? value.audio_track_id : null });
  if (!isValidShotAudioMix(audioMixCandidate) || audioMix.mainVoice.mode !== audioMode) throw new Error("镜头主声音与混音契约不一致。");
  return {
    version: "shot-preparation/v1",
    storyboardFingerprint: requiredString(value.storyboard_fingerprint, "镜头准备契约缺少分镜版本。"),
    sourceMaterialRevisionId: value.source_material_revision_id === null ? null : requiredString(value.source_material_revision_id, "镜头准备契约缺少原片版本。"),
    clipSegments: segments,
    composition: shotComposition(value.composition, segments.length),
    transitionMode: value.transition_mode === undefined ? "cut" : requiredShotTransitionMode(value.transition_mode),
    audioMode,
    ttsText: value.tts_text === null ? null : requiredString(value.tts_text, "镜头准备契约 TTS 正文格式无效。"),
    ttsVoice: value.tts_voice === null ? null : requiredString(value.tts_voice, "镜头准备契约 TTS 声音格式无效。"),
    ttsSpeakingRate: value.tts_speaking_rate === null ? null : requiredPositiveNumber(value.tts_speaking_rate, "镜头准备契约 TTS 语速格式无效。"),
    audioMix,
    captions,
    inputFingerprint: requiredString(value.input_fingerprint, "镜头准备契约缺少输入指纹。"),
  };
}

export function shotPreparationContractFromSnapshot(value: unknown): ShotPreparationContract {
  return shotPreparationContract(value);
}

function requiredShotTransitionMode(value: unknown): ShotTransitionMode {
  if (typeof value !== "string" || !shotTransitionModes.includes(value as ShotTransitionMode)) throw new Error("镜头准备契约衔接方式无效。");
  return value as ShotTransitionMode;
}

function jsonKeysToCamel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonKeysToCamel);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key.replace(/_([a-z])/g, (_, character: string) => character.toUpperCase()), jsonKeysToCamel(entry)]));
}

function shotCaptionContract(value: unknown): ShotCaptionContract {
  if (!isRecord(value) || !isRecord(value.spatial) || !Array.isArray(value.cues)) throw new Error("镜头字幕契约格式无效。");
  const candidate = {
    version: value.version,
    enabled: value.enabled,
    contentMode: value.content_mode,
    text: value.text,
    cues: value.cues.map((cue) => isRecord(cue) ? { id: cue.id, text: cue.text, startMs: cue.start_ms, endMs: cue.end_ms } : cue),
    spatial: {
      version: value.spatial.version,
      anchor: value.spatial.anchor,
      safeArea: value.spatial.safe_area,
      ...(value.spatial.aspect_ratio === undefined ? {} : { aspectRatio: value.spatial.aspect_ratio }),
      ...(value.spatial.insets === undefined ? {} : { insets: value.spatial.insets }),
      maxLines: value.spatial.max_lines,
      maxCharactersPerLine: value.spatial.max_characters_per_line,
    },
  };
  const normalized = normalizeShotCaptionContract(candidate, { enabled: Boolean(value.enabled), text: typeof value.text === "string" ? value.text : "" });
  if (!isValidShotCaptionContract(normalized)) throw new Error("镜头字幕契约格式无效。");
  return normalized;
}

function shotComposition(value: unknown, clipSegmentCount: number): ShotComposition {
  if (value === undefined || value === null) return normalizeShotComposition(undefined, clipSegmentCount);
  if (!isValidShotComposition(value, Math.max(1, clipSegmentCount))) throw new Error("镜头结构化构图格式无效。");
  return value;
}

function clipSegments(value: unknown): Array<{ startSeconds: number; endSeconds: number }> {
  if (!Array.isArray(value) || value.length === 0) throw new Error("片段标记格式无效。");
  return value.map((segment) => {
    if (!isRecord(segment)) throw new Error("片段标记格式无效。");
    return { startSeconds: requiredNonNegativeNumber(segment.start_seconds, "片段标记缺少入点。"), endSeconds: requiredPositiveNumber(segment.end_seconds, "片段标记缺少出点。") };
  });
}

function requiredConfirmationMode(value: unknown): "shot_preparation" {
  if (value === "shot_preparation") return value;
  throw new Error("Studio 确认模式无效。");
}

function requiredConfirmationStatus(value: unknown): "confirmed" {
  if (value === "confirmed") return value;
  throw new Error("确认快照必须来自已确认镜头。");
}

function requiredAudioMode(value: unknown): "none" | "source" | "tts" {
  if (value === "none" || value === "source" || value === "tts") return value;
  throw new Error("Studio 音频模式无效。");
}

function studioProject(value: unknown): NonNullable<WorkerTaskPackageInput["reviewRender"]>["studioProject"] {
  if (!isRecord(value)) throw new Error("Studio 冻结工程格式无效。");
  const relativePath = requiredString(value.relative_path, "Studio 冻结工程缺少路径。");
  const sha256 = requiredString(value.sha256, "Studio 冻结工程缺少哈希。");
  const fileSize = requiredPositiveNumber(value.file_size, "Studio 冻结工程缺少文件大小。");
  if (!(/^(?:episodes\/[0-9a-f-]{36}\/studio-frozen\/[0-9a-f-]{36}\/index\.html|episodes\/[0-9a-f-]{36}\/openchatcut-frozen\/[0-9a-f-]{36}\/project\.json)$/i.test(relativePath)) || !/^[0-9a-f]{64}$/i.test(sha256)) throw new Error("Studio 冻结工程格式无效。");
  return { relativePath, sha256, fileSize };
}

function reviewRenderAdjustments(value: unknown): ReviewRenderAdjustments {
  if (!isRecord(value)) throw new Error("审核渲染任务缺少冻结合成配置。");
  const captionStyle = value.caption_style;
  const pacing = value.pacing;
  const crop = value.crop;
  const transition = value.transition;
  const layout = value.layout;
  const aspectRatio = value.aspect_ratio;
  const width = value.width;
  const height = value.height;
  const captionsEnabled = value.captions_enabled;
  const narrationGainDb = value.narration_gain_db;
  const bgmGainDb = value.bgm_gain_db;
  const sfxGainDb = value.sfx_gain_db;
  const frameRate = value.frame_rate === undefined ? defaultDurationFrameRate : value.frame_rate;
  const allowedFrames = value.allowed_frames === undefined ? defaultAllowedDurationFrames : value.allowed_frames;
  if ((aspectRatio !== "9:16" && aspectRatio !== "16:9" && aspectRatio !== "1:1") || typeof width !== "number" || typeof height !== "number" || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || (aspectRatio === "9:16" && width * 16 !== height * 9) || (aspectRatio === "16:9" && width * 9 !== height * 16) || (aspectRatio === "1:1" && width !== height) || typeof captionsEnabled !== "boolean" || (captionStyle !== "cinematic" && captionStyle !== "minimal") || (pacing !== "gentle" && pacing !== "standard" && pacing !== "compact") || (crop !== "cover" && crop !== "contain") || (transition !== "fade" && transition !== "cut") || (layout !== "lower_third" && layout !== "center") || typeof narrationGainDb !== "number" || typeof bgmGainDb !== "number" || typeof sfxGainDb !== "number" || !Number.isFinite(narrationGainDb) || !Number.isFinite(bgmGainDb) || !Number.isFinite(sfxGainDb) || typeof frameRate !== "number" || !Number.isFinite(frameRate) || frameRate <= 0 || typeof allowedFrames !== "number" || !Number.isInteger(allowedFrames) || allowedFrames < 0) throw new Error("审核渲染任务冻结合成配置无效。");
  return { aspectRatio, width, height, captionsEnabled, captionStyle, pacing, crop, transition, layout, narrationGainDb, bgmGainDb, sfxGainDb, frameRate, allowedFrames, reason: requiredString(value.reason, "审核渲染任务缺少调整理由。") };
}

function requiredReviewRenderMemberKind(value: unknown): "shot_media" | "narration" | "soundtrack" {
  if (value === "shot_media" || value === "narration" || value === "soundtrack") return value;
  throw new Error("审核渲染成员类型无效。");
}

function requiredSubtitleText(value: unknown, enabled: boolean, message: string): string {
  if (typeof value !== "string" || (enabled && !value.trim())) throw new Error(message);
  return value;
}
