import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { createClient } from "@supabase/supabase-js";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs, readFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { promisify } from "node:util";
import { loadEnv, type Plugin } from "vite";
import { verifyMediaLibrary } from "./src/worker/mediaLibrary";
import { createRuntimePreflight, localAdapterReadinessFromCommands, runtimeCapabilitiesFromBlueprintPolicy, runtimeCommandArguments } from "./src/worker/runtimePreflight";
import { probeCodexModel, probeProviderConnection } from "./src/worker/runtimeProbes";
import { isSupportedManualARollVideo, isSupportedManualAudio } from "./src/reviews/materialImport";
import { workerPreflightVersion } from "./src/worker/contracts";
import { writeSafeAssetFile } from "./src/worker/controlledMediaExecutor";
import { createPublishPackage, verifyPublishPackage } from "./src/publishing/publishPackage";
import { loadPublishContext } from "./src/publishing/publishContext";
import { coverImageExtension, coverInputPath } from "./src/publishing/coverImage";
import { adapterRegistration } from "./src/worker/adapterRegistry";
import { synthesizeGoogleTts, synthesizeVolcengineTts } from "./src/worker/mediaProviders";

export { coverImageExtension } from "./src/publishing/coverImage";

const localArtifactRoute = "/_local-artifact";
const localEpisodeDirectoryRoute = "/_local-episode-directory";
const openLocalEpisodeDirectoryRoute = "/_open-local-episode-directory";
const chooseLocalAssetDirectoryRoute = "/_choose-local-asset-directory";
const openLocalAssetDirectoryRoute = "/_open-local-asset-directory";
const openLocalArtifactRoute = "/_open-local-artifact";
const localProductionMaterialRoute = "/_production-material";
const localEpisodeDeletionRoute = "/_delete-episode";
const localEpisodeDeletionCleanupRoute = "/_finalize-episode-deletion";
const systemStatusRoute = "/_system-status";
const goldenProductionTestRoute = "/_golden-production-test";
const workerPreflightRoute = "/_worker-preflight";
const externalConnectionTestRoute = "/_external-connection-test";
const publishPreparationRoute = "/_publish-preparation";
const openHyperframesStudioRoute = "/_open-hyperframes-studio";
const openPersonalHyperframesStudioRoute = "/_open-personal-hyperframes-studio";
const freezeHyperframesStudioRoute = "/_freeze-hyperframes-studio";
const episodePreflightRoute = "/_episode-preflight";
const ttsVoicePreviewRoute = "/_tts-voice-preview";
const maxProductionMaterialBytes = 100 * 1024 * 1024;
const maxEncodedMaterialRequestBytes = 140 * 1024 * 1024;
const execFileAsync = promisify(execFile);

const mediaTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

function isSafeRelativeArtifactPath(value: string): boolean {
  return value.length > 0 && !value.split(/[\\/]/).some((segment) => !segment || segment === "." || segment === "..");
}

function isEpisodeId(value: string): boolean {
  return isUuid(value);
}

export function confirmedStudioShotBlockers(context: unknown, drafts: readonly unknown[]): string[] {
  const snapshot = context && typeof context === "object" && !Array.isArray(context) ? context as Record<string, unknown> : {};
  const storyboard = snapshot.storyboard && typeof snapshot.storyboard === "object" && !Array.isArray(snapshot.storyboard) ? snapshot.storyboard as Record<string, unknown> : {};
  const shots = Array.isArray(storyboard.shots) ? storyboard.shots : [];
  const confirmedShots = Array.isArray(snapshot.confirmed_shots) ? snapshot.confirmed_shots : [];
  const members = Array.isArray(snapshot.members) ? snapshot.members : [];
  const draftByShot = new Map<string, Record<string, unknown>>();
  const confirmedByShot = new Map<string, Record<string, unknown>>();
  const memberByKey = new Map<string, Record<string, unknown>>();
  for (const draft of drafts) {
    if (draft && typeof draft === "object" && !Array.isArray(draft) && typeof (draft as Record<string, unknown>).shot_id === "string") draftByShot.set((draft as Record<string, unknown>).shot_id as string, draft as Record<string, unknown>);
  }
  for (const confirmedShot of confirmedShots) {
    if (confirmedShot && typeof confirmedShot === "object" && !Array.isArray(confirmedShot) && typeof (confirmedShot as Record<string, unknown>).shot_id === "string") confirmedByShot.set((confirmedShot as Record<string, unknown>).shot_id as string, confirmedShot as Record<string, unknown>);
  }
  for (const member of members) {
    if (member && typeof member === "object" && !Array.isArray(member) && typeof (member as Record<string, unknown>).member_key === "string") memberByKey.set((member as Record<string, unknown>).member_key as string, member as Record<string, unknown>);
  }

  const blockers: string[] = [];
  for (const shot of shots) {
    const shotId = shot && typeof shot === "object" && !Array.isArray(shot) && typeof (shot as Record<string, unknown>).id === "string" ? (shot as Record<string, unknown>).id as string : "未知镜头";
    const confirmed = confirmedByShot.get(shotId);
    const draft = draftByShot.get(shotId);
    const media = memberByKey.get(`shot:${shotId}`);
    const audio = memberByKey.get(`narration:${shotId}`);
    const audioMode = confirmed?.audio_mode;
    const rawSourceMatches = typeof confirmed?.source_material_revision_id === "string"
      && draft?.selected_material_revision_id === confirmed.source_material_revision_id
      && media?.source_material_revision_id === confirmed.source_material_revision_id
      && JSON.stringify(draft.clip_segments) === JSON.stringify(confirmed.clip_segments)
      && JSON.stringify(media.clip_segments) === JSON.stringify(confirmed.clip_segments);
    const preparedClipMatches = typeof confirmed?.video_artifact_id === "string" && typeof confirmed.video_task_id === "string"
      && draft?.current_video_artifact_id === confirmed.video_artifact_id
      && draft?.current_video_task_id === confirmed?.video_task_id
      && media?.artifact_id === confirmed?.video_artifact_id
      && media?.task_id === confirmed?.video_task_id;
    const embeddedSourceAudio = rawSourceMatches && audioMode === "source";
    const valid = confirmed?.confirmation_status === "confirmed"
      && draft?.confirmation_status === "confirmed"
      && draft.input_fingerprint === confirmed.input_fingerprint
      && (rawSourceMatches || preparedClipMatches)
      && draft.audio_mode === audioMode
      && draft.current_audio_track_id === confirmed.audio_track_id
      && draft.subtitle_text === confirmed.subtitle_text
      && draft.subtitles_enabled === confirmed.subtitles_enabled
      && (audioMode === "none" || embeddedSourceAudio ? !audio : Boolean(audio && audio.audio_track_id === confirmed.audio_track_id))
      && Boolean(media && media.input_fingerprint === confirmed.input_fingerprint
        && media.audio_mode === confirmed.audio_mode
        && media.subtitle_text === confirmed.subtitle_text
        && media.subtitles_enabled === confirmed.subtitles_enabled);
    if (!valid) blockers.push(shotId);
  }
  return [...new Set(blockers)];
}

export function requiredMediaCapabilitiesFromTasks(tasks: unknown): string[] {
  if (!Array.isArray(tasks)) return [];
  const capabilities = new Set<string>();
  for (const task of tasks) {
    if (!task || typeof task !== "object" || Array.isArray(task)) continue;
    const record = task as Record<string, unknown>;
    if (record.status === "completed" || record.status === "superseded" || record.provider === "manual_upload") continue;
    const taskType = record.task_type;
    const capability = taskType === "generate_b_roll" ? "b_roll_generation"
      : taskType === "generate_narration" ? "narration_generation"
        : taskType === "generate_soundtrack" ? "soundtrack_generation"
          : taskType === "generate_a_roll" ? "a_roll_generation"
            : taskType === "generate_static_visual" ? "static_visual_generation" : null;
    if (capability) capabilities.add(capability);
    const snapshot = record.input_snapshot;
    if (taskType === "prepare_visual_brief" && snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
      const visualAssets = (snapshot as Record<string, unknown>).visual_assets;
      const imageGeneration = visualAssets && typeof visualAssets === "object" && !Array.isArray(visualAssets) ? (visualAssets as Record<string, unknown>).image_generation : undefined;
      if (imageGeneration && typeof imageGeneration === "object" && !Array.isArray(imageGeneration) && (imageGeneration as Record<string, unknown>).provider !== "manual_upload") capabilities.add("static_visual_generation");
    }
  }
  return [...capabilities];
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isDescendant(parentPath: string, childPath: string): boolean {
  const pathFromParent = relative(parentPath, childPath);
  return pathFromParent.length > 0 && !pathFromParent.startsWith("..") && !isAbsolute(pathFromParent);
}

function isFilesystemRoot(path: string): boolean {
  const resolvedPath = resolve(path);
  return parse(resolvedPath).root === resolvedPath;
}

export interface StudioProjectSnapshot {
  relativePath: string;
  sha256: string;
  fileSize: number;
}

function isReviewRenderProjectPath(episodeId: string, value: string): boolean {
  return new RegExp(`^episodes/${episodeId}/review-render/v[1-9][0-9]*/index\\.html$`).test(value);
}

function isStudioWorkspacePath(episodeId: string, value: string, kind: "studio" | "studio-frozen"): boolean {
  return new RegExp(`^episodes/${episodeId}/${kind}/[0-9a-f-]{36}/index\\.html$`, "i").test(value);
}

function videoTagAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return match?.[1] ?? match?.[2] ?? null;
}

export function studioMarkerSourceRequirements(originalHtml: string, editedHtml: string): Array<{ relativePath: string; minimumDurationSeconds: number }> {
  const originalSources = new Map<string, string>();
  for (const tag of originalHtml.match(/<video\b[^>]*>/gi) ?? []) {
    if (videoTagAttribute(tag, "data-media-start") === null) continue;
    const shotClass = videoTagAttribute(tag, "class")?.split(/\s+/).find((value) => /^shot-\d+$/.test(value));
    const source = videoTagAttribute(tag, "src");
    if (shotClass && source) originalSources.set(shotClass, source);
  }
  if (originalSources.size === 0) return [];

  const seen = new Set<string>();
  const requirements = new Map<string, number>();
  for (const tag of editedHtml.match(/<video\b[^>]*>/gi) ?? []) {
    const shotClass = videoTagAttribute(tag, "class")?.split(/\s+/).find((value) => /^shot-\d+$/.test(value));
    if (!shotClass || !originalSources.has(shotClass)) throw new Error("Studio 不能新增或更换镜头原片；请返回镜头工作台修改。");
    const source = videoTagAttribute(tag, "src");
    if (source !== originalSources.get(shotClass) || !/^assets\/[^/]+$/.test(source)) throw new Error("Studio 不能更换原片；请返回镜头工作台修改。");
    const startValue = videoTagAttribute(tag, "data-media-start");
    const durationValue = videoTagAttribute(tag, "data-duration");
    if (startValue === null || durationValue === null) throw new Error("Studio 片段标记无效。");
    const start = Number(startValue);
    const duration = Number(durationValue);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0) throw new Error("Studio 片段标记无效。");
    seen.add(shotClass);
    requirements.set(source, Math.max(requirements.get(source) ?? 0, start + duration));
  }
  if ([...originalSources.keys()].some((shotClass) => !seen.has(shotClass))) throw new Error("Studio 不能删除镜头；请提交分镜结构修订。");
  return [...requirements].map(([relativePath, minimumDurationSeconds]) => ({ relativePath, minimumDurationSeconds }));
}

async function validateStudioMarkerWorkspace(assetRoot: string, episodeId: string, sourceRelativePath: string, workspaceRelativePath: string): Promise<void> {
  if (!isReviewRenderProjectPath(episodeId, sourceRelativePath) || !isStudioWorkspacePath(episodeId, workspaceRelativePath, "studio")) throw new Error("HyperFrames 工程路径无效。");
  const root = await fs.realpath(assetRoot);
  const source = await fs.realpath(resolve(root, sourceRelativePath));
  const workspace = await fs.realpath(resolve(root, workspaceRelativePath));
  if (!isDescendant(root, source) || !isDescendant(root, workspace)) throw new Error("HyperFrames 工程超出资产根。");
  const requirements = studioMarkerSourceRequirements(await fs.readFile(source, "utf8"), await fs.readFile(workspace, "utf8"));
  for (const requirement of requirements) {
    const sourceAsset = await fs.realpath(resolve(dirname(source), requirement.relativePath));
    const asset = await fs.realpath(resolve(dirname(workspace), requirement.relativePath));
    if (!isDescendant(dirname(source), sourceAsset) || !isDescendant(dirname(workspace), asset)) throw new Error("Studio 原片路径无效。");
    const sourceHash = createHash("sha256").update(await fs.readFile(sourceAsset)).digest("hex");
    const workspaceHash = createHash("sha256").update(await fs.readFile(asset)).digest("hex");
    if (sourceHash !== workspaceHash) throw new Error("Studio 不能更换原片；请返回镜头工作台修改。");
    const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", asset]);
    const duration = Number(stdout.trim());
    if (!Number.isFinite(duration) || duration + 0.01 < requirement.minimumDurationSeconds) throw new Error("Studio 片段标记超出原片范围。");
  }
}

