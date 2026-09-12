import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { ArtifactManifest, WorkerResult, WorkerTaskPackage } from "./contracts.js";
import { generateCloudflareWorkersAiImage, generateOpenAiImage, searchFreesoundPreview, searchPexelsVideo, synthesizeGoogleTts, synthesizeVolcengineTts, type FreesoundPreview, type MediaFetcher } from "./mediaProviders.js";
import type { WhisperXExecution } from "./whisperxAlignment.js";

export async function executeControlledMediaTask(input: {
  taskPackage: WorkerTaskPackage;
  fetcher: MediaFetcher;
  pexelsApiKey: string | undefined;
  googleTtsApiKey: string | undefined;
  volcengineTtsApiKey?: string;
  freesoundApiKey?: string;
  openaiApiKey?: string;
  cloudflareWorkersAiCredentials?: string;
  validateMp4: (path: string, minimumDurationSeconds: number) => Promise<void>;
  probeMp3: (path: string) => Promise<number>;
  extractMp3: (sourcePath: string, minimumDurationSeconds: number) => Promise<Uint8Array>;
  trimMp3: (bytes: Uint8Array, targetDurationSeconds: number) => Promise<Uint8Array>;
  trimMp4?: (sourcePath: string, startSeconds: number, endSeconds: number) => Promise<Uint8Array>;
  trimMp4Segments?: (sourcePath: string, segments: Array<{ startSeconds: number; endSeconds: number }>) => Promise<Uint8Array>;
  whisperXCacheDirectory?: string;
  executeWhisperX?: (input: { audioPath: string; cacheDirectory: string; model: string }) => Promise<WhisperXExecution>;
}): Promise<string> {
  const media = await mediaBytes(input);
  const audioDurationSeconds = await validateTemporaryMedia(input, media.bytes);
  const artifact = await writePrimaryArtifact(input.taskPackage, media.bytes);
  const result: WorkerResult = {
    version: "worker-result/v1",
    taskId: input.taskPackage.task.id,
    status: "completed",
    artifacts: [artifact],
    validation: {
      passed: true,
      checks: [{ name: "controlled_media_output", passed: true, detail: `已按冻结 ${input.taskPackage.provider} 适配器生成并校验主产物。` }],
    },
    actualCostCents: 0,
    ...(audioDurationSeconds ? { audioDurationSeconds } : {}),
    ...(media.source ? { mediaSource: freesoundSource(media.source) } : {}),
    blockers: [],
    retry: { shouldRetry: false, reason: "Completed successfully." },
    nextStep: "Await the next controlled production step.",
  };
  return JSON.stringify(result);
}

