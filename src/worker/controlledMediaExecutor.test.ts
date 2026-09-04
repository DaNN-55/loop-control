import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerTaskPackage, type WorkerTaskPackageInput } from "./contracts";
import { executeControlledMediaTask } from "./controlledMediaExecutor";

const directories: string[] = [];
const execFileAsync = promisify(execFile);
const ffmpegAvailable = await execFileAsync("ffmpeg", ["-version"]).then(() => true).catch(() => false);
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function packageFor(overrides: Partial<WorkerTaskPackageInput>, assetRoot?: string): Promise<ReturnType<typeof createWorkerTaskPackage>> {
  const root = assetRoot ?? await mkdtemp(join(tmpdir(), "controlled-media-"));
  if (!assetRoot) directories.push(root);
  return createWorkerTaskPackage({
    task: { id: "task-1", type: "generate_narration", attempt: 0, budgetLimitCents: 100, maxAttempts: 1, provider: "google_tts", model: "standard", promptVersion: "narration-v1" },
    episode: { id: "episode-1", accountId: "account-1", blueprintVersionId: "blueprint-1", title: "测试" },
    capability: "narration_generation", credentialRef: "11111111-1111-4111-8111-111111111111", allowedTools: ["network", "write"], allowedAssetRoot: root,
    output: { requiredArtifactTypes: ["narration_audio"], contentType: "audio/mpeg", relativePath: "episodes/episode-1/audio/narration.mp3", reviewStage: "production_ready" }, inputArtifacts: [],
    media: { adapter: "google_tts", narration: { text: "冻结旁白", voice: { languageCode: "cmn-CN", name: "cmn-CN-Standard-A", speakingRate: 1 } } },
    ...overrides,
  });
}

