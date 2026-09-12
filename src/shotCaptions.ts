export const shotCaptionContentModes = ["follow_tts", "independent"] as const;
export const shotCaptionAnchors = [
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
] as const;
export const shotCaptionSafeAreas = ["title-safe", "action-safe", "custom"] as const;
export const shotCaptionCanvasAspectRatios = ["9:16", "16:9", "1:1"] as const;

export type ShotCaptionContentMode = typeof shotCaptionContentModes[number];
export type ShotCaptionAnchor = typeof shotCaptionAnchors[number];
export type ShotCaptionSafeArea = typeof shotCaptionSafeAreas[number];
export type ShotCaptionCanvasAspectRatio = typeof shotCaptionCanvasAspectRatios[number];

export interface ShotCaptionSafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ShotCaptionCue {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface ShotCaptionSpatialConstraints {
  version: "shot-caption-space/v1" | "shot-caption-space/v2";
  anchor: ShotCaptionAnchor;
  safeArea: ShotCaptionSafeArea;
  aspectRatio?: ShotCaptionCanvasAspectRatio;
  insets?: ShotCaptionSafeAreaInsets;
  maxLines: number;
  maxCharactersPerLine: number;
}

export interface ShotCaptionContract {
  version: "shot-captions/v1";
  enabled: boolean;
  contentMode: ShotCaptionContentMode;
  text: string;
  cues: ShotCaptionCue[];
  spatial: ShotCaptionSpatialConstraints;
}

export const shotCaptionAnchorLabels: Record<ShotCaptionAnchor, string> = {
  "top-left": "左上",
  "top-center": "上方",
  "top-right": "右上",
  "middle-left": "左侧",
  "middle-center": "中央",
  "middle-right": "右侧",
  "bottom-left": "左下",
  "bottom-center": "下方",
  "bottom-right": "右下",
};

export const shotCaptionSafeAreaLabels: Record<ShotCaptionSafeArea, string> = {
  "title-safe": "标题安全区",
  "action-safe": "动作安全区",
  custom: "自定义安全区",
};

const presetInsets: Record<ShotCaptionCanvasAspectRatio, Record<Exclude<ShotCaptionSafeArea, "custom">, ShotCaptionSafeAreaInsets>> = {
  "9:16": {
    "title-safe": { top: 0.08, right: 0.08, bottom: 0.18, left: 0.08 },
    "action-safe": { top: 0.05, right: 0.05, bottom: 0.12, left: 0.05 },
  },
  "16:9": {
    "title-safe": { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 },
    "action-safe": { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
  },
  "1:1": {
    "title-safe": { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 },
    "action-safe": { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
  },
};

export function shotCaptionSafeAreaInsets(spatial: Pick<ShotCaptionSpatialConstraints, "aspectRatio" | "insets" | "safeArea">): ShotCaptionSafeAreaInsets {
  const aspectRatio = spatial.aspectRatio ?? "9:16";
  if (spatial.safeArea !== "custom") return { ...presetInsets[aspectRatio][spatial.safeArea] };
  return normalizeInsets(spatial.insets, presetInsets[aspectRatio]["title-safe"]);
}

export function shotCaptionSafeAreaGeometry(spatial: Pick<ShotCaptionSpatialConstraints, "anchor" | "aspectRatio" | "insets" | "safeArea">): { width: number; height: number; offsetX: number; offsetY: number; insets: ShotCaptionSafeAreaInsets } {
  const insets = shotCaptionSafeAreaInsets(spatial);
  const horizontal = spatial.anchor.endsWith("-left") ? insets.left : spatial.anchor.endsWith("-right") ? -insets.right : (insets.left - insets.right) / 2;
  const vertical = spatial.anchor.startsWith("top-") ? insets.top : spatial.anchor.startsWith("bottom-") ? -insets.bottom : (insets.top - insets.bottom) / 2;
  return { width: roundedRatio(1 - insets.left - insets.right), height: roundedRatio(1 - insets.top - insets.bottom), offsetX: roundedRatio(horizontal), offsetY: roundedRatio(vertical), insets };
}

export function defaultShotCaptionContract(
  text: string,
  contentMode: ShotCaptionContentMode = "follow_tts",
  enabled = true,
): ShotCaptionContract {
  return {
    version: "shot-captions/v1",
    enabled,
    contentMode,
    text,
    cues: [],
    spatial: {
      version: "shot-caption-space/v2",
      anchor: "bottom-center",
      safeArea: "title-safe",
      aspectRatio: "9:16",
      insets: { ...presetInsets["9:16"]["title-safe"] },
      maxLines: 2,
      maxCharactersPerLine: 16,
    },
  };
}

export function normalizeShotCaptionContract(
  value: unknown,
  fallback: { enabled: boolean; text: string; audioMode?: "none" | "source" | "tts"; aspectRatio?: ShotCaptionCanvasAspectRatio },
): ShotCaptionContract {
  const defaultMode: ShotCaptionContentMode = fallback.audioMode === "tts" || fallback.audioMode === undefined ? "follow_tts" : "independent";
  const defaults = defaultShotCaptionContract(fallback.text, defaultMode, fallback.enabled);
  defaults.spatial.aspectRatio = fallback.aspectRatio ?? defaults.spatial.aspectRatio;
  defaults.spatial.insets = { ...presetInsets[defaults.spatial.aspectRatio!]["title-safe"] };
  if (!isRecord(value) || value.version !== "shot-captions/v1") return defaults;
  const spatial = isRecord(value.spatial) ? value.spatial : {};
  const storedContentMode = value.contentMode ?? value.content_mode;
  const contentMode = shotCaptionContentModes.includes(storedContentMode as ShotCaptionContentMode)
    ? storedContentMode as ShotCaptionContentMode
    : defaultMode;
  const cues = Array.isArray(value.cues) ? value.cues.filter(isRecord).flatMap((cue) => {
    const startMs = cue.startMs ?? cue.start_ms;
    const endMs = cue.endMs ?? cue.end_ms;
    if (typeof cue.id !== "string" || typeof cue.text !== "string" || typeof startMs !== "number" || typeof endMs !== "number" || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) return [];
    return [{ id: cue.id, text: cue.text, startMs, endMs }];
  }) : [];
  const safeArea = shotCaptionSafeAreas.includes((spatial.safeArea ?? spatial.safe_area) as ShotCaptionSafeArea) ? (spatial.safeArea ?? spatial.safe_area) as ShotCaptionSafeArea : defaults.spatial.safeArea;
  const storedAspectRatio = spatial.aspectRatio ?? spatial.aspect_ratio;
  const aspectRatio = fallback.aspectRatio ?? (shotCaptionCanvasAspectRatios.includes(storedAspectRatio as ShotCaptionCanvasAspectRatio) ? storedAspectRatio as ShotCaptionCanvasAspectRatio : defaults.spatial.aspectRatio!);
  const insets = safeArea === "custom" ? normalizeInsets(spatial.insets, presetInsets[aspectRatio]["title-safe"]) : { ...presetInsets[aspectRatio][safeArea] };
  return {
    version: "shot-captions/v1",
    enabled: typeof value.enabled === "boolean" ? value.enabled : fallback.enabled,
    contentMode,
    text: typeof value.text === "string" ? value.text : fallback.text,
    cues,
    spatial: {
      version: "shot-caption-space/v2",
      anchor: shotCaptionAnchors.includes(spatial.anchor as ShotCaptionAnchor) ? spatial.anchor as ShotCaptionAnchor : defaults.spatial.anchor,
      safeArea,
      aspectRatio,
      insets,
      maxLines: boundedInteger(spatial.maxLines ?? spatial.max_lines, 1, 2, defaults.spatial.maxLines),
      maxCharactersPerLine: boundedInteger(spatial.maxCharactersPerLine ?? spatial.max_characters_per_line, 1, 24, defaults.spatial.maxCharactersPerLine),
    },
  };
}

export function shotCaptionContractToDatabase(contract: ShotCaptionContract): Record<string, unknown> {
  return {
    version: contract.version,
    enabled: contract.enabled,
    content_mode: contract.contentMode,
    text: contract.text,
    cues: contract.cues.map((cue) => ({ id: cue.id, text: cue.text, start_ms: cue.startMs, end_ms: cue.endMs })),
    spatial: {
      version: "shot-caption-space/v2",
      anchor: contract.spatial.anchor,
      safe_area: contract.spatial.safeArea,
      aspect_ratio: contract.spatial.aspectRatio ?? "9:16",
      insets: shotCaptionSafeAreaInsets(contract.spatial),
      max_lines: contract.spatial.maxLines,
      max_characters_per_line: contract.spatial.maxCharactersPerLine,
    },
  };
}

export function isValidShotCaptionContract(value: unknown): value is ShotCaptionContract {
  if (!isRecord(value) || value.version !== "shot-captions/v1" || typeof value.enabled !== "boolean" || !shotCaptionContentModes.includes(value.contentMode as ShotCaptionContentMode) || typeof value.text !== "string" || !Array.isArray(value.cues) || !isRecord(value.spatial)) return false;
  const normalized = normalizeShotCaptionContract(value, { enabled: value.enabled, text: value.text });
  return JSON.stringify(normalized) === JSON.stringify(value) && (!value.enabled || value.text.trim().length > 0);
}

export function captionCuesForShot(captions: ShotCaptionContract, durationMs: number): ShotCaptionCue[] {
  if (!captions.enabled || !captions.text.trim() || !Number.isFinite(durationMs) || durationMs <= 0) return [];
  return captions.cues;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function normalizeInsets(value: unknown, fallback: ShotCaptionSafeAreaInsets): ShotCaptionSafeAreaInsets {
  if (!isRecord(value)) return { ...fallback };
  return {
    top: boundedRatio(value.top, fallback.top),
    right: boundedRatio(value.right, fallback.right),
    bottom: boundedRatio(value.bottom, fallback.bottom),
    left: boundedRatio(value.left, fallback.left),
  };
}

function boundedRatio(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 0.4 ? value : fallback;
}

function roundedRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
