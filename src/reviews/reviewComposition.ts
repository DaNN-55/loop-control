import { defaultAllowedDurationFrames, defaultDurationFrameRate } from "../worker/durationDecision";

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
  frameRate?: number;
  allowedFrames?: number;
}

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
  frameRate: defaultDurationFrameRate,
  allowedFrames: defaultAllowedDurationFrames,
};

export function reviewRenderCompositionFromJson(value: unknown): ReviewRenderComposition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const read = (snakeCase: string, camelCase: string): unknown => snakeCase in record ? record[snakeCase] : record[camelCase];
  const aspect_ratio = read("aspect_ratio", "aspectRatio");
  const width = record.width;
  const height = record.height;
  const captions_enabled = read("captions_enabled", "captionsEnabled");
  const caption_style = read("caption_style", "captionStyle");
  const pacing = record.pacing;
  const crop = record.crop;
  const transition = record.transition;
  const layout = record.layout;
  const narration_gain_db = read("narration_gain_db", "narrationGainDb");
  const bgm_gain_db = read("bgm_gain_db", "bgmGainDb");
  const sfx_gain_db = read("sfx_gain_db", "sfxGainDb");
  const frame_rate = read("frame_rate", "frameRate");
  const allowed_frames = read("allowed_frames", "allowedFrames");
  const frameRate = frame_rate ?? defaultReviewRenderComposition.frameRate;
  const allowedFrames = allowed_frames ?? defaultReviewRenderComposition.allowedFrames;
  if ((aspect_ratio !== "9:16" && aspect_ratio !== "16:9" && aspect_ratio !== "1:1") || typeof width !== "number" || typeof height !== "number" || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || (aspect_ratio === "9:16" && width * 16 !== height * 9) || (aspect_ratio === "16:9" && width * 9 !== height * 16) || (aspect_ratio === "1:1" && width !== height) || typeof captions_enabled !== "boolean" || (caption_style !== "cinematic" && caption_style !== "minimal") || (pacing !== "gentle" && pacing !== "standard" && pacing !== "compact") || (crop !== "cover" && crop !== "contain") || (transition !== "fade" && transition !== "cut") || (layout !== "lower_third" && layout !== "center") || typeof narration_gain_db !== "number" || !Number.isFinite(narration_gain_db) || typeof bgm_gain_db !== "number" || !Number.isFinite(bgm_gain_db) || typeof sfx_gain_db !== "number" || !Number.isFinite(sfx_gain_db) || typeof frameRate !== "number" || !Number.isFinite(frameRate) || frameRate <= 0 || typeof allowedFrames !== "number" || !Number.isInteger(allowedFrames) || allowedFrames < 0) return null;
  return { aspectRatio: aspect_ratio, width, height, captionsEnabled: captions_enabled, captionStyle: caption_style, pacing, crop, transition, layout, narrationGainDb: narration_gain_db, bgmGainDb: bgm_gain_db, sfxGainDb: sfx_gain_db, frameRate, allowedFrames };
}

export function reviewRenderCompositionToJson(composition: ReviewRenderComposition): Record<string, unknown> {
  return { aspect_ratio: composition.aspectRatio, width: composition.width, height: composition.height, captions_enabled: composition.captionsEnabled, caption_style: composition.captionStyle, pacing: composition.pacing, crop: composition.crop, transition: composition.transition, layout: composition.layout, narration_gain_db: composition.narrationGainDb, bgm_gain_db: composition.bgmGainDb, sfx_gain_db: composition.sfxGainDb, frame_rate: composition.frameRate ?? defaultDurationFrameRate, allowed_frames: composition.allowedFrames ?? defaultAllowedDurationFrames };
}