describe("受控媒体执行器", () => {
  it.skipIf(!ffmpegAvailable)("使用真实 ffmpeg 裁剪带原声视频并提取当前片段原声", async () => {
    const root = await mkdtemp(join(tmpdir(), "controlled-media-ffmpeg-"));
    directories.push(root);
    const sourcePath = join(root, "episodes/episode-1/materials/source.mp4");
    await mkdir(join(root, "episodes/episode-1/materials"), { recursive: true });
    await execFileAsync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100", "-t", "4", "-shortest", "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", sourcePath]);

    const realValidateMp4 = async (path: string, minimumDurationSeconds: number) => {
      const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path]);
      expect(Number(stdout.trim())).toBeGreaterThanOrEqual(minimumDurationSeconds);
    };
    const realProbeMp3 = async (path: string) => {
      const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path]);
      const duration = Number(stdout.trim());
      expect(duration).toBeGreaterThan(0);
      return duration;
    };
    const realTrimMp4 = async (path: string, startSeconds: number, endSeconds: number) => {
      const directory = await mkdtemp(join(tmpdir(), "controlled-media-ffmpeg-output-"));
      directories.push(directory);
      const outputPath = join(directory, "clip.mp4");
      await execFileAsync("ffmpeg", ["-nostdin", "-v", "error", "-ss", String(startSeconds), "-i", path, "-t", String(endSeconds - startSeconds), "-map", "0:v:0", "-map", "0:a:0", "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath]);
      return new Uint8Array(await readFile(outputPath));
    };
    const realExtractMp3 = async (path: string, minimumDurationSeconds: number) => {
      const directory = await mkdtemp(join(tmpdir(), "controlled-media-ffmpeg-audio-"));
      directories.push(directory);
      const outputPath = join(directory, "source.mp3");
      await execFileAsync("ffmpeg", ["-nostdin", "-v", "error", "-i", path, "-vn", "-codec:a", "libmp3lame", "-q:a", "2", outputPath]);
      expect(await realProbeMp3(outputPath)).toBeGreaterThanOrEqual(minimumDurationSeconds);
      return new Uint8Array(await readFile(outputPath));
    };
    const common = { fetcher: vi.fn(), googleTtsApiKey: undefined, pexelsApiKey: undefined, validateMp4: realValidateMp4, probeMp3: realProbeMp3, extractMp3: realExtractMp3, trimMp3: vi.fn(), trimMp4: realTrimMp4 };
    const sourceArtifact = { artifactType: "source_video", relativePath: "episodes/episode-1/materials/source.mp4", sha256: "a".repeat(64), fileSize: 1 };
    const clipPackage = await packageFor({
      task: { id: "task-real-clip", type: "generate_a_roll", attempt: 0, budgetLimitCents: 0, maxAttempts: 1, provider: "ffmpeg", model: "ffmpeg", promptVersion: "shot-clip-v1" },
      capability: "shot_clip_preparation", output: { requiredArtifactTypes: ["a_roll_video"], contentType: "video/mp4", relativePath: "episodes/episode-1/shot-clips/shot-1.mp4", reviewStage: "production_ready" }, inputArtifacts: [sourceArtifact],
      media: { adapter: "ffmpeg_trim_video", videoClip: { sourceRelativePath: sourceArtifact.relativePath, startSeconds: 1, endSeconds: 3, targetDurationSeconds: 2 } },
    }, root);
    const clipResult = JSON.parse(await executeControlledMediaTask({ ...common, taskPackage: clipPackage }));
    expect(clipResult.status).toBe("completed");
    const clipPath = join(root, clipPackage.output.relativePath);
    const clipProbe = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", clipPath]);
    expect(Number(JSON.parse(clipProbe.stdout).format.duration)).toBeCloseTo(2, 1);
    expect(JSON.parse(clipProbe.stdout).streams.map((stream: { codec_type: string }) => stream.codec_type)).toEqual(expect.arrayContaining(["video", "audio"]));

    const audioPackage = await packageFor({
      task: { id: "task-real-audio", type: "extract_embedded_audio", attempt: 0, budgetLimitCents: 0, maxAttempts: 1, provider: "ffmpeg", model: "ffmpeg", promptVersion: "shot-source-audio-v1" },
      capability: "embedded_audio_extraction", output: { requiredArtifactTypes: ["shot_source_audio"], contentType: "audio/mpeg", relativePath: "episodes/episode-1/audio/source.mp3", reviewStage: "production_ready" }, inputArtifacts: [sourceArtifact],
      media: { adapter: "ffmpeg_extract_audio", embeddedAudio: { sourceRelativePath: sourceArtifact.relativePath, durationSeconds: 3 } },
    }, root);
    const audioResult = JSON.parse(await executeControlledMediaTask({ ...common, taskPackage: audioPackage }));
    expect(audioResult).toMatchObject({ status: "completed", audioDurationSeconds: expect.any(Number) });
    expect(common.fetcher).not.toHaveBeenCalled();
  }, 30_000);

  it("只用冻结的 Google 旁白配置写入冻结输出路径", async () => {
    const taskPackage = await packageFor({});
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ audioContent: Buffer.from("mp3-data").toString("base64") }), { status: 200 }));
    const result = JSON.parse(await executeControlledMediaTask({ taskPackage, fetcher, googleTtsApiKey: "google-key", pexelsApiKey: undefined, validateMp4: vi.fn(), probeMp3: vi.fn().mockResolvedValue(2), extractMp3: vi.fn(), trimMp3: vi.fn() }));
    expect(result.status).toBe("completed");
    await expect(readFile(join(taskPackage.assets.allowedRoot, taskPackage.output.relativePath), "utf8")).resolves.toBe("mp3-data");
  });

  it("Google TTS 产物无法探测为音频时不上报成功", async () => {
    const taskPackage = await packageFor({});
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ audioContent: Buffer.from("not-an-mp3").toString("base64") }), { status: 200 }));
    await expect(executeControlledMediaTask({ taskPackage, fetcher, googleTtsApiKey: "google-key", pexelsApiKey: undefined, validateMp4: vi.fn(), probeMp3: async () => { throw new Error("无法播放"); }, extractMp3: vi.fn(), trimMp3: vi.fn() })).rejects.toThrow("无法播放");
  });

  it("拒绝通过输出目录符号链接写出资产根目录", async () => {
    const taskPackage = await packageFor({});
    const outside = await mkdtemp(join(tmpdir(), "controlled-media-outside-"));
    directories.push(outside);
    await symlink(outside, join(taskPackage.assets.allowedRoot, "episodes"));
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ audioContent: Buffer.from("mp3-data").toString("base64") }), { status: 200 }));
    await expect(executeControlledMediaTask({ taskPackage, fetcher, googleTtsApiKey: "google-key", pexelsApiKey: undefined, validateMp4: vi.fn(), probeMp3: vi.fn().mockResolvedValue(2), extractMp3: vi.fn(), trimMp3: vi.fn() })).rejects.toThrow("符号链接");
  });

  it("拒绝将非 MP4 的 Pexels 下载伪装成视频产物", async () => {
    const rootPackage = await packageFor({
      task: { id: "task-2", type: "generate_b_roll", attempt: 0, budgetLimitCents: 100, maxAttempts: 1, provider: "pexels", model: "pexels-video-v1", promptVersion: "b-roll-v1" },
      capability: "b_roll_generation", credentialRef: "11111111-1111-4111-8111-111111111111", output: { requiredArtifactTypes: ["b_roll_asset"], contentType: "video/mp4", relativePath: "episodes/episode-1/b-roll/shot-1.mp4", reviewStage: "production_ready" },
      inputArtifacts: [{ artifactType: "main_script", relativePath: "episodes/episode-1/main.txt", sha256: "a".repeat(64), fileSize: 1 }, { artifactType: "static_visual", relativePath: "episodes/episode-1/ref.png", sha256: "b".repeat(64), fileSize: 1 }],
      media: { adapter: "pexels_video", bRoll: { query: "雨夜", targetDurationSeconds: 2, shot: { id: "shot-1", scriptSegment: "雨夜", durationSeconds: 2, shotType: "b_roll", productionMethod: "Pexels", inputBasis: [{ relativePath: "episodes/episode-1/main.txt", sha256: "a".repeat(64) }, { relativePath: "episodes/episode-1/ref.png", sha256: "b".repeat(64) }], targetSpec: "9:16" } } },
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ videos: [{ id: 1, duration: 3, video_files: [{ link: "https://cdn.test/video.mp4", width: 1080, height: 1920, file_type: "video/mp4" }] }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response("not-video", { status: 200, headers: { "content-type": "text/plain" } }));
    await expect(executeControlledMediaTask({ taskPackage: rootPackage, fetcher, googleTtsApiKey: undefined, pexelsApiKey: "pexels-key", validateMp4: vi.fn(), probeMp3: vi.fn(), extractMp3: vi.fn(), trimMp3: vi.fn() })).rejects.toThrow("不是 MP4");
  });

  it("返回的 MP4 无法播放时不上报成功", async () => {
    const taskPackage = await packageFor({
      task: { id: "task-3", type: "generate_b_roll", attempt: 0, budgetLimitCents: 100, maxAttempts: 1, provider: "pexels", model: "pexels-video-v1", promptVersion: "b-roll-v1" },
      capability: "b_roll_generation", credentialRef: "11111111-1111-4111-8111-111111111111", output: { requiredArtifactTypes: ["b_roll_asset"], contentType: "video/mp4", relativePath: "episodes/episode-1/b-roll/shot-1.mp4", reviewStage: "production_ready" },
      inputArtifacts: [{ artifactType: "main_script", relativePath: "episodes/episode-1/main.txt", sha256: "a".repeat(64), fileSize: 1 }, { artifactType: "static_visual", relativePath: "episodes/episode-1/ref.png", sha256: "b".repeat(64), fileSize: 1 }],
      media: { adapter: "pexels_video", bRoll: { query: "雨夜", targetDurationSeconds: 2, shot: { id: "shot-1", scriptSegment: "雨夜", durationSeconds: 2, shotType: "b_roll", productionMethod: "Pexels", inputBasis: [{ relativePath: "episodes/episode-1/main.txt", sha256: "a".repeat(64) }, { relativePath: "episodes/episode-1/ref.png", sha256: "b".repeat(64) }], targetSpec: "9:16" } } },
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ videos: [{ id: 1, duration: 3, video_files: [{ link: "https://cdn.test/video.mp4", width: 1080, height: 1920, file_type: "video/mp4" }] }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response("not-playable", { status: 200, headers: { "content-type": "video/mp4" } }));
    await expect(executeControlledMediaTask({ taskPackage, fetcher, googleTtsApiKey: undefined, pexelsApiKey: "pexels-key", validateMp4: async () => { throw new Error("无法播放"); }, probeMp3: vi.fn(), extractMp3: vi.fn(), trimMp3: vi.fn() })).rejects.toThrow("无法播放");
  });

  it("按冻结入点和出点执行视频裁剪，并校验 MP4 产物", async () => {
    const taskPackage = await packageFor({
      task: { id: "task-clip", type: "generate_a_roll", attempt: 0, budgetLimitCents: 0, maxAttempts: 1, provider: "ffmpeg", model: "ffmpeg", promptVersion: "shot-clip-v1" },
      capability: "shot_clip_preparation",
      output: { requiredArtifactTypes: ["a_roll_video"], contentType: "video/mp4", relativePath: "episodes/episode-1/shot-clips/shot-1.mp4", reviewStage: "production_ready" },
      inputArtifacts: [{ artifactType: "source_video", relativePath: "episodes/episode-1/materials/source.mp4", sha256: "a".repeat(64), fileSize: 10 }],
      media: { adapter: "ffmpeg_trim_video", videoClip: { sourceRelativePath: "episodes/episode-1/materials/source.mp4", startSeconds: 1.25, endSeconds: 4.25, targetDurationSeconds: 3 } },
    });
    const trimMp4 = vi.fn().mockResolvedValue(new Uint8Array(Buffer.from("trimmed-mp4")));
    const validateMp4 = vi.fn().mockResolvedValue(undefined);

    const result = JSON.parse(await executeControlledMediaTask({ taskPackage, fetcher: vi.fn(), googleTtsApiKey: undefined, pexelsApiKey: undefined, validateMp4, probeMp3: vi.fn(), extractMp3: vi.fn(), trimMp3: vi.fn(), trimMp4 }));

    expect(result).toMatchObject({ status: "completed", artifacts: [{ artifactType: "a_roll_video", fileSize: 11 }] });
    expect(trimMp4).toHaveBeenCalledWith(join(taskPackage.assets.allowedRoot, "episodes/episode-1/materials/source.mp4"), 1.25, 4.25);
    expect(validateMp4).toHaveBeenCalledWith(expect.any(String), 3);
    await expect(readFile(join(taskPackage.assets.allowedRoot, taskPackage.output.relativePath), "utf8")).resolves.toBe("trimmed-mp4");
  });

  it("按顺序拼接同一原片的多个冻结片段", async () => {
    const segments = [{ startSeconds: 1, endSeconds: 2.5 }, { startSeconds: 4, endSeconds: 6 }];
    const taskPackage = await packageFor({
      task: { id: "task-multi-clip", type: "generate_a_roll", attempt: 0, budgetLimitCents: 0, maxAttempts: 1, provider: "ffmpeg", model: "ffmpeg", promptVersion: "shot-clip-v2" },
      capability: "shot_clip_preparation",
      output: { requiredArtifactTypes: ["a_roll_video"], contentType: "video/mp4", relativePath: "episodes/episode-1/shot-clips/shot-1.mp4", reviewStage: "production_ready" },
      inputArtifacts: [{ artifactType: "source_video", relativePath: "episodes/episode-1/materials/source.mp4", sha256: "a".repeat(64), fileSize: 10 }],
      media: { adapter: "ffmpeg_trim_video", videoClips: { sourceRelativePath: "episodes/episode-1/materials/source.mp4", segments, targetDurationSeconds: 3.5 } },
    });
    const trimMp4Segments = vi.fn().mockResolvedValue(new Uint8Array(Buffer.from("combined-mp4")));
    const validateMp4 = vi.fn().mockResolvedValue(undefined);

    const result = JSON.parse(await executeControlledMediaTask({ taskPackage, fetcher: vi.fn(), googleTtsApiKey: undefined, pexelsApiKey: undefined, validateMp4, probeMp3: vi.fn(), extractMp3: vi.fn(), trimMp3: vi.fn(), trimMp4Segments }));

    expect(result.status).toBe("completed");
    expect(trimMp4Segments).toHaveBeenCalledWith(join(taskPackage.assets.allowedRoot, "episodes/episode-1/materials/source.mp4"), segments);
    expect(validateMp4).toHaveBeenCalledWith(expect.any(String), 3.5);
  });

  it("按冻结分镜检索、下载、校验并登记 Pexels MP4", async () => {
    const inputBasis = [{ relativePath: "episodes/episode-1/main.txt", sha256: "a".repeat(64) }, { relativePath: "episodes/episode-1/ref.png", sha256: "b".repeat(64) }];
    const taskPackage = await packageFor({
      task: { id: "task-pexels", type: "generate_b_roll", attempt: 0, budgetLimitCents: 100, maxAttempts: 1, provider: "pexels", model: "pexels-video-v1", promptVersion: "b-roll-v1" },
      capability: "b_roll_generation", credentialRef: "11111111-1111-4111-8111-111111111111", output: { requiredArtifactTypes: ["b_roll_asset"], contentType: "video/mp4", relativePath: "episodes/episode-1/b-roll/shot-1.mp4", reviewStage: "production_ready" },
      inputArtifacts: [{ artifactType: "main_script", ...inputBasis[0], fileSize: 1 }, { artifactType: "static_visual", ...inputBasis[1], fileSize: 1 }],
      media: { adapter: "pexels_video", bRoll: { query: "雨夜", targetDurationSeconds: 2, shot: { id: "shot-1", scriptSegment: "雨夜", durationSeconds: 2, shotType: "b_roll", productionMethod: "Pexels", inputBasis, targetSpec: "9:16" } } },
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ videos: [{ id: 1, duration: 3, video_files: [{ link: "https://cdn.test/video.mp4", width: 1080, height: 1920, file_type: "video/mp4" }] }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response("mp4-data", { status: 200, headers: { "content-type": "video/mp4" } }));
    const validateMp4 = vi.fn().mockResolvedValue(undefined);

    const result = JSON.parse(await executeControlledMediaTask({ taskPackage, fetcher, googleTtsApiKey: undefined, pexelsApiKey: "pexels-key", validateMp4, probeMp3: vi.fn(), extractMp3: vi.fn(), trimMp3: vi.fn() }));

    expect(result).toMatchObject({ status: "completed", artifacts: [{ artifactType: "b_roll_asset", relativePath: taskPackage.output.relativePath, fileSize: 8 }] });
    expect(validateMp4).toHaveBeenCalledWith(expect.any(String), 2);
    await expect(readFile(join(taskPackage.assets.allowedRoot, taskPackage.output.relativePath), "utf8")).resolves.toBe("mp4-data");
  });

  it("仅从冻结的视频修订提取派生音频", async () => {
    const taskPackage = await packageFor({
      task: { id: "task-4", type: "extract_embedded_audio", attempt: 0, budgetLimitCents: 0, maxAttempts: 1, provider: "ffmpeg", model: "ffmpeg", promptVersion: "embedded-audio-v1" },
      capability: "embedded_audio_extraction",
      output: { requiredArtifactTypes: ["derived_audio"], contentType: "audio/mpeg", relativePath: "episodes/episode-1/audio/source-video.mp3", reviewStage: "production_ready" },
      inputArtifacts: [{ artifactType: "a_roll_video", relativePath: "episodes/episode-1/a-roll/source.mp4", sha256: "a".repeat(64), fileSize: 1 }],
      media: { adapter: "ffmpeg_extract_audio", embeddedAudio: { sourceRelativePath: "episodes/episode-1/a-roll/source.mp4", durationSeconds: 4 } },
    });
    const extractMp3 = vi.fn().mockResolvedValue(new Uint8Array(Buffer.from("mp3-data")));
    const result = JSON.parse(await executeControlledMediaTask({ taskPackage, fetcher: vi.fn(), googleTtsApiKey: undefined, pexelsApiKey: undefined, validateMp4: vi.fn(), probeMp3: vi.fn().mockResolvedValue(4), extractMp3, trimMp3: vi.fn() }));
    expect(result.status).toBe("completed");
    expect(extractMp3).toHaveBeenCalledWith(join(taskPackage.assets.allowedRoot, "episodes/episode-1/a-roll/source.mp4"), 4);
    await expect(readFile(join(taskPackage.assets.allowedRoot, taskPackage.output.relativePath), "utf8")).resolves.toBe("mp3-data");
  });

  it("下载并记录 Freesound 的冻结声轨预览来源", async () => {
    const taskPackage = await packageFor({
      task: { id: "task-5", type: "generate_soundtrack", attempt: 0, budgetLimitCents: 0, maxAttempts: 1, provider: "freesound", model: "freesound-preview-v1", promptVersion: "soundtrack-v1" },
      capability: "soundtrack_generation",
      output: { requiredArtifactTypes: ["soundtrack_audio"], contentType: "audio/mpeg", relativePath: "episodes/episode-1/audio/sfx-bell.mp3", reviewStage: "production_ready" },
      media: { adapter: "freesound_preview", soundtrack: { query: "rain bell", targetDurationSeconds: 4, cue: { id: "bell", kind: "sfx", description: "雨中铜铃", searchQuery: "rain bell", startSeconds: 2, durationSeconds: 4 } } },
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: 9, name: "rain bell", username: "creator", license: "Creative Commons 0", duration: 5, url: "https://freesound.org/s/9/", previews: { "preview-hq-mp3": "https://cdn.test/bell.mp3" } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response("mp3-data", { status: 200, headers: { "content-type": "audio/mpeg" } }));

    const trimMp3 = vi.fn().mockResolvedValue(new Uint8Array(Buffer.from("trimmed-mp3")));
    const result = JSON.parse(await executeControlledMediaTask({ taskPackage, fetcher, googleTtsApiKey: undefined, pexelsApiKey: undefined, freesoundApiKey: "freesound-key", validateMp4: vi.fn(), probeMp3: vi.fn().mockResolvedValue(4), extractMp3: vi.fn(), trimMp3 }));
    expect(result).toMatchObject({ status: "completed", audioDurationSeconds: 4, mediaSource: { provider: "freesound", sourceId: 9, creator: "creator", license: "Creative Commons 0" } });
    expect(trimMp3).toHaveBeenCalledWith(new Uint8Array(Buffer.from("mp3-data")), 4);
    await expect(readFile(join(taskPackage.assets.allowedRoot, taskPackage.output.relativePath), "utf8")).resolves.toBe("trimmed-mp3");
  });
});
