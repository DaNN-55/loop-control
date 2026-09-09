export const shotDurationDecisionVersion = "shot-duration/v1" as const;
export const defaultDurationFrameRate = 30;
export const defaultAllowedDurationFrames = 2;

export type ShotAudioMode = "none" | "source" | "tts";
export type ShotDurationStatus = "pending" | "not_applicable" | "synchronized" | "needs_attention";

export interface ShotDurationDecision {
  version: typeof shotDurationDecisionVersion;
  audioMode: ShotAudioMode;
  plannedDurationSeconds: number;
  clipDurationSeconds: number | null;
  actualAudioDurationSeconds: number | null;
  studioAdoptedDurationSeconds: number | null;
  audioVideoDeltaSeconds: number | null;
  planDeltaSeconds: number | null;
  frameRate: number;
  allowedFrames: number;
  frameToleranceSeconds: number;
  status: ShotDurationStatus;
}

export function durationToleranceSeconds(frameRate = defaultDurationFrameRate, allowedFrames = defaultAllowedDurationFrames): number {
  if (!Number.isFinite(frameRate) || frameRate <= 0 || !Number.isFinite(allowedFrames) || allowedFrames < 0) throw new Error("帧率和允许帧数必须有效。");
  return allowedFrames / frameRate;
}

export function durationWithinFrameTolerance(deltaSeconds: number, frameRate = defaultDurationFrameRate, allowedFrames = defaultAllowedDurationFrames): boolean {
  return Math.abs(deltaSeconds) <= durationToleranceSeconds(frameRate, allowedFrames) + 1e-9;
}

export function videoDurationMeetsMinimum(actualSeconds: number, minimumSeconds: number, frameRate = defaultDurationFrameRate, allowedFrames = defaultAllowedDurationFrames): boolean {
  return Number.isFinite(actualSeconds)
    && Number.isFinite(minimumSeconds)
    && actualSeconds + durationToleranceSeconds(frameRate, allowedFrames) + 1e-9 >= minimumSeconds;
}

export function createShotDurationDecision(input: {
  audioMode: ShotAudioMode;
  actualAudioDurationSeconds: number | null;
  allowedFrames?: number;
  clipDurationSeconds: number | null;
  frameRate?: number;
  plannedDurationSeconds: number;
  studioAdoptedDurationSeconds?: number | null;
}): ShotDurationDecision {
  const frameRate = input.frameRate ?? defaultDurationFrameRate;
  const allowedFrames = input.allowedFrames ?? defaultAllowedDurationFrames;
  const frameToleranceSeconds = durationToleranceSeconds(frameRate, allowedFrames);
  const clipDurationSeconds = validDuration(input.clipDurationSeconds) ? input.clipDurationSeconds : null;
  const actualAudioDurationSeconds = input.audioMode === "none" || !validDuration(input.actualAudioDurationSeconds) ? null : input.actualAudioDurationSeconds;
  const studioAdoptedDurationSeconds = clipDurationSeconds === null ? null : validDuration(input.studioAdoptedDurationSeconds ?? clipDurationSeconds) ? input.studioAdoptedDurationSeconds ?? clipDurationSeconds : null;
  const audioVideoDeltaSeconds = input.audioMode === "none" || clipDurationSeconds === null || actualAudioDurationSeconds === null ? null : actualAudioDurationSeconds - clipDurationSeconds;
  const planDeltaSeconds = studioAdoptedDurationSeconds === null ? null : studioAdoptedDurationSeconds - input.plannedDurationSeconds;
  const status = clipDurationSeconds === null ? "pending" : input.audioMode === "none" ? "not_applicable" : actualAudioDurationSeconds === null ? "pending" : durationWithinFrameTolerance(audioVideoDeltaSeconds ?? 0, frameRate, allowedFrames) ? "synchronized" : "needs_attention";
  return {
    version: shotDurationDecisionVersion,
    audioMode: input.audioMode,
    plannedDurationSeconds: input.plannedDurationSeconds,
    clipDurationSeconds,
    actualAudioDurationSeconds,
    studioAdoptedDurationSeconds,
    audioVideoDeltaSeconds,
    planDeltaSeconds,
    frameRate,
    allowedFrames,
    frameToleranceSeconds,
    status,
  };
}