async function mediaBytes(input: {
  taskPackage: WorkerTaskPackage;
  fetcher: MediaFetcher;
  pexelsApiKey: string | undefined;
  googleTtsApiKey: string | undefined;
  volcengineTtsApiKey?: string;
  freesoundApiKey?: string;
  openaiApiKey?: string;
  cloudflareWorkersAiCredentials?: string;
  validateMp4: (path: string, minimumDurationSeconds: number) => Promise<void>;
  probeMp3: (path: string) => Promise<number>;
  extractMp3: (sourcePath: string, minimumDurationSeconds: number) => Promise<Uint8Array>;
  trimMp3: (bytes: Uint8Array, targetDurationSeconds: number) => Promise<Uint8Array>;
  trimMp4?: (sourcePath: string, startSeconds: number, endSeconds: number) => Promise<Uint8Array>;
  trimMp4Segments?: (sourcePath: string, segments: Array<{ startSeconds: number; endSeconds: number }>) => Promise<Uint8Array>;
}): Promise<{ bytes: Uint8Array; source?: FreesoundPreview }> {
  const { taskPackage } = input;
  if (taskPackage.provider === "google_tts" && taskPackage.media?.adapter === "google_tts") {
    if (!input.googleTtsApiKey) throw new Error("GOOGLE_TTS_API_KEY 未配置，无法执行冻结旁白任务。");
    return { bytes: await synthesizeGoogleTts({
      apiKey: input.googleTtsApiKey,
      fetcher: input.fetcher,
      text: taskPackage.media.narration.text,
      voice: taskPackage.media.narration.voice,
    }) };
  }
  if (taskPackage.provider === "volcengine_tts" && taskPackage.media?.adapter === "volcengine_tts") {
    if (!input.volcengineTtsApiKey) throw new Error("豆包语音连接秘密不可用，无法执行冻结旁白任务。");
    return { bytes: await synthesizeVolcengineTts({ apiKey: input.volcengineTtsApiKey, fetcher: input.fetcher, model: taskPackage.model, text: taskPackage.media.narration.text, voice: taskPackage.media.narration.voice }) };
  }
  if (taskPackage.provider === "pexels" && taskPackage.media?.adapter === "pexels_video") {
    if (!input.pexelsApiKey) throw new Error("Pexels 连接秘密不可用，无法执行冻结 B-roll 任务。");
    const selected = await searchPexelsVideo({
      apiKey: input.pexelsApiKey,
      fetcher: input.fetcher,
      query: taskPackage.media.bRoll.query,
      targetDurationSeconds: taskPackage.media.bRoll.targetDurationSeconds,
    });
    const response = await input.fetcher(selected.downloadUrl);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok) throw new Error(`Pexels 视频下载失败：HTTP ${response.status}。`);
    if (!contentType.startsWith("video/mp4")) throw new Error("Pexels 下载响应不是 MP4 视频。");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error("Pexels 下载的视频为空。");
    return { bytes };
  }
  if (taskPackage.provider === "ffmpeg" && taskPackage.media?.adapter === "ffmpeg_extract_audio") {
    const sourcePath = resolve(taskPackage.assets.allowedRoot, taskPackage.media.embeddedAudio.sourceRelativePath);
    const fromRoot = relative(resolve(taskPackage.assets.allowedRoot), sourcePath);
    if (isAbsolute(fromRoot) || fromRoot.startsWith("..")) throw new Error("冻结视频输入路径超出资产根目录。");
    return { bytes: await input.extractMp3(sourcePath, taskPackage.media.embeddedAudio.durationSeconds) };
  }
  if (taskPackage.provider === "ffmpeg" && taskPackage.media?.adapter === "ffmpeg_trim_video") {
    const clip = taskPackage.media.videoClips ?? taskPackage.media.videoClip;
    if (!clip) throw new Error("冻结视频裁剪输入缺失。");
    const sourcePath = resolve(taskPackage.assets.allowedRoot, clip.sourceRelativePath);
    const fromRoot = relative(resolve(taskPackage.assets.allowedRoot), sourcePath);
    if (isAbsolute(fromRoot) || fromRoot.startsWith("..")) throw new Error("冻结视频输入路径超出资产根目录。");
    if (taskPackage.media.videoClips) {
      if (!input.trimMp4Segments) throw new Error("Worker 未配置多片段裁剪执行器。");
      return { bytes: await input.trimMp4Segments(sourcePath, taskPackage.media.videoClips.segments) };
    }
    if (!input.trimMp4) throw new Error("Worker 未配置视频裁剪执行器。");
    return { bytes: await input.trimMp4(sourcePath, taskPackage.media.videoClip!.startSeconds, taskPackage.media.videoClip!.endSeconds) };
  }
  if (taskPackage.provider === "freesound" && taskPackage.media?.adapter === "freesound_preview") {
    if (!input.freesoundApiKey) throw new Error("FREESOUND_API_KEY 未配置，无法执行冻结声轨任务。");
    const selected = await searchFreesoundPreview({
      apiKey: input.freesoundApiKey,
      fetcher: input.fetcher,
      query: taskPackage.media.soundtrack.query,
      targetDurationSeconds: taskPackage.media.soundtrack.targetDurationSeconds,
    });
    const response = await input.fetcher(selected.previewUrl);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok) throw new Error(`Freesound 预览下载失败：HTTP ${response.status}。`);
    if (!contentType.startsWith("audio/mpeg")) throw new Error("Freesound 下载响应不是 MP3 音频。");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error("Freesound 下载的音频为空。");
    return { bytes: await input.trimMp3(bytes, taskPackage.media.soundtrack.targetDurationSeconds), source: selected };
  }
  if (taskPackage.provider === "openai" && taskPackage.media?.adapter === "openai_images") {
    if (!input.openaiApiKey) throw new Error("OPENAI_API_KEY 未配置，无法执行冻结静态视觉任务。");
    return { bytes: await generateOpenAiImage({ apiKey: input.openaiApiKey, fetcher: input.fetcher, model: taskPackage.model, prompt: taskPackage.media.staticVisual.prompt }) };
  }
  if (taskPackage.provider === "cloudflare" && taskPackage.media?.adapter === "workers_ai_images") {
    if (!input.cloudflareWorkersAiCredentials) throw new Error("Cloudflare Workers AI 连接秘密不可用，无法执行冻结静态视觉任务。");
    return { bytes: await generateCloudflareWorkersAiImage({ credentials: input.cloudflareWorkersAiCredentials, fetcher: input.fetcher, model: taskPackage.model, prompt: taskPackage.media.staticVisual.prompt }) };
  }
  throw new Error("任务 Provider 与冻结媒体适配器不匹配。");
}