async function assertDirectoryTreeHasNoLinks(directory: string): Promise<void> {
  const details = await fs.lstat(directory);
  if (details.isSymbolicLink() || !details.isDirectory()) throw new Error("HyperFrames 工程目录不安全。");
  for (const entry of await fs.readdir(directory)) {
    const path = join(directory, entry);
    const child = await fs.lstat(path);
    if (child.isSymbolicLink()) throw new Error("HyperFrames 工程不能包含符号链接。");
    if (child.isDirectory()) await assertDirectoryTreeHasNoLinks(path);
  }
}

async function copyStudioProject(assetRoot: string, episodeId: string, sourceRelativePath: string, targetKind: "studio" | "studio-frozen"): Promise<StudioProjectSnapshot> {
  if (!isEpisodeId(episodeId)) throw new Error("无效的 Episode ID。");
  const isExpectedSource = targetKind === "studio" ? isReviewRenderProjectPath(episodeId, sourceRelativePath) : isStudioWorkspacePath(episodeId, sourceRelativePath, "studio");
  if (!isExpectedSource) throw new Error("HyperFrames 工程路径无效。");
  const root = await fs.realpath(assetRoot);
  if (isFilesystemRoot(root)) throw new Error("资产根不能是文件系统根目录。");
  const source = await fs.realpath(resolve(root, sourceRelativePath));
  if (!isDescendant(root, source) || basename(source) !== "index.html") throw new Error("HyperFrames 工程超出资产根。");
  const sourceDirectory = dirname(source);
  await assertDirectoryTreeHasNoLinks(sourceDirectory);

  const relativePath = `episodes/${episodeId}/${targetKind}/${randomUUID()}/index.html`;
  const targetDirectory = resolve(root, dirname(relativePath));
  const targetParent = await ensureDirectoryWithinRoot(root, dirname(targetDirectory));
  if (!isDescendant(root, targetDirectory) || targetParent !== dirname(targetDirectory)) throw new Error("HyperFrames 工程目标路径无效。");
  const projectPath = join(targetDirectory, "index.html");
  if (targetKind === "studio-frozen") {
    await fs.mkdir(targetDirectory);
    await fs.copyFile(source, projectPath);
  } else {
    await fs.cp(sourceDirectory, targetDirectory, { errorOnExist: true, force: false, recursive: true, verbatimSymlinks: true });
  }
  const content = await fs.readFile(projectPath);
  return { relativePath, sha256: createHash("sha256").update(content).digest("hex"), fileSize: content.byteLength };
}

export async function prepareHyperframesStudioWorkspace(assetRoot: string, episodeId: string, sourceRelativePath: string): Promise<StudioProjectSnapshot> {
  return copyStudioProject(assetRoot, episodeId, sourceRelativePath, "studio");
}

export async function freezeHyperframesStudioWorkspace(assetRoot: string, episodeId: string, workspaceRelativePath: string): Promise<StudioProjectSnapshot> {
  return copyStudioProject(assetRoot, episodeId, workspaceRelativePath, "studio-frozen");
}

async function availableLocalPort(): Promise<number> {
  const server = createTcpServer();
  await new Promise<void>((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePort);
  });
  const address = server.address();
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  if (!address || typeof address === "string") throw new Error("无法分配 HyperFrames Studio 端口。");
  return address.port;
}

export function hyperframesStudioPreviewArguments(workspaceRelativePath: string, port: number): string[] {
  return ["preview", workspaceRelativePath, `--port=${port}`, "--background", "--no-open"];
}

export function serveLocalArtifact(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined) {
  return async (request: IncomingMessage, response: ServerResponse, next: (error?: Error) => void): Promise<void> => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.statusCode = 405;
    response.end();
    return;
  }

  const url = new URL(request.url ?? "", "http://127.0.0.1");
  const episodeId = url.searchParams.get("episode") ?? "";
  const relativePath = url.searchParams.get("path") ?? "";
  const expectedSha256 = url.searchParams.get("sha256");
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    response.statusCode = 401;
    response.end("需要 Owner 登录会话。");
    return;
  }
  if (!episodeId || !isSafeRelativeArtifactPath(relativePath)) {
    response.statusCode = 400;
    response.end("无效的本地产物路径。");
    return;
  }

  try {
    const indexedArtifact = await indexedArtifactForPreview({ authorization, episodeId, expectedSha256: expectedSha256 ?? undefined, relativePath, supabasePublishableKey, supabaseUrl });
    if (!indexedArtifact || !isAbsolute(indexedArtifact.assetRoot)) {
      response.statusCode = 404;
      response.end("未找到可预览产物。");
      return;
    }
    if (expectedSha256 && (expectedSha256 !== indexedArtifact.sha256 || !/^[0-9a-f]{64}$/.test(expectedSha256))) {
      response.statusCode = 409;
      response.end("产物修订与索引不一致。");
      return;
    }
    const resolvedRoot = await fs.realpath(indexedArtifact.assetRoot);
    const resolvedArtifact = await fs.realpath(`${indexedArtifact.assetRoot}/${relativePath}`);
    if (!isDescendant(resolvedRoot, resolvedArtifact)) {
      response.statusCode = 403;
      response.end("产物路径超出账号资产目录。");
      return;
    }

    const artifact = await fs.stat(resolvedArtifact);
    if (!artifact.isFile()) {
      response.statusCode = 404;
      response.end("未找到可预览产物。");
      return;
    }
    if (expectedSha256) {
      const actualSha256 = createHash("sha256").update(await fs.readFile(resolvedArtifact)).digest("hex");
      if (actualSha256 !== expectedSha256) {
        response.statusCode = 409;
        response.end("产物内容与冻结修订不一致。");
        return;
      }
    }

    response.setHeader("Content-Type", mediaTypes[extname(resolvedArtifact).toLowerCase()] ?? "application/octet-stream");
    response.setHeader("Content-Length", artifact.size);
    if (request.method === "HEAD") {
      response.statusCode = 200;
      response.end();
      return;
    }
    createReadStream(resolvedArtifact).on("error", next).pipe(response);
  } catch {
    response.statusCode = 404;
    response.end("未找到可预览产物。");
  }
  };
}

export function serveLocalEpisodeDirectory(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") {
      response.statusCode = 405;
      response.end();
      return;
    }

    const url = new URL(request.url ?? "", "http://127.0.0.1");
    const episodeId = url.searchParams.get("episode") ?? "";
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      response.statusCode = 401;
      response.end("需要 Owner 登录会话。");
      return;
    }
    if (!isEpisodeId(episodeId)) {
      response.statusCode = 400;
      response.end("无效的 Episode ID。");
      return;
    }

    try {
      const assetRoot = await assetRootForOwnedEpisode({ authorization, episodeId, supabasePublishableKey, supabaseUrl });
      if (!assetRoot || !isAbsolute(assetRoot)) {
        response.statusCode = 404;
        response.end("未找到可创建目录的 Episode 资产根。");
        return;
      }

      await createLocalEpisodeDirectory(assetRoot, episodeId);

      response.statusCode = 201;
      response.end("本地 Episode 目录已准备就绪。");
    } catch {
      response.statusCode = 403;
      response.end("无法创建本地 Episode 目录。");
    }
  };
}

export function serveOpenLocalEpisodeDirectory(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") {
      response.statusCode = 405;
      response.end();
      return;
    }

    const url = new URL(request.url ?? "", "http://127.0.0.1");
    const episodeId = url.searchParams.get("episode") ?? "";
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      response.statusCode = 401;
      response.end("需要 Owner 登录会话。");
      return;
    }
    if (!isEpisodeId(episodeId)) {
      response.statusCode = 400;
      response.end("无效的 Episode ID。");
      return;
    }

    try {
      const assetRoot = await assetRootForOwnedEpisode({ authorization, episodeId, supabasePublishableKey, supabaseUrl });
      if (!assetRoot || !isAbsolute(assetRoot)) {
        response.statusCode = 404;
        response.end("未找到可打开的 Episode 资产根。");
        return;
      }

      const episodeDirectory = await createLocalEpisodeDirectory(assetRoot, episodeId);
      const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
      await execFileAsync(command, [episodeDirectory]);

      response.statusCode = 204;
      response.end();
    } catch {
      response.statusCode = 503;
      response.end("无法打开本地 Episode 目录，请使用页面显示的路径。");
    }
  };
}

export function serveOpenHyperframesStudio(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") { response.statusCode = 405; response.end(); return; }
    const authorization = request.headers.authorization;
    const episodeId = new URL(request.url ?? "", "http://127.0.0.1").searchParams.get("episode") ?? "";
    if (!authorization?.startsWith("Bearer ")) { response.statusCode = 401; response.end("需要 Owner 登录会话。"); return; }
    if (!isEpisodeId(episodeId)) { response.statusCode = 400; response.end("无效的 Episode ID。"); return; }
    try {
      const body = await readJsonBody(request);
      if (typeof body.projectRelativePath !== "string") throw new Error("缺少审核工程路径。");
      const assetRoot = await assetRootForOwnedEpisode({ authorization, episodeId, supabasePublishableKey, supabaseUrl });
      if (!assetRoot || !isAbsolute(assetRoot)) { response.statusCode = 404; response.end("未找到可编辑的审核工程。"); return; }
      const studioGate = await studioEntryGateForOwnedEpisode({ authorization, episodeId, projectRelativePath: body.projectRelativePath, supabasePublishableKey, supabaseUrl });
      if (!studioGate.allowed) { response.statusCode = 409; response.end(studioGate.message ?? "当前 Episode 尚未达到 Studio 进入条件。"); return; }
      const workspace = await prepareHyperframesStudioWorkspace(assetRoot, episodeId, body.projectRelativePath);
      const port = await availableLocalPort();
      await execFileAsync(join(process.cwd(), "node_modules", ".bin", "hyperframes"), hyperframesStudioPreviewArguments(dirname(join(assetRoot, workspace.relativePath)), port));
      response.setHeader("Content-Type", "application/json");
      response.statusCode = 201;
      response.end(JSON.stringify({ studioUrl: `http://127.0.0.1:${port}/`, workspace }));
    } catch (error) {
      response.statusCode = 400;
      response.end(error instanceof Error ? error.message : "无法打开 HyperFrames Studio。");
    }
  };
}

export function serveOpenPersonalHyperframesStudio(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") { response.statusCode = 405; response.end(); return; }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) { response.statusCode = 401; response.end("需要 Owner 登录会话。"); return; }
    if (!supabaseUrl || !supabasePublishableKey) { response.statusCode = 503; response.end("Supabase 本地客户端未配置。"); return; }
    const client = createClient(supabaseUrl, supabasePublishableKey, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
    const { data, error } = await client.auth.getUser(authorization.slice("Bearer ".length));
    if (error || !data.user) { response.statusCode = 401; response.end("Owner 登录会话无效。"); return; }
    try {
      const projectDirectory = resolve("content", "hyperframes-studio");
      await fs.access(join(projectDirectory, "index.html"));
      const port = await availableLocalPort();
      await execFileAsync(join(process.cwd(), "node_modules", ".bin", "hyperframes"), hyperframesStudioPreviewArguments(projectDirectory, port));
      response.setHeader("Content-Type", "application/json");
      response.statusCode = 201;
      response.end(JSON.stringify({ studioUrl: `http://127.0.0.1:${port}/#project/${encodeURIComponent(basename(projectDirectory))}` }));
    } catch (cause) {
      response.statusCode = 503;
      response.end(cause instanceof Error ? cause.message : "无法打开个人 HyperFrames Studio 工程。");
    }
  };
}

