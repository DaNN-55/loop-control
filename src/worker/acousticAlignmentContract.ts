export const acousticAlignmentStatuses = ["waiting", "aligning", "completed", "needs_review", "stale", "failed"] as const;
export const acousticAlignmentMethods = ["none", "tts_native", "external_text_audio", "local_whisperx", "manual"] as const;
export const acousticAlignmentGranularities = ["none", "character", "word", "phrase"] as const;

export type AcousticAlignmentStatus = typeof acousticAlignmentStatuses[number];
export type AcousticAlignmentMethod = typeof acousticAlignmentMethods[number];
export type AcousticAlignmentGranularity = typeof acousticAlignmentGranularities[number];

export interface AcousticAlignmentCue {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface AcousticAlignmentReviewIssue {
  id: string;
  kind: "low_confidence" | "unmatched_text";
  text: string;
  cueIds: string[];
  detail: string;
}

export interface AcousticAlignmentCandidate {
  method: Exclude<AcousticAlignmentMethod, "none">;
  granularity: Exclude<AcousticAlignmentGranularity, "none">;
  provider: string;
  model: string;
  cues: AcousticAlignmentCue[];
  reportedText?: string;
}

export interface AcousticAlignmentResult {
  version: "acoustic-alignment/v1";
  status: AcousticAlignmentStatus;
  method: AcousticAlignmentMethod;
  granularity: AcousticAlignmentGranularity;
  inputVersion: string;
  audioSha256: string;
  textFingerprint: string;
  provider: string;
  model: string;
  connectionVersionId: string | null;
  wordCount: number;
  cues: AcousticAlignmentCue[];
  reviewIssues?: AcousticAlignmentReviewIssue[];
  attempts: Array<{ method: Exclude<AcousticAlignmentMethod, "none">; status: "unsupported" | "failed" | "completed"; detail: string }>;
  detail: string;
  generatedAt: string;
}

export function isValidAcousticAlignmentResult(value: unknown): value is AcousticAlignmentResult {
  if (!isRecord(value) || value.version !== "acoustic-alignment/v1" || !acousticAlignmentStatuses.includes(value.status as AcousticAlignmentStatus) || !acousticAlignmentMethods.includes(value.method as AcousticAlignmentMethod) || !acousticAlignmentGranularities.includes(value.granularity as AcousticAlignmentGranularity) || !isSha256(value.inputVersion) || (value.audioSha256 !== "" && !isSha256(value.audioSha256)) || !isSha256(value.textFingerprint) || typeof value.provider !== "string" || typeof value.model !== "string" || (value.connectionVersionId !== null && typeof value.connectionVersionId !== "string") || !Number.isInteger(value.wordCount) || Number(value.wordCount) < 0 || !Array.isArray(value.cues) || (value.reviewIssues !== undefined && !Array.isArray(value.reviewIssues)) || !Array.isArray(value.attempts) || typeof value.detail !== "string" || typeof value.generatedAt !== "string") return false;
  const reviewIssues = value.reviewIssues ?? [];
  if ((value.status === "completed" || value.status === "needs_review") && (value.method === "none" || value.granularity === "none")) return false;
  if (value.status === "completed" && (value.cues.length === 0 || value.wordCount !== value.cues.length || reviewIssues.length > 0)) return false;
  if (value.status === "needs_review" && reviewIssues.length === 0) return false;
  if ((value.status === "waiting" || value.status === "aligning" || value.status === "failed") && value.cues.length > 0) return false;
  return value.cues.every((cue) => isRecord(cue) && typeof cue.id === "string" && typeof cue.text === "string" && typeof cue.startMs === "number" && typeof cue.endMs === "number" && cue.startMs >= 0 && cue.endMs > cue.startMs && (cue.confidence === undefined || typeof cue.confidence === "number"))
    && reviewIssues.every((issue) => isRecord(issue) && typeof issue.id === "string" && (issue.kind === "low_confidence" || issue.kind === "unmatched_text") && typeof issue.text === "string" && Array.isArray(issue.cueIds) && issue.cueIds.every((id) => typeof id === "string") && typeof issue.detail === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}
