import type { Json } from "../lib/database.types";
import { supabase } from "../lib/supabase";
import type { StoryboardStructureOperation } from "../worker/storyboardRevision";

export interface ReviewRenderComposition {
  aspectRatio: "9:16" | "16:9" | "1:1";
  width: number;
  height: number;
  captionsEnabled: boolean;
  captionStyle: "cinematic" | "minimal";
  pacing: "gentle" | "standard" | "compact";
  crop: "cover" | "contain";
  transition: "fade" | "cut";
  layout: "lower_third" | "center";
  narrationGainDb: number;
  bgmGainDb: number;
  sfxGainDb: number;
}

export interface HyperframesStudioWorkspace {
  relativePath: string;
  sha256: string;
  fileSize: number;
}

export type ReviewRevisionRequest =
  | { kind: "composition"; reviewPackageId: string; composition?: ReviewRenderComposition; reason: string; studioProject?: HyperframesStudioWorkspace }
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

export const defaultReviewRenderComposition: ReviewRenderComposition = {
  aspectRatio: "9:16",
  width: 1080,
  height: 1920,
  captionsEnabled: true,
  captionStyle: "cinematic",
  pacing: "standard",
  crop: "cover",
  transition: "fade",
  layout: "lower_third",
  narrationGainDb: 0,
  bgmGainDb: -12,
  sfxGainDb: -6,
};

export async function requestReviewRevision(input: ReviewRevisionRequest): Promise<ReviewRevisionOutcome> {
  if (input.kind === "storyboard") {
    const { error } = await supabase.rpc("request_studio_storyboard_revision", { p_reason: input.reason, p_review_package_id: input.reviewPackageId });
    if (error) throw error;
    return { kind: "storyboard", message: "分镜结构修订已提交；已返回分镜审核。" };
  }

  const composition = reviewRenderCompositionToJson(input.composition ?? defaultReviewRenderComposition) as Record<string, Json>;
  const { error } = await supabase.rpc("request_review_render_revision", {
    p_composition: input.studioProject ? { ...composition, studio_project: { relative_path: input.studioProject.relativePath, sha256: input.studioProject.sha256, file_size: input.studioProject.fileSize } } : composition,
    p_reason: input.reason,
    p_review_package_id: input.reviewPackageId,
  });
  if (error) throw new Error(error.message);
  return { kind: "composition", message: "合成调整已冻结；会复用已批准媒体和音轨生成新的审核渲染。" };
}

export async function requestShotStructureRevision(input: ShotStructureRevisionRequest): Promise<void> {
  const { error } = await supabase.rpc("request_shot_structure_revision", {
    p_episode_id: input.episodeId,
    p_operation: input.operation as unknown as Json,
    p_reason: input.reason,
    p_review_package_id: input.reviewPackageId,
  });
  if (error) throw error;
}

export async function submitStudioReviewRevision(input: StudioReviewRevisionRequest): Promise<ReviewRevisionOutcome> {
  const response = await fetch(`/_freeze-hyperframes-studio?episode=${encodeURIComponent(input.episodeId)}`, {
    body: JSON.stringify({ sourceProjectRelativePath: input.sourceProjectRelativePath, workspaceRelativePath: input.workspaceRelativePath }),
    headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
    method: "POST",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload) || !("frozenProject" in payload)) throw new Error("无法冻结 Studio 修改。");
  const studioProject = studioWorkspaceFromPayload(payload.frozenProject);
  return requestReviewRevision({ kind: "composition", reviewPackageId: input.reviewPackageId, reason: input.reason, composition: input.composition, studioProject });
}

export async function recoverFinalReviewRender(episodeId: string, reason: string): Promise<"最终渲染已重新排队；会复用已批准的审核工程。"> {
  const { error } = await supabase.rpc("retry_failed_final_render", { p_episode_id: episodeId, p_reason: reason });
  if (error) throw error;
  return "最终渲染已重新排队；会复用已批准的审核工程。";
}

function reviewRenderCompositionToJson(composition: ReviewRenderComposition): Json {
  return { aspect_ratio: composition.aspectRatio, width: composition.width, height: composition.height, captions_enabled: composition.captionsEnabled, caption_style: composition.captionStyle, pacing: composition.pacing, crop: composition.crop, transition: composition.transition, layout: composition.layout, narration_gain_db: composition.narrationGainDb, bgm_gain_db: composition.bgmGainDb, sfx_gain_db: composition.sfxGainDb };
}

function studioWorkspaceFromPayload(value: unknown): HyperframesStudioWorkspace {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Studio 工作区响应无效。");
  const workspace = value as Record<string, unknown>;
  if (typeof workspace.relativePath !== "string" || typeof workspace.sha256 !== "string" || typeof workspace.fileSize !== "number") throw new Error("Studio 工作区响应无效。");
  return { relativePath: workspace.relativePath, sha256: workspace.sha256, fileSize: workspace.fileSize };
}
