import type { Database, Json } from "../lib/database.types";
import { supabase } from "../lib/supabase";
import type { StoryboardStructureOperation } from "../worker/storyboardRevision";
import { defaultAllowedDurationFrames, defaultDurationFrameRate } from "../worker/durationDecision";
import { defaultReviewRenderComposition, reviewRenderCompositionFromJson, reviewRenderCompositionToJson, type ReviewRenderComposition } from "./reviewComposition";
export { defaultReviewRenderComposition, reviewRenderCompositionFromJson } from "./reviewComposition";
export type { ReviewRenderComposition } from "./reviewComposition";

export interface ReviewRenderDurationSettings { frameRate: number; allowedFrames: number; }

export interface OpenChatCutStudioWorkspace {
  relativePath: string;
  sha256: string;
  fileSize: number;
  composition?: ReviewRenderComposition;
  projectId?: string;
}

export type ReviewRevisionRequest =
  | { kind: "composition"; reviewPackageId: string; composition?: ReviewRenderComposition; reason: string; studioProject?: OpenChatCutStudioWorkspace }
  | { kind: "storyboard"; reviewPackageId: string; reason: string };

export type ShotStructureRevisionRequest = {
  episodeId: string;
  operation: StoryboardStructureOperation;
  reason: string;
  reviewPackageId: string;
};

export type ReviewRevisionOutcome =
  | { kind: "composition"; message: "合成调整已冻结；会复用已批准媒体和音轨生成新的审核渲染。" }
  | { kind: "storyboard"; message: "分镜结构修订已提交；已返回分镜审核。" };

export type StudioReviewRevisionRequest = {
  accessToken: string;
  episodeId: string;
  reviewPackageId: string;
  reason: string;
  sourceProjectRelativePath: string;
  workspaceRelativePath: string;
  composition?: ReviewRenderComposition;
};

export const defaultReviewRenderDurationSettings: ReviewRenderDurationSettings = { frameRate: defaultDurationFrameRate, allowedFrames: defaultAllowedDurationFrames };

export function reviewRenderDurationSettingsFromRules(rules?: Json): ReviewRenderDurationSettings {
  const root = rules && !Array.isArray(rules) && typeof rules === "object" ? rules as Record<string, Json | undefined> : {};
  const candidate = root.openchatcut_composition;
  const composition = candidate && !Array.isArray(candidate) && typeof candidate === "object" ? candidate as Record<string, Json | undefined> : {};
  const frameRate = composition.frame_rate;
  const allowedFrames = composition.allowed_frames;
  return {
    frameRate: typeof frameRate === "number" && Number.isFinite(frameRate) && frameRate > 0 ? frameRate : defaultReviewRenderDurationSettings.frameRate,
    allowedFrames: typeof allowedFrames === "number" && Number.isInteger(allowedFrames) && allowedFrames >= 0 ? allowedFrames : defaultReviewRenderDurationSettings.allowedFrames,
  };
}

export async function requestReviewRevision(input: ReviewRevisionRequest): Promise<ReviewRevisionOutcome> {
  if (input.kind === "storyboard") {
    const { error } = await supabase.rpc("request_studio_storyboard_revision", { p_reason: input.reason, p_review_package_id: input.reviewPackageId });
    if (error) throw error;
    return { kind: "storyboard", message: "分镜结构修订已提交；已返回分镜审核。" };
  }

  if (input.studioProject && !input.studioProject.composition) throw new Error("Studio 冻结工程缺少有效合成配置。");
  const composition = reviewRenderCompositionToJson(input.studioProject?.composition ?? input.composition ?? defaultReviewRenderComposition) as Record<string, Json>;
  const { error } = await supabase.rpc("request_review_render_revision", {
    p_composition: input.studioProject ? { ...composition, studio_project: { relative_path: input.studioProject.relativePath, sha256: input.studioProject.sha256, file_size: input.studioProject.fileSize, composition } } : composition,
    p_reason: input.reason,
    p_review_package_id: input.reviewPackageId,
  });
  if (error) throw new Error(error.message);
  return { kind: "composition", message: "合成调整已冻结；会复用已批准媒体和音轨生成新的审核渲染。" };
}

export async function requestShotStructureRevision(input: ShotStructureRevisionRequest): Promise<Database["public"]["Tables"]["tasks"]["Row"]> {
  const { data, error } = await supabase.rpc("request_shot_structure_revision", {
    p_episode_id: input.episodeId,
    p_operation: input.operation as unknown as Json,
    p_reason: input.reason,
    p_review_package_id: input.reviewPackageId,
  });
  if (error) throw error;
  return data;
}

export async function submitStudioReviewRevision(input: StudioReviewRevisionRequest): Promise<ReviewRevisionOutcome> {
  const response = await fetch(`/_freeze-openchatcut-studio?episode=${encodeURIComponent(input.episodeId)}`, {
    body: JSON.stringify({ sourceProjectRelativePath: input.sourceProjectRelativePath, workspaceRelativePath: input.workspaceRelativePath }),
    headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
    method: "POST",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload) || !("frozenProject" in payload)) throw new Error("无法冻结 Studio 修改。");
  const studioProject = studioWorkspaceFromPayload(payload.frozenProject);
  return requestReviewRevision({ kind: "composition", reviewPackageId: input.reviewPackageId, reason: input.reason, composition: studioProject.composition, studioProject });
}

export async function recoverFinalReviewRender(episodeId: string, reason: string): Promise<"最终渲染已重新排队；会复用已批准的审核工程。"> {
  const { error } = await supabase.rpc("retry_failed_final_render", { p_episode_id: episodeId, p_reason: reason });
  if (error) throw error;
  return "最终渲染已重新排队；会复用已批准的审核工程。";
}

function studioWorkspaceFromPayload(value: unknown): OpenChatCutStudioWorkspace {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Studio 工作区响应无效。");
  const workspace = value as Record<string, unknown>;
  if (typeof workspace.relativePath !== "string" || typeof workspace.sha256 !== "string" || typeof workspace.fileSize !== "number") throw new Error("Studio 工作区响应无效。");
  const composition = reviewRenderCompositionFromJson(workspace.composition);
  if (!composition) throw new Error("Studio 冻结工程缺少有效合成配置。");
  return { relativePath: workspace.relativePath, sha256: workspace.sha256, fileSize: workspace.fileSize, composition, ...(typeof workspace.projectId === "string" ? { projectId: workspace.projectId } : {}) };
}
