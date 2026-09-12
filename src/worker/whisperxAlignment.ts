import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { alignmentIdentity } from "./acousticAlignment.js";
import type { AcousticAlignmentCue, AcousticAlignmentResult, AcousticAlignmentReviewIssue } from "./acousticAlignmentContract.js";

export interface WhisperXToken {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface WhisperXExecution {
  model: string;
  tokens: WhisperXToken[];
}

export interface WhisperXAlignmentInput {
  audioPath: string;
  audioSha256: string;
  confirmedText: string;
  connectionVersionId?: string;
  model: string;
  sourceModel?: string;
  sourceProvider?: string;
  speakingRate: number;
  voice: string;
  cacheDirectory: string;
  lowConfidenceThreshold?: number;
  now?: () => Date;
  execute?: (input: { audioPath: string; cacheDirectory: string; confirmedText: string; model: string }) => Promise<WhisperXExecution>;
}

export async function runLocalWhisperXAlignment(input: WhisperXAlignmentInput): Promise<AcousticAlignmentResult> {
  await mkdir(input.cacheDirectory, { recursive: true });
  const execution = await (input.execute ?? executeWhisperX)({ audioPath: input.audioPath, cacheDirectory: input.cacheDirectory, confirmedText: input.confirmedText, model: input.model });
  const identity = alignmentIdentity({ audioSha256: input.audioSha256, confirmedText: input.confirmedText, connectionVersionId: input.connectionVersionId, model: input.sourceModel ?? input.model, provider: input.sourceProvider ?? "whisperx", speakingRate: input.speakingRate, voice: input.voice });
  const normalized = normalizeWhisperXTokens(input.confirmedText, execution.tokens, input.lowConfidenceThreshold ?? 0.72);
  const status = normalized.reviewIssues.length ? "needs_review" : "completed";
  return {
    version: "acoustic-alignment/v1",
    status,
    method: "local_whisperx",
    granularity: "phrase",
    ...identity,
    provider: "whisperx",
    model: execution.model,
    connectionVersionId: input.connectionVersionId ?? null,
    wordCount: normalized.cues.length,
    cues: normalized.cues,
    reviewIssues: normalized.reviewIssues,
    attempts: [{ method: "local_whisperx", status: "completed", detail: status === "completed" ? "本地 WhisperX 已生成短语 cues。" : "本地 WhisperX 已生成候选时序，存在需要 Owner 检查的区间。" }],
    detail: status === "completed" ? "本地 WhisperX 对齐已完成。" : `本地 WhisperX 返回 ${normalized.reviewIssues.length} 个待人工检查区间。`,
    generatedAt: (input.now?.() ?? new Date()).toISOString(),
  };
}

export function normalizeWhisperXTokens(confirmedText: string, tokens: WhisperXToken[], lowConfidenceThreshold = 0.72): { cues: AcousticAlignmentCue[]; reviewIssues: AcousticAlignmentReviewIssue[] } {
  const usableTokens = tokens.filter((token) => token.text.trim() && Number.isFinite(token.startMs) && Number.isFinite(token.endMs) && token.startMs >= 0 && token.endMs > token.startMs);
  const recognized = comparableText(usableTokens.map((token) => token.text).join(""));
  const expected = comparableText(confirmedText);
  if (!expected || recognized !== expected) {
    return { cues: [], reviewIssues: [{ id: "unmatched-1", kind: "unmatched_text", text: confirmedText, cueIds: [], detail: "WhisperX 识别 Token 无法完整映射 Owner 已确认字幕；正文未被替换。" }] };
  }

  const characters = usableTokens.flatMap((token) => {
    const text = comparableText(token.text);
    return [...text].map((character, index) => ({
      character,
      startMs: token.startMs + ((token.endMs - token.startMs) * index) / text.length,
      endMs: token.startMs + ((token.endMs - token.startMs) * (index + 1)) / text.length,
      confidence: token.confidence,
    }));
  });
  let offset = 0;
  const cues = phraseTexts(confirmedText).map((text, index) => {
    const length = [...comparableText(text)].length;
    const segment = characters.slice(offset, offset + length);
    offset += length;
    const confidences = segment.flatMap((item) => item.confidence === undefined ? [] : [item.confidence]);
    return {
      id: `phrase-${index + 1}`,
      text,
      startMs: Math.round(segment[0].startMs),
      endMs: Math.round(segment.at(-1)!.endMs),
      ...(confidences.length ? { confidence: confidences.reduce((sum, value) => sum + value, 0) / confidences.length } : {}),
    };
  });
  const reviewIssues = cues.flatMap((cue, index) => cue.confidence !== undefined && cue.confidence < lowConfidenceThreshold
    ? [{ id: `low-confidence-${index + 1}`, kind: "low_confidence" as const, text: cue.text, cueIds: [cue.id], detail: `平均置信度 ${cue.confidence.toFixed(2)}，低于 ${lowConfidenceThreshold.toFixed(2)}。` }]
    : []);
  return { cues, reviewIssues };
}

function phraseTexts(text: string): string[] {
  const phrases = text.match(/[^，。！？；：,.!?;:]+[，。！？；：,.!?;:]*/gu)?.map((value) => value.trim()).filter(Boolean) ?? [];
  return phrases.length ? phrases : [text.trim()];
}

function comparableText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\p{P}\p{Z}\s]/gu, "");
}

async function executeWhisperX(input: { audioPath: string; cacheDirectory: string; confirmedText: string; model: string }): Promise<WhisperXExecution> {
  const script = process.env.WHISPERX_RUNNER_PATH?.trim() || join(process.cwd(), "scripts", "whisperx-align.py");
  const python = process.env.WHISPERX_PYTHON?.trim() || "python3";
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(python, [script, "--audio", input.audioPath, "--cache-dir", input.cacheDirectory, "--model", input.model, "--confirmed-text-stdin"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `WhisperX runner 退出码 ${code ?? "unknown"}。`)));
    child.stdin.end(input.confirmedText, "utf8");
  });
  return parseWhisperXExecutionOutput(output, input.model);
}

export function parseWhisperXExecutionOutput(output: string, fallbackModel: string): WhisperXExecution {
  for (const line of output.trim().split(/\r?\n/).reverse()) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { continue; }
    if (!value || typeof value !== "object" || Array.isArray(value) || !("tokens" in value) || !Array.isArray(value.tokens)) continue;
    const model = "model" in value && typeof value.model === "string" ? value.model : fallbackModel;
    return { model, tokens: value.tokens.map(parseToken) };
  }
  throw new Error("WhisperX runner 输出格式无效。");
}

function parseToken(value: unknown): WhisperXToken {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("WhisperX Token 格式无效。");
  const token = value as Record<string, unknown>;
  if (typeof token.text !== "string" || typeof token.startMs !== "number" || typeof token.endMs !== "number" || (token.confidence !== undefined && typeof token.confidence !== "number")) throw new Error("WhisperX Token 格式无效。");
  return { text: token.text, startMs: token.startMs, endMs: token.endMs, ...(typeof token.confidence === "number" ? { confidence: token.confidence } : {}) };
}
