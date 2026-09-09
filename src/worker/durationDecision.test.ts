import { describe, expect, it } from "vitest";
import { reviewRenderDurationSettingsFromRules } from "../reviews/reviewRevision";
import { createShotDurationDecision, durationToleranceSeconds, isShotDurationDecision, shotDurationDecisionFromJson, videoDurationMeetsMinimum } from "./durationDecision";

describe("shot duration decision", () => {
  it("uses the frozen frame rate and allowed frames for encoded video tail deltas", () => {
    expect(videoDurationMeetsMinimum(9.96, 10, 24, 1)).toBe(true);
    expect(videoDurationMeetsMinimum(9.95, 10, 24, 1)).toBe(false);
    expect(videoDurationMeetsMinimum(9.999, 10, 30, 0)).toBe(false);
    expect(videoDurationMeetsMinimum(10, 10, 30, 0)).toBe(true);
  });

  it("keeps synced audio separate from plan drift", () => {
    const decision = createShotDurationDecision({ audioMode: "tts", actualAudioDurationSeconds: 5.8, clipDurationSeconds: 5.8, plannedDurationSeconds: 5 });
    expect(decision.audioVideoDeltaSeconds).toBe(0);
    expect(decision.planDeltaSeconds).toBeCloseTo(0.8);
    expect(decision.status).toBe("synchronized");
    expect(decision.frameToleranceSeconds).toBe(2 / 30);
  });

  it("flags audio longer than the current clip", () => {
    const decision = createShotDurationDecision({ audioMode: "tts", actualAudioDurationSeconds: 5.8, clipDurationSeconds: 5, plannedDurationSeconds: 5 });
    expect(decision.status).toBe("needs_attention");
    expect(decision.audioVideoDeltaSeconds).toBeCloseTo(0.8);
    expect(decision.studioAdoptedDurationSeconds).toBe(5);
    expect(decision.planDeltaSeconds).toBe(0);
  });

  it("accepts exactly the allowed frame boundary and rejects the next frame", () => {
    expect(createShotDurationDecision({ audioMode: "tts", actualAudioDurationSeconds: 5 + 2 / 30, clipDurationSeconds: 5, plannedDurationSeconds: 5 }).status).toBe("synchronized");
    expect(createShotDurationDecision({ audioMode: "tts", actualAudioDurationSeconds: 5 + 2 / 30 + 0.0001, clipDurationSeconds: 5, plannedDurationSeconds: 5 }).status).toBe("needs_attention");
  });

  it("converts frame rate and allowed frames to seconds", () => {
    expect(durationToleranceSeconds(24, 2)).toBeCloseTo(1 / 12);
  });

  it("uses the frozen series composition duration settings", () => {
    const settings = reviewRenderDurationSettingsFromRules({ openchatcut_composition: { frame_rate: 24, allowed_frames: 1 } });
    const decision = createShotDurationDecision({ audioMode: "tts", actualAudioDurationSeconds: 5 + 1 / 24, clipDurationSeconds: 5, plannedDurationSeconds: 5, ...settings });
    expect(settings).toEqual({ frameRate: 24, allowedFrames: 1 });
    expect(decision.frameToleranceSeconds).toBeCloseTo(1 / 24);
    expect(decision.status).toBe("synchronized");
  });

  it.each([
    ["none", 5, "not_applicable"],
    ["source", 5, "synchronized"],
    ["tts", 5, "synchronized"],
  ] as const)("handles %s audio semantics", (audioMode, actualAudioDurationSeconds, status) => {
    expect(createShotDurationDecision({ audioMode, actualAudioDurationSeconds, clipDurationSeconds: 5, plannedDurationSeconds: 5 }).status).toBe(status);
    expect(createShotDurationDecision({ audioMode, actualAudioDurationSeconds, clipDurationSeconds: 5, plannedDurationSeconds: 5 }).audioVideoDeltaSeconds).toBe(audioMode === "none" ? null : 0);
  });

  it("keeps a pending decision when a required duration is unavailable", () => {
    expect(createShotDurationDecision({ audioMode: "tts", actualAudioDurationSeconds: null, clipDurationSeconds: 5, plannedDurationSeconds: 5 }).status).toBe("pending");
  });

  it("reads the same snake-case snapshot contract used by Supabase", () => {
    const decision = createShotDurationDecision({ audioMode: "tts", actualAudioDurationSeconds: 5.8, clipDurationSeconds: 5, plannedDurationSeconds: 5 });
    expect(shotDurationDecisionFromJson({
      version: decision.version,
      audio_mode: decision.audioMode,
      planned_duration_seconds: decision.plannedDurationSeconds,
      clip_duration_seconds: decision.clipDurationSeconds,
      actual_audio_duration_seconds: decision.actualAudioDurationSeconds,
      studio_adopted_duration_seconds: decision.studioAdoptedDurationSeconds,
      audio_video_delta_seconds: decision.audioVideoDeltaSeconds,
      plan_delta_seconds: decision.planDeltaSeconds,
      frame_rate: decision.frameRate,
      allowed_frames: decision.allowedFrames,
      frame_tolerance_seconds: decision.frameToleranceSeconds,
      status: decision.status,
    })).toEqual(decision);
  });

  it("normalizes missing nullable none-mode durations to null", () => {
    const base = {
      version: "shot-duration/v1",
      audio_mode: "none",
      planned_duration_seconds: 5,
      clip_duration_seconds: 5,
      studio_adopted_duration_seconds: 5,
      plan_delta_seconds: 0,
      frame_rate: 30,
      allowed_frames: 2,
      frame_tolerance_seconds: 2 / 30,
      status: "not_applicable",
    };
    expect(shotDurationDecisionFromJson(base)).toMatchObject({ actualAudioDurationSeconds: null, audioVideoDeltaSeconds: null });
    expect(shotDurationDecisionFromJson({ ...base, actual_audio_duration_seconds: null, audio_video_delta_seconds: null })).toMatchObject({ actualAudioDurationSeconds: null, audioVideoDeltaSeconds: null });
  });

  it("rejects self-contradictory deltas and statuses", () => {
    const decision = createShotDurationDecision({ audioMode: "tts", actualAudioDurationSeconds: 5.8, clipDurationSeconds: 5, plannedDurationSeconds: 5 });
    expect(isShotDurationDecision({ ...decision, audioVideoDeltaSeconds: 0 })).toBe(false);
    expect(isShotDurationDecision({ ...decision, planDeltaSeconds: 0.8 })).toBe(false);
    expect(isShotDurationDecision({ ...decision, status: "synchronized" })).toBe(false);
    expect(isShotDurationDecision({ ...decision, frameToleranceSeconds: 1 })).toBe(false);
  });
});
