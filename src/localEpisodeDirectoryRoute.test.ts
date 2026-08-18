// @vitest-environment node

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalEpisodeDirectory, finalizeStagedLocalEpisodeDirectory, restoreStagedLocalEpisodeDirectory, saveProductionMaterialSnapshot, serveEpisodeDeletion, serveEpisodeDeletionCleanup, serveLocalEpisodeDirectory, serveOpenLocalArtifact, serveOpenLocalEpisodeDirectory, stageLocalEpisodeDirectoryForDeletion } from "../vite.config";

const episodeId = "00000000-0000-0000-0000-000000000000";
let server: ReturnType<typeof createServer>;
let origin = "";

beforeAll(async () => {
  const middleware = serveLocalEpisodeDirectory(undefined, undefined);
  server = createServer((request, response) => {
    void middleware(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("本地 Episode 目录路由", () => {
  it("拒绝未登录、非法 ID 和非 POST 请求", async () => {
    const [unauthorized, invalidId, wrongMethod] = await Promise.all([
      fetch(`${origin}/_local-episode-directory?episode=${episodeId}`, { method: "POST" }),
      fetch(`${origin}/_local-episode-directory?episode=not-an-episode-id`, { headers: { Authorization: "Bearer invalid" }, method: "POST" }),
      fetch(`${origin}/_local-episode-directory?episode=${episodeId}`),
    ]);

    expect(unauthorized.status).toBe(401);
    expect(invalidId.status).toBe(400);
    expect(wrongMethod.status).toBe(405);
  });

  it("打开目录路由拒绝未登录、非法 ID 和错误方法", async () => {
    const middleware = serveOpenLocalEpisodeDirectory(undefined, undefined);
    const openServer = createServer((request, response) => {
      void middleware(request, response);
    });
    await new Promise<void>((resolve) => openServer.listen(0, "127.0.0.1", resolve));
    const openOrigin = `http://127.0.0.1:${(openServer.address() as AddressInfo).port}`;
    try {
      const [unauthorized, invalidId, wrongMethod] = await Promise.all([
        fetch(`${openOrigin}/_open-local-episode-directory?episode=${episodeId}`, { method: "POST" }),
        fetch(`${openOrigin}/_open-local-episode-directory?episode=not-an-episode-id`, { headers: { Authorization: "Bearer invalid" }, method: "POST" }),
        fetch(`${openOrigin}/_open-local-episode-directory?episode=${episodeId}`, { headers: { Authorization: "Bearer invalid" } }),
      ]);

      expect(unauthorized.status).toBe(401);
      expect(invalidId.status).toBe(400);
      expect(wrongMethod.status).toBe(405);
    } finally {
      await new Promise<void>((resolve, reject) => openServer.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("打开产物路由拒绝未登录、非法参数和错误方法", async () => {
    const middleware = serveOpenLocalArtifact(undefined, undefined);
    const openServer = createServer((request, response) => {
      void middleware(request, response);
    });
    await new Promise<void>((resolve) => openServer.listen(0, "127.0.0.1", resolve));
    const openOrigin = `http://127.0.0.1:${(openServer.address() as AddressInfo).port}`;
    try {
      const [unauthorized, invalidId, invalidPath, wrongMethod] = await Promise.all([
        fetch(`${openOrigin}/_open-local-artifact?episode=${episodeId}&path=episodes%2F${episodeId}%2Fcover.png`, { method: "POST" }),
        fetch(`${openOrigin}/_open-local-artifact?episode=not-an-episode-id&path=cover.png`, { headers: { Authorization: "Bearer invalid" }, method: "POST" }),
        fetch(`${openOrigin}/_open-local-artifact?episode=${episodeId}&path=../cover.png`, { headers: { Authorization: "Bearer invalid" }, method: "POST" }),
        fetch(`${openOrigin}/_open-local-artifact?episode=${episodeId}&path=cover.png`, { headers: { Authorization: "Bearer invalid" } }),
      ]);

      expect(unauthorized.status).toBe(401);
      expect(invalidId.status).toBe(400);
      expect(invalidPath.status).toBe(400);
      expect(wrongMethod.status).toBe(405);
    } finally {
      await new Promise<void>((resolve, reject) => openServer.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("永久删除路由在执行文件系统操作前拒绝未登录、非法 ID 和错误方法", async () => {
    const middleware = serveEpisodeDeletion(undefined, undefined);
    const deletionServer = createServer((request, response) => {
      void middleware(request, response);
    });
    await new Promise<void>((resolve) => deletionServer.listen(0, "127.0.0.1", resolve));
    const deletionOrigin = `http://127.0.0.1:${(deletionServer.address() as AddressInfo).port}`;
    try {
      const [unauthorized, invalidId, wrongMethod] = await Promise.all([
        fetch(`${deletionOrigin}/_delete-episode?episode=${episodeId}`, { body: "{}", method: "DELETE" }),
        fetch(`${deletionOrigin}/_delete-episode?episode=not-an-episode-id`, { body: "{}", headers: { Authorization: "Bearer invalid" }, method: "DELETE" }),
        fetch(`${deletionOrigin}/_delete-episode?episode=${episodeId}`, { headers: { Authorization: "Bearer invalid" } }),
      ]);

      expect(unauthorized.status).toBe(401);
      expect(invalidId.status).toBe(400);
      expect(wrongMethod.status).toBe(405);
    } finally {
      await new Promise<void>((resolve, reject) => deletionServer.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("删除暂存清理路由在执行文件系统操作前拒绝未登录和非法参数", async () => {
    const middleware = serveEpisodeDeletionCleanup(undefined, undefined);
    const cleanupServer = createServer((request, response) => {
      void middleware(request, response);
    });
    await new Promise<void>((resolve) => cleanupServer.listen(0, "127.0.0.1", resolve));
    const cleanupOrigin = `http://127.0.0.1:${(cleanupServer.address() as AddressInfo).port}`;
    try {
      const [unauthorized, invalidId, wrongMethod] = await Promise.all([
        fetch(`${cleanupOrigin}/_finalize-episode-deletion`, { body: "{}", method: "POST" }),
        fetch(`${cleanupOrigin}/_finalize-episode-deletion`, { body: JSON.stringify({ accountId: "bad", blueprintVersionId: "bad", episodeId }), headers: { Authorization: "Bearer invalid", "Content-Type": "application/json" }, method: "POST" }),
        fetch(`${cleanupOrigin}/_finalize-episode-deletion`, { headers: { Authorization: "Bearer invalid" } }),
      ]);

      expect(unauthorized.status).toBe(401);
      expect(invalidId.status).toBe(400);
      expect(wrongMethod.status).toBe(405);
    } finally {
      await new Promise<void>((resolve, reject) => cleanupServer.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("只在资产根的 episodes 目录下创建，并发创建保持幂等", async () => {
    const root = await mkdtemp(join(tmpdir(), "tk-workflow-directory-"));
    try {
      const results = await Promise.all([
        createLocalEpisodeDirectory(root, episodeId),
        createLocalEpisodeDirectory(root, episodeId),
      ]);

      expect(results[0]).toBe(results[1]);
      expect((await stat(results[0])).isDirectory()).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("拒绝作为资产根的文件系统根目录和 episodes 符号链接", async () => {
    await expect(createLocalEpisodeDirectory("/", episodeId)).rejects.toThrow("资产根不能是文件系统根目录。");

    const root = await mkdtemp(join(tmpdir(), "tk-workflow-directory-"));
    const outside = await mkdtemp(join(tmpdir(), "tk-workflow-outside-"));
    try {
      await symlink(outside, join(root, "episodes"));
      await expect(createLocalEpisodeDirectory(root, episodeId)).rejects.toThrow("目录不是安全目录。");
      await expect(stat(join(outside, episodeId))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await Promise.all([rm(root, { force: true, recursive: true }), rm(outside, { force: true, recursive: true })]);
    }
  });

  it("把目录文件固定为内容寻址的生产材料副本", async () => {
    const root = await mkdtemp(join(tmpdir(), "tk-workflow-material-"));
    try {
      const episodeDirectory = await createLocalEpisodeDirectory(root, episodeId);
      await writeFile(join(episodeDirectory, "input", "script.txt"), "First script");

      const snapshot = await saveProductionMaterialSnapshot(root, episodeId, {
        sourceKind: "directory",
        sourcePath: "script.txt",
      });
      await writeFile(join(episodeDirectory, "input", "script.txt"), "Changed outside");

      expect(snapshot).toMatchObject({
        fileSize: 12,
        sha256: "6c9b61c88d4a2f2a053a90540e861226ed0b1ca25396acedf22ef3f5453c1d62",
        sourcePath: "script.txt",
        storagePath: `episodes/${episodeId}/materials/6c9b61c88d4a2f2a053a90540e861226ed0b1ca25396acedf22ef3f5453c1d62-script.txt`,
      });
      expect(await readFile(join(root, snapshot.storagePath), "utf8")).toBe("First script");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("拒绝从 Episode 输入目录之外导入文件", async () => {
    const root = await mkdtemp(join(tmpdir(), "tk-workflow-material-"));
    try {
      await createLocalEpisodeDirectory(root, episodeId);
      await expect(saveProductionMaterialSnapshot(root, episodeId, { sourceKind: "directory", sourcePath: "../secret.txt" })).rejects.toThrow("输入文件路径无效");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("拒绝删除符号链接形式的 Episode 目录", async () => {
    const root = await mkdtemp(join(tmpdir(), "tk-workflow-delete-"));
    const outside = await mkdtemp(join(tmpdir(), "tk-workflow-delete-outside-"));
    try {
      await mkdir(join(root, "episodes"), { recursive: true });
      await symlink(outside, join(root, "episodes", episodeId));
      await expect(stageLocalEpisodeDirectoryForDeletion(root, episodeId)).rejects.toThrow("目录不是安全目录");
      expect((await stat(outside)).isDirectory()).toBe(true);
    } finally {
      await Promise.all([rm(root, { force: true, recursive: true }), rm(outside, { force: true, recursive: true })]);
    }
  });

  it("数据库删除失败时可以恢复暂存目录，成功时再永久清理", async () => {
    const root = await mkdtemp(join(tmpdir(), "tk-workflow-delete-"));
    try {
      const episodeDirectory = await createLocalEpisodeDirectory(root, episodeId);
      await writeFile(join(episodeDirectory, "render.mp4"), "video");

      const staged = await stageLocalEpisodeDirectoryForDeletion(root, episodeId);
      expect(staged.existed).toBe(true);
      await expect(stat(episodeDirectory)).rejects.toMatchObject({ code: "ENOENT" });
      await restoreStagedLocalEpisodeDirectory(root, episodeId);
      expect((await stat(join(episodeDirectory, "render.mp4"))).isFile()).toBe(true);

      await stageLocalEpisodeDirectoryForDeletion(root, episodeId);
      expect(await finalizeStagedLocalEpisodeDirectory(root, episodeId)).toBe(true);
      await expect(stat(episodeDirectory)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await finalizeStagedLocalEpisodeDirectory(root, episodeId)).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
