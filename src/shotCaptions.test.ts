import { describe, expect, it } from "vitest";
import { isValidShotCaptionContract, normalizeShotCaptionContract, shotCaptionContractToDatabase, shotCaptionSafeAreaGeometry } from "./shotCaptions";

describe("shot caption database boundary", () => {
  it("normalizes persisted snake-case contracts for the workbench", () => {
    const normalized = normalizeShotCaptionContract({
      version: "shot-captions/v1",
      enabled: true,
      content_mode: "independent",
      text: "字幕",
      cues: [{ id: "cue-1", text: "字幕", start_ms: 100, end_ms: 900 }],
      spatial: {
        version: "shot-caption-space/v1",
        anchor: "bottom-center",
        safe_area: "action-safe",
        max_lines: 2,
        max_characters_per_line: 16,
      },
    }, { enabled: true, text: "fallback" });

    expect(normalized).toMatchObject({
      contentMode: "independent",
      cues: [{ id: "cue-1", text: "字幕", startMs: 100, endMs: 900 }],
      spatial: { safeArea: "action-safe", maxLines: 2, maxCharactersPerLine: 16 },
    });
  });

  it("serializes the workbench contract to the database schema", () => {
    expect(shotCaptionContractToDatabase({
      version: "shot-captions/v1",
      enabled: true,
      contentMode: "follow_tts",
      text: "字幕",
      cues: [{ id: "cue-1", text: "字幕", startMs: 0, endMs: 800 }],
      spatial: {
        version: "shot-caption-space/v1",
        anchor: "bottom-center",
        safeArea: "title-safe",
        maxLines: 2,
        maxCharactersPerLine: 16,
      },
    })).toMatchObject({
      content_mode: "follow_tts",
      cues: [{ id: "cue-1", text: "字幕", start_ms: 0, end_ms: 800 }],
      spatial: { version: "shot-caption-space/v2", aspect_ratio: "9:16", safe_area: "title-safe", insets: { top: 0.08, right: 0.08, bottom: 0.18, left: 0.08 }, max_lines: 2, max_characters_per_line: 16 },
    });
  });

  it("uses orientation-aware presets and preserves custom four-edge margins", () => {
    const portrait = normalizeShotCaptionContract(undefined, { aspectRatio: "9:16", enabled: true, text: "字幕" });
    expect(portrait.spatial).toMatchObject({ aspectRatio: "9:16", insets: { top: 0.08, right: 0.08, bottom: 0.18, left: 0.08 } });
    const custom = normalizeShotCaptionContract({ ...portrait, spatial: { ...portrait.spatial, safeArea: "custom", insets: { top: 0.1, right: 0.08, bottom: 0.2, left: 0.12 } } }, { aspectRatio: "16:9", enabled: true, text: "字幕" });
    expect(custom.spatial).toMatchObject({ aspectRatio: "16:9", safeArea: "custom", insets: { top: 0.1, right: 0.08, bottom: 0.2, left: 0.12 } });
    const geometry = shotCaptionSafeAreaGeometry(custom.spatial);
    expect(geometry.width).toBeCloseTo(0.8);
    expect(geometry.height).toBeCloseTo(0.7);
    expect(geometry.offsetX).toBeCloseTo(0.02);
    expect(geometry.offsetY).toBeCloseTo(-0.2);
    expect(isValidShotCaptionContract(custom)).toBe(true);
  });
});
