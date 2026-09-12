import { describe, expect, it } from "vitest";
import { defaultShotComposition, shotCompositionTiming } from "./shotComposition";

describe("shot composition timing", () => {
  const segments = [
    { startSeconds: 0, endSeconds: 2 },
    { startSeconds: 3, endSeconds: 4.8 },
  ];

  it("adds every prepared segment for a full-screen sequential montage", () => {
    expect(shotCompositionTiming(segments, defaultShotComposition("full", 2))).toMatchObject({
      mode: "sequential",
      playbackDurationSeconds: 3.8,
      slotDurations: [{ slotId: "full", durationSeconds: 3.8 }],
    });
  });

  it("keeps split-screen slots parallel instead of doubling the shot duration", () => {
    const parallelSegments = [
      { startSeconds: 0, endSeconds: 3.8 },
      { startSeconds: 10, endSeconds: 13.8 },
    ];
    expect(shotCompositionTiming(parallelSegments, defaultShotComposition("2up-vertical", 2))).toMatchObject({
      mode: "parallel",
      playbackDurationSeconds: 3.8,
      slotDurations: [
        { slotId: "top", clipSegmentIndex: 0, durationSeconds: 3.8 },
        { slotId: "bottom", clipSegmentIndex: 1, durationSeconds: 3.8 },
      ],
    });
  });
});
