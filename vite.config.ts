import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, promises as fs, readFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import { promisify } from "node:util";
import { loadEnv, type Plugin } from "vite";
import { verifyMediaLibrary } from "./src/worker/mediaLibrary";
import { createRuntimePreflight, runtimeCapabilitiesFromBlueprintPolicy, runtimeCommandArguments } from "./src/worker/runtimePreflight";
import { probeCodexModel, probeProviderConnection } from "./src/worker/runtimeProbes";
import { isSupportedManualARollVideo } from "./src/reviews/materialImport";

const localArtifactRoute = "/_local-artifact";
const localEpisodeDirectoryRoute = "/_local-episode-directory";
const openLocalEpisodeDirectoryRoute = "/_open-local-episode-directory";
const openLocalArtifactRoute = "/_open-local-artifact";
const localProductionMaterialRoute = "/_production-material";
const localEpisodeDeletionRoute = "/_delete-episode";
const localEpisodeDeletionCleanupRoute = "/_finalize-episode-deletion";
const systemStatusRoute = "/_system-status";
const workerPreflightRoute = "/_worker-preflight";
const episodePreflightRoute = "/_episode-preflight";
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

function serveLocalArtifact(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined) {
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
    const indexedArtifact = await indexedArtifactForPreview({ authorization, episodeId, relativePath, supabasePublishableKey, supabaseUrl });
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
      const indexedArtifact = await indexedArtifactForPreview({ authorization, episodeId, relativePath, supabasePublishableKey, supabaseUrl });
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
  const fileName = basename(input.sourcePath);
  const storagePath = `episodes/${episodeId}/materials/${sha256}-${fileName}`;
  const targetPath = join(assetRoot, storagePath);
  try {
    await fs.writeFile(targetPath, content, { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    const existingHash = createHash("sha256").update(await fs.readFile(targetPath)).digest("hex");
    if (existingHash !== sha256) throw new Error("已有材料快照与内容哈希不一致。");
  }
  return { sourcePath: input.sourcePath, storagePath, sha256, fileSize: content.byteLength };
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
  if (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
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
      const mediaRoot = localWorkerEnvironmentValue("MEDIA_LIBRARY_MOUNT_PATH");
      const mediaExists = mediaRoot ? await fs.stat(mediaRoot).then((stats) => stats.isDirectory()).catch(() => false) : false;
      const dependencies = await Promise.all([
        dependencyStatus("Codex CLI", "codex", ["--version"]),
        dependencyStatus("ffmpeg", "ffmpeg", ["-version"]),
      ]);
      const report = {
        dependencies,
        mediaLibrary: { detail: mediaRoot ? (mediaExists ? `已挂载：${mediaRoot}` : `未找到挂载目录：${mediaRoot}`) : "未配置 MEDIA_LIBRARY_MOUNT_PATH。", state: mediaExists ? "healthy" : "offline" },
        n8n: { detail: runtimeExists ? (lastEventAt ? "已读取本地 n8n 事件日志；n8n 负责编排、通知和健康检查，不代替 Worker。" : "已发现 n8n 运行时目录，但暂无事件日志。") : "未发现本地 n8n 运行时目录。", lastDispatchAt: null, lastEventAt, lastHealthCheckAt: null, lastRunAt: null, state: lastEventAt ? "healthy" : runtimeExists ? "unknown" : "offline" },
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

      const report = await runtimePreflightForPolicy(blueprint.policy, seriesRules);
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

      const report = await runtimePreflightForPolicy(policy ?? blueprint.policy, seriesRules, Boolean(episodeId));
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

async function runtimePreflightForPolicy(policy: unknown, seriesRules: unknown, checkAssetRoot = false) {
  const capabilities = runtimeCapabilitiesFromBlueprintPolicy(policy, seriesRules);
  const commandNames = [...new Set(capabilities.map((capability) => capability.command).filter((command): command is string => Boolean(command)))];
  const commandEntries = await Promise.all(commandNames.map(async (command) => [command, await dependencyStatus(command, command, runtimeCommandArguments(command))] as const));
  const commands = Object.fromEntries(commandEntries.map(([command, status]) => [command, { available: status.state === "healthy", detail: status.detail }]));
  const credentialNames = [...new Set(capabilities.map((capability) => capability.credential).filter((credential): credential is string => Boolean(credential)))];
  const credentials = Object.fromEntries(credentialNames.map((credential) => [credential, Boolean(localWorkerEnvironmentValue(credential))]));
  const modelEntries = await Promise.all([...new Set(capabilities.filter((capability) => capability.provider === "codex" && capability.model && commands.codex?.available).map((capability) => capability.model as string))].map(async (model) => {
    const probe = await probeCodexModel(model, async (command, argumentsList, options) => {
      const result = await execFileAsync(command, argumentsList, { timeout: options?.timeoutMs, maxBuffer: 64 * 1024 });
      return { stdout: String(result.stdout), stderr: String(result.stderr) };
    }, tmpdir());
    return [model, probe] as const;
  }));
  const providerEntries = await Promise.all([...new Set(capabilities.filter((capability) => capability.credential).map((capability) => capability.provider))].map(async (provider) => {
    const credential = capabilities.find((capability) => capability.provider === provider)?.credential;
    const apiKey = credential ? localWorkerEnvironmentValue(credential) : undefined;
    if (!apiKey) return null;
    return { provider, credential, probe: await probeProviderConnection(provider, apiKey) };
  }));
  const modelPermissions = Object.fromEntries(modelEntries.map(([model, probe]) => [model, probe.modelPermission]));
  const connections = Object.fromEntries(providerEntries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)).map((entry) => [entry.provider, entry.probe.connection]));
  const credentialValidity = Object.fromEntries(providerEntries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry?.probe.credentialValidity)).map((entry) => [entry.credential, entry.probe.credentialValidity]));
  const assetRoot = await workerMediaLibraryStatus(policy, checkAssetRoot);
  return createRuntimePreflight(capabilities, {
    commands,
    credentials,
    ...(Object.keys(modelPermissions).length ? { modelPermissions } : {}),
    ...(Object.keys(connections).length ? { connections } : {}),
    ...(Object.keys(credentialValidity).length ? { credentialValidity } : {}),
    ...(checkAssetRoot ? { assetRoot } : { mediaLibrary: assetRoot }),
  });
}

function isTransientPreflightError(error: unknown): boolean {
  const detail = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /fetch failed|network|timeout|timed out|econnreset|econnrefused|etimedout|502|503|504/.test(detail);
}

function retryablePreflight(error: unknown) {
  return {
    version: "worker-preflight/v1" as const,
    checks: [{ capability: "worker_runtime", check: "connection", phase: "preflight" as const, status: "retryable" as const, reason: error instanceof Error ? error.message : "Worker 或 Supabase 连接暂时失败。", action: "retry" as const, scope: "worker" as const }],
  };
}

async function workerMediaLibraryStatus(policy: unknown, beforeEpisodeCreation = false): Promise<{ available: boolean; detail: string } | undefined> {
  const assetRoot = policy && typeof policy === "object" && !Array.isArray(policy) && typeof (policy as Record<string, unknown>).asset_root === "string" ? ((policy as Record<string, unknown>).asset_root as string).trim() : "";
  if (!assetRoot) return { available: false, detail: "蓝图未配置 asset_root。" };
  if (!isAbsolute(assetRoot)) return { available: false, detail: "蓝图 asset_root 必须使用绝对路径。" };
  const mountPath = localWorkerEnvironmentValue("MEDIA_LIBRARY_MOUNT_PATH");
  if (!mountPath) return { available: false, detail: "未配置 MEDIA_LIBRARY_MOUNT_PATH。" };
  const minimumFreeBytesValue = localWorkerEnvironmentValue("MEDIA_LIBRARY_MIN_FREE_BYTES");
  if (!minimumFreeBytesValue || !/^\d+$/.test(minimumFreeBytesValue) || !Number.isSafeInteger(Number(minimumFreeBytesValue))) return { available: false, detail: "MEDIA_LIBRARY_MIN_FREE_BYTES 未配置为非负整数。" };
  try {
    const status = await verifyMediaLibrary({ assetRoot, mountPath, minimumFreeBytes: Number(minimumFreeBytesValue), requireEpisodesDirectory: !beforeEpisodeCreation });
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
      const materialType = body.materialType;
      const materialPurpose = body.materialPurpose;
      const mimeType = body.mimeType;
      const isMainScript = body.isMainScript;
      const allowedMaterialPurposes = new Set(["main_script", "supplemental_script", "general_reference", "visual_reference", "a_roll", "b_roll", "narration", "background_music", "sound_effect"]);
      if ((sourceKind !== "directory" && sourceKind !== "file" && sourceKind !== "paste") || typeof sourcePath !== "string" || typeof materialType !== "string" || typeof materialPurpose !== "string" || !allowedMaterialPurposes.has(materialPurpose) || typeof mimeType !== "string" || typeof isMainScript !== "boolean") {
        throw new Error("生产材料元数据无效。");
      }
      if (materialPurpose === "a_roll" && !isSupportedManualARollVideo(sourcePath, materialType, mimeType)) throw new Error("人工 A-roll 仅支持 MP4、MOV 或 WebM 视频。");
      let content: Uint8Array | undefined;
      if (sourceKind !== "directory") {
        if (typeof body.contentBase64 !== "string") throw new Error("生产材料内容无效。");
        content = Buffer.from(body.contentBase64, "base64");
      }
      const snapshot = await saveProductionMaterialSnapshot(assetRoot, episodeId, { content, sourceKind, sourcePath });
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

async function indexedArtifactForPreview(input: { authorization: string; episodeId: string; relativePath: string; supabasePublishableKey: string | undefined; supabaseUrl: string | undefined }): Promise<{ assetRoot: string; sha256: string } | null> {
  if (!input.supabaseUrl || !input.supabasePublishableKey) return null;
  const supabase = createClient(input.supabaseUrl, input.supabasePublishableKey, { auth: { persistSession: false }, global: { headers: { Authorization: input.authorization } } });

  const { data: artifact, error: artifactError } = await supabase.from("artifacts").select("episode_id, sha256").eq("episode_id", input.episodeId).eq("relative_path", input.relativePath).maybeSingle();
  if (artifactError || !artifact) return null;

  const { data: episode, error: episodeError } = await supabase.from("episodes").select("blueprint_version_id").eq("id", artifact.episode_id).maybeSingle();
  if (episodeError || !episode) return null;

  const { data: blueprint, error: blueprintError } = await supabase.from("account_blueprint_versions").select("policy").eq("id", episode.blueprint_version_id).maybeSingle();
  if (blueprintError || !blueprint || !blueprint.policy || Array.isArray(blueprint.policy) || typeof blueprint.policy !== "object") return null;
  const assetRoot = blueprint.policy.asset_root;
  return typeof assetRoot === "string" && assetRoot.trim() ? { assetRoot: assetRoot.trim(), sha256: artifact.sha256 } : null;
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

function localArtifactPreviewPlugin(supabaseUrl: string | undefined, supabasePublishableKey: string | undefined): Plugin {
  const artifactMiddleware = serveLocalArtifact(supabaseUrl, supabasePublishableKey);
  const openArtifactMiddleware = serveOpenLocalArtifact(supabaseUrl, supabasePublishableKey);
  const directoryMiddleware = serveLocalEpisodeDirectory(supabaseUrl, supabasePublishableKey);
  const openDirectoryMiddleware = serveOpenLocalEpisodeDirectory(supabaseUrl, supabasePublishableKey);
  const productionMaterialMiddleware = serveProductionMaterial(supabaseUrl, supabasePublishableKey);
  const deletionMiddleware = serveEpisodeDeletion(supabaseUrl, supabasePublishableKey, localWorkerServiceRoleKey());
  const deletionCleanupMiddleware = serveEpisodeDeletionCleanup(supabaseUrl, supabasePublishableKey);
  const systemStatusMiddleware = serveSystemStatus(supabaseUrl, supabasePublishableKey);
  const episodePreflightMiddleware = serveEpisodePreflight(supabaseUrl, supabasePublishableKey);
  const workerPreflightMiddleware = serveWorkerPreflight(supabaseUrl, supabasePublishableKey);
  return {
    name: "local-artifact-preview",
    configureServer(server) {
      server.middlewares.use(localArtifactRoute, artifactMiddleware);
      server.middlewares.use(openLocalArtifactRoute, openArtifactMiddleware);
      server.middlewares.use(localEpisodeDirectoryRoute, directoryMiddleware);
      server.middlewares.use(openLocalEpisodeDirectoryRoute, openDirectoryMiddleware);
      server.middlewares.use(localProductionMaterialRoute, productionMaterialMiddleware);
      server.middlewares.use(localEpisodeDeletionRoute, deletionMiddleware);
      server.middlewares.use(localEpisodeDeletionCleanupRoute, deletionCleanupMiddleware);
      server.middlewares.use(systemStatusRoute, systemStatusMiddleware);
      server.middlewares.use(episodePreflightRoute, episodePreflightMiddleware);
      server.middlewares.use(workerPreflightRoute, workerPreflightMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(localArtifactRoute, artifactMiddleware);
      server.middlewares.use(openLocalArtifactRoute, openArtifactMiddleware);
      server.middlewares.use(localEpisodeDirectoryRoute, directoryMiddleware);
      server.middlewares.use(openLocalEpisodeDirectoryRoute, openDirectoryMiddleware);
      server.middlewares.use(localProductionMaterialRoute, productionMaterialMiddleware);
      server.middlewares.use(localEpisodeDeletionRoute, deletionMiddleware);
      server.middlewares.use(localEpisodeDeletionCleanupRoute, deletionCleanupMiddleware);
      server.middlewares.use(systemStatusRoute, systemStatusMiddleware);
      server.middlewares.use(episodePreflightRoute, episodePreflightMiddleware);
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
