import type { Json } from "../lib/database.types";
import { defaultAllowedDurationFrames, defaultDurationFrameRate } from "../worker/durationDecision";
import type { ReviewRenderComposition } from "./reviewComposition";
export { defaultReviewRenderComposition, reviewRenderCompositionFromJson } from "./reviewComposition";
export type { ReviewRenderComposition } from "./reviewComposition";

export interface ReviewRenderDurationSettings { frameRate: number; allowedFrames: number; aspectRatio: "9:16" | "16:9" | "1:1"; }

export interface OpenChatCutStudioWorkspace {
  relativePath: string;
  sha256: string;
  fileSize: number;
  composition?: ReviewRenderComposition;
  projectId?: string;
  replacementWarning?: {
    code: "openchatcut_workspace_replacement";
    modifiedScopes: string[];
    studioHasChanges: boolean;
  };
}

export const defaultReviewRenderDurationSettings: ReviewRenderDurationSettings = { frameRate: defaultDurationFrameRate, allowedFrames: defaultAllowedDurationFrames, aspectRatio: "9:16" };

export function reviewRenderDurationSettingsFromRules(rules?: Json): ReviewRenderDurationSettings {
  const root = rules && !Array.isArray(rules) && typeof rules === "object" ? rules as Record<string, Json | undefined> : {};
  const candidate = root.openchatcut_composition;
  const composition = candidate && !Array.isArray(candidate) && typeof candidate === "object" ? candidate as Record<string, Json | undefined> : {};
  const frameRate = composition.frame_rate;
  const allowedFrames = composition.allowed_frames;
  const aspectRatio = composition.aspect_ratio;
  return {
    frameRate: typeof frameRate === "number" && Number.isFinite(frameRate) && frameRate > 0 ? frameRate : defaultReviewRenderDurationSettings.frameRate,
    allowedFrames: typeof allowedFrames === "number" && Number.isInteger(allowedFrames) && allowedFrames >= 0 ? allowedFrames : defaultReviewRenderDurationSettings.allowedFrames,
    aspectRatio: aspectRatio === "16:9" || aspectRatio === "1:1" ? aspectRatio : "9:16",
  };
}

export function studioWorkspaceFromPayload(value: unknown): OpenChatCutStudioWorkspace {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Studio 工作区响应无效。");
  const workspace = value as Record<string, unknown>;
  if (typeof workspace.relativePath !== "string" || typeof workspace.sha256 !== "string" || typeof workspace.fileSize !== "number") throw new Error("Studio 工作区响应无效。");
  return { relativePath: workspace.relativePath, sha256: workspace.sha256, fileSize: workspace.fileSize, ...(typeof workspace.projectId === "string" ? { projectId: workspace.projectId } : {}) };
}