function freesoundSource(source: FreesoundPreview): NonNullable<WorkerResult["mediaSource"]> {
  return { provider: "freesound", sourceId: source.id, title: source.title, creator: source.creator, license: source.license, sourceUrl: source.sourceUrl, previewUrl: source.previewUrl };
}

async function writePrimaryArtifact(taskPackage: WorkerTaskPackage, bytes: Uint8Array): Promise<ArtifactManifest> {
  await writeSafeAssetFile(taskPackage.assets.allowedRoot, taskPackage.output.relativePath, bytes);
  return {
    artifactType: taskPackage.output.requiredArtifactTypes[0],
    relativePath: taskPackage.output.relativePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    fileSize: bytes.byteLength,
  };
}

export async function writeSafeAssetFile(allowedRoot: string, relativePath: string, bytes: Uint8Array | string): Promise<string> {
  const destination = await safeAssetOutputPath(allowedRoot, relativePath);
  const handle = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
  return destination;
}

async function validateTemporaryMedia(input: Parameters<typeof executeControlledMediaTask>[0], bytes: Uint8Array): Promise<number | undefined> {
  const directory = await mkdtemp(join(tmpdir(), "loop-control-media-"));
  const path = join(directory, input.taskPackage.output.relativePath.split("/").at(-1) ?? "output");
  try {
    await writeFile(path, bytes);
    if (input.taskPackage.provider === "pexels" && input.taskPackage.media?.adapter === "pexels_video") {
      await input.validateMp4(path, input.taskPackage.media.bRoll.targetDurationSeconds);
      return undefined;
    }
    if (input.taskPackage.provider === "ffmpeg" && input.taskPackage.media?.adapter === "ffmpeg_trim_video") {
      await input.validateMp4(path, (input.taskPackage.media.videoClips ?? input.taskPackage.media.videoClip)!.targetDurationSeconds);
      return undefined;
    }
    if (input.taskPackage.provider === "google_tts" || input.taskPackage.provider === "volcengine_tts" || input.taskPackage.provider === "ffmpeg" || input.taskPackage.provider === "freesound") return await input.probeMp3(path);
    return undefined;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function safeAssetOutputPath(allowedRoot: string, relativePath: string): Promise<string> {
  const assetRoot = await realpath(resolve(allowedRoot));
  const destination = resolve(assetRoot, relativePath);
  const fromRoot = relative(assetRoot, destination);
  if (isAbsolute(fromRoot) || fromRoot.startsWith("..")) throw new Error("冻结媒体输出路径越出资产根目录。");
  let directory = assetRoot;
  for (const segment of dirname(relativePath).split(/[\\/]/)) {
    if (!segment || segment === ".") continue;
    directory = join(directory, segment);
    try {
      const details = await lstat(directory);
      if (details.isSymbolicLink() || !details.isDirectory()) throw new Error("冻结媒体输出目录不能是符号链接或非目录。");
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      await mkdir(directory);
      const details = await lstat(directory);
      if (details.isSymbolicLink() || !details.isDirectory()) throw new Error("冻结媒体输出目录不能是符号链接或非目录。");
    }
  }
  try {
    if ((await lstat(destination)).isSymbolicLink()) throw new Error("冻结媒体输出文件不能是符号链接。");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  return destination;
}
