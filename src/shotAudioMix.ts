export const bgmDuckingLevels = ["off", "light", "medium", "strong"] as const;

export type BgmDuckingLevel = typeof bgmDuckingLevels[number];

export interface ShotAudioMixContract {
  version: "shot-audio-mix/v1";
  mainVoice: {
    mode: "none" | "source" | "tts";
    trackId: string | null;
    gainDb: number;
    role: "anchor" | "none";
  };
  bgm: null | {
    selectionId: string;
    cueId: string | null;
    materialRevisionId: string | null;
    gainDb: number;
    role: "follower";
    duckingLevel: BgmDuckingLevel;
    duckDepthDb: number;
  };
  sfx: null | {
    selectionId: string;
    cueId: string | null;
    materialRevisionId: string | null;
    gainDb: number;
    role: "independent";
    automaticDucking: false;
  };
}

export const bgmDuckingLabels: Record<BgmDuckingLevel, string> = {
  off: "关闭",
  light: "轻",
  medium: "中",
  strong: "强",
};

export const bgmDuckingDepthDb: Record<BgmDuckingLevel, number> = {
  off: 0,
  light: -6,
  medium: -10,
  strong: -14,
};

export function normalizeShotAudioMix(
  value: unknown,
  fallback: { audioMode: "none" | "source" | "tts"; audioTrackId?: string | null },
): ShotAudioMixContract {
  const record = isRecord(value) ? value : {};
  const mainVoice = isRecord(record.mainVoice) ? record.mainVoice : {};
  const mode = mainVoice.mode === "none" || mainVoice.mode === "source" || mainVoice.mode === "tts" ? mainVoice.mode : fallback.audioMode;
  return {
    version: "shot-audio-mix/v1",
    mainVoice: {
      mode,
      trackId: typeof mainVoice.trackId === "string" ? mainVoice.trackId : fallback.audioTrackId ?? null,
      gainDb: finite(mainVoice.gainDb, 0),
      role: mode === "none" ? "none" : "anchor",
    },
    bgm: normalizeBgm(record.bgm, mode),
    sfx: normalizeSfx(record.sfx),
  };
}

export function isValidShotAudioMix(value: unknown): value is ShotAudioMixContract {
  if (!isRecord(value) || value.version !== "shot-audio-mix/v1" || !isRecord(value.mainVoice)) return false;
  const mode = value.mainVoice.mode;
  if (mode !== "none" && mode !== "source" && mode !== "tts") return false;
  return canonicalJson(normalizeShotAudioMix(value, { audioMode: mode })) === canonicalJson(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function normalizeBgm(value: unknown, mode: "none" | "source" | "tts"): ShotAudioMixContract["bgm"] {
  if (!isRecord(value) || typeof value.selectionId !== "string" || !value.selectionId) return null;
  const requested = bgmDuckingLevels.includes(value.duckingLevel as BgmDuckingLevel) ? value.duckingLevel as BgmDuckingLevel : "off";
  const duckingLevel = mode === "none" ? "off" : requested;
  return {
    selectionId: value.selectionId,
    cueId: nullableString(value.cueId),
    materialRevisionId: nullableString(value.materialRevisionId),
    gainDb: finite(value.gainDb, -12),
    role: "follower",
    duckingLevel,
    duckDepthDb: bgmDuckingDepthDb[duckingLevel],
  };
}

function normalizeSfx(value: unknown): ShotAudioMixContract["sfx"] {
  if (!isRecord(value) || typeof value.selectionId !== "string" || !value.selectionId) return null;
  return {
    selectionId: value.selectionId,
    cueId: nullableString(value.cueId),
    materialRevisionId: nullableString(value.materialRevisionId),
    gainDb: finite(value.gainDb, -6),
    role: "independent",
    automaticDucking: false,
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
