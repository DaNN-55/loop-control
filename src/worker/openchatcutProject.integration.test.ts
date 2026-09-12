// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { buildOpenChatCutProject } from "./openchatcutProject";
import { inspectOpenChatCutProjectWithRuntime, verifyOpenChatCutProject } from "./openchatcutProjectReader";
import { closeOpenChatCutStudio, freezeOpenChatCutStudio, openOpenChatCutStudio } from "./openchatcutStudio";
import { confirmedTtsRender } from "./openchatcutProject.fixture";
import { createWorkerTaskPackage } from "./contracts";
import { executeOpenChatCutRender } from "./openchatcutRenderer";
import { defaultShotComposition } from "../shotComposition";

const execFileAsync = promisify(execFile);

const openChatCutRoot = process.env.OPENCHATCUT_ROOT?.trim();
if (!openChatCutRoot) throw new Error("OpenChatCut 集成测试需要 OPENCHATCUT_ROOT。请运行 OPENCHATCUT_ROOT=/absolute/path/to/OpenChatCut npm run test:openchatcut-integration。");
const runtime = { root: openChatCutRoot, nodePath: process.env.OPENCHATCUT_NODE?.trim() || process.execPath };
const episodeIds: string[] = [];
const assetRoots: string[] = [];

afterEach(async () => {
  await Promise.all(episodeIds.splice(0).map(closeOpenChatCutStudio));
  await Promise.all(assetRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("OpenChatCut real project reader integration", () => {
  it("opens Studio and reads editable caption cues back from its project store", async () => {
    const episodeId = "00000000-0000-4000-8000-000000000096";
    episodeIds.push(episodeId);
    const assetRoot = await mkdtemp(join(tmpdir(), "loop-control-openchatcut-studio-test-"));
    assetRoots.push(assetRoot);
    await mkdir(join(assetRoot, "episodes/e"), { recursive: true });
    await writeFile(join(assetRoot, "episodes/e/shot.mp4"), "studio-reader-video-fixture");
    await writeFile(join(assetRoot, "episodes/e/voice.mp3"), "studio-reader-audio-fixture");
    const render = confirmedTtsRender();

    const opened = await openOpenChatCutStudio(assetRoot, episodeId, render, runtime);
    if (!opened.studioUrl) throw new Error("测试未能打开 OpenChatCut Studio。");
    const stored = await waitForStoredProject(new URL(opened.studioUrl).origin, opened.workspace.projectId);
    const observation = await inspectOpenChatCutProjectWithRuntime(stored, runtime);

    expect(opened.studioUrl).toContain(`/#/editor/${opened.workspace.projectId}`);
    expect(observation).toMatchObject({ readable: true, captionTracks: [{ enabled: true, editable: true, cues: [{ id: "cue-shot-1", text: render.confirmedShots[0].subtitleText, start: 0, end: 2000 }] }], textItemsOnCaptionTracks: 0 });
  }, 120_000);

  it("keeps Studio edits mutable, warns before changed workbench input replaces them, and freezes new immutable revisions only on demand", async () => {
    const episodeId = "00000000-0000-4000-8000-000000000105";
    episodeIds.push(episodeId);
    const assetRoot = await mkdtemp(join(tmpdir(), "loop-control-openchatcut-boundary-test-"));
    assetRoots.push(assetRoot);
    await mkdir(join(assetRoot, "episodes/e"), { recursive: true });
    await writeFile(join(assetRoot, "episodes/e/shot.mp4"), "studio-boundary-video-fixture");
    await writeFile(join(assetRoot, "episodes/e/voice.mp3"), "studio-boundary-audio-fixture");
    const render = confirmedTtsRender();
    const opened = await openOpenChatCutStudio(assetRoot, episodeId, render, runtime);
    if (!opened.studioUrl) throw new Error("测试未能打开 OpenChatCut Studio。");
    const origin = new URL(opened.studioUrl).origin;
    const project = await waitForStoredProject(origin, opened.workspace.projectId) as ReturnType<typeof buildOpenChatCutProject>;
    const video = project.timelines[0].items.find((item) => item.kind === "video")!;
    video.transform = { ...video.transform as Record<string, unknown>, x: 12 };
    const caption = project.timelines[0].tracks.C1.captions!.sourceEntries[0].words[0];
    caption.text = "Studio 内继续编辑的字幕";
    const audio = project.timelines[0].items.find((item) => item.kind === "audio")!;
    audio.volume = 0.4;
    video.fadeInFrames = 15;
    await closeOpenChatCutStudio(episodeId);
    const storedProjectPath = join(assetRoot, `episodes/${episodeId}/openchatcut-work/current/runtime/project-store-v1/${encodeURIComponent(`project:${opened.workspace.projectId}`)}.json`);
    await writeFile(storedProjectPath, JSON.stringify(project) + "\n");

    const reopened = await openOpenChatCutStudio(assetRoot, episodeId, render, runtime);
    expect(reopened.replacementWarning).toBeUndefined();
    expect(JSON.parse(await readFile(join(assetRoot, reopened.workspace.relativePath), "utf8")).timelines[0].tracks.C1.captions.sourceEntries[0].words[0].text).toBe("Studio 内继续编辑的字幕");
    expect((await readdir(join(assetRoot, `episodes/${episodeId}/openchatcut-frozen`)).catch(() => []))).toEqual([]);

    const changedRender = structuredClone(render);
    changedRender.confirmedShots[0].inputFingerprint = "changed-workbench-input";
    const warning = await openOpenChatCutStudio(assetRoot, episodeId, changedRender, runtime);
    expect(warning.studioUrl).toBeUndefined();
    expect(warning.replacementWarning).toEqual({ code: "openchatcut_workspace_replacement", studioHasChanges: true, modifiedScopes: expect.arrayContaining(["视频层与片段", "字幕", "音量与音轨", "转场与节奏"]) });
    expect(JSON.parse(await readFile(join(assetRoot, warning.workspace.relativePath), "utf8")).timelines[0].tracks.C1.captions.sourceEntries[0].words[0].text).toBe("Studio 内继续编辑的字幕");

    const replaced = await openOpenChatCutStudio(assetRoot, episodeId, changedRender, runtime, { replaceWorkspace: true });
    expect(replaced.studioUrl).toBeTruthy();
    const firstFrozen = await freezeOpenChatCutStudio(assetRoot, episodeId, replaced.workspace.relativePath);
    const regeneratedProject = await waitForStoredProject(new URL(replaced.studioUrl!).origin, replaced.workspace.projectId) as ReturnType<typeof buildOpenChatCutProject>;
    regeneratedProject.timelines[0].tracks.C1.captions!.sourceEntries[0].words[0].text = "下一次修改";
    await writeFile(storedProjectPath, JSON.stringify(regeneratedProject) + "\n");
    const secondFrozen = await freezeOpenChatCutStudio(assetRoot, episodeId, replaced.workspace.relativePath);
    expect(secondFrozen.relativePath).not.toBe(firstFrozen.relativePath);
    expect(secondFrozen.sha256).not.toBe(firstFrozen.sha256);
    expect(await readFile(join(assetRoot, firstFrozen.relativePath), "utf8")).not.toContain("下一次修改");
    expect(await readFile(join(assetRoot, secondFrozen.relativePath), "utf8")).toContain("下一次修改");
  }, 120_000);

  it("reads a stacked shot as two correctly transformed editable video layers backed by one asset", async () => {
    const render = confirmedTtsRender(true, "2up-vertical");
    const project = buildOpenChatCutProject(render);
    const observation = await verifyOpenChatCutProject(render, project, runtime);

    expect(observation.videoLayers).toMatchObject([
      { id: "shot-shot-1-top", editable: true, transform: { scale: 1, x: 0, y: -25, crop: { left: 0, top: 0.25, right: 0, bottom: 0.25 } } },
      { id: "shot-shot-1-bottom", editable: true, transform: { scale: 1, x: 0, y: 25, crop: { left: 0, top: 0.25, right: 0, bottom: 0.25 } } },
    ]);
    expect(new Set(observation.videoLayers.map((layer) => layer.track)).size).toBe(2);
    expect(observation.assets.filter((asset) => asset.src === "episodes/e/shot.mp4")).toHaveLength(1);
    expect(new Set(observation.videoLayers.map((layer) => layer.sourceAssetId))).toEqual(new Set([observation.assets.find((asset) => asset.src === "episodes/e/shot.mp4")?.id]));
  });

  it("accepts migrated stable track ids when consecutive full-screen segments remain on the V1 alias", async () => {
    const render = confirmedTtsRender();
    const segments = [{ startSeconds: 0, endSeconds: 2 }, { startSeconds: 3, endSeconds: 4.8 }];
    const composition = defaultShotComposition("full", segments.length);
    render.confirmedShots[0].clipSegments = segments;
    render.confirmedShots[0].composition = composition;
    render.confirmedShots[0].preparationContract.clipSegments = segments;
    render.confirmedShots[0].preparationContract.composition = composition;
    render.members[0].clipSegments = segments;
    render.members[0].composition = composition;
    render.members[0].durationSeconds = 3.8;
    render.members[0].preparationContract = render.confirmedShots[0].preparationContract;

    const observation = await verifyOpenChatCutProject(render, buildOpenChatCutProject(render), runtime);

    expect(observation.videoLayers).toMatchObject([
      { id: "shot-shot-1-full-1", alias: "V1", editable: true, startFrame: 0, durationInFrames: 60 },
      { id: "shot-shot-1-full-2", alias: "V1", editable: true, startFrame: 60, durationInFrames: 54 },
    ]);
  });

  it("reads exactly one source-audio item when one material fills multiple visual slots", async () => {
    const render = confirmedTtsRender(false, "2up-vertical");
    render.confirmedShots[0].audioMode = "source";
    render.confirmedShots[0].audioTrackId = "source-track-1";
    render.confirmedShots[0].preparationContract.audioMode = "source";
    render.confirmedShots[0].preparationContract.audioMix = { version: "shot-audio-mix/v1", mainVoice: { mode: "source", trackId: "source-track-1", gainDb: 0, role: "anchor" }, bgm: null, sfx: null };
    render.members = render.members.filter((member) => member.memberKind !== "narration");
    render.members[0].audioMode = "source";
    render.members[0].audioTrackId = "source-track-1";
    render.members[0].preparationContract = render.confirmedShots[0].preparationContract;

    const observation = await verifyOpenChatCutProject(render, buildOpenChatCutProject(render), runtime);
    expect(observation.videoLayers).toHaveLength(2);
    expect(observation.audibleVideoItems).toEqual([]);
    expect(observation.audioTracks.find((track) => track.alias === "A1")).toMatchObject({ role: "anchor", items: [{ id: "main-source-shot-1" }] });
  });

  it("reads silent, BGM-follower, and independent-SFX semantics from the real runtime", async () => {
    const silent = confirmedTtsRender(false);
    silent.confirmedShots[0].audioMode = "none";
    silent.confirmedShots[0].audioTrackId = null;
    silent.confirmedShots[0].preparationContract.audioMode = "none";
    silent.confirmedShots[0].preparationContract.audioMix = { version: "shot-audio-mix/v1", mainVoice: { mode: "none", trackId: null, gainDb: 0, role: "none" }, bgm: null, sfx: null };
    silent.members = silent.members.filter((member) => member.memberKind !== "narration");
    silent.members[0].audioMode = "none";
    silent.members[0].audioTrackId = null;
    silent.members[0].preparationContract = silent.confirmedShots[0].preparationContract;
    const silentObservation = await verifyOpenChatCutProject(silent, buildOpenChatCutProject(silent), runtime);
    expect(silentObservation.audioTracks.find((track) => track.alias === "A1")).toBeUndefined();

    const mixed = confirmedTtsRender(false);
    mixed.confirmedShots[0].preparationContract.audioMix.bgm = { selectionId: "bgm-selection", cueId: null, materialRevisionId: "bgm-material", gainDb: -12, role: "follower", duckingLevel: "strong", duckDepthDb: -14 };
    mixed.confirmedShots[0].preparationContract.audioMix.sfx = { selectionId: "sfx-selection", cueId: "sfx-1", materialRevisionId: null, gainDb: -6, role: "independent", automaticDucking: false };
    mixed.members.push(
      { memberKey: "bgm:episode", memberKind: "soundtrack", audioKind: "bgm", relativePath: "episodes/e/bgm.mp3", sha256: "c".repeat(64), startSeconds: 0, durationSeconds: 2 },
      { memberKey: "sfx:shot-1", memberKind: "soundtrack", audioKind: "sfx", relativePath: "episodes/e/sfx.mp3", sha256: "d".repeat(64), startSeconds: 0.5, durationSeconds: 0.5 },
    );
    const mixedObservation = await verifyOpenChatCutProject(mixed, buildOpenChatCutProject(mixed), runtime);
    expect(mixedObservation.audioTracks.find((track) => track.items.some((item) => item.id === "bgm-shot-1"))).toMatchObject({ role: "follower", duckDepthDb: -14 });
    const sfxTrack = mixedObservation.audioTracks.find((track) => track.alias === "A3");
    expect(sfxTrack?.role).toBeUndefined();
    expect(sfxTrack?.duckDepthDb).toBeUndefined();
  });

  it("reads disabled captions and independent manual cues through the real runtime", async () => {
    const disabled = confirmedTtsRender(false);
    const disabledObservation = await verifyOpenChatCutProject(disabled, buildOpenChatCutProject(disabled), runtime);
    expect(disabledObservation.captionTracks).toMatchObject([{ enabled: true, cues: [] }]);

    const independent = confirmedTtsRender();
    const text = "  Owner 独立字幕\n第二行保持原样。  ";
    independent.confirmedShots[0].subtitleText = text;
    independent.confirmedShots[0].preparationContract.captions = {
      ...independent.confirmedShots[0].preparationContract.captions,
      contentMode: "independent",
      text,
      cues: [
        { id: "owner-1", text: "  Owner 独立字幕\n", startMs: 120, endMs: 880 },
        { id: "owner-2", text: "第二行保持原样。  ", startMs: 920, endMs: 1900 },
      ],
    };
    independent.members[0].subtitleText = text;
    independent.members[0].preparationContract = independent.confirmedShots[0].preparationContract;
    const observation = await verifyOpenChatCutProject(independent, buildOpenChatCutProject(independent), runtime);
    expect(observation.captionTracks[0]).toMatchObject({
      editable: true,
      cues: [
        { id: "cue-shot-1-owner-1", text: "  Owner 独立字幕\n", start: 120, end: 880 },
        { id: "cue-shot-1-owner-2", text: "第二行保持原样。  ", start: 920, end: 1900 },
      ],
    });
  });

  it("renders and probes a real synchronized proxy while preserving the editable project fingerprint", async () => {
    const assetRoot = await mkdtemp(join(tmpdir(), "loop-control-shot-sync-render-"));
    assetRoots.push(assetRoot);
    await mkdir(join(assetRoot, "episodes/e"), { recursive: true });
    await execFileAsync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(assetRoot, "episodes/e/shot.mp4")]);
    for (const [name, frequency] of [["voice", "440"], ["bgm", "220"], ["sfx", "880"]] as const) {
      await execFileAsync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000`, "-t", name === "sfx" ? "0.5" : "2", "-c:a", "libmp3lame", join(assetRoot, `episodes/e/${name}.mp3`)]);
    }
    const render = confirmedTtsRender(false, "2up-vertical");
    render.adjustments.width = 360;
    render.adjustments.height = 640;
    render.confirmedShots[0].preparationContract.transitionMode = "fade";
    render.confirmedShots[0].preparationContract.audioMix.bgm = { selectionId: "bgm-selection", cueId: null, materialRevisionId: "bgm-material", gainDb: -12, role: "follower", duckingLevel: "strong", duckDepthDb: -14 };
    render.confirmedShots[0].preparationContract.audioMix.sfx = { selectionId: "sfx-selection", cueId: "sfx-1", materialRevisionId: null, gainDb: -6, role: "independent", automaticDucking: false };
    render.members[0].preparationContract = render.confirmedShots[0].preparationContract;
    render.members.push(
      { memberKey: "bgm:episode", memberKind: "soundtrack", audioKind: "bgm", relativePath: "episodes/e/bgm.mp3", sha256: "c".repeat(64), startSeconds: 0, durationSeconds: 2 },
      { memberKey: "sfx:shot-1", memberKind: "soundtrack", audioKind: "sfx", relativePath: "episodes/e/sfx.mp3", sha256: "d".repeat(64), startSeconds: 0.5, durationSeconds: 0.5 },
    );
    const taskPackage = createWorkerTaskPackage({
      task: { id: "shot-sync-real", type: "generate_shot_sync_preview", attempt: 0, budgetLimitCents: 0, maxAttempts: 1, provider: "openchatcut", model: "openchatcut@0.2.14", promptVersion: "shot-sync-preview-v1" },
      episode: { id: "episode-real", accountId: "account-real", blueprintVersionId: "blueprint-real", title: "真实同步代理" },
      capability: "review_rendering", allowedTools: ["read", "write"], allowedAssetRoot: assetRoot,
      reviewRender: render,
      output: { requiredArtifactTypes: ["shot_preview_proxy", "shot_editable_project", "shot_preview_runtime", "shot_preview_qc_report"], contentType: "video/mp4", relativePath: "episodes/e/shot-preview/proxy.mp4", reviewStage: "storyboard_approved" },
      inputArtifacts: render.members.map((member) => ({ artifactType: member.memberKind, relativePath: member.relativePath, sha256: member.sha256, fileSize: 1 })),
    });
    const inspect = async (path: string) => {
      const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", path]);
      const probe = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> };
      const video = probe.streams?.find((stream) => stream.codec_type === "video");
      const black = await execFileAsync("ffmpeg", ["-nostdin", "-v", "info", "-i", path, "-vf", "blackdetect=d=0.1:pix_th=0.02", "-an", "-f", "null", "-"]);
      return { durationSeconds: Number(probe.format?.duration), width: Number(video?.width), height: Number(video?.height), hasAudio: Boolean(probe.streams?.some((stream) => stream.codec_type === "audio")), blackFrameCount: (black.stderr.match(/black_start:/g) ?? []).length };
    };
    const result = JSON.parse(await executeOpenChatCutRender({
      taskPackage,
      run: async (_command, args) => { await execFileAsync(process.execPath, [resolve("scripts/openchatcut-render.mjs"), ...args], { env: { ...process.env, OPENCHATCUT_ROOT: openChatCutRoot } }); },
      validateMp4: async (path, minimumDurationSeconds) => { const probe = await inspect(path); expect(probe.durationSeconds).toBeGreaterThanOrEqual(minimumDurationSeconds - 2 / 30); },
      inspectMp4: inspect,
    })) as { artifacts: Array<{ artifactType: string; relativePath: string }>; status: string };
    const proxy = result.artifacts.find((artifact) => artifact.artifactType === "shot_preview_proxy");
    const projectArtifact = result.artifacts.find((artifact) => artifact.artifactType === "shot_editable_project");
    expect(result.status).toBe("completed");
    expect(await inspect(join(assetRoot, proxy!.relativePath))).toMatchObject({ width: 360, height: 640, hasAudio: true, blackFrameCount: 0 });
    const project = JSON.parse(await readFile(join(assetRoot, projectArtifact!.relativePath), "utf8"));
    expect(project.loopControl).toEqual({ version: "shot-sync-preview/v1", inputFingerprint: render.confirmedShots[0].inputFingerprint, transitionMode: "fade" });
    expect(await verifyOpenChatCutProject(render, project, runtime)).toMatchObject({ readable: true });
  }, 120_000);

  it("opens, edits, freezes, and renders one real Episode containing TTS split-screen, source-audio, and silent captioned shots", async () => {
    const episodeId = "00000000-0000-4000-8000-000000000106";
    episodeIds.push(episodeId);
    const assetRoot = await mkdtemp(join(tmpdir(), "loop-control-issue-106-real-episode-"));
    assetRoots.push(assetRoot);
    await mkdir(join(assetRoot, "episodes/e"), { recursive: true });
    await execFileAsync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(assetRoot, "episodes/e/tts.mp4")]);
    await execFileAsync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(assetRoot, "episodes/e/source.mp4")]);
    await execFileAsync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=green:size=640x360:rate=30", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(assetRoot, "episodes/e/silent.mp4")]);
    await execFileAsync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "2", "-c:a", "libmp3lame", join(assetRoot, "episodes/e/voice.mp3")]);
    const render = threePathRender(episodeId);
    render.adjustments.width = 360;
    render.adjustments.height = 640;

    const opened = await openOpenChatCutStudio(assetRoot, episodeId, render, runtime);
    if (!opened.studioUrl) throw new Error("测试未能打开 OpenChatCut Studio。");
    const origin = new URL(opened.studioUrl).origin;
    const project = await waitForStoredProject(origin, opened.workspace.projectId) as ReturnType<typeof buildOpenChatCutProject>;
    const visual = project.timelines[0].items.find((item) => item.id === "shot-shot-tts-top")!;
    visual.transform = { ...visual.transform as Record<string, unknown>, x: 8 };
    const sourceCaption = project.timelines[0].tracks.C1.captions!.sourceEntries.find((entry) => entry.id === "lane-shot-source")!.words[0];
    sourceCaption.text = "OpenChatCut 修改后的原声字幕";
    sourceCaption.start += 50;
    sourceCaption.end -= 50;
    const narration = project.timelines[0].items.find((item) => item.id === "main-tts-narration-shot-tts")!;
    narration.volume = 0.5;
    await closeOpenChatCutStudio(episodeId);
    const storedProjectPath = join(assetRoot, `episodes/${episodeId}/openchatcut-work/current/runtime/project-store-v1/${encodeURIComponent(`project:${opened.workspace.projectId}`)}.json`);
    await writeFile(storedProjectPath, JSON.stringify(project) + "\n");
    const reopened = await openOpenChatCutStudio(assetRoot, episodeId, render, runtime);
    if (!reopened.studioUrl) throw new Error("修改后的 OpenChatCut 工程未能重新打开。");
    const reopenedProject = await waitForStoredProject(new URL(reopened.studioUrl).origin, reopened.workspace.projectId) as ReturnType<typeof buildOpenChatCutProject>;
    expect(reopenedProject.timelines[0].tracks.C1.captions!.sourceEntries.find((entry) => entry.id === "lane-shot-source")!.words[0].text).toBe("OpenChatCut 修改后的原声字幕");
    const frozen = await freezeOpenChatCutStudio(assetRoot, episodeId, reopened.workspace.relativePath);
    render.studioProject = { relativePath: frozen.relativePath, sha256: frozen.sha256, fileSize: frozen.fileSize };
    const taskPackage = createWorkerTaskPackage({
      task: { id: "review-real-three-paths", type: "generate_review_render", attempt: 0, budgetLimitCents: 0, maxAttempts: 1, provider: "openchatcut", model: "openchatcut@0.2.14", promptVersion: "review-render-v1" },
      episode: { id: episodeId, accountId: "account-real", blueprintVersionId: "blueprint-real", title: "Issue 106 三路径真实 Episode" },
      capability: "review_rendering", allowedTools: ["read", "write"], allowedAssetRoot: assetRoot,
      reviewRender: render,
      output: { requiredArtifactTypes: ["review_render_video", "review_render_project", "review_render_runtime", "review_qc_report"], contentType: "video/mp4", relativePath: `episodes/${episodeId}/review-render/v1/review.mp4`, reviewStage: "pre_render" },
      inputArtifacts: render.members.map((member) => ({ artifactType: member.memberKind, relativePath: member.relativePath, sha256: member.sha256, fileSize: 1 })),
    });
    const inspect = async (path: string) => {
      const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", path]);
      const probe = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> };
      const video = probe.streams?.find((stream) => stream.codec_type === "video");
      const black = await execFileAsync("ffmpeg", ["-nostdin", "-v", "info", "-i", path, "-vf", "blackdetect=d=0.1:pix_th=0.02", "-an", "-f", "null", "-"]);
      return { durationSeconds: Number(probe.format?.duration), width: Number(video?.width), height: Number(video?.height), hasAudio: Boolean(probe.streams?.some((stream) => stream.codec_type === "audio")), blackFrameCount: (black.stderr.match(/black_start:/g) ?? []).length };
    };
    const result = JSON.parse(await executeOpenChatCutRender({
      taskPackage,
      run: async (_command, args) => { await execFileAsync(process.execPath, [resolve("scripts/openchatcut-render.mjs"), ...args], { env: { ...process.env, OPENCHATCUT_ROOT: openChatCutRoot } }); },
      validateMp4: async (path, minimumDurationSeconds) => { expect((await inspect(path)).durationSeconds).toBeGreaterThanOrEqual(minimumDurationSeconds - 2 / 30); },
      inspectMp4: inspect,
    })) as { artifacts: Array<{ artifactType: string; relativePath: string }>; status: string };
    const output = result.artifacts.find((artifact) => artifact.artifactType === "review_render_video")!;
    const renderedProject = result.artifacts.find((artifact) => artifact.artifactType === "review_render_project")!;
    expect(result.status).toBe("completed");
    expect(await inspect(join(assetRoot, output.relativePath))).toMatchObject({ width: 360, height: 640, hasAudio: true, blackFrameCount: 0 });
    const renderedProjectText = await readFile(join(assetRoot, renderedProject.relativePath), "utf8");
    expect(renderedProjectText).toContain("OpenChatCut 修改后的原声字幕");
    expect(renderedProjectText).toContain('"x": 8');
    expect(renderedProjectText).toContain('"volume": 0.5');
  }, 180_000);

  it("keeps an older project with a text caption item readable", async () => {
    const legacy = structuredClone(buildOpenChatCutProject(confirmedTtsRender()));
    delete legacy.timelines[0].tracks.C1.captions;
    legacy.timelines[0].items.push({ id: "legacy-caption", track: "C1", startFrame: 0, durationInFrames: 60, kind: "text", name: "旧版字幕", props: { text: "旧版字幕" } });
    expect(await inspectOpenChatCutProjectWithRuntime(legacy, runtime)).toMatchObject({ readable: true, activeTimelineId: "production-order", textItemsOnCaptionTracks: 1 });
  });

  it("blocks known invalid caption contracts after real OpenChatCut reading", async () => {
    const render = confirmedTtsRender();
    const empty = buildOpenChatCutProject(render);
    empty.timelines[0].tracks.C1.captions!.sourceEntries[0].words = [];
    await expect(verifyOpenChatCutProject(render, empty, runtime)).rejects.toThrow("字幕 cues 为空、无效或正文与确认快照不一致");
    const textImpostor = buildOpenChatCutProject(render);
    textImpostor.timelines[0].items.push({ id: "fake-caption", track: "C1", startFrame: 0, durationInFrames: 60, kind: "text", name: "伪字幕" });
    await expect(verifyOpenChatCutProject(render, textImpostor, runtime)).rejects.toThrow("字幕轨包含普通 text item");
    const invalidCue = buildOpenChatCutProject(render);
    invalidCue.timelines[0].tracks.C1.captions!.sourceEntries[0].words[0].end = 0;
    await expect(verifyOpenChatCutProject(render, invalidCue, runtime)).rejects.toThrow("字幕 cues 为空、无效或正文与确认快照不一致");
    const unreadable = buildOpenChatCutProject(render) as unknown as Record<string, unknown>;
    unreadable.version = 99;
    await expect(verifyOpenChatCutProject(render, unreadable, runtime)).rejects.toThrow("OpenChatCut 真实读取失败");
  });
});

async function waitForStoredProject(baseUrl: string, projectId: string): Promise<unknown> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/project-store/entry?key=${encodeURIComponent(`project:${projectId}`)}`, { headers: { "Sec-Fetch-Site": "none" } });
    if (response.ok) {
      const payload = await response.json() as { found?: boolean; value?: unknown };
      if (payload.found && payload.value) return payload.value;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("OpenChatCut Studio 启动后未在 project-store 中导入测试工程。");
}

function threePathRender(episodeId: string): ReturnType<typeof confirmedTtsRender> {
  const render = confirmedTtsRender(true, "2up-vertical");
  render.projectRelativePath = `episodes/${episodeId}/review-render/v1/index.html`;
  const tts = render.confirmedShots[0];
  tts.shotId = "shot-tts";
  tts.inputFingerprint = "1".repeat(32);
  tts.preparationContract.inputFingerprint = tts.inputFingerprint;
  const source = structuredClone(tts);
  source.shotId = "shot-source";
  source.inputFingerprint = "2".repeat(32);
  source.sourceMaterialRevisionId = "material-source";
  source.clipSegments = [{ startSeconds: 0, endSeconds: 2 }];
  source.composition = source.preparationContract.composition = { version: "shot-composition/v1", layout: "full", slots: [{ id: "full", clipSegmentIndex: 0, fit: "cover", focalPoint: { x: 0.5, y: 0.5 } }] };
  source.audioMode = source.preparationContract.audioMode = "source";
  source.audioTrackId = null;
  source.preparationContract.inputFingerprint = source.inputFingerprint;
  source.preparationContract.audioMix = { version: "shot-audio-mix/v1", mainVoice: { mode: "source", trackId: "source-track", gainDb: 0, role: "anchor" }, bgm: null, sfx: null };
  source.subtitleText = source.preparationContract.captions.text = "原声镜头字幕";
  source.preparationContract.captions.contentMode = "independent";
  source.preparationContract.captions.cues = [{ id: "source-cue", text: source.subtitleText, startMs: 0, endMs: 2000 }];
  const silent = structuredClone(source);
  silent.shotId = "shot-silent";
  silent.inputFingerprint = "3".repeat(32);
  silent.audioMode = silent.preparationContract.audioMode = "none";
  silent.audioTrackId = null;
  silent.preparationContract.inputFingerprint = silent.inputFingerprint;
  silent.preparationContract.audioMix = { version: "shot-audio-mix/v1", mainVoice: { mode: "none", trackId: null, gainDb: 0, role: "none" }, bgm: null, sfx: null };
  silent.subtitleText = silent.preparationContract.captions.text = "静音镜头仍有画面字幕";
  silent.preparationContract.captions.contentMode = "independent";
  silent.preparationContract.captions.cues = [{ id: "silent-cue", text: silent.subtitleText, startMs: 0, endMs: 2000 }];
  render.confirmedShots = [tts, source, silent];
  render.storyboard.shots = [
    { id: "shot-tts", scriptSegment: "TTS 分屏", durationSeconds: 2, shotType: "a_roll", productionMethod: "自然语言仅作说明", inputBasis: [], targetSpec: "9:16" },
    { id: "shot-source", scriptSegment: "原声", durationSeconds: 2, shotType: "b_roll", productionMethod: "结构由契约决定", inputBasis: [], targetSpec: "9:16" },
    { id: "shot-silent", scriptSegment: "静音字幕", durationSeconds: 2, shotType: "a_roll", productionMethod: "不解析这里的构图描述", inputBasis: [], targetSpec: "9:16" },
  ];
  const visual = (shot: typeof tts, relativePath: string, sha256: string) => ({ memberKey: `shot:${shot.shotId}`, memberKind: "shot_media" as const, taskId: shot.videoTaskId, artifactId: shot.videoArtifactId, ...(shot.sourceMaterialRevisionId ? { sourceMaterialRevisionId: shot.sourceMaterialRevisionId, clipSegments: shot.clipSegments } : {}), inputFingerprint: shot.inputFingerprint, composition: shot.composition, preparationContract: shot.preparationContract, relativePath, sha256, startSeconds: 0, durationSeconds: 2, audioMode: shot.audioMode, audioTrackId: shot.audioTrackId, subtitleText: shot.subtitleText, subtitlesEnabled: true });
  render.members = [
    visual(tts, "episodes/e/tts.mp4", "a".repeat(64)),
    { memberKey: "narration:shot-tts", memberKind: "narration", taskId: "audio-task-shot-tts", audioTrackId: "audio-track-1", relativePath: "episodes/e/voice.mp3", sha256: "b".repeat(64), startSeconds: 0, durationSeconds: 2, audioMode: "tts" },
    visual(source, "episodes/e/source.mp4", "c".repeat(64)),
    visual(silent, "episodes/e/silent.mp4", "d".repeat(64)),
  ];
  return render;
}