export function serveFreezeHyperframesStudio(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") { response.statusCode = 405; response.end(); return; }
    const authorization = request.headers.authorization;
    const episodeId = new URL(request.url ?? "", "http://127.0.0.1").searchParams.get("episode") ?? "";
    if (!authorization?.startsWith("Bearer ")) { response.statusCode = 401; response.end("需要 Owner 登录会话。"); return; }
    if (!isEpisodeId(episodeId)) { response.statusCode = 400; response.end("无效的 Episode ID。"); return; }
    try {
      const body = await readJsonBody(request);
      if (typeof body.workspaceRelativePath !== "string" || typeof body.sourceProjectRelativePath !== "string") throw new Error("缺少 Studio 工作区路径。");
      const assetRoot = await assetRootForOwnedEpisode({ authorization, episodeId, supabasePublishableKey, supabaseUrl });
      if (!assetRoot || !isAbsolute(assetRoot)) { response.statusCode = 404; response.end("未找到可冻结的 Studio 工程。"); return; }
      const studioGate = await studioEntryGateForOwnedEpisode({ authorization, episodeId, projectRelativePath: body.sourceProjectRelativePath, supabasePublishableKey, supabaseUrl });
      if (!studioGate.allowed) { response.statusCode = 409; response.end(studioGate.message ?? "当前 Episode 尚未达到 Studio 提交条件。"); return; }
      await validateStudioMarkerWorkspace(assetRoot, episodeId, body.sourceProjectRelativePath, body.workspaceRelativePath);
      const frozenProject = await freezeHyperframesStudioWorkspace(assetRoot, episodeId, body.workspaceRelativePath);
      response.setHeader("Content-Type", "application/json");
      response.statusCode = 201;
      response.end(JSON.stringify({ frozenProject }));
    } catch (error) {
      response.statusCode = 400;
      response.end(error instanceof Error ? error.message : "无法冻结 HyperFrames Studio 工程。");
    }
  };
}

export function serveChooseLocalAssetDirectory(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") { response.statusCode = 405; response.end(); return; }
    const url = new URL(request.url ?? "", "http://127.0.0.1");
    const accountId = url.searchParams.get("account") ?? "";
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) { response.statusCode = 401; response.end("需要 Owner 登录会话。"); return; }
    if (!isUuid(accountId)) { response.statusCode = 400; response.end("无效的账号 ID。"); return; }
    if (!await accountIsOwned({ accountId, authorization, supabasePublishableKey, supabaseUrl })) { response.statusCode = 403; response.end("没有该账号的 Owner 权限。"); return; }
    if (process.platform !== "darwin") { response.statusCode = 501; response.end("当前本机不支持目录选择器，请直接填写路径。"); return; }
    try {
      const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", "POSIX path of (choose folder with prompt \"选择账号资产目录\")"]);
      const assetRoot = stdout.trim();
      if (!isAbsolute(assetRoot)) throw new Error("无效目录");
      response.setHeader("Content-Type", "application/json");
      response.statusCode = 200;
      response.end(JSON.stringify({ assetRoot }));
    } catch {
      response.statusCode = 503;
      response.end("未选择本地文件夹。");
    }
  };
}

export function serveOpenLocalAssetDirectory(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") { response.statusCode = 405; response.end(); return; }
    const url = new URL(request.url ?? "", "http://127.0.0.1");
    const accountId = url.searchParams.get("account") ?? "";
    const assetRoot = url.searchParams.get("path")?.trim() ?? "";
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) { response.statusCode = 401; response.end("需要 Owner 登录会话。"); return; }
    if (!isUuid(accountId) || !isAbsolute(assetRoot)) { response.statusCode = 400; response.end("无效的账号或本地目录路径。"); return; }
    if (!await accountIsOwned({ accountId, authorization, supabasePublishableKey, supabaseUrl })) { response.statusCode = 403; response.end("没有该账号的 Owner 权限。"); return; }
    try {
      if (!(await fs.stat(assetRoot)).isDirectory()) throw new Error("不是目录");
      const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
      await execFileAsync(command, [assetRoot]);
      response.statusCode = 204;
      response.end();
    } catch {
      response.statusCode = 503;
      response.end("无法打开本地文件夹，请检查路径是否存在。");
    }
  };
}

export function serveOpenLocalArtifact(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") {
      response.statusCode = 405;
      response.end();
      return;
    }
    const url = new URL(request.url ?? "", "http://127.0.0.1");
    const episodeId = url.searchParams.get("episode") ?? "";
    const relativePath = url.searchParams.get("path") ?? "";
    const expectedSha256 = url.searchParams.get("sha256") ?? "";
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      response.statusCode = 401;
      response.end("需要 Owner 登录会话。");
      return;
    }
    if (!isEpisodeId(episodeId)) {
      response.statusCode = 400;
      response.end("无效的 Episode ID。");
      return;
    }
    if (!isSafeRelativeArtifactPath(relativePath)) {
      response.statusCode = 400;
      response.end("无效的本地产物路径。");
      return;
    }
    if (expectedSha256 && !/^[0-9a-f]{64}$/.test(expectedSha256)) {
      response.statusCode = 400;
      response.end("无效的产物修订哈希。");
      return;
    }

    try {
      const indexedArtifact = await indexedArtifactForPreview({ authorization, episodeId, expectedSha256: expectedSha256 || undefined, relativePath, supabasePublishableKey, supabaseUrl });
      if (!indexedArtifact || !isAbsolute(indexedArtifact.assetRoot)) {
        response.statusCode = 404;
        response.end("未找到可打开的本地产物。");
        return;
      }
      if (expectedSha256 && expectedSha256 !== indexedArtifact.sha256) {
        response.statusCode = 409;
        response.end("产物修订与索引不一致。");
        return;
      }
      const resolvedRoot = await fs.realpath(indexedArtifact.assetRoot);
      const resolvedArtifact = await fs.realpath(`${indexedArtifact.assetRoot}/${relativePath}`);
      if (!isDescendant(resolvedRoot, resolvedArtifact)) {
        response.statusCode = 403;
        response.end("产物路径超出账号资产目录。");
        return;
      }
      if (!(await fs.stat(resolvedArtifact)).isFile()) {
        response.statusCode = 404;
        response.end("未找到可打开的本地产物。");
        return;
      }
      if (expectedSha256 && createHash("sha256").update(await fs.readFile(resolvedArtifact)).digest("hex") !== expectedSha256) {
        response.statusCode = 409;
        response.end("产物内容与冻结修订不一致。");
        return;
      }
      const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
      await execFileAsync(command, [resolvedArtifact]);
      response.statusCode = 204;
      response.end();
    } catch {
      response.statusCode = 503;
      response.end("无法打开本地产物，请检查本机文件关联设置。");
    }
  };
}

export function serveEpisodeDeletion(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined, supabaseServiceRoleKey?: string) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "DELETE") {
      response.statusCode = 405;
      response.end();
      return;
    }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      response.statusCode = 401;
      response.end("需要 Owner 登录会话。");
      return;
    }
    const episodeId = new URL(request.url ?? "", "http://127.0.0.1").searchParams.get("episode") ?? "";
    if (!isEpisodeId(episodeId)) {
      response.statusCode = 400;
      response.end("无效的 Episode ID。");
      return;
    }

    try {
      const body = await readJsonBody(request);
      if (typeof body.confirmation !== "string") throw new Error("缺少删除确认文本。");
      const context = await episodeDeletionContextForOwner({ authorization, episodeId, supabasePublishableKey, supabaseUrl });
      if (!context) {
        response.statusCode = 404;
        response.end("未找到可删除的 Episode。");
        return;
      }
      const expectedConfirmation = context.title.trim() || "DELETE";
      if (body.confirmation !== expectedConfirmation) {
        response.statusCode = 409;
        response.end("删除确认文本不匹配。");
        return;
      }
      if (!context.archivedAt) {
        response.statusCode = 409;
        response.end("请先归档 Episode，再执行永久删除。");
        return;
      }
      if (context.hasRunningTask || context.hasActiveAssetLock) {
        response.statusCode = 409;
        response.end("Episode 仍有运行中的 Worker 任务或资产锁，暂时不能删除。");
        return;
      }
      if (!supabaseUrl || !supabasePublishableKey || !supabaseServiceRoleKey) throw new Error("缺少本机 Supabase service role 配置，无法安全执行永久删除。");

      const local = await stageLocalEpisodeDirectoryForDeletion(context.assetRoot, episodeId);
      const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } });
      const { data: deletion, error } = await supabase.rpc("delete_episode", { p_actor_id: context.actorId, p_episode_id: episodeId });
      if (error) {
        try {
          if (local.existed) await restoreStagedLocalEpisodeDirectory(context.assetRoot, episodeId);
        } catch (restoreError) {
          response.statusCode = 500;
          response.end(`数据库记录删除失败，且本地目录恢复失败：${restoreError instanceof Error ? restoreError.message : "未知恢复错误"}`);
          return;
        }
        response.statusCode = 500;
        response.end(`数据库记录删除失败，本地 Episode 目录已恢复：${error.message}`);
        return;
      }
      let localRemoved = false;
      try {
        localRemoved = local.existed ? await finalizeStagedLocalEpisodeDirectory(context.assetRoot, episodeId) : false;
      } catch (cleanupError) {
        response.statusCode = 500;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          accountId: context.accountId,
          blueprintVersionId: context.blueprintVersionId,
          cleanupPending: true,
          episodeId,
          error: `数据库记录已删除，但本地删除暂存目录失败：${cleanupError instanceof Error ? cleanupError.message : "未知清理错误"}`,
          path: local.path,
        }));
        return;
      }

      response.setHeader("Content-Type", "application/json");
      response.statusCode = 200;
      response.end(JSON.stringify({ database: deletion, episodeId, local: { existed: local.existed, path: local.path, removed: localRemoved } }));
    } catch (error) {
      response.statusCode = 400;
      response.end(error instanceof Error ? error.message : "无法删除 Episode。");
    }
  };
}

export function serveEpisodeDeletionCleanup(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") {
      response.statusCode = 405;
      response.end();
      return;
    }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      response.statusCode = 401;
      response.end("需要 Owner 登录会话。");
      return;
    }
    try {
      const body = await readJsonBody(request);
      const episodeId = body.episodeId;
      const accountId = body.accountId;
      const blueprintVersionId = body.blueprintVersionId;
      if (typeof episodeId !== "string" || typeof accountId !== "string" || typeof blueprintVersionId !== "string" || !isEpisodeId(episodeId) || !isEpisodeId(accountId) || !isEpisodeId(blueprintVersionId)) throw new Error("删除暂存清理参数无效。");
      const assetRoot = await assetRootForOwnedAccountBlueprint({ authorization, accountId, blueprintVersionId, supabasePublishableKey, supabaseUrl });
      if (!assetRoot) {
        response.statusCode = 404;
        response.end("未找到可清理的账号资产目录。");
        return;
      }
      const removed = await finalizeStagedLocalEpisodeDirectory(assetRoot, episodeId);
      response.setHeader("Content-Type", "application/json");
      response.statusCode = 200;
      response.end(JSON.stringify({ episodeId, removed }));
    } catch (error) {
      response.statusCode = 400;
      response.end(error instanceof Error ? error.message : "无法清理删除暂存目录。");
    }
  };
}

async function ensureDirectoryWithinRoot(root: string, directory: string): Promise<string> {
  if (!isDescendant(root, directory)) throw new Error("目录超出资产根。");
  try {
    const existing = await fs.lstat(directory);
    if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error("目录不是安全目录。");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    try {
      await fs.mkdir(directory);
    } catch (mkdirError) {
      if (!(mkdirError instanceof Error && "code" in mkdirError && mkdirError.code === "EEXIST")) throw mkdirError;
    }
  }
  const resolvedDirectory = await fs.realpath(directory);
  if (!isDescendant(root, resolvedDirectory)) throw new Error("目录超出资产根。");
  return resolvedDirectory;
}

export async function createLocalEpisodeDirectory(assetRoot: string, episodeId: string): Promise<string> {
  const resolvedRoot = await fs.realpath(assetRoot);
  if (isFilesystemRoot(resolvedRoot)) throw new Error("资产根不能是文件系统根目录。");
  const resolvedEpisodesDirectory = await ensureDirectoryWithinRoot(resolvedRoot, resolve(resolvedRoot, "episodes"));
  const episodeDirectory = await ensureDirectoryWithinRoot(resolvedEpisodesDirectory, resolve(resolvedEpisodesDirectory, episodeId));
  await ensureDirectoryWithinRoot(episodeDirectory, resolve(episodeDirectory, "input"));
  await ensureDirectoryWithinRoot(episodeDirectory, resolve(episodeDirectory, "materials"));
  await ensureDirectoryWithinRoot(episodeDirectory, resolve(episodeDirectory, "captions"));
  return episodeDirectory;
}

