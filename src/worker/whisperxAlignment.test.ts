import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseWhisperXExecutionOutput, runLocalWhisperXAlignment } from "./whisperxAlignment";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

async function run(confirmedText: string, tokens: Array<{ text: string; startMs: number; endMs: number; confidence?: number }>) {
  const cacheDirectory = await mkdtemp(join(tmpdir(), "whisperx-cache-fixture-"));
  directories.push(cacheDirectory);
  return runLocalWhisperXAlignment({
    audioPath: "/fixtures/owner-confirmed-zh.wav",
    audioSha256: "a".repeat(64),
    cacheDirectory,
    confirmedText,
    execute: vi.fn().mockResolvedValue({ model: "fixture-whisperx", tokens }),
    model: "fixture-whisperx",
    now: () => new Date("2026-09-11T02:30:00.000Z"),
    speakingRate: 1,
    voice: "fixture-voice",
  });
}

describe("本地 WhisperX 对齐", () => {
  it("把 Owner 已确认正文交给本地 runner 做强制对齐", async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), "whisperx-cache-fixture-"));
    directories.push(cacheDirectory);
    const execute = vi.fn().mockResolvedValue({ model: "fixture-aligner", tokens: [{ text: "确认正文", startMs: 0, endMs: 600 }] });
    await runLocalWhisperXAlignment({
      audioPath: "/fixtures/owner-confirmed-zh.wav",
      audioSha256: "a".repeat(64),
      cacheDirectory,
      confirmedText: "确认正文",
      execute,
      model: "large-v3",
      speakingRate: 1,
      voice: "fixture-voice",
    });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ confirmedText: "确认正文" }));
  });

  it("忽略第三方 stdout 日志并读取最后一行 Worker JSON", () => {
    const output = '2026-09-11 - whisperx - INFO - loading model\n{"model":"large-v3","tokens":[{"text":"测试","startMs":0,"endMs":500}]}\n';
    expect(parseWhisperXExecutionOutput(output, "fallback")).toEqual({ model: "large-v3", tokens: [{ text: "测试", startMs: 0, endMs: 500 }] });
  });

  it("没有合法 Worker JSON 时拒绝日志输出", () => {
    expect(() => parseWhisperXExecutionOutput("whisperx INFO loading", "large-v3")).toThrow("WhisperX runner 输出格式无效");
  });

  it("把中文字符或 Token 规范化为保留 Owner 正文的短语 cues", async () => {
    const result = await run("今天下雨，记得带伞。", [
      { text: "今天", startMs: 0, endMs: 300, confidence: 0.98 },
      { text: "下雨", startMs: 320, endMs: 650, confidence: 0.97 },
      { text: "记得", startMs: 700, endMs: 980, confidence: 0.95 },
      { text: "带伞", startMs: 1000, endMs: 1320, confidence: 0.96 },
    ]);
    expect(result).toMatchObject({ status: "completed", method: "local_whisperx", granularity: "phrase", cues: [{ text: "今天下雨，", startMs: 0, endMs: 650 }, { text: "记得带伞。", startMs: 700, endMs: 1320 }], reviewIssues: [] });
  });

  it("忽略识别结果缺失的引号并兼容英文大小写", async () => {
    const result = await run("打开桌面的“测试销售表.xlsx”。", [
      { text: "打开桌面的测试销售表 XLSX", startMs: 0, endMs: 1800, confidence: 0.95 },
    ]);
    expect(result.status).toBe("completed");
    expect(result.cues.map((cue) => cue.text).join("")).toBe("打开桌面的“测试销售表.xlsx”。");
    expect(result.cues[0].startMs).toBe(0);
    expect(result.cues.at(-1)?.endMs).toBe(1800);
  });

  it("文本未匹配时进入人工检查且不采用识别正文", async () => {
    const result = await run("Owner 确认正文", [{ text: "模型识别错了", startMs: 0, endMs: 900, confidence: 0.91 }]);
    expect(result).toMatchObject({ status: "needs_review", method: "local_whisperx", cues: [], reviewIssues: [{ kind: "unmatched_text", text: "Owner 确认正文" }] });
    expect(JSON.stringify(result)).not.toContain("模型识别错了");
  });

  it("低置信度短语进入人工检查", async () => {
    const result = await run("需要检查", [{ text: "需要", startMs: 0, endMs: 300, confidence: 0.92 }, { text: "检查", startMs: 330, endMs: 700, confidence: 0.51 }]);
    expect(result).toMatchObject({ status: "needs_review", cues: [{ text: "需要检查" }], reviewIssues: [{ kind: "low_confidence", cueIds: ["phrase-1"] }] });
    expect(result.cues[0].confidence).toBeCloseTo(0.715);
  });

  it("长短语不因单个偏低字符被整体误判为低置信度", async () => {
    const result = await run("打开桌面的测试销售表文件", [
      { text: "打开桌面的测试销售表", startMs: 0, endMs: 1600, confidence: 0.94 },
      { text: "文件", startMs: 1600, endMs: 1900, confidence: 0.62 },
    ]);
    expect(result.status).toBe("completed");
    expect(result.reviewIssues).toEqual([]);
  });

  it("音频或确认正文变化会改变输入版本", async () => {
    const original = await run("固定正文", [{ text: "固定正文", startMs: 0, endMs: 600 }]);
    const changedText = await run("另一正文", [{ text: "另一正文", startMs: 0, endMs: 600 }]);
    expect(changedText.inputVersion).not.toBe(original.inputVersion);
  });
});
