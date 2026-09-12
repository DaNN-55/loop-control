export const shotCompositionLayouts = ["full", "2up-horizontal", "2up-vertical", "pip", "grid-4"] as const;
export const shotTransitionModes = ["cut", "fade", "studio"] as const;

export type ShotCompositionLayout = typeof shotCompositionLayouts[number];
export type ShotCompositionFit = "cover" | "contain";
export type ShotTransitionMode = typeof shotTransitionModes[number];

export interface ShotCompositionSlot {
  id: string;
  clipSegmentIndex: number;
  fit: ShotCompositionFit;
  focalPoint: { x: number; y: number };
}

export interface ShotComposition {
  version: "shot-composition/v1";
  layout: ShotCompositionLayout;
  slots: ShotCompositionSlot[];
}

export interface ShotCompositionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShotCompositionTiming {
  mode: "sequential" | "parallel";
  playbackDurationSeconds: number;
  slotDurations: Array<{ slotId: string; clipSegmentIndex?: number; durationSeconds: number }>;
}

export const shotCompositionLayoutLabels: Record<ShotCompositionLayout, string> = {
  full: "全屏",
  "2up-horizontal": "左右双屏",
  "2up-vertical": "上下双屏",
  pip: "画中画",
  "grid-4": "四宫格",
};

export const shotTransitionModeLabels: Record<ShotTransitionMode, string> = {
  cut: "硬切",
  fade: "基础淡化",
  studio: "交给 Studio",
};

export const shotCompositionSlotLabels: Record<string, string> = {
  full: "主画面",
  left: "左侧",
  right: "右侧",
  top: "上方",
  bottom: "下方",
  main: "背景",
  inset: "小窗",
  "top-left": "左上",
  "top-right": "右上",
  "bottom-left": "左下",
  "bottom-right": "右下",
};

const layoutSlotIds: Record<ShotCompositionLayout, readonly string[]> = {
  full: ["full"],
  "2up-horizontal": ["left", "right"],
  "2up-vertical": ["top", "bottom"],
  pip: ["main", "inset"],
  "grid-4": ["top-left", "top-right", "bottom-left", "bottom-right"],
};

const layoutRects: Record<ShotCompositionLayout, Record<string, ShotCompositionRect>> = {
  full: { full: { x: 0, y: 0, width: 1, height: 1 } },
  "2up-horizontal": {
    left: { x: 0, y: 0, width: 0.5, height: 1 },
    right: { x: 0.5, y: 0, width: 0.5, height: 1 },
  },
  "2up-vertical": {
    top: { x: 0, y: 0, width: 1, height: 0.5 },
    bottom: { x: 0, y: 0.5, width: 1, height: 0.5 },
  },
  pip: {
    main: { x: 0, y: 0, width: 1, height: 1 },
    inset: { x: 0.64, y: 0.64, width: 0.32, height: 0.32 },
  },
  "grid-4": {
    "top-left": { x: 0, y: 0, width: 0.5, height: 0.5 },
    "top-right": { x: 0.5, y: 0, width: 0.5, height: 0.5 },
    "bottom-left": { x: 0, y: 0.5, width: 0.5, height: 0.5 },
    "bottom-right": { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
  },
};

export function shotCompositionSlotIds(layout: ShotCompositionLayout): readonly string[] {
  return layoutSlotIds[layout];
}

export function shotCompositionRect(layout: ShotCompositionLayout, slotId: string): ShotCompositionRect {
  const rect = layoutRects[layout][slotId];
  if (!rect) throw new Error(`未知构图槽位：${layout}/${slotId}`);
  return rect;
}

export function defaultShotComposition(layout: ShotCompositionLayout = "full", clipSegmentCount = 1): ShotComposition {
  const maximumIndex = Math.max(0, clipSegmentCount - 1);
  return {
    version: "shot-composition/v1",
    layout,
    slots: layoutSlotIds[layout].map((id, index) => ({
      id,
      clipSegmentIndex: Math.min(index, maximumIndex),
      fit: "cover",
      focalPoint: { x: 0.5, y: 0.5 },
    })),
  };
}

export function normalizeShotComposition(value: unknown, clipSegmentCount = 1): ShotComposition {
  if (!isRecord(value) || value.version !== "shot-composition/v1" || !shotCompositionLayouts.includes(value.layout as ShotCompositionLayout) || !Array.isArray(value.slots)) {
    return defaultShotComposition("full", clipSegmentCount);
  }
  const layout = value.layout as ShotCompositionLayout;
  const savedSlots = new Map(value.slots.filter(isRecord).map((slot) => [slot.id, slot]));
  const maximumIndex = Math.max(0, clipSegmentCount - 1);
  return {
    version: "shot-composition/v1",
    layout,
    slots: layoutSlotIds[layout].map((id, index) => {
      const saved = savedSlots.get(id);
      const clipSegmentIndex = saved && Number.isInteger(saved.clipSegmentIndex) && Number(saved.clipSegmentIndex) >= 0
        ? Math.min(Number(saved.clipSegmentIndex), maximumIndex)
        : Math.min(index, maximumIndex);
      const focalPoint = isRecord(saved?.focalPoint) ? saved.focalPoint : {};
      return {
        id,
        clipSegmentIndex,
        fit: saved?.fit === "contain" ? "contain" : "cover",
        focalPoint: { x: unit(focalPoint.x), y: unit(focalPoint.y) },
      };
    }),
  };
}

export function shotCompositionTiming(
  segments: readonly { startSeconds: number; endSeconds: number }[],
  value: unknown,
): ShotCompositionTiming {
  const composition = normalizeShotComposition(value, Math.max(1, segments.length));
  const durationAt = (index: number) => {
    const segment = segments[index];
    return segment && Number.isFinite(segment.startSeconds) && Number.isFinite(segment.endSeconds)
      ? Math.round(Math.max(0, segment.endSeconds - segment.startSeconds) * 1_000_000) / 1_000_000
      : 0;
  };
  if (composition.layout === "full") {
    const durationSeconds = segments.reduce((total, _segment, index) => total + durationAt(index), 0);
    return { mode: "sequential", playbackDurationSeconds: durationSeconds, slotDurations: [{ slotId: "full", durationSeconds }] };
  }
  const slotDurations = composition.slots.map((slot) => ({
    slotId: slot.id,
    clipSegmentIndex: slot.clipSegmentIndex,
    durationSeconds: durationAt(slot.clipSegmentIndex),
  }));
  return {
    mode: "parallel",
    playbackDurationSeconds: slotDurations.length ? Math.min(...slotDurations.map((slot) => slot.durationSeconds)) : 0,
    slotDurations,
  };
}

export function isValidShotComposition(value: unknown, clipSegmentCount: number): value is ShotComposition {
  if (!isRecord(value) || value.version !== "shot-composition/v1" || !shotCompositionLayouts.includes(value.layout as ShotCompositionLayout) || !Array.isArray(value.slots)) return false;
  const expected = layoutSlotIds[value.layout as ShotCompositionLayout];
  if (value.slots.length !== expected.length) return false;
  return value.slots.every((candidate, index) => isRecord(candidate)
    && candidate.id === expected[index]
    && Number.isInteger(candidate.clipSegmentIndex)
    && Number(candidate.clipSegmentIndex) >= 0
    && Number(candidate.clipSegmentIndex) < clipSegmentCount
    && (candidate.fit === "cover" || candidate.fit === "contain")
    && isRecord(candidate.focalPoint)
    && isUnit(candidate.focalPoint.x)
    && isUnit(candidate.focalPoint.y));
}

function unit(value: unknown): number {
  return isUnit(value) ? value : 0.5;
}

function isUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