export async function stageLocalEpisodeDirectoryForDeletion(assetRoot: string, episodeId: string): Promise<{ existed: boolean; path: string; stagingPath: string }> {
  if (!isEpisodeId(episodeId)) throw new Error("无效的 Episode ID。");
  const resolvedRoot = await fs.realpath(assetRoot);
  if (isFilesystemRoot(resolvedRoot)) throw new Error("资产根不能是文件系统根目录。");
  const episodesDirectory = resolve(resolvedRoot, "episodes");
  const episodeDirectory = resolve(episodesDirectory, episodeId);
  let episodesStat;
  try {
    episodesStat = await fs.lstat(episodesDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { existed: false, path: episodeDirectory, stagingPath: resolve(episodesDirectory, ".deletion-staging", episodeId) };
    throw error;
  }
  if (episodesStat.isSymbolicLink() || !episodesStat.isDirectory()) throw new Error("目录不是安全目录。");

  const stagingRoot = await ensureDirectoryWithinRoot(episodesDirectory, resolve(episodesDirectory, ".deletion-staging"));
  const stagingPath = resolve(stagingRoot, episodeId);
  let stagedStat;
  try {
    stagedStat = await fs.lstat(stagingPath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    stagedStat = null;
  }
  if (stagedStat && (stagedStat.isSymbolicLink() || !stagedStat.isDirectory())) throw new Error("删除暂存目录不是安全目录。");

  let episodeStat;
  try {
    episodeStat = await fs.lstat(episodeDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      if (stagedStat) return { existed: true, path: episodeDirectory, stagingPath };
      return { existed: false, path: episodeDirectory, stagingPath };
    }
    throw error;
  }
  if (episodeStat.isSymbolicLink() || !episodeStat.isDirectory()) throw new Error("目录不是安全目录。");
  if (stagedStat) throw new Error("Episode 已有待删除的暂存目录。");

  const resolvedEpisodeDirectory = await fs.realpath(episodeDirectory);
  if (!isDescendant(resolvedRoot, resolvedEpisodeDirectory)) throw new Error("目录超出资产根。");
  await fs.rename(resolvedEpisodeDirectory, stagingPath);
  return { existed: true, path: episodeDirectory, stagingPath };
}

export async function restoreStagedLocalEpisodeDirectory(assetRoot: string, episodeId: string): Promise<void> {
  if (!isEpisodeId(episodeId)) throw new Error("无效的 Episode ID。");
  const resolvedRoot = await fs.realpath(assetRoot);
  const episodesDirectory = resolve(resolvedRoot, "episodes");
  const episodeDirectory = resolve(episodesDirectory, episodeId);
  const stagingPath = resolve(episodesDirectory, ".deletion-staging", episodeId);
  const stagedDirectory = await fs.realpath(stagingPath);
  if (!isDescendant(resolvedRoot, stagedDirectory)) throw new Error("删除暂存目录超出资产根。");
  const existingEpisode = await fs.lstat(episodeDirectory).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  });
  if (existingEpisode) throw new Error("原 Episode 目录已存在，无法恢复删除暂存目录。");
  await fs.rename(stagedDirectory, episodeDirectory);
}

export async function finalizeStagedLocalEpisodeDirectory(assetRoot: string, episodeId: string): Promise<boolean> {
  if (!isEpisodeId(episodeId)) throw new Error("无效的 Episode ID。");
  const resolvedRoot = await fs.realpath(assetRoot);
  const stagingPath = resolve(resolvedRoot, "episodes", ".deletion-staging", episodeId);
  let stagedStat;
  try {
    stagedStat = await fs.lstat(stagingPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  if (stagedStat.isSymbolicLink() || !stagedStat.isDirectory()) throw new Error("删除暂存目录不是安全目录。");
  const resolvedStagingPath = await fs.realpath(stagingPath);
  if (!isDescendant(resolvedRoot, resolvedStagingPath)) throw new Error("删除暂存目录超出资产根。");
  await fs.rm(resolvedStagingPath, { force: false, recursive: true });
  return true;
}

interface MaterialSnapshotInput {
  sourceKind: "directory" | "file" | "paste";
  sourcePath: string;
  logicalName?: string;
  content?: Uint8Array;
}

interface MaterialSnapshot {
  sourcePath: string;
  storagePath: string;
  sha256: string;
  fileSize: number;
}

export async function saveProductionMaterialSnapshot(assetRoot: string, episodeId: string, input: MaterialSnapshotInput): Promise<MaterialSnapshot> {
  if (!isEpisodeId(episodeId)) throw new Error("无效的 Episode ID。");
  if (!isSafeRelativeArtifactPath(input.sourcePath)) throw new Error("输入文件路径无效。");
  if (input.logicalName && !isSafeRelativeArtifactPath(input.logicalName)) throw new Error("材料逻辑名称无效。");
  const episodeDirectory = await createLocalEpisodeDirectory(assetRoot, episodeId);
  let content: Uint8Array;
  if (input.sourceKind === "directory") {
    const inputDirectory = await fs.realpath(join(episodeDirectory, "input"));
    const sourceFile = await fs.realpath(resolve(inputDirectory, input.sourcePath));
    if (!isDescendant(inputDirectory, sourceFile)) throw new Error("输入文件路径无效。");
    const sourceStat = await fs.stat(sourceFile);
    if (!sourceStat.isFile()) throw new Error("输入路径不是文件。");
    content = await fs.readFile(sourceFile);
  } else {
    if (!input.content) throw new Error("文件选择或粘贴导入缺少内容。");
    content = input.content.slice();
  }
  if (content.byteLength > maxProductionMaterialBytes) throw new Error("生产材料超过 100 MB 上限。");

  const sha256 = createHash("sha256").update(content).digest("hex");
  const sourcePath = input.logicalName ?? input.sourcePath;
  const fileName = basename(sourcePath);
  const storagePath = `episodes/${episodeId}/materials/${sha256}-${fileName}`;
  const targetPath = join(assetRoot, storagePath);
  try {
    await fs.writeFile(targetPath, content, { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    const existingHash = createHash("sha256").update(await fs.readFile(targetPath)).digest("hex");
    if (existingHash !== sha256) throw new Error("已有材料快照与内容哈希不一致。");
  }
  return { sourcePath, storagePath, sha256, fileSize: content.byteLength };
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxEncodedMaterialRequestBytes) throw new Error("编码后的生产材料请求超过 140 MB 上限。");
    chunks.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("生产材料请求无效。");
  return parsed as Record<string, unknown>;
}

async function episodeDeletionContextForOwner(input: { authorization: string; episodeId: string; supabasePublishableKey: string | undefined; supabaseUrl: string | undefined }): Promise<{ accountId: string; actorId: string; archivedAt: string | null; assetRoot: string; blueprintVersionId: string; hasActiveAssetLock: boolean; hasRunningTask: boolean; title: string } | null> {
  if (!input.supabaseUrl || !input.supabasePublishableKey) return null;
  const accessToken = input.authorization.slice("Bearer ".length);
  const supabase = createClient(input.supabaseUrl, input.supabasePublishableKey, { auth: { persistSession: false }, global: { headers: { Authorization: input.authorization } } });
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) return null;

  const { data: episode, error: episodeError } = await supabase.from("episodes").select("account_id, archived_at, blueprint_version_id, title").eq("id", input.episodeId).maybeSingle();
  if (episodeError || !episode) return null;
  const { data: membership, error: membershipError } = await supabase.from("account_memberships").select("role").eq("account_id", episode.account_id).eq("user_id", userData.user.id).eq("role", "owner").maybeSingle();
  if (membershipError || !membership) return null;
  const [{ data: runningTasks, error: runningTasksError }, { data: activeLocks, error: activeLocksError }, { data: blueprint, error: blueprintError }] = await Promise.all([
    supabase.from("tasks").select("id").eq("episode_id", input.episodeId).eq("status", "running").limit(1),
    supabase.from("asset_locks").select("resource_key").eq("episode_id", input.episodeId).gt("expires_at", new Date().toISOString()).limit(1),
    supabase.from("account_blueprint_versions").select("policy").eq("id", episode.blueprint_version_id).maybeSingle(),
  ]);
  if (runningTasksError || activeLocksError || blueprintError || !blueprint || !blueprint.policy || Array.isArray(blueprint.policy) || typeof blueprint.policy !== "object") return null;
  const assetRoot = blueprint.policy.asset_root;
  if (typeof assetRoot !== "string" || !assetRoot.trim()) return null;
  return {
    accountId: episode.account_id,
    actorId: userData.user.id,
    archivedAt: typeof episode.archived_at === "string" ? episode.archived_at : null,
    assetRoot: assetRoot.trim(),
    blueprintVersionId: episode.blueprint_version_id,
    hasActiveAssetLock: Boolean(activeLocks?.length),
    hasRunningTask: Boolean(runningTasks?.length),
    title: episode.title,
  };
}

async function assetRootForOwnedAccountBlueprint(input: { accountId: string; authorization: string; blueprintVersionId: string; supabasePublishableKey: string | undefined; supabaseUrl: string | undefined }): Promise<string | null> {
  if (!input.supabaseUrl || !input.supabasePublishableKey) return null;
  const accessToken = input.authorization.slice("Bearer ".length);
  const supabase = createClient(input.supabaseUrl, input.supabasePublishableKey, { auth: { persistSession: false }, global: { headers: { Authorization: input.authorization } } });
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) return null;
  const { data: membership, error: membershipError } = await supabase.from("account_memberships").select("role").eq("account_id", input.accountId).eq("user_id", userData.user.id).eq("role", "owner").maybeSingle();
  if (membershipError || !membership) return null;
  const { data: blueprint, error: blueprintError } = await supabase.from("account_blueprint_versions").select("policy").eq("account_id", input.accountId).eq("id", input.blueprintVersionId).maybeSingle();
  if (blueprintError || !blueprint || !blueprint.policy || Array.isArray(blueprint.policy) || typeof blueprint.policy !== "object") return null;
  const assetRoot = blueprint.policy.asset_root;
  return typeof assetRoot === "string" && assetRoot.trim() ? assetRoot.trim() : null;
}

function localWorkerServiceRoleKey(): string | undefined {
  try {
    const workerEnv = readFileSync(resolve("n8n", "worker.env.local"), "utf8");
    return workerEnv.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function localWorkerEnvironmentValue(name: string): string | undefined {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess) return fromProcess.replace(/^['"]|['"]$/g, "");
  try {
    const workerEnv = readFileSync(resolve("n8n", "worker.env.local"), "utf8");
    const value = workerEnv.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
    return value?.replace(/^['"]|['"]$/g, "") || undefined;
  } catch {
    return undefined;
  }
}

async function latestModifiedAt(paths: string[]): Promise<string | null> {
  const entries = await Promise.all(paths.map(async (path) => {
    try {
      return (await fs.stat(path)).mtime.toISOString();
    } catch {
      return null;
    }
  }));
  return entries.filter((entry): entry is string => Boolean(entry)).sort().at(-1) ?? null;
}

async function dependencyStatus(name: string, command: string, args: string[]): Promise<{ detail: string; name: string; state: "healthy" | "offline" }> {
  try {
    const result = await execFileAsync(command, args);
    return { detail: result.stdout.split("\n")[0] || "可调用", name, state: "healthy" };
  } catch (error) {
    return { detail: error instanceof Error ? error.message : "无法调用", name, state: "offline" };
  }
}

async function n8nHealth(port: string): Promise<boolean> {
  if (!/^\d+$/.test(port)) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function runProbeCommand(command: string, argumentsList: string[], timeoutMs?: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, argumentsList, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = timeoutMs ? setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs) : undefined;
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", (error) => { if (timeout) clearTimeout(timeout); rejectCommand(error); });
    child.once("close", (code) => {
      if (timeout) clearTimeout(timeout);
      if (code === 0) resolveCommand({ stdout, stderr });
      else if (timedOut) rejectCommand(new Error(`${command} 执行超时。`));
      else rejectCommand(new Error(stderr.trim() || `${command} exited with status ${code ?? "unknown"}.`));
    });
  });
}

export function serveSystemStatus(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "GET") {
      response.statusCode = 405;
      response.end();
      return;
    }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      response.statusCode = 401;
      response.end("需要 Owner 登录会话。");
      return;
    }
    if (!supabaseUrl || !supabasePublishableKey) {
      response.statusCode = 503;
      response.end("Supabase 本地客户端未配置。");
      return;
    }
    try {
      const accessToken = authorization.slice("Bearer ".length);
      const client = createClient(supabaseUrl, supabasePublishableKey, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
      const { data, error } = await client.auth.getUser(accessToken);
      if (error || !data.user) {
        response.statusCode = 401;
        response.end("Owner 登录会话无效。");
        return;
      }

      const runtimeDirectory = resolve("n8n", "runtime", ".n8n");
      const eventLogPaths = (await fs.readdir(runtimeDirectory).catch(() => [])).filter((entry) => entry.startsWith("n8nEventLog") && entry.endsWith(".log")).map((entry) => join(runtimeDirectory, entry));
      const lastEventAt = await latestModifiedAt(eventLogPaths);
      const runtimeExists = await fs.stat(runtimeDirectory).then((stats) => stats.isDirectory()).catch(() => false);
      const n8nPort = localWorkerEnvironmentValue("N8N_PORT") ?? "5678";
      const n8nRunning = await n8nHealth(n8nPort);
      const mediaRoot = localWorkerEnvironmentValue("MEDIA_LIBRARY_MOUNT_PATH");
      const mediaExists = mediaRoot ? await fs.stat(mediaRoot).then((stats) => stats.isDirectory()).catch(() => false) : false;
      const dependencies = await Promise.all([
        dependencyStatus("Codex CLI", "codex", ["--version"]),
        dependencyStatus("ffmpeg", "ffmpeg", ["-version"]),
        dependencyStatus("HyperFrames", join(process.cwd(), "node_modules", ".bin", "hyperframes"), ["--version"]),
      ]);
      const report = {
        dependencies,
        mediaLibrary: { detail: mediaRoot ? (mediaExists ? `已挂载：${mediaRoot}` : `未找到挂载目录：${mediaRoot}`) : "未配置 MEDIA_LIBRARY_MOUNT_PATH。", state: mediaExists ? "healthy" : "offline" },
        n8n: { detail: n8nRunning ? `健康端点在线：127.0.0.1:${n8nPort}。` : runtimeExists ? `健康端点无响应：127.0.0.1:${n8nPort}；历史日志不代表当前在线。` : "未发现本地 n8n 运行时目录。", lastDispatchAt: null, lastEventAt, lastHealthCheckAt: n8nRunning ? new Date().toISOString() : null, lastRunAt: null, state: n8nRunning ? "healthy" : "offline" },
        observedAt: new Date().toISOString(),
      };
      response.setHeader("Content-Type", "application/json");
      response.statusCode = 200;
      response.end(JSON.stringify(report));
    } catch (error) {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : "无法读取系统状态。");
    }
  };
}

export function serveGoldenProductionTest(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") { response.statusCode = 405; response.end(); return; }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) { response.statusCode = 401; response.end("需要 Owner 登录会话。"); return; }
    if (!supabaseUrl || !supabasePublishableKey) { response.statusCode = 503; response.end("Supabase 本地客户端未配置。"); return; }
    const accessToken = authorization.slice("Bearer ".length);
    const client = createClient(supabaseUrl, supabasePublishableKey, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data.user) { response.statusCode = 401; response.end("Owner 登录会话无效。"); return; }
    try {
      const result = await runProbeCommand(join(process.cwd(), "n8n", "run-orchestrator.sh"), ["health"], 60_000);
      const payload = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as { passed?: unknown; checks?: Array<{ detail?: unknown; name?: unknown; passed?: unknown }> };
      const checks = Array.isArray(payload.checks) ? payload.checks.map((check) => ({ detail: typeof check.detail === "string" ? check.detail : check.passed === true ? "通过" : "未通过", name: typeof check.name === "string" ? check.name : "健康检查", passed: check.passed === true })) : [];
      response.setHeader("Content-Type", "application/json"); response.statusCode = 200;
      response.end(JSON.stringify({ checks, observedAt: new Date().toISOString(), passed: payload.passed === true }));
    } catch (cause) {
      response.setHeader("Content-Type", "application/json"); response.statusCode = 500;
      response.end(JSON.stringify({ error: cause instanceof Error ? cause.message : "黄金生产链测试失败。" }));
    }
  };
}

