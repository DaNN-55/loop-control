import { describe, expect, it, vi } from "vitest";
import { runAcousticAlignmentPriorityChain, type AcousticAlignmentCandidate } from "./acousticAlignment";

const native: AcousticAlignmentCandidate = { method: "tts_native", granularity: "character", provider: "fixture", model: "fixture-v1", reportedText: "主人确认字幕", cues: [{ id: "1", text: "主人", startMs: 80, endMs: 400 }, { id: "2", text: "确认字幕", startMs: 420, endMs: 1100 }] };
const external: AcousticAlignmentCandidate = { ...native, method: "external_text_audio", provider: "fixture-aligner" };
const base = { audioSha256: "a".repeat(64), confirmedText: "主人确认字幕", connectionVersionId: "connection-v1", model: "fixture-v1", provider: "fixture", speakingRate: 1.1, voice: "voice-a", now: () => new Date("2026-09-11T02:00:00.000Z") };

describe("声学对齐优先链", () => {
  it("同次 TTS 原生时间戳存在时优先采用，不调用外部打轴", async () => {
    const alignExistingTextAudio = vi.fn().mockResolvedValue(external);
    const result = await runAcousticAlignmentPriorityChain({ ...base, capabilities: { nativeTimestamps: { support: "supported", granularity: "character", detail: "fixture" }, existingTextAudioAlignment: { support: "supported", granularity: "word", detail: "fixture" } }, nativeCandidate: native, alignExistingTextAudio });
    expect(result).toMatchObject({ status: "completed", method: "tts_native", granularity: "character", wordCount: 2, audioSha256: "a".repeat(64), connectionVersionId: "connection-v1" });
    expect(alignExistingTextAudio).not.toHaveBeenCalled();
  });

  it("原生能力明确不支持时才尝试兼容的已有文本加音频打轴", async () => {
    const alignExistingTextAudio = vi.fn().mockResolvedValue(external);
    const result = await runAcousticAlignmentPriorityChain({ ...base, capabilities: { nativeTimestamps: { support: "unsupported", detail: "no native" }, existingTextAudioAlignment: { support: "supported", granularity: "word", detail: "fixture" } }, alignExistingTextAudio });
    expect(result.method).toBe("external_text_audio");
    expect(result.attempts[0]).toMatchObject({ method: "tts_native", status: "unsupported" });
    expect(alignExistingTextAudio).toHaveBeenCalledOnce();
  });

  it("拒绝用识别文本覆盖 Owner 字幕，并明确记录无可用回退", async () => {
    const result = await runAcousticAlignmentPriorityChain({ ...base, capabilities: { nativeTimestamps: { support: "supported", granularity: "word", detail: "fixture" }, existingTextAudioAlignment: { support: "unsupported", detail: "当前连接未注册打轴能力" } }, nativeCandidate: { ...native, reportedText: "识别出来的另一段文字" } });
    expect(result).toMatchObject({ status: "failed", method: "none", wordCount: 0, cues: [], detail: "当前 Worker 未配置本地 WhisperX runner。" });
    expect(result.attempts).toEqual(expect.arrayContaining([expect.objectContaining({ method: "tts_native", status: "failed" }), expect.objectContaining({ method: "external_text_audio", status: "unsupported" })]));
  });

  it.each([
    ["audio hash", { audioSha256: "d".repeat(64) }],
    ["subtitle body", { confirmedText: "另一版 Owner 字幕", nativeCandidate: { ...native, reportedText: "另一版 Owner 字幕", cues: [{ id: "1", text: "另一版 Owner 字幕", startMs: 0, endMs: 900 }] } }],
    ["voice", { voice: "voice-b" }],
    ["speaking rate", { speakingRate: 1.25 }],
  ])("%s changes the immutable alignment input version", async (_label, changed) => {
    const capabilities = { nativeTimestamps: { support: "supported" as const, granularity: "character" as const, detail: "fixture" }, existingTextAudioAlignment: { support: "unsupported" as const, detail: "fixture" } };
    const original = await runAcousticAlignmentPriorityChain({ ...base, capabilities, nativeCandidate: native });
    const next = await runAcousticAlignmentPriorityChain({ ...base, capabilities, nativeCandidate: native, ...changed });
    expect(next.inputVersion).not.toBe(original.inputVersion);
  });
});
