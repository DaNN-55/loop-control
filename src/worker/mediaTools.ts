// Shared existing media algorithms; transports supply only execution and credentials.
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {durationToleranceSeconds,videoDurationMeetsMinimum} from './durationDecision.js';
async function runCommandWithOutput(command:string,args:string[]){return promisify(execFile)(command,args,{timeout:300000,maxBuffer:4*1024*1024});}
async function runCommand(command:string,args:string[]){await runCommandWithOutput(command,args);}
export async function extractMp3Artifact(sourcePath: string, minimumDurationSeconds: number): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), "loop-control-audio-"));
  const outputPath = join(directory, "derived.mp3");
  try {
    await runCommand("ffmpeg", ["-nostdin", "-v", "error", "-i", sourcePath, "-vn", "-codec:a", "libmp3lame", "-q:a", "2", outputPath]);
    const { stdout } = await runCommandWithOutput("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", outputPath]);
    const duration = Number(stdout.trim());
    if (!Number.isFinite(duration) || duration < minimumDurationSeconds) throw new Error(`派生音频不可播放或时长不足：${duration || "未知"} 秒。`);
    return new Uint8Array(await readFile(outputPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function trimMp3Artifact(bytes: Uint8Array, targetDurationSeconds: number): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), "loop-control-soundtrack-"));
  const inputPath = join(directory, "source.mp3");
  const outputPath = join(directory, "trimmed.mp3");
  try {
    await writeFile(inputPath, bytes);
    await runCommand("ffmpeg", ["-nostdin", "-v", "error", "-i", inputPath, "-t", String(targetDurationSeconds), "-codec:a", "libmp3lame", "-q:a", "2", outputPath]);
    const duration = await probeMp3Artifact(outputPath);
    if (duration + durationToleranceSeconds() < targetDurationSeconds) throw new Error(`Freesound 裁剪后的音频时长不足：${duration} 秒。`);
    return new Uint8Array(await readFile(outputPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function trimMp4Artifact(sourcePath: string, startSeconds: number, endSeconds: number): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), "loop-control-video-"));
  const outputPath = join(directory, "trimmed.mp4");
  try {
    const durationSeconds = endSeconds - startSeconds;
    await runCommand("ffmpeg", ["-nostdin", "-v", "error", "-i", sourcePath, "-ss", String(startSeconds), "-t", String(durationSeconds), "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath]);
    const { stdout } = await runCommandWithOutput("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", outputPath]);
    const inspected = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
    const actualDuration = Number(inspected.format?.duration);
    const hasVideo = Boolean(inspected.streams?.some((stream) => stream.codec_type === "video"));
    const hasAudio = Boolean(inspected.streams?.some((stream) => stream.codec_type === "audio"));
    if (!Number.isFinite(actualDuration) || Math.abs(actualDuration - durationSeconds) > durationToleranceSeconds() || !hasVideo) throw new Error(`裁剪视频校验失败：时长 ${actualDuration || "未知"} 秒，视频流 ${hasVideo ? "存在" : "缺失"}，音频流 ${hasAudio ? "存在" : "缺失"}。`);
    const bytes = new Uint8Array(await readFile(outputPath));
    if (bytes.byteLength === 0) throw new Error("裁剪视频文件为空。");
    return bytes;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function trimMp4SegmentsArtifact(sourcePath: string, segments: Array<{ startSeconds: number; endSeconds: number }>): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), "loop-control-video-segments-"));
  const outputPath = join(directory, "combined.mp4");
  try {
    const segmentPaths: string[] = [];
    for (const [index, segment] of segments.entries()) {
      const segmentPath = join(directory, `segment-${index}.mp4`);
      await runCommand("ffmpeg", ["-nostdin", "-v", "error", "-i", sourcePath, "-ss", String(segment.startSeconds), "-t", String(segment.endSeconds - segment.startSeconds), "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", "-movflags", "+faststart", segmentPath]);
      segmentPaths.push(segmentPath);
    }
    const concatPath = join(directory, "segments.txt");
    await writeFile(concatPath, segmentPaths.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join("\n"));
    await runCommand("ffmpeg", ["-nostdin", "-v", "error", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", "-movflags", "+faststart", outputPath]);
    const bytes = new Uint8Array(await readFile(outputPath));
    if (bytes.byteLength === 0) throw new Error("拼接视频文件为空。");
    return bytes;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function probeMp3Artifact(path: string): Promise<number> {
  const { stdout } = await runCommandWithOutput("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("音频不可播放或缺少有效时长。");
  return duration;
}

export async function validateMp4Artifact(path: string, minimumDurationSeconds: number, frameRate?: number, allowedFrames?: number): Promise<void> {
  const { stdout } = await runCommandWithOutput("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path,
  ]);
  const duration = Number(stdout.trim());
  if (!videoDurationMeetsMinimum(duration, minimumDurationSeconds, frameRate, allowedFrames)) {
    throw new Error(`视频不可播放或时长不足：${duration || "未知"} 秒。`);
  }
}

export async function inspectMp4Artifact(path: string): Promise<{ durationSeconds: number; width: number; height: number; hasAudio: boolean; blackFrameCount: number }> {
  const { stdout } = await runCommandWithOutput("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", path]);
  const inspected = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> };
  const durationSeconds = Number(inspected.format?.duration);
  const video = inspected.streams?.find((stream) => stream.codec_type === "video");
  if (!Number.isFinite(durationSeconds) || !video || !Number.isInteger(video.width) || !Number.isInteger(video.height)) throw new Error("最终视频缺少有效的时长或视频流。");
  const black = await runCommandWithOutput("ffmpeg", ["-nostdin", "-v", "info", "-i", path, "-vf", "blackdetect=d=0.1:pix_th=0.02", "-an", "-f", "null", "-"]);
  return { durationSeconds, width: Number(video.width), height: Number(video.height), hasAudio: Boolean(inspected.streams?.some((stream) => stream.codec_type === "audio")), blackFrameCount: (black.stderr.match(/black_start:/g) ?? []).length };
}