export function serveWorkerPreflight(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "GET" && request.method !== "POST") {
      response.statusCode = 405;
      response.end();
      return;
    }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      response.statusCode = 401;
      response.end("需要 Owner 登录会话。");
      return;
    }
    const episodeId = new URL(request.url ?? "", "http://127.0.0.1").searchParams.get("episode") ?? "";
    if (!isEpisodeId(episodeId)) {
      response.statusCode = 400;
      response.end("无效的 Episode ID。");
      return;
    }
    if (!supabaseUrl || !supabasePublishableKey) {
      response.statusCode = 503;
      response.end("Supabase 本地客户端未配置。");
      return;
    }
    try {
      const accessToken = authorization.slice("Bearer ".length);
      const client = createClient(supabaseUrl, supabasePublishableKey, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
      const { data: userData, error: userError } = await client.auth.getUser(accessToken);
      if (userError || !userData.user) {
        response.statusCode = 401;
        response.end("Owner 登录会话无效。");
        return;
      }

      const { data: episode, error: episodeError } = await client.from("episodes").select("account_id, blueprint_version_id, series_version_id").eq("id", episodeId).maybeSingle();
      if (episodeError) throw episodeError;
      if (!episode) {
        response.statusCode = 404;
        response.end("未找到当前 Episode。");
        return;
      }
      const { data: membership, error: membershipError } = await client.from("account_memberships").select("role").eq("account_id", episode.account_id).eq("user_id", userData.user.id).eq("role", "owner").maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) {
        response.statusCode = 403;
        response.end("Owner 权限不足。");
        return;
      }
      let seriesRules: unknown;
      if (episode.series_version_id) {
        const { data: seriesVersion, error: seriesVersionError } = await client.from("series_versions").select("rules").eq("id", episode.series_version_id).eq("account_id", episode.account_id).maybeSingle();
        if (seriesVersionError) throw seriesVersionError;
        seriesRules = seriesVersion?.rules;
      }
      const { data: blueprint, error: blueprintError } = await client.from("account_blueprint_versions").select("policy").eq("id", episode.blueprint_version_id).eq("account_id", episode.account_id).maybeSingle();
      if (blueprintError) throw blueprintError;
      if (!blueprint) {
        response.statusCode = 404;
        response.end("未找到当前 Episode 的蓝图快照。");
        return;
      }

      const { data: tasks, error: tasksError } = await client.from("tasks").select("task_type, provider, status, input_snapshot").eq("episode_id", episodeId);
      if (tasksError) throw tasksError;
      const report = await runtimePreflightForPolicy(blueprint.policy, seriesRules, requiredMediaCapabilitiesFromTasks(tasks), true, episode.account_id);
      if (request.method === "POST") {
        response.setHeader("Content-Type", "application/json");
        if (report.checks.some((check) => check.status !== "passed")) {
          response.statusCode = 409;
          response.end(JSON.stringify({ preflight: report }));
          return;
        }
        const workerServiceRoleKey = localWorkerServiceRoleKey();
        if (!workerServiceRoleKey) {
          response.statusCode = 503;
          response.end(JSON.stringify({ error: "本地 Worker 服务角色密钥未配置，无法记录运行态检查。", preflight: report }));
          return;
        }
        const adminClient = createClient(supabaseUrl, workerServiceRoleKey, { auth: { persistSession: false } });
        const { error: recordPreflightError } = await adminClient.rpc("record_episode_worker_preflight", { p_episode_id: episodeId, p_owner_id: userData.user.id });
        if (recordPreflightError) {
          response.statusCode = 503;
          response.end(JSON.stringify({ error: recordPreflightError.message, preflight: report }));
          return;
        }
        const { data: startedEpisode, error: startError } = await client.rpc("start_episode_production", { p_episode_id: episodeId });
        if (startError) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: startError.message, preflight: report }));
          return;
        }
        response.statusCode = 200;
        response.end(JSON.stringify({ episode: startedEpisode, preflight: report }));
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.statusCode = 200;
      response.end(JSON.stringify(report));
    } catch (error) {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : "无法读取 Worker 运行态检查。");
    }
  };
}

export function serveEpisodePreflight(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") {
      response.statusCode = 405;
      response.end();
      return;
    }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      response.statusCode = 401;
      response.end("需要 Owner 登录会话。");
      return;
    }
    if (!supabaseUrl || !supabasePublishableKey) {
      response.statusCode = 503;
      response.end("Supabase 本地客户端未配置。");
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch {
      response.statusCode = 400;
      response.end("创建前检查参数无效。");
      return;
    }
    const accountId = typeof body.accountId === "string" ? body.accountId : "";
    const blueprintVersionId = typeof body.blueprintVersionId === "string" ? body.blueprintVersionId : "";
    const episodeIdValue = body.episodeId;
    const episodeId = episodeIdValue === undefined ? null : typeof episodeIdValue === "string" ? episodeIdValue : "";
    const policy = body.policy;
    const seriesVersionValue = body.seriesVersionId;
    const seriesVersionId = seriesVersionValue === null || seriesVersionValue === undefined ? null : typeof seriesVersionValue === "string" ? seriesVersionValue : "";
    if (!isUuid(accountId) || !isUuid(blueprintVersionId) || (episodeId !== null && !isUuid(episodeId)) || (seriesVersionId !== null && !isUuid(seriesVersionId)) || (policy !== undefined && (!policy || Array.isArray(policy) || typeof policy !== "object"))) {
      response.statusCode = 400;
      response.end("创建前检查参数无效。");
      return;
    }

    try {
      const accessToken = authorization.slice("Bearer ".length);
      const client = createClient(supabaseUrl, supabasePublishableKey, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
      const { data: userData, error: userError } = await client.auth.getUser(accessToken);
      if (userError || !userData.user) {
        response.statusCode = 401;
        response.end("Owner 登录会话无效。");
        return;
      }

      const { data: membership, error: membershipError } = await client.from("account_memberships").select("role").eq("account_id", accountId).eq("user_id", userData.user.id).eq("role", "owner").maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) {
        response.statusCode = 403;
        response.end("Owner 权限不足。");
        return;
      }
      const { data: account, error: accountError } = await client.from("accounts").select("current_blueprint_version_id").eq("id", accountId).maybeSingle();
      if (accountError) throw accountError;
      if (!account) {
        response.statusCode = 404;
        response.end("未找到当前账号。");
        return;
      }
      if (account.current_blueprint_version_id !== blueprintVersionId) {
        response.statusCode = 409;
        response.end("所选蓝图已不是当前激活版本，请刷新后重试。");
        return;
      }

      let episodeSeriesVersionId = seriesVersionId;
      if (episodeId) {
        const { data: episode, error: episodeError } = await client.from("episodes").select("account_id, series_version_id").eq("id", episodeId).maybeSingle();
        if (episodeError) throw episodeError;
        if (!episode) {
          response.statusCode = 404;
          response.end("未找到当前生产单。");
          return;
        }
        if (episode.account_id !== accountId) {
          response.statusCode = 403;
          response.end("生产单不属于当前账号。");
          return;
        }
        episodeSeriesVersionId = episode.series_version_id;
      }

      const { data: blueprint, error: blueprintError } = await client.from("account_blueprint_versions").select("policy, is_active").eq("id", blueprintVersionId).eq("account_id", accountId).maybeSingle();
      if (blueprintError) throw blueprintError;
      if (!blueprint) {
        response.statusCode = 404;
        response.end("未找到当前账号蓝图。");
        return;
      }
      if (!blueprint.is_active) {
        response.statusCode = 409;
        response.end("所选蓝图已停用，请刷新后重试。");
        return;
      }

      let seriesRules: unknown;
      if (episodeSeriesVersionId) {
        const { data: seriesVersion, error: seriesVersionError } = await client.from("series_versions").select("rules").eq("id", episodeSeriesVersionId).eq("account_id", accountId).maybeSingle();
        if (seriesVersionError) throw seriesVersionError;
        if (!seriesVersion) {
          response.statusCode = 400;
          response.end(episodeId ? "当前生产单的系列版本不属于当前账号。" : "所选系列版本不属于当前账号。");
          return;
        }
        seriesRules = seriesVersion.rules;
      }

      let requiredMediaCapabilities: string[] | undefined;
      if (episodeId) {
        const { data: tasks, error: tasksError } = await client.from("tasks").select("task_type, provider, status, input_snapshot").eq("episode_id", episodeId);
        if (tasksError) throw tasksError;
        requiredMediaCapabilities = requiredMediaCapabilitiesFromTasks(tasks);
      }
      const report = await runtimePreflightForPolicy(policy ?? blueprint.policy, seriesRules, requiredMediaCapabilities, Boolean(episodeId), accountId);
      response.setHeader("Content-Type", "application/json");
      if (report.checks.some((check) => check.status !== "passed")) {
        response.statusCode = 409;
        response.end(JSON.stringify({ error: episodeId ? "修复前真实运行态检查未通过，当前生产单仍保持阻塞。" : "生产前可生产性检查未通过，尚未创建生产单。", preflight: report }));
        return;
      }
      response.statusCode = 200;
      response.end(JSON.stringify({ preflight: report }));
    } catch (error) {
      response.setHeader("Content-Type", "application/json");
      if (isTransientPreflightError(error)) {
        response.statusCode = 503;
        response.end(JSON.stringify({ error: "生产前检查暂时失败，请重试。", preflight: retryablePreflight(error) }));
        return;
      }
      response.statusCode = 500;
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "无法完成生产前检查。" }));
    }
  };
}

