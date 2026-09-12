export interface ClipTimeRange {
  endSeconds: number;
  startSeconds: number;
}

const minimumDurationSeconds = 0.001;

export function moveClipTimeRange(range: ClipTimeRange, deltaSeconds: number, sourceDurationSeconds: number): ClipTimeRange {
  const duration = Math.min(sourceDurationSeconds, Math.max(minimumDurationSeconds, range.endSeconds - range.startSeconds));
  const startSeconds = clamp(range.startSeconds + deltaSeconds, 0, Math.max(0, sourceDurationSeconds - duration));
  return roundedRange(startSeconds, startSeconds + duration);
}

export function fitClipTimeRange(range: ClipTimeRange, targetDurationSeconds: number, sourceDurationSeconds: number): ClipTimeRange {
  const duration = Math.min(sourceDurationSeconds, Math.max(minimumDurationSeconds, targetDurationSeconds));
  const startSeconds = Math.min(range.startSeconds, Math.max(0, sourceDurationSeconds - duration));
  return roundedRange(startSeconds, startSeconds + duration);
}

export function lockedClipTimeRangeChange(range: ClipTimeRange, proposed: ClipTimeRange, sourceDurationSeconds: number): ClipTimeRange {
  const startDelta = proposed.startSeconds - range.startSeconds;
  const endDelta = proposed.endSeconds - range.endSeconds;
  const deltaSeconds = Math.abs(startDelta) >= Math.abs(endDelta) ? startDelta : endDelta;
  return moveClipTimeRange(range, deltaSeconds, sourceDurationSeconds);
}

export function targetClipDuration(ranges: readonly ClipTimeRange[], activeIndex: number, layout: "full" | string, shotDurationSeconds: number): number {
  if (layout !== "full") return shotDurationSeconds;
  const otherDuration = ranges.reduce((total, range, index) => index === activeIndex ? total : total + Math.max(0, range.endSeconds - range.startSeconds), 0);
  return Math.max(minimumDurationSeconds, shotDurationSeconds - otherDuration);
}

function roundedRange(startSeconds: number, endSeconds: number): ClipTimeRange {
  return { startSeconds: Math.round(startSeconds * 1_000_000) / 1_000_000, endSeconds: Math.round(endSeconds * 1_000_000) / 1_000_000 };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