export function isShotDurationDecision(value: unknown): value is ShotDurationDecision {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const decision = value as Partial<ShotDurationDecision>;
  if (decision.version !== shotDurationDecisionVersion
    || (decision.audioMode !== "none" && decision.audioMode !== "source" && decision.audioMode !== "tts")
    || typeof decision.plannedDurationSeconds !== "number" || !Number.isFinite(decision.plannedDurationSeconds) || decision.plannedDurationSeconds <= 0
    || !positiveOrNull(decision.clipDurationSeconds)
    || !positiveOrNull(decision.actualAudioDurationSeconds)
    || !positiveOrNull(decision.studioAdoptedDurationSeconds)
    || !finiteOrNull(decision.audioVideoDeltaSeconds)
    || !finiteOrNull(decision.planDeltaSeconds)
    || typeof decision.frameRate !== "number" || !Number.isFinite(decision.frameRate) || decision.frameRate <= 0
    || typeof decision.allowedFrames !== "number" || !Number.isInteger(decision.allowedFrames) || decision.allowedFrames < 0
    || typeof decision.frameToleranceSeconds !== "number" || !Number.isFinite(decision.frameToleranceSeconds) || decision.frameToleranceSeconds < 0
    || typeof decision.status !== "string") return false;
  const completeDecision = decision as ShotDurationDecision;
  return Math.abs(completeDecision.frameToleranceSeconds - completeDecision.allowedFrames / completeDecision.frameRate) < 1e-9
    && (completeDecision.audioMode === "none" ? completeDecision.actualAudioDurationSeconds === null && completeDecision.audioVideoDeltaSeconds === null : true)
    && (completeDecision.audioVideoDeltaSeconds === null || completeDecision.clipDurationSeconds !== null && completeDecision.actualAudioDurationSeconds !== null && Math.abs(completeDecision.audioVideoDeltaSeconds - (completeDecision.actualAudioDurationSeconds - completeDecision.clipDurationSeconds)) < 1e-9)
    && (completeDecision.planDeltaSeconds === null || completeDecision.studioAdoptedDurationSeconds !== null && Math.abs(completeDecision.planDeltaSeconds - (completeDecision.studioAdoptedDurationSeconds - completeDecision.plannedDurationSeconds)) < 1e-9)
    && completeDecision.status === expectedStatus(completeDecision);
}

function expectedStatus(decision: Pick<ShotDurationDecision, "audioMode" | "clipDurationSeconds" | "actualAudioDurationSeconds" | "audioVideoDeltaSeconds" | "frameRate" | "allowedFrames">): ShotDurationStatus {
  if (decision.clipDurationSeconds === null) return "pending";
  if (decision.audioMode === "none") return "not_applicable";
  if (decision.actualAudioDurationSeconds === null || decision.audioVideoDeltaSeconds === null) return "pending";
  return durationWithinFrameTolerance(decision.audioVideoDeltaSeconds, decision.frameRate, decision.allowedFrames) ? "synchronized" : "needs_attention";
}

export function shotDurationDecisionFromJson(value: unknown): ShotDurationDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("镜头时长判定格式无效。");
  const raw = value as Record<string, unknown>;
  const decision = {
    version: raw.version,
    audioMode: raw.audio_mode,
    plannedDurationSeconds: raw.planned_duration_seconds,
    clipDurationSeconds: raw.clip_duration_seconds ?? null,
    actualAudioDurationSeconds: raw.actual_audio_duration_seconds ?? null,
    studioAdoptedDurationSeconds: raw.studio_adopted_duration_seconds ?? null,
    audioVideoDeltaSeconds: raw.audio_video_delta_seconds ?? null,
    planDeltaSeconds: raw.plan_delta_seconds ?? null,
    frameRate: raw.frame_rate,
    allowedFrames: raw.allowed_frames,
    frameToleranceSeconds: raw.frame_tolerance_seconds,
    status: raw.status,
  };
  if (!isShotDurationDecision(decision)) throw new Error("镜头时长判定格式无效。");
  return decision;
}

function validDuration(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function positiveOrNull(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value > 0);
}

function finiteOrNull(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}