export function serveExternalConnectionTest(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined, serviceRoleKey = localWorkerServiceRoleKey()) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") {
      response.statusCode = 405;
      response.end();
      return;
    }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      response.statusCode = 401;
      response.end("需要 Owner 登录会话。");
      return;
    }
    if (!supabaseUrl || !supabasePublishableKey || !serviceRoleKey) {
      response.statusCode = 503;
      response.end("连接测试 Worker 未配置。");
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch {
      response.statusCode = 400;
      response.end("连接测试请求无效。");
      return;
    }
    const connectionId = typeof body.connectionId === "string" ? body.connectionId : "";
    if (!isUuid(connectionId)) {
      response.statusCode = 400;
      response.end("连接 ID 无效。");
      return;
    }

    try {
      const accessToken = authorization.slice("Bearer ".length);
      const ownerClient = createClient(supabaseUrl, supabasePublishableKey, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
      const { data: userData, error: userError } = await ownerClient.auth.getUser(accessToken);
      if (userError || !userData.user) {
        response.statusCode = 401;
        response.end("Owner 登录会话无效。");
        return;
      }
      const { data: connection, error: connectionError } = await ownerClient.from("external_connections").select("id, provider, adapter, name, status, last_verification_detail, last_verified_at, created_by, created_at, current_version_id").eq("id", connectionId).eq("created_by", userData.user.id).maybeSingle();
      if (connectionError) throw connectionError;
      if (!connection) {
        response.statusCode = 404;
        response.end("未找到可测试的外部连接。");
        return;
      }

      const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
      const { data: secret, error: secretError } = await serviceClient.rpc("resolve_external_connection_secret", { p_connection_id: connection.current_version_id });
      if (secretError) throw secretError;
      const probe = typeof secret === "string" && secret.trim()
        ? await probeProviderConnection(connection.provider, secret.trim(), fetch)
        : { connection: { available: false, status: "unavailable" as const, detail: "连接秘密不可用。" } };
      const status = probe.credentialValidity?.status === "unavailable" ? "invalid" : !probe.connection.available ? (probe.connection.status === "retryable" ? "retryable" : "invalid") : "verified";
      const detail = redactConnectionSecret(probe.credentialValidity?.detail ?? probe.connection.detail, typeof secret === "string" ? secret : "");
      const { data: updatedConnection, error: recordError } = await serviceClient.rpc("record_external_connection_verification", { p_connection_id: connection.current_version_id, p_status: status, p_detail: detail });
      if (recordError) throw recordError;
      response.setHeader("Content-Type", "application/json");
      response.statusCode = 200;
      response.end(JSON.stringify({ connection: updatedConnection ?? { ...connection, status, last_verification_detail: detail }, verification: { status, detail } }));
    } catch (error) {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : "无法完成连接测试。");
    }
  };
}

export function servePublishPreparation(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined, serviceRoleKey = localWorkerServiceRoleKey()) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") { response.statusCode = 405; response.end(); return; }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) { response.statusCode = 401; response.end("需要 Owner 登录会话。"); return; }
    if (!supabaseUrl || !supabasePublishableKey || !serviceRoleKey) { response.statusCode = 503; response.end("发布准备 Worker 未配置。"); return; }
    try {
      const body = await readJsonBody(request);
      const episodeId = typeof body.episodeId === "string" ? body.episodeId : "";
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim() : "";
      const tags = Array.isArray(body.tags) ? body.tags.map((tag) => typeof tag === "string" ? tag.trim() : "").filter(Boolean) : [];
      const coverBase64 = typeof body.coverBase64 === "string" ? body.coverBase64 : "";
      if (!isEpisodeId(episodeId) || !title || title.length > 200 || description.length > 5000 || tags.length > 20 || tags.some((tag) => tag.length > 50)) throw new Error("发布标题、简介或标签无效。");
      if (!coverBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(coverBase64)) throw new Error("请选择有效的封面。");
      const cover = Buffer.from(coverBase64, "base64");
      const coverExtension = coverImageExtension(cover);
      if (cover.byteLength > 20 * 1024 * 1024 || !coverExtension) throw new Error("封面必须是 20 MB 以内的 JPG、PNG 或 WebP 文件。");
      const assetRoot = await assetRootForOwnedEpisode({ authorization, episodeId, supabasePublishableKey, supabaseUrl });
      if (!assetRoot) { response.statusCode = 403; response.end("没有该生产单的 Owner 权限。"); return; }
      const mediaLibraryMountPath = localWorkerEnvironmentValue("MEDIA_LIBRARY_MOUNT_PATH");
      const minimumFreeBytes = Number(localWorkerEnvironmentValue("MEDIA_LIBRARY_MIN_FREE_BYTES"));
      if (!mediaLibraryMountPath || !Number.isSafeInteger(minimumFreeBytes) || minimumFreeBytes < 0) throw new Error("本机媒体库配置无效。");
      const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
      const context = await loadPublishContext({ allowedStages: ["qc_passed"], episodeId, mediaLibraryMountPath, mediaLibraryMinimumFreeBytes: minimumFreeBytes, supabase: serviceClient });
      if (context.artifacts.some((artifact) => artifact.artifactType === "publish_package")) throw new Error("发布包已经固定，不能覆盖发布输入。");
      const coverPath = coverInputPath(episodeId, coverExtension);
      const metadataPath = `episodes/${episodeId}/publish-input/metadata-v1.json`;
      const metadata = Buffer.from(`${JSON.stringify({ title, description, tags }, null, 2)}\n`);
      const publishInputs = [{ artifactType: "cover", relativePath: coverPath, bytes: cover }, { artifactType: "metadata", relativePath: metadataPath, bytes: metadata }];
      for (const artifact of publishInputs) {
        const existing = context.artifacts.find((candidate) => candidate.artifactType === artifact.artifactType);
        const sha256 = createHash("sha256").update(artifact.bytes).digest("hex");
        if (existing && (existing.relativePath !== artifact.relativePath || existing.sha256 !== sha256 || existing.fileSize !== artifact.bytes.byteLength)) throw new Error(`${artifact.artifactType === "cover" ? "封面" : "发布元数据"}已经固定，不能覆盖。`);
      }
      for (const artifact of publishInputs) {
        await writeSafeAssetFile(assetRoot, artifact.relativePath, artifact.bytes);
        const { error } = await serviceClient.rpc("record_publish_input", { p_episode_id: episodeId, p_artifact_type: artifact.artifactType, p_relative_path: artifact.relativePath, p_sha256: createHash("sha256").update(artifact.bytes).digest("hex"), p_file_size: artifact.bytes.byteLength });
        if (error) throw new Error(`无法登记${artifact.artifactType === "cover" ? "封面" : "发布元数据"}：${error.message}`);
      }
      const registered = await loadPublishContext({ allowedStages: ["qc_passed"], episodeId, mediaLibraryMountPath, mediaLibraryMinimumFreeBytes: minimumFreeBytes, supabase: serviceClient });
      const publishPackage = await createPublishPackage({ assetRoot, episodeId, artifacts: registered.artifacts });
      const { error: packageError } = await serviceClient.rpc("record_publish_package", { p_episode_id: episodeId, p_relative_path: publishPackage.relativePath, p_sha256: publishPackage.sha256, p_file_size: publishPackage.fileSize });
      if (packageError) throw new Error(`无法登记发布包：${packageError.message}`);
      await verifyPublishPackage({ assetRoot, episodeId, publishPackage });
      const { error: verificationError } = await serviceClient.rpc("record_publish_package_verification", { p_episode_id: episodeId, p_sha256: publishPackage.sha256, p_file_size: publishPackage.fileSize });
      if (verificationError) throw new Error(`无法登记发布包校验：${verificationError.message}`);
      response.setHeader("Content-Type", "application/json");
      response.statusCode = 201;
      response.end(JSON.stringify({ episodeId, publishPackage, status: "verified" }));
    } catch (error) {
      response.statusCode = 400;
      response.end(error instanceof Error ? error.message : "无法准备发布包。");
    }
  };
}

function redactConnectionSecret(detail: string, secret: string): string {
  return secret ? detail.split(secret).join("[已隐藏]") : detail;
}

export async function runtimePreflightForPolicy(policy: unknown, seriesRules: unknown, requiredMediaCapabilities?: readonly string[], hasExistingEpisode = false, accountId?: string) {
  const capabilities = runtimeCapabilitiesFromBlueprintPolicy(policy, seriesRules, requiredMediaCapabilities);
  const commandNames = [...new Set(capabilities.map((capability) => capability.command).filter((command): command is string => Boolean(command)))];
  const credentialNames = [...new Set(capabilities.map((capability) => capability.credential).filter((credential): credential is string => Boolean(credential)))];
  const credentials = Object.fromEntries(credentialNames.map((credential) => [credential, Boolean(localWorkerEnvironmentValue(credential))]));
  const referenceCapabilities = capabilities.filter((capability) => capability.credentialRef);
  const referenceEntriesPromise = Promise.all(referenceCapabilities.map(async (capability) => [capability.credentialRef!, await localWorkerSecretForCapability(capability, accountId)] as const));
  const commandEntriesPromise = Promise.all(commandNames.map(async (command) => [command, await dependencyStatus(command, command, runtimeCommandArguments(command))] as const));
  const providerEntriesPromise = Promise.all([...new Set(capabilities.filter((capability) => capability.credential || capability.credentialRef).map((capability) => capability.provider))].map(async (provider) => {
    const capability = capabilities.find((candidate) => candidate.provider === provider);
    const credential = capability?.credential;
    const apiKey = capability?.credentialRef && isUuid(capability.credentialRef)
      ? await localWorkerSecretForCapability(capability, accountId)
      : capability?.credential ? localWorkerEnvironmentValue(capability.credential) : undefined;
    if (!apiKey) return null;
    return { provider, credential: credential ?? capability?.credentialRef, probe: await probeProviderConnection(provider, apiKey) };
  }));
  const assetRootPromise = workerMediaLibraryStatus(policy, hasExistingEpisode);
  const commandEntries = await commandEntriesPromise;
  const commands = Object.fromEntries(commandEntries.map(([command, status]) => [command, { available: status.state === "healthy", detail: status.detail }]));
  const localAdapters = localAdapterReadinessFromCommands(capabilities, commands);
  const modelEntries = await Promise.all([...new Set(capabilities.filter((capability) => capability.provider === "codex" && capability.model && commands.codex?.available).map((capability) => capability.model as string))].map(async (model) => {
    const probe = await probeCodexModel(model, (command, argumentsList, options) => runProbeCommand(command, argumentsList, options?.timeoutMs), tmpdir());
    return [model, probe] as const;
  }));
  const [providerEntries, referenceEntries, assetRoot] = await Promise.all([providerEntriesPromise, referenceEntriesPromise, assetRootPromise]);
  const modelPermissions = Object.fromEntries(modelEntries.map(([model, probe]) => [model, probe.modelPermission]));
  const connections = Object.fromEntries(providerEntries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)).map((entry) => [entry.provider, entry.probe.connection]));
  const credentialValidity = Object.fromEntries(providerEntries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry?.probe.credentialValidity)).map((entry) => [entry.credential, entry.probe.credentialValidity]));
  const connectionReferences = Object.fromEntries(referenceEntries.map(([reference, secret]) => [reference, secret ? { available: true, detail: "外部连接引用已解析。" } : { available: false, detail: "外部连接引用不存在或尚未验证。" }]));
  return createRuntimePreflight(capabilities, {
    commands,
    ...(Object.keys(localAdapters).length ? { localAdapters } : {}),
    credentials: { ...credentials, ...Object.fromEntries(referenceEntries.map(([reference, secret]) => [reference, Boolean(secret)])) },
    ...(Object.keys(connectionReferences).length ? { connectionReferences } : {}),
    ...(Object.keys(modelPermissions).length ? { modelPermissions } : {}),
    ...(Object.keys(connections).length ? { connections } : {}),
    ...(Object.keys(credentialValidity).length ? { credentialValidity } : {}),
    ...(hasExistingEpisode ? { assetRoot } : { mediaLibrary: assetRoot }),
  });
}

async function localWorkerSecretForCapability(capability: { credential?: string; credentialRef?: string; provider: string }, accountId?: string): Promise<string | undefined> {
  const reference = capability.credentialRef;
  if (reference && isUuid(reference)) {
    if (!accountId) return undefined;
    const key = localWorkerServiceRoleKey();
    const url = localWorkerEnvironmentValue("SUPABASE_URL") ?? process.env.VITE_SUPABASE_URL;
    if (!key || !url) return undefined;
    const client = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await client.rpc("resolve_external_connection_secret", { p_account_id: accountId, p_connection_id: reference });
    if (error || typeof data !== "string") return undefined;
    return data.trim() || undefined;
  }
  if (capability.provider === "pexels") return undefined;
  return capability.credential ? localWorkerEnvironmentValue(capability.credential) : undefined;
}

