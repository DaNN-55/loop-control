// @vitest-environment node

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { confirmedStudioShotBlockers, coverImageExtension, createLocalEpisodeDirectory, finalizeStagedLocalEpisodeDirectory, freezeHyperframesStudioWorkspace, hyperframesStudioPreviewArguments, prepareHyperframesStudioWorkspace, restoreStagedLocalEpisodeDirectory, saveProductionMaterialSnapshot, serveChooseLocalAssetDirectory, serveEpisodeDeletion, serveEpisodeDeletionCleanup, serveEpisodePreflight, serveFreezeHyperframesStudio, serveLocalArtifact, serveLocalEpisodeDirectory, serveOpenHyperframesStudio, serveOpenLocalArtifact, serveOpenLocalAssetDirectory, serveOpenLocalEpisodeDirectory, serveOpenPersonalHyperframesStudio, servePublishPreparation, serveTtsVoicePreview, stageLocalEpisodeDirectoryForDeletion, studioMarkerSourceRequirements } from "../vite.config";

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
  it("只允许当前确认版本进入 Studio，并指出发生变化的镜头", () => {
    const context = {
      confirmation_mode: "shot_preparation",
      storyboard: { shots: [{ id: "shot-1" }] },
      confirmed_shots: [{ shot_id: "shot-1", confirmation_status: "confirmed", input_fingerprint: "a".repeat(32), video_artifact_id: "artifact-1", video_task_id: "task-1", audio_mode: "none", audio_track_id: null, subtitle_text: "字幕", subtitles_enabled: true }],
      members: [{ member_key: "shot:shot-1", artifact_id: "artifact-1", task_id: "task-1", input_fingerprint: "a".repeat(32), audio_mode: "none", subtitle_text: "字幕", subtitles_enabled: true }],
    };
    const currentDraft = { shot_id: "shot-1", confirmation_status: "confirmed", input_fingerprint: "b".repeat(32), current_video_artifact_id: "artifact-1", current_video_task_id: "task-1", audio_mode: "none", current_audio_track_id: null, subtitle_text: "字幕", subtitles_enabled: true };
    expect(confirmedStudioShotBlockers(context, [currentDraft])).toEqual(["shot-1"]);
    expect(confirmedStudioShotBlockers(context, [{ ...currentDraft, input_fingerprint: "a".repeat(32) }])).toEqual([]);

    const markerContext = {
      confirmation_mode: "shot_preparation",
      storyboard: { shots: [{ id: "shot-1" }] },
      confirmed_shots: [{ shot_id: "shot-1", confirmation_status: "confirmed", input_fingerprint: "a".repeat(32), source_material_revision_id: "material-1", clip_segments: [{ start_seconds: 1, end_seconds: 5 }], audio_mode: "source", audio_track_id: null, subtitle_text: "原声字幕", subtitles_enabled: true }],
      members: [{ member_key: "shot:shot-1", source_material_revision_id: "material-1", clip_segments: [{ start_seconds: 1, end_seconds: 5 }], input_fingerprint: "a".repeat(32), audio_mode: "source", subtitle_text: "原声字幕", subtitles_enabled: true }],
    };
    const markerDraft = { shot_id: "shot-1", confirmation_status: "confirmed", input_fingerprint: "a".repeat(32), selected_material_revision_id: "material-1", clip_segments: [{ start_seconds: 1, end_seconds: 5 }], audio_mode: "source", current_audio_track_id: null, subtitle_text: "原声字幕", subtitles_enabled: true };
    expect(confirmedStudioShotBlockers(markerContext, [markerDraft])).toEqual([]);
  });

  it("按文件内容识别发布封面的 JPG、PNG 和 WebP 格式", () => {
    expect(coverImageExtension(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe("jpg");
    expect(coverImageExtension(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe("png");
    expect(coverImageExtension(Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]))).toBe("webp");
    expect(coverImageExtension(Uint8Array.from([71, 73, 70, 56, 57, 97]))).toBeNull();
  });

  it("Studio 只允许在原片范围内修改片段标记，不允许替换镜头原片", () => {
    const original = '<video class="clip shot shot-0" data-media-start="1" data-duration="2.8" src="assets/source.mp4"></video>';
    const edited = '<video class="clip shot shot-0" data-media-start="1" data-duration="4" src="assets/source.mp4"></video>';
    expect(studioMarkerSourceRequirements(original, edited)).toEqual([{ relativePath: "assets/source.mp4", minimumDurationSeconds: 5 }]);
    expect(() => studioMarkerSourceRequirements(original, edited.replace("source.mp4", "other.mp4"))).toThrow("更换原片");
    expect(() => studioMarkerSourceRequirements(original, edited.replace('data-duration="4"', ""))).toThrow("标记无效");
  });
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

  it("创建前 Worker 检查拒绝未登录、错误方法和未配置 Supabase", async () => {
    const middleware = serveEpisodePreflight(undefined, undefined);
    const preflightServer = createServer((request, response) => {
      void middleware(request, response);
    });
    await new Promise<void>((resolve) => preflightServer.listen(0, "127.0.0.1", resolve));
    const preflightOrigin = `http://127.0.0.1:${(preflightServer.address() as AddressInfo).port}`;
    try {
      const [unauthorized, wrongMethod, unavailable] = await Promise.all([
        fetch(`${preflightOrigin}/_episode-preflight`, { method: "POST" }),
        fetch(`${preflightOrigin}/_episode-preflight`, { headers: { Authorization: "Bearer invalid" } }),
        fetch(`${preflightOrigin}/_episode-preflight`, { body: "{}", headers: { Authorization: "Bearer invalid", "Content-Type": "application/json" }, method: "POST" }),
      ]);

      expect(unauthorized.status).toBe(401);
      expect(wrongMethod.status).toBe(405);
      expect(unavailable.status).toBe(503);
    } finally {
      await new Promise<void>((resolve, reject) => preflightServer.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("音色试听在调用供应商前拒绝未登录、错误方法和未配置服务", async () => {
    const middleware = serveTtsVoicePreview(undefined, undefined);
    const previewServer = createServer((request, response) => { void middleware(request, response); });
    await new Promise<void>((resolve) => previewServer.listen(0, "127.0.0.1", resolve));
    const previewOrigin = `http://127.0.0.1:${(previewServer.address() as AddressInfo).port}`;
    try {
      const [unauthorized, wrongMethod, unavailable] = await Promise.all([
        fetch(`${previewOrigin}/_tts-voice-preview?episode=${episodeId}`, { body: "{}", method: "POST" }),
        fetch(`${previewOrigin}/_tts-voice-preview?episode=${episodeId}`, { headers: { Authorization: "Bearer invalid" } }),
        fetch(`${previewOrigin}/_tts-voice-preview?episode=${episodeId}`, { body: JSON.stringify({ speakingRate: 1, voice: "voice-a" }), headers: { Authorization: "Bearer invalid", "Content-Type": "application/json" }, method: "POST" }),
      ]);
      expect(unauthorized.status).toBe(401);
      expect(wrongMethod.status).toBe(405);
      expect(unavailable.status).toBe(503);
    } finally {
      await new Promise<void>((resolve, reject) => previewServer.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("发布准备路由在写入文件前拒绝未登录、错误方法和未配置服务", async () => {
    const middleware = servePublishPreparation(undefined, undefined, "");
    const publishServer = createServer((request, response) => { void middleware(request, response); });
    await new Promise<void>((resolve) => publishServer.listen(0, "127.0.0.1", resolve));
    const publishOrigin = `http://127.0.0.1:${(publishServer.address() as AddressInfo).port}`;
    try {
      const [unauthorized, wrongMethod, unavailable] = await Promise.all([
        fetch(`${publishOrigin}/_publish-preparation`, { body: "{}", method: "POST" }),
        fetch(`${publishOrigin}/_publish-preparation`, { headers: { Authorization: "Bearer invalid" } }),
        fetch(`${publishOrigin}/_publish-preparation`, { body: "{}", headers: { Authorization: "Bearer invalid", "Content-Type": "application/json" }, method: "POST" }),
      ]);
      expect(unauthorized.status).toBe(401);
      expect(wrongMethod.status).toBe(405);
      expect(unavailable.status).toBe(503);
    } finally {
      await new Promise<void>((resolve, reject) => publishServer.close((error) => error ? reject(error) : resolve()));
    }
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

  it("Studio 路由在访问本机工程前拒绝未登录、非法 ID 和错误方法", async () => {
    const cases = [serveOpenHyperframesStudio(undefined, undefined), serveFreezeHyperframesStudio(undefined, undefined)];
    for (const middleware of cases) {
      const studioServer = createServer((request, response) => { void middleware(request, response); });
      await new Promise<void>((resolve) => studioServer.listen(0, "127.0.0.1", resolve));
      const studioOrigin = `http://127.0.0.1:${(studioServer.address() as AddressInfo).port}`;
      try {
        const [unauthorized, invalidId, wrongMethod] = await Promise.all([
          fetch(`${studioOrigin}/studio?episode=${episodeId}`, { body: "{}", method: "POST" }),
          fetch(`${studioOrigin}/studio?episode=not-an-episode-id`, { body: "{}", headers: { Authorization: "Bearer invalid", "Content-Type": "application/json" }, method: "POST" }),
          fetch(`${studioOrigin}/studio?episode=${episodeId}`, { headers: { Authorization: "Bearer invalid" } }),
        ]);
        expect(unauthorized.status).toBe(401);
        expect(invalidId.status).toBe(400);
        expect(wrongMethod.status).toBe(405);
      } finally {
        await new Promise<void>((resolve, reject) => studioServer.close((error) => error ? reject(error) : resolve()));
      }
    }
  });

  it("个人 Studio 入口在启动本机工程前拒绝未登录、错误方法和缺失配置", async () => {
    const middleware = serveOpenPersonalHyperframesStudio(undefined, undefined);
    const studioServer = createServer((request, response) => { void middleware(request, response); });
    await new Promise<void>((resolve) => studioServer.listen(0, "127.0.0.1", resolve));
    const studioOrigin = `http://127.0.0.1:${(studioServer.address() as AddressInfo).port}`;
    try {
      const [unauthorized, wrongMethod, unavailable] = await Promise.all([
        fetch(`${studioOrigin}/studio`, { method: "POST" }),
        fetch(`${studioOrigin}/studio`, { headers: { Authorization: "Bearer invalid" } }),
        fetch(`${studioOrigin}/studio`, { headers: { Authorization: "Bearer invalid" }, method: "POST" }),
      ]);
      expect(unauthorized.status).toBe(401);
      expect(wrongMethod.status).toBe(405);
      expect(unavailable.status).toBe(503);
    } finally {
      await new Promise<void>((resolve, reject) => studioServer.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("账号资产目录路由在触碰本机文件系统前拒绝未登录、非法参数和错误方法", async () => {
    const cases = [
      [serveChooseLocalAssetDirectory(undefined, undefined), "_choose-local-asset-directory", `account=${episodeId}`],
      [serveOpenLocalAssetDirectory(undefined, undefined), "_open-local-asset-directory", `account=${episodeId}&path=%2Ftmp`],
    ] as const;
    for (const [middleware, route, query] of cases) {
      const assetServer = createServer((request, response) => { void middleware(request, response); });
      await new Promise<void>((resolve) => assetServer.listen(0, "127.0.0.1", resolve));
      const assetOrigin = `http://127.0.0.1:${(assetServer.address() as AddressInfo).port}`;
      try {
        const [unauthorized, invalidId, wrongMethod] = await Promise.all([
          fetch(`${assetOrigin}/${route}?${query}`, { method: "POST" }),
          fetch(`${assetOrigin}/${route}?account=not-an-account&path=%2Ftmp`, { headers: { Authorization: "Bearer invalid" }, method: "POST" }),
          fetch(`${assetOrigin}/${route}?${query}`, { headers: { Authorization: "Bearer invalid" } }),
        ]);
        expect(unauthorized.status).toBe(401);
        expect(invalidId.status).toBe(400);
        expect(wrongMethod.status).toBe(405);
      } finally {
        await new Promise<void>((resolve, reject) => assetServer.close((error) => error ? reject(error) : resolve()));
      }
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

  it("预览已冻结的上传素材", async () => {
    const root = await mkdtemp(join(tmpdir(), "tk-workflow-material-preview-"));
    const content = Buffer.from("uploaded-video");
    const sha256 = createHash("sha256").update(content).digest("hex");
    const relativePath = `episodes/${episodeId}/materials/${sha256}-a-shot-001.mp4`;
    await mkdir(join(root, "episodes", episodeId, "materials"), { recursive: true });
    await writeFile(join(root, relativePath), content);

    const supabaseServer = createServer((request, response) => {
      response.setHeader("Content-Type", "application/json");
      const pathname = new URL(request.url ?? "", "http://127.0.0.1").pathname;
      if (pathname === "/rest/v1/artifacts") {
        const shaFilter = new URL(request.url ?? "", "http://127.0.0.1").searchParams.get("sha256");
        response.end(shaFilter === `eq.${sha256}` ? JSON.stringify([{ episode_id: episodeId, sha256 }]) : JSON.stringify([{ episode_id: episodeId, sha256 }, { episode_id: episodeId, sha256: "0".repeat(64) }]));
      }
      else if (pathname === "/rest/v1/production_material_revisions") response.end(JSON.stringify([{ episode_id: episodeId, sha256 }]));
      else if (pathname === "/rest/v1/episodes") response.end(JSON.stringify([{ blueprint_version_id: episodeId }]));
      else if (pathname === "/rest/v1/account_blueprint_versions") response.end(JSON.stringify([{ policy: { asset_root: root } }]));
      else { response.statusCode = 404; response.end("{}"); }
    });
    await new Promise<void>((resolve) => supabaseServer.listen(0, "127.0.0.1", resolve));
    const supabaseOrigin = `http://127.0.0.1:${(supabaseServer.address() as AddressInfo).port}`;
    const middleware = serveLocalArtifact(supabaseOrigin, "publishable-key");
    const previewServer = createServer((request, response) => { void middleware(request, response, () => undefined); });
    await new Promise<void>((resolve) => previewServer.listen(0, "127.0.0.1", resolve));
    const previewOrigin = `http://127.0.0.1:${(previewServer.address() as AddressInfo).port}`;

    try {
      const response = await fetch(`${previewOrigin}/_local-artifact?episode=${episodeId}&path=${encodeURIComponent(relativePath)}&sha256=${sha256}`, { headers: { Authorization: "Bearer owner-token" } });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("video/mp4");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(content);
    } finally {
      await new Promise<void>((resolve, reject) => previewServer.close((error) => error ? reject(error) : resolve()));
      await new Promise<void>((resolve, reject) => supabaseServer.close((error) => error ? reject(error) : resolve()));
      await rm(root, { force: true, recursive: true });
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
      expect((await stat(join(results[0], "captions"))).isDirectory()).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("为 Studio 创建可编辑副本，并只冻结可校验的工程入口", async () => {
    const root = await mkdtemp(join(tmpdir(), "tk-workflow-studio-"));
    try {
      const sourceDirectory = join(root, "episodes", episodeId, "review-render", "v1");
      await mkdir(join(sourceDirectory, "assets"), { recursive: true });
      await writeFile(join(sourceDirectory, "index.html"), "<main>review v1</main>");
      await writeFile(join(sourceDirectory, "assets", "theme.css"), "main { color: red; }");

      const workspace = await prepareHyperframesStudioWorkspace(root, episodeId, `episodes/${episodeId}/review-render/v1/index.html`);
      expect(workspace.relativePath).toMatch(new RegExp(`^episodes/${episodeId}/studio/[0-9a-f-]{36}/index\\.html$`));
      await writeFile(join(root, workspace.relativePath), "<main>edited in Studio</main>");
      const frozen = await freezeHyperframesStudioWorkspace(root, episodeId, workspace.relativePath);

      expect(frozen.relativePath).toMatch(new RegExp(`^episodes/${episodeId}/studio-frozen/[0-9a-f-]{36}/index\\.html$`));
      expect(await readFile(join(root, frozen.relativePath), "utf8")).toBe("<main>edited in Studio</main>");
      await expect(readFile(join(root, frozen.relativePath, "..", "assets", "theme.css"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(root, "episodes", episodeId, "review-render", "v1", "index.html"), "utf8")).toBe("<main>review v1</main>");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("使用独立端口的官方 HyperFrames preview 子命令启动 Studio", () => {
    expect(hyperframesStudioPreviewArguments(`/tmp/episodes/${episodeId}/studio/project`, 3123)).toEqual(["preview", `/tmp/episodes/${episodeId}/studio/project`, "--port=3123", "--background", "--no-open"]);
  });

  it("拒绝把 Studio 工作区指向资产根外或符号链接", async () => {
    const root = await mkdtemp(join(tmpdir(), "tk-workflow-studio-"));
    const outside = await mkdtemp(join(tmpdir(), "tk-workflow-studio-outside-"));
    try {
      const sourceDirectory = join(root, "episodes", episodeId, "review-render", "v1");
      await mkdir(sourceDirectory, { recursive: true });
      await writeFile(join(sourceDirectory, "index.html"), "<main>review v1</main>");
      await expect(prepareHyperframesStudioWorkspace(root, episodeId, `episodes/${episodeId}/review-render/v0/index.html`)).rejects.toThrow("HyperFrames 工程路径无效");
      await symlink(outside, join(sourceDirectory, "unsafe"));
      await expect(prepareHyperframesStudioWorkspace(root, episodeId, `episodes/${episodeId}/review-render/v1/index.html`)).rejects.toThrow("符号链接");
    } finally {
      await Promise.all([rm(root, { force: true, recursive: true }), rm(outside, { force: true, recursive: true })]);
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
        logicalName: "script.md",
        sourceKind: "directory",
        sourcePath: "script.txt",
      });
      await writeFile(join(episodeDirectory, "input", "script.txt"), "Changed outside");

      expect(snapshot).toMatchObject({
        fileSize: 12,
        sha256: "6c9b61c88d4a2f2a053a90540e861226ed0b1ca25396acedf22ef3f5453c1d62",
        sourcePath: "script.md",
        storagePath: `episodes/${episodeId}/materials/6c9b61c88d4a2f2a053a90540e861226ed0b1ca25396acedf22ef3f5453c1d62-script.md`,
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
