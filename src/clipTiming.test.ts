import { describe, expect, it } from "vitest";
import { fitClipTimeRange, lockedClipTimeRangeChange, moveClipTimeRange, targetClipDuration } from "./clipTiming";

describe("clip timing controls", () => {
  it("moves a locked range without changing its duration and clamps at source bounds", () => {
    expect(moveClipTimeRange({ startSeconds: 1, endSeconds: 4.8 }, 2, 6)).toEqual({ startSeconds: 2.2, endSeconds: 6 });
    expect(lockedClipTimeRangeChange({ startSeconds: 1, endSeconds: 4.8 }, { startSeconds: 2, endSeconds: 4.8 }, 10)).toEqual({ startSeconds: 2, endSeconds: 5.8 });
  });

  it("fits the active range to the requested duration while preserving its position when possible", () => {
    expect(fitClipTimeRange({ startSeconds: 3, endSeconds: 4 }, 3.8, 8)).toEqual({ startSeconds: 3, endSeconds: 6.8 });
    expect(fitClipTimeRange({ startSeconds: 6, endSeconds: 7 }, 3.8, 8)).toEqual({ startSeconds: 4.2, endSeconds: 8 });
  });

  it("uses remaining sequential time for full screen and per-slot shot time for parallel layouts", () => {
    const ranges = [{ startSeconds: 0, endSeconds: 2 }, { startSeconds: 3, endSeconds: 4 }];
    expect(targetClipDuration(ranges, 1, "full", 3.8)).toBeCloseTo(1.8);
    expect(targetClipDuration(ranges, 1, "pip", 3.8)).toBe(3.8);
  });
});