function isTransientPreflightError(error: unknown): boolean {
  const detail = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /fetch failed|network|timeout|timed out|econnreset|econnrefused|etimedout|502|503|504/.test(detail);
}

function retryablePreflight(error: unknown) {
  return {
    version: workerPreflightVersion,
    checks: [{ capability: "worker_runtime", check: "connection", phase: "preflight" as const, status: "retryable" as const, reason: error instanceof Error ? error.message : "Worker 或 Supabase 连接暂时失败。", action: "retry" as const, scope: "worker" as const }],
  };
}

async function workerMediaLibraryStatus(policy: unknown, requireEpisodesDirectory = false): Promise<{ available: boolean; detail: string } | undefined> {
  const assetRoot = policy && typeof policy === "object" && !Array.isArray(policy) && typeof (policy as Record<string, unknown>).asset_root === "string" ? ((policy as Record<string, unknown>).asset_root as string).trim() : "";
  if (!assetRoot) return { available: false, detail: "蓝图未配置 asset_root。" };
  if (!isAbsolute(assetRoot)) return { available: false, detail: "蓝图 asset_root 必须使用绝对路径。" };
  const mountPath = localWorkerEnvironmentValue("MEDIA_LIBRARY_MOUNT_PATH");
  if (!mountPath) return { available: false, detail: "未配置 MEDIA_LIBRARY_MOUNT_PATH。" };
  const minimumFreeBytesValue = localWorkerEnvironmentValue("MEDIA_LIBRARY_MIN_FREE_BYTES");
  if (!minimumFreeBytesValue || !/^\d+$/.test(minimumFreeBytesValue) || !Number.isSafeInteger(Number(minimumFreeBytesValue))) return { available: false, detail: "MEDIA_LIBRARY_MIN_FREE_BYTES 未配置为非负整数。" };
  try {
    const status = await verifyMediaLibrary({ assetRoot, mountPath, minimumFreeBytes: Number(minimumFreeBytesValue), requireEpisodesDirectory });
    return { available: true, detail: `媒体库已验证：${status.mountPath}，可用空间 ${status.availableBytes} 字节。` };
  } catch (error) {
    return { available: false, detail: error instanceof Error ? error.message : "媒体库无法通过运行态检查。" };
  }
}

export function serveProductionMaterial(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") {
      response.statusCode = 405;
      response.end();
      return;
    }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      response.statusCode = 401;
      response.end("需要 Owner 登录会话。");
      return;
    }
    const episodeId = new URL(request.url ?? "", "http://127.0.0.1").searchParams.get("episode") ?? "";
    if (!isEpisodeId(episodeId)) {
      response.statusCode = 400;
      response.end("无效的 Episode ID。");
      return;
    }
    try {
      const assetRoot = await assetRootForOwnedEpisode({ authorization, episodeId, supabasePublishableKey, supabaseUrl });
      if (!assetRoot || !isAbsolute(assetRoot)) throw new Error("未找到可写入的 Episode 资产根。");
      const body = await readJsonBody(request);
      const sourceKind = body.sourceKind;
      const sourcePath = body.sourcePath;
      const logicalName = body.logicalName;
      const materialType = body.materialType;
      const materialPurpose = body.materialPurpose;
      const mimeType = body.mimeType;
      const isMainScript = body.isMainScript;
      const allowedMaterialPurposes = new Set(["main_script", "supplemental_script", "general_reference", "visual_reference", "a_roll", "b_roll", "narration", "background_music", "sound_effect", "cover"]);
      if ((sourceKind !== "directory" && sourceKind !== "file" && sourceKind !== "paste") || typeof sourcePath !== "string" || (logicalName !== undefined && typeof logicalName !== "string") || typeof materialType !== "string" || typeof materialPurpose !== "string" || !allowedMaterialPurposes.has(materialPurpose) || typeof mimeType !== "string" || typeof isMainScript !== "boolean") {
        throw new Error("生产材料元数据无效。");
      }
      if ((materialPurpose === "a_roll" || materialPurpose === "b_roll") && !isSupportedManualARollVideo(sourcePath, materialType, mimeType)) throw new Error("人工 A-roll/B-roll 仅支持 MP4、MOV 或 WebM 视频。");
      if ((materialPurpose === "narration" || materialPurpose === "background_music" || materialPurpose === "sound_effect") && !isSupportedManualAudio(sourcePath, materialType, mimeType)) throw new Error("人工旁白、配乐和音效仅支持常见音频文件。");
      let content: Uint8Array | undefined;
      if (sourceKind !== "directory") {
        if (typeof body.contentBase64 !== "string") throw new Error("生产材料内容无效。");
        content = Buffer.from(body.contentBase64, "base64");
      }
      if (materialPurpose === "cover" && (materialType !== "image" || !(mimeType === "application/octet-stream" || mimeType.toLowerCase().startsWith("image/")))) throw new Error("封面素材仅支持图片文件。");
      const snapshot = await saveProductionMaterialSnapshot(assetRoot, episodeId, { content, logicalName, sourceKind, sourcePath });
      if (!supabaseUrl || !supabasePublishableKey) throw new Error("Supabase 连接未配置。");
      const supabase = createClient(supabaseUrl, supabasePublishableKey, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
      const { data, error } = await supabase.rpc("import_production_material", {
        p_episode_id: episodeId,
        p_file_size: snapshot.fileSize,
        p_is_main_script: isMainScript,
        p_material_purpose: materialPurpose,
        p_material_type: materialType,
        p_mime_type: mimeType,
        p_sha256: snapshot.sha256,
        p_source_kind: sourceKind,
        p_source_path: snapshot.sourcePath,
        p_storage_path: snapshot.storagePath,
      });
      if (error) throw error;
      response.setHeader("Content-Type", "application/json");
      response.statusCode = 201;
      response.end(JSON.stringify(data));
    } catch (error) {
      response.statusCode = 400;
      response.end(error instanceof Error ? error.message : "无法导入生产材料。");
    }
  };
}

export function serveTtsVoicePreview(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") { response.statusCode = 405; response.end(); return; }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) { response.statusCode = 401; response.end("需要 Owner 登录会话。"); return; }
    const episodeId = new URL(request.url ?? "", "http://127.0.0.1").searchParams.get("episode") ?? "";
    if (!isEpisodeId(episodeId)) { response.statusCode = 400; response.end("无效的 Episode ID。"); return; }
    if (!supabaseUrl || !supabasePublishableKey) { response.statusCode = 503; response.end("Supabase 连接未配置。"); return; }
    try {
      const body = await readJsonBody(request);
      const voice = typeof body.voice === "string" ? body.voice.trim() : "";
      const speakingRate = body.speakingRate;
      if (!voice || voice.length > 128 || typeof speakingRate !== "number" || !Number.isFinite(speakingRate) || speakingRate < 0.5 || speakingRate > 2) throw new Error("音色或语速无效。");
      const client = createClient(supabaseUrl, supabasePublishableKey, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
      const { data: episode, error: episodeError } = await client.from("episodes").select("account_id, blueprint_version_id").eq("id", episodeId).maybeSingle();
      if (episodeError || !episode || !await accountIsOwned({ accountId: episode.account_id, authorization, supabasePublishableKey, supabaseUrl })) { response.statusCode = 403; response.end("没有该生产单的 Owner 权限。"); return; }
      const { data: blueprint, error: blueprintError } = await client.from("account_blueprint_versions").select("policy").eq("id", episode.blueprint_version_id).eq("account_id", episode.account_id).maybeSingle();
      if (blueprintError || !blueprint) throw new Error("未找到当前蓝图。");
      const capability = runtimeCapabilitiesFromBlueprintPolicy(blueprint.policy, undefined, ["narration_generation"]).find((candidate) => candidate.capability === "narration_generation");
      if (!capability || (capability.provider !== "google_tts" && capability.provider !== "volcengine_tts")) throw new Error("当前蓝图没有可试听的 TTS 执行器。");
      const policy = blueprint.policy && typeof blueprint.policy === "object" && !Array.isArray(blueprint.policy) ? blueprint.policy as Record<string, unknown> : {};
      const narration = policy.narration && typeof policy.narration === "object" && !Array.isArray(policy.narration) ? policy.narration as Record<string, unknown> : {};
      const voiceConfig = narration.voice && typeof narration.voice === "object" && !Array.isArray(narration.voice) ? narration.voice as Record<string, unknown> : {};
      const assetRoot = typeof policy.asset_root === "string" ? policy.asset_root.trim() : "";
      if (!assetRoot) throw new Error("当前蓝图没有本地资产根目录。");
      const languageCode = typeof voiceConfig.language_code === "string" ? voiceConfig.language_code : "zh-CN";
      const configuredVoice = typeof voiceConfig.name === "string" ? voiceConfig.name : "";
      const catalog = adapterRegistration(capability.provider, capability.adapter ?? capability.provider)?.voiceCatalog?.[languageCode] ?? [];
      if (voice !== configuredVoice && !catalog.includes(voice)) throw new Error("所选音色不在当前 TTS 执行器目录中。");
      const apiKey = await localWorkerSecretForCapability(capability, episode.account_id);
      if (!apiKey) { response.statusCode = 503; response.end("当前 TTS 凭据不可用。"); return; }
      const model = capability.model ?? (capability.provider === "volcengine_tts" ? "seed-tts-2.0" : "standard");
      const text = "你好，这是当前音色的试听效果。";
      const preview = await cachedTtsVoicePreview(assetRoot, { languageCode, model, provider: capability.provider, speakingRate, text, voice }, async () => {
        const input = { apiKey, fetcher: fetch, text, voice: { languageCode, name: voice, speakingRate } };
        return capability.provider === "volcengine_tts" ? synthesizeVolcengineTts({ ...input, model }) : synthesizeGoogleTts(input);
      });
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", "audio/mpeg");
      response.setHeader("X-TTS-Preview-Cache", preview.cacheStatus);
      response.statusCode = 200;
      response.end(preview.audio);
    } catch (error) {
      response.statusCode = 400;
      response.end(error instanceof Error ? error.message : "无法试听当前音色。");
    }
  };
}

export async function cachedTtsVoicePreview(assetRoot: string, identity: { languageCode: string; model: string; provider: string; speakingRate: number; text: string; voice: string }, synthesize: () => Promise<Uint8Array>): Promise<{ audio: Buffer; cacheStatus: "HIT" | "MISS" }> {
  const resolvedRoot = await fs.realpath(assetRoot);
  if (isFilesystemRoot(resolvedRoot)) throw new Error("资产根不能是文件系统根目录。");
  const cacheRoot = await ensureDirectoryWithinRoot(resolvedRoot, resolve(resolvedRoot, ".cache"));
  const cacheDirectory = await ensureDirectoryWithinRoot(cacheRoot, resolve(cacheRoot, "tts-previews"));
  const cachePath = resolve(cacheDirectory, `${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}.mp3`);
  try {
    return { audio: await fs.readFile(cachePath), cacheStatus: "HIT" };
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const audio = Buffer.from(await synthesize());
  if (audio.byteLength === 0) throw new Error("音色试听没有返回音频。");
  try {
    await fs.writeFile(cachePath, audio, { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    return { audio: await fs.readFile(cachePath), cacheStatus: "HIT" };
  }
  return { audio, cacheStatus: "MISS" };
}

async function indexedArtifactForPreview(input: { authorization: string; episodeId: string; expectedSha256?: string; relativePath: string; supabasePublishableKey: string | undefined; supabaseUrl: string | undefined }): Promise<{ assetRoot: string; sha256: string } | null> {
  if (!input.supabaseUrl || !input.supabasePublishableKey) return null;
  const supabase = createClient(input.supabaseUrl, input.supabasePublishableKey, { auth: { persistSession: false }, global: { headers: { Authorization: input.authorization } } });

  let artifactQuery = supabase.from("artifacts").select("episode_id, sha256").eq("episode_id", input.episodeId).eq("relative_path", input.relativePath);
  if (input.expectedSha256) artifactQuery = artifactQuery.eq("sha256", input.expectedSha256);
  const { data: artifacts, error: artifactError } = await artifactQuery.order("created_at", { ascending: false }).limit(1);
  if (artifactError) return null;
  const artifact = artifacts?.[0] ?? null;
  let materialQuery = supabase.from("production_material_revisions").select("episode_id, sha256").eq("episode_id", input.episodeId).eq("storage_path", input.relativePath);
  if (input.expectedSha256) materialQuery = materialQuery.eq("sha256", input.expectedSha256);
  const { data: materials, error: materialError } = artifact ? { data: null, error: null } : await materialQuery.order("created_at", { ascending: false }).limit(1);
  if (materialError) return null;
  const indexedInput = artifact ?? materials?.[0];
  if (!indexedInput) return null;

  const { data: episode, error: episodeError } = await supabase.from("episodes").select("blueprint_version_id").eq("id", indexedInput.episode_id).maybeSingle();
  if (episodeError || !episode) return null;

  const { data: blueprint, error: blueprintError } = await supabase.from("account_blueprint_versions").select("policy").eq("id", episode.blueprint_version_id).maybeSingle();
  if (blueprintError || !blueprint || !blueprint.policy || Array.isArray(blueprint.policy) || typeof blueprint.policy !== "object") return null;
  const assetRoot = blueprint.policy.asset_root;
  return typeof assetRoot === "string" && assetRoot.trim() ? { assetRoot: assetRoot.trim(), sha256: indexedInput.sha256 } : null;
}

async function assetRootForOwnedEpisode(input: { authorization: string; episodeId: string; supabasePublishableKey: string | undefined; supabaseUrl: string | undefined }): Promise<string | null> {
  if (!input.supabaseUrl || !input.supabasePublishableKey) return null;
  const accessToken = input.authorization.slice("Bearer ".length);
  const supabase = createClient(input.supabaseUrl, input.supabasePublishableKey, { auth: { persistSession: false }, global: { headers: { Authorization: input.authorization } } });
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) return null;

  const { data: episode, error: episodeError } = await supabase.from("episodes").select("account_id, blueprint_version_id").eq("id", input.episodeId).maybeSingle();
  if (episodeError || !episode) return null;

  const { data: membership, error: membershipError } = await supabase.from("account_memberships").select("role").eq("account_id", episode.account_id).eq("user_id", userData.user.id).eq("role", "owner").maybeSingle();
  if (membershipError || !membership) return null;

  const { data: blueprint, error: blueprintError } = await supabase.from("account_blueprint_versions").select("policy").eq("id", episode.blueprint_version_id).maybeSingle();
  if (blueprintError || !blueprint || !blueprint.policy || Array.isArray(blueprint.policy) || typeof blueprint.policy !== "object") return null;
  const assetRoot = blueprint.policy.asset_root;
  return typeof assetRoot === "string" ? assetRoot.trim() || null : null;
}

async function studioEntryGateForOwnedEpisode(input: { authorization: string; episodeId: string; projectRelativePath: string; supabasePublishableKey: string | undefined; supabaseUrl: string | undefined }): Promise<{ allowed: boolean; message?: string }> {
  if (!input.supabaseUrl || !input.supabasePublishableKey) return { allowed: false, message: "Supabase 本地客户端未配置。" };
  const supabase = createClient(input.supabaseUrl, input.supabasePublishableKey, { auth: { persistSession: false }, global: { headers: { Authorization: input.authorization } } });
  const { data: episode, error: episodeError } = await supabase.from("episodes").select("stage").eq("id", input.episodeId).maybeSingle();
  if (episodeError || !episode) return { allowed: false, message: "未找到当前 Episode。" };
  if (episode.stage !== "qc_review") return { allowed: false, message: "只有审核渲染完成后才能进入 Studio。" };

  const { data: qcPackages, error: qcError } = await supabase.from("review_packages").select("id, context_snapshot").eq("episode_id", input.episodeId).eq("stage", "qc_review").is("invalidated_at", null).order("revision_number", { ascending: false }).limit(1);
  const qcPackage = qcPackages?.[0];
  if (qcError || !qcPackage) return { allowed: false, message: "未找到当前审核渲染工程。" };
  const qcSnapshot = qcPackage.context_snapshot && typeof qcPackage.context_snapshot === "object" && !Array.isArray(qcPackage.context_snapshot) ? qcPackage.context_snapshot as Record<string, unknown> : {};
  if (qcSnapshot.project_relative_path !== input.projectRelativePath) return { allowed: false, message: "Studio 工程不是当前审核渲染工程。" };

  const preRenderPackageId = typeof qcSnapshot.pre_render_review_package_id === "string" ? qcSnapshot.pre_render_review_package_id : undefined;
  if (!preRenderPackageId) return { allowed: true };
  const { data: preRenderPackage, error: preRenderError } = await supabase.from("review_packages").select("context_snapshot").eq("id", preRenderPackageId).eq("episode_id", input.episodeId).eq("stage", "production_ready").is("invalidated_at", null).maybeSingle();
  if (preRenderError || !preRenderPackage) return { allowed: false, message: "当前 Studio 输入快照不存在或已失效。" };
  const preRenderSnapshot = preRenderPackage.context_snapshot && typeof preRenderPackage.context_snapshot === "object" && !Array.isArray(preRenderPackage.context_snapshot) ? preRenderPackage.context_snapshot as Record<string, unknown> : {};
  if (preRenderSnapshot.confirmation_mode !== "shot_preparation") return { allowed: true };
  const storyboardPackageId = typeof preRenderSnapshot.storyboard_review_package_id === "string" ? preRenderSnapshot.storyboard_review_package_id : undefined;
  if (!storyboardPackageId) return { allowed: false, message: "当前 Studio 输入快照缺少分镜版本。" };
  const { data: drafts, error: draftsError } = await supabase.from("shot_preparation_drafts").select("shot_id, confirmation_status, input_fingerprint, selected_material_revision_id, clip_segments, current_video_artifact_id, current_video_task_id, audio_mode, current_audio_track_id, subtitle_text, subtitles_enabled").eq("episode_id", input.episodeId).eq("review_package_id", storyboardPackageId);
  if (draftsError) return { allowed: false, message: "无法确认当前镜头版本，请稍后重试。" };
  const blockers = confirmedStudioShotBlockers(preRenderSnapshot, drafts ?? []);
  return blockers.length === 0
    ? { allowed: true }
    : { allowed: false, message: `Studio 尚未就绪，请先确认镜头：${blockers.join("、")}。` };
}

async function accountIsOwned(input: { accountId: string; authorization: string; supabasePublishableKey: string | undefined; supabaseUrl: string | undefined }): Promise<boolean> {
  if (!input.supabaseUrl || !input.supabasePublishableKey) return false;
  const accessToken = input.authorization.slice("Bearer ".length);
  const supabase = createClient(input.supabaseUrl, input.supabasePublishableKey, { auth: { persistSession: false }, global: { headers: { Authorization: input.authorization } } });
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) return false;
  const { data: membership, error: membershipError } = await supabase.from("account_memberships").select("role").eq("account_id", input.accountId).eq("user_id", userData.user.id).eq("role", "owner").maybeSingle();
  return !membershipError && Boolean(membership);
}

function localArtifactPreviewPlugin(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined): Plugin {
  const artifactMiddleware = serveLocalArtifact(supabaseUrl, supabasePublishableKey);
  const openArtifactMiddleware = serveOpenLocalArtifact(supabaseUrl, supabasePublishableKey);
  const directoryMiddleware = serveLocalEpisodeDirectory(supabaseUrl, supabasePublishableKey);
  const openDirectoryMiddleware = serveOpenLocalEpisodeDirectory(supabaseUrl, supabasePublishableKey);
  const openHyperframesStudioMiddleware = serveOpenHyperframesStudio(supabaseUrl, supabasePublishableKey);
  const openPersonalHyperframesStudioMiddleware = serveOpenPersonalHyperframesStudio(supabaseUrl, supabasePublishableKey);
  const freezeHyperframesStudioMiddleware = serveFreezeHyperframesStudio(supabaseUrl, supabasePublishableKey);
  const chooseAssetDirectoryMiddleware = serveChooseLocalAssetDirectory(supabaseUrl, supabasePublishableKey);
  const openAssetDirectoryMiddleware = serveOpenLocalAssetDirectory(supabaseUrl, supabasePublishableKey);
  const productionMaterialMiddleware = serveProductionMaterial(supabaseUrl, supabasePublishableKey);
  const ttsVoicePreviewMiddleware = serveTtsVoicePreview(supabaseUrl, supabasePublishableKey);
  const deletionMiddleware = serveEpisodeDeletion(supabaseUrl, supabasePublishableKey, localWorkerServiceRoleKey());
  const deletionCleanupMiddleware = serveEpisodeDeletionCleanup(supabaseUrl, supabasePublishableKey);
  const systemStatusMiddleware = serveSystemStatus(supabaseUrl, supabasePublishableKey);
  const goldenProductionTestMiddleware = serveGoldenProductionTest(supabaseUrl, supabasePublishableKey);
  const episodePreflightMiddleware = serveEpisodePreflight(supabaseUrl, supabasePublishableKey);
  const externalConnectionTestMiddleware = serveExternalConnectionTest(supabaseUrl, supabasePublishableKey, localWorkerServiceRoleKey());
  const publishPreparationMiddleware = servePublishPreparation(supabaseUrl, supabasePublishableKey, localWorkerServiceRoleKey());
  const workerPreflightMiddleware = serveWorkerPreflight(supabaseUrl, supabasePublishableKey);
  return {
    name: "local-artifact-preview",
    configureServer(server) {
      server.middlewares.use(localArtifactRoute, artifactMiddleware);
      server.middlewares.use(openLocalArtifactRoute, openArtifactMiddleware);
      server.middlewares.use(localEpisodeDirectoryRoute, directoryMiddleware);
      server.middlewares.use(openLocalEpisodeDirectoryRoute, openDirectoryMiddleware);
      server.middlewares.use(openHyperframesStudioRoute, openHyperframesStudioMiddleware);
      server.middlewares.use(openPersonalHyperframesStudioRoute, openPersonalHyperframesStudioMiddleware);
      server.middlewares.use(freezeHyperframesStudioRoute, freezeHyperframesStudioMiddleware);
      server.middlewares.use(chooseLocalAssetDirectoryRoute, chooseAssetDirectoryMiddleware);
      server.middlewares.use(openLocalAssetDirectoryRoute, openAssetDirectoryMiddleware);
      server.middlewares.use(localProductionMaterialRoute, productionMaterialMiddleware);
      server.middlewares.use(ttsVoicePreviewRoute, ttsVoicePreviewMiddleware);
      server.middlewares.use(localEpisodeDeletionRoute, deletionMiddleware);
      server.middlewares.use(localEpisodeDeletionCleanupRoute, deletionCleanupMiddleware);
      server.middlewares.use(systemStatusRoute, systemStatusMiddleware);
      server.middlewares.use(goldenProductionTestRoute, goldenProductionTestMiddleware);
      server.middlewares.use(episodePreflightRoute, episodePreflightMiddleware);
      server.middlewares.use(externalConnectionTestRoute, externalConnectionTestMiddleware);
      server.middlewares.use(publishPreparationRoute, publishPreparationMiddleware);
      server.middlewares.use(workerPreflightRoute, workerPreflightMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(localArtifactRoute, artifactMiddleware);
      server.middlewares.use(openLocalArtifactRoute, openArtifactMiddleware);
      server.middlewares.use(localEpisodeDirectoryRoute, directoryMiddleware);
      server.middlewares.use(openLocalEpisodeDirectoryRoute, openDirectoryMiddleware);
      server.middlewares.use(openHyperframesStudioRoute, openHyperframesStudioMiddleware);
      server.middlewares.use(openPersonalHyperframesStudioRoute, openPersonalHyperframesStudioMiddleware);
      server.middlewares.use(freezeHyperframesStudioRoute, freezeHyperframesStudioMiddleware);
      server.middlewares.use(chooseLocalAssetDirectoryRoute, chooseAssetDirectoryMiddleware);
      server.middlewares.use(openLocalAssetDirectoryRoute, openAssetDirectoryMiddleware);
      server.middlewares.use(localProductionMaterialRoute, productionMaterialMiddleware);
      server.middlewares.use(ttsVoicePreviewRoute, ttsVoicePreviewMiddleware);
      server.middlewares.use(localEpisodeDeletionRoute, deletionMiddleware);
      server.middlewares.use(localEpisodeDeletionCleanupRoute, deletionCleanupMiddleware);
      server.middlewares.use(systemStatusRoute, systemStatusMiddleware);
      server.middlewares.use(goldenProductionTestRoute, goldenProductionTestMiddleware);
      server.middlewares.use(episodePreflightRoute, episodePreflightMiddleware);
      server.middlewares.use(externalConnectionTestRoute, externalConnectionTestMiddleware);
      server.middlewares.use(publishPreparationRoute, publishPreparationMiddleware);
      server.middlewares.use(workerPreflightRoute, workerPreflightMiddleware);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), localArtifactPreviewPlugin(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY)],
    test: {
      environment: "jsdom",
      globals: true,
    },
  };
});
