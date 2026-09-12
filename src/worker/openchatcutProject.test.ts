import { describe, expect, it } from "vitest";
import { buildOpenChatCutProject, openChatCutSlotTransform } from "./openchatcutProject";
import { assertConfirmedShotAudioReadable, assertConfirmedShotCaptionsReadable, assertConfirmedShotLayoutsReadable, type OpenChatCutProjectObservation } from "./openchatcutProjectReader";
import { confirmedTtsRender } from "./openchatcutProject.fixture";
import { openChatCutModifiedScopes } from "./openchatcutStudio";
import { defaultShotComposition, shotCompositionLayouts, shotCompositionRect } from "../shotComposition";

describe("OpenChatCut production-order conversion", () => {
  it("places full-screen prepared segments sequentially and adds their durations", () => {
    const render = confirmedTtsRender();
    const segments = [{ startSeconds: 0, endSeconds: 2 }, { startSeconds: 3, endSeconds: 4.8 }];
    render.confirmedShots[0].clipSegments = segments;
    render.confirmedShots[0].composition = defaultShotComposition("full", 2);
    render.confirmedShots[0].preparationContract.clipSegments = segments;
    render.confirmedShots[0].preparationContract.composition = render.confirmedShots[0].composition;
    render.members[0].clipSegments = segments;
    render.members[0].composition = render.confirmedShots[0].composition;
    render.members[0].durationSeconds = 3.8;
    render.members[0].preparationContract = render.confirmedShots[0].preparationContract;

    const videos = buildOpenChatCutProject(render).timelines[0].items.filter((item) => item.kind === "video");
    expect(videos).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "shot-shot-1-full-1", startFrame: 0, durationInFrames: 60, srcInFrame: 0 }),
      expect.objectContaining({ id: "shot-shot-1-full-2", startFrame: 60, durationInFrames: 54, srcInFrame: 90 }),
    ]));
    expect(() => assertConfirmedShotLayoutsReadable(render, observationFromProject(buildOpenChatCutProject(render)))).not.toThrow();
  });

  it("places split-screen segments in parallel without doubling the timeline", () => {
    const render = confirmedTtsRender(true, "2up-vertical");
    const segments = [{ startSeconds: 0, endSeconds: 3.8 }, { startSeconds: 10, endSeconds: 13.8 }];
    const composition = defaultShotComposition("2up-vertical", 2);
    render.confirmedShots[0].clipSegments = segments;
    render.confirmedShots[0].composition = composition;
    render.confirmedShots[0].preparationContract.clipSegments = segments;
    render.confirmedShots[0].preparationContract.composition = composition;
    render.members[0].clipSegments = segments;
    render.members[0].composition = composition;
    render.members[0].durationSeconds = 3.8;
    render.members[0].preparationContract = render.confirmedShots[0].preparationContract;

    const videos = buildOpenChatCutProject(render).timelines[0].items.filter((item) => item.kind === "video");
    expect(videos).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "shot-shot-1-top", startFrame: 0, durationInFrames: 114 }),
      expect.objectContaining({ id: "shot-shot-1-bottom", startFrame: 0, durationInFrames: 114 }),
    ]));
    expect(Math.max(...videos.map((item) => Number(item.startFrame) + Number(item.durationInFrames)))).toBe(114);
  });

  it("classifies editable Studio changes before a workbench regeneration can overwrite them", () => {
    const base = buildOpenChatCutProject(confirmedTtsRender());
    const edited = structuredClone(base);
    const video = edited.timelines[0].items.find((item) => item.kind === "video")!;
    const audio = edited.timelines[0].items.find((item) => item.kind === "audio")!;
    video.transform = { ...video.transform as Record<string, unknown>, x: 10 };
    video.fadeInFrames = 8;
    audio.volume = 0.5;
    edited.timelines[0].tracks.C1.captions!.sourceEntries[0].words[0].text = "Studio 字幕";
    expect(openChatCutModifiedScopes(base, edited)).toEqual(["视频层与片段", "字幕", "音量与音轨", "转场与节奏"]);
  });

  it("writes confirmed TTS subtitles as caption cues without rewriting the body", () => {
    const render = confirmedTtsRender();
    const project = buildOpenChatCutProject(render);
    expect(project.timelines[0].tracks.C1.captions?.sourceEntries[0].words).toEqual([{ id: "cue-shot-1", text: render.confirmedShots[0].subtitleText, start: 0, end: 2000 }]);
    expect(project.timelines[0].items).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: "text", track: "C1" })]));
    expect(project.timelines[0].tracks.C1.captions).toMatchObject({ layoutPolicy: { mode: "manual-slots", slots: [{ anchor: "bottom-center", offsetXRatio: 0, offsetYRatio: -0.18, widthRatio: 0.84, heightRatio: 0.74 }] }, perSource: { "lane-shot-1": { maxLines: 2, maxCharactersPerLine: 16 } } });
  });

  it("writes custom caption margins as editable OpenChatCut slot geometry", () => {
    const render = confirmedTtsRender();
    render.confirmedShots[0].preparationContract.captions.spatial = { version: "shot-caption-space/v2", anchor: "bottom-center", safeArea: "custom", aspectRatio: "16:9", insets: { top: 0.08, right: 0.12, bottom: 0.16, left: 0.06 }, maxLines: 2, maxCharactersPerLine: 16 };
    render.members[0].preparationContract = render.confirmedShots[0].preparationContract;
    const slot = buildOpenChatCutProject(render).timelines[0].tracks.C1.captions?.layoutPolicy.slots[0];
    expect(slot).toMatchObject({ anchor: "bottom-center", offsetXRatio: -0.03, offsetYRatio: -0.16, widthRatio: 0.82, heightRatio: 0.76 });
  });

  it.each(["cut", "fade", "studio"] as const)("keeps the %s transition and input fingerprint in the same editable project", (transitionMode) => {
    const render = confirmedTtsRender();
    render.confirmedShots[0].preparationContract.transitionMode = transitionMode;
    render.members[0].preparationContract = render.confirmedShots[0].preparationContract;
    const project = buildOpenChatCutProject(render);
    const video = project.timelines[0].items.find((item) => item.kind === "video");
    expect(project.loopControl).toEqual({ version: "shot-sync-preview/v1", inputFingerprint: render.confirmedShots[0].inputFingerprint, transitionMode });
    expect(video?.fadeInFrames).toBe(transitionMode === "fade" ? 11 : undefined);
    expect(video?.fadeOutFrames).toBe(transitionMode === "fade" ? 11 : undefined);
  });

  it("keeps independent subtitle text byte-for-byte instead of replacing it with TTS", () => {
    const render = confirmedTtsRender();
    const independentText = "  独立字幕\n保留原始空白。  ";
    render.confirmedShots[0].subtitleText = independentText;
    render.confirmedShots[0].preparationContract.captions = { ...render.confirmedShots[0].preparationContract.captions, contentMode: "independent", text: independentText, cues: [{ id: "aligned-independent", text: independentText, startMs: 0, endMs: 2000 }] };
    render.members[0].subtitleText = independentText;
    render.members[0].preparationContract = render.confirmedShots[0].preparationContract;
    const project = buildOpenChatCutProject(render);
    expect(project.timelines[0].tracks.C1.captions?.sourceEntries[0].words.map((cue) => cue.text).join("")).toBe(independentText);
  });

  it("preserves manual cues and their editable timing", () => {
    const render = confirmedTtsRender();
    const captions = render.confirmedShots[0].preparationContract.captions;
    captions.cues = [
      { id: "intro", text: "  已确认正文，", startMs: 100, endMs: 800 },
      { id: "outro", text: "必须原样保留。\n第二行也不能改写。  ", startMs: 900, endMs: 1900 },
    ];
    const project = buildOpenChatCutProject(render);
    expect(project.timelines[0].tracks.C1.captions?.sourceEntries[0].words).toEqual([
      { id: "cue-shot-1-intro", text: captions.cues[0].text, start: 100, end: 800 },
      { id: "cue-shot-1-outro", text: captions.cues[1].text, start: 900, end: 1900 },
    ]);
  });

  it("refuses to fabricate acoustic timing by averaging text over the audio duration", () => {
    const render = confirmedTtsRender();
    render.confirmedShots[0].preparationContract.captions.cues = [];
    expect(() => buildOpenChatCutProject(render)).toThrow("字幕尚未完成声学对齐或手动时序");
  });

  it("allows an empty caption track when every confirmed shot disables subtitles", () => {
    const render = confirmedTtsRender(false);
    const project = buildOpenChatCutProject(render);
    expect(project.timelines[0].tracks.C1.captions?.sourceEntries).toEqual([]);
    expect(() => assertConfirmedShotCaptionsReadable(render, { readable: true, activeTimelineId: "production-order", captionTracks: [{ id: "C1", enabled: true, editable: false, cues: [] }], textItemsOnCaptionTracks: 0, audioTracks: [], audibleVideoItems: [], videoLayers: [], assets: [] })).not.toThrow();
  });

  it("requires a matching valid cue when a confirmed shot enables subtitles", () => {
    const render = confirmedTtsRender();
    expect(() => assertConfirmedShotCaptionsReadable(render, { readable: true, activeTimelineId: "production-order", captionTracks: [{ id: "C1", enabled: true, editable: false, cues: [] }], textItemsOnCaptionTracks: 0, audioTracks: [], audibleVideoItems: [], videoLayers: [], assets: [] })).toThrow("字幕 cues 为空、无效或正文与确认快照不一致");
  });

  it.each(shotCompositionLayouts)("converts %s into stable independent editable video layers", (layout) => {
    const render = confirmedTtsRender(true, layout);
    render.storyboard.shots[0].productionMethod = layout === "2up-vertical" ? "自然语言故意写成全屏，不得覆盖结构化布局" : "自然语言只供 Owner 阅读";
    const project = buildOpenChatCutProject(render);
    const observation = observationFromProject(project);
    expect(() => assertConfirmedShotLayoutsReadable(render, observation)).not.toThrow();
    expect(observation.videoLayers).toHaveLength(render.confirmedShots[0].preparationContract.composition.slots.length);
    expect(new Set(observation.videoLayers.map((layer) => layer.track)).size).toBe(observation.videoLayers.length);
    expect(project.assets.filter((asset) => asset.kind === "video")).toHaveLength(1);
    expect(new Set(observation.videoLayers.map((layer) => layer.sourceAssetId))).toEqual(new Set([project.assets.find((asset) => asset.kind === "video")?.id]));
  });

  it("rejects the known stacked-layout regression when only one full-screen video layer exists", () => {
    const render = confirmedTtsRender(true, "2up-vertical");
    const project = buildOpenChatCutProject(render);
    project.timelines[0].items = project.timelines[0].items.filter((item) => item.id !== "shot-shot-1-bottom");
    expect(() => assertConfirmedShotLayoutsReadable(render, observationFromProject(project))).toThrow("没有生成全部独立构图视频层");
  });

  it("keeps TTS as the only authoritative main voice and mutes every visual layer", () => {
    const render = confirmedTtsRender();
    const observation = observationFromProject(buildOpenChatCutProject(render));
    expect(() => assertConfirmedShotAudioReadable(render, observation)).not.toThrow();
    expect(observation.audioTracks.find((track) => track.id === "A1")).toMatchObject({ role: "anchor", items: [{ id: "main-tts-narration-shot-1" }] });
    expect(observation.audibleVideoItems).toEqual([]);
  });

  it("registers source audio once when one source segment fills multiple visual slots", () => {
    const render = confirmedTtsRender(false, "2up-vertical");
    render.confirmedShots[0].audioMode = "source";
    render.confirmedShots[0].audioTrackId = "source-track-1";
    render.confirmedShots[0].preparationContract.audioMode = "source";
    render.confirmedShots[0].preparationContract.audioMix = { version: "shot-audio-mix/v1", mainVoice: { mode: "source", trackId: "source-track-1", gainDb: 0, role: "anchor" }, bgm: null, sfx: null };
    render.members = render.members.filter((member) => member.memberKind !== "narration");
    render.members[0].audioMode = "source";
    render.members[0].audioTrackId = "source-track-1";
    render.members[0].preparationContract = render.confirmedShots[0].preparationContract;
    const project = buildOpenChatCutProject(render);
    const observation = observationFromProject(project);
    expect(() => assertConfirmedShotAudioReadable(render, observation)).not.toThrow();
    expect(observation.videoLayers).toHaveLength(2);
    expect(observation.audioTracks.find((track) => track.id === "A1")?.items).toHaveLength(1);
    expect(project.assets.filter((asset) => asset.src === "episodes/e/shot.mp4")).toHaveLength(1);
  });

  it("stitches disjoint full-screen source-audio segments on one authoritative track", () => {
    const render = confirmedTtsRender(false);
    const segments = [{ startSeconds: 0, endSeconds: 2 }, { startSeconds: 3, endSeconds: 4.8 }];
    const composition = defaultShotComposition("full", 2);
    render.confirmedShots[0].audioMode = "source";
    render.confirmedShots[0].audioTrackId = "source-track-1";
    render.confirmedShots[0].clipSegments = segments;
    render.confirmedShots[0].composition = composition;
    render.confirmedShots[0].preparationContract = { ...render.confirmedShots[0].preparationContract, audioMode: "source", audioMix: { version: "shot-audio-mix/v1", mainVoice: { mode: "source", trackId: "source-track-1", gainDb: 0, role: "anchor" }, bgm: null, sfx: null }, clipSegments: segments, composition };
    render.members = render.members.filter((member) => member.memberKind !== "narration");
    Object.assign(render.members[0], { audioMode: "source", audioTrackId: "source-track-1", clipSegments: segments, composition, durationSeconds: 3.8, preparationContract: render.confirmedShots[0].preparationContract });
    const project = buildOpenChatCutProject(render);
    const mainItems = project.timelines[0].items.filter((item) => item.kind === "audio" && item.track === "A1");
    expect(mainItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "main-source-shot-1-1", startFrame: 0, durationInFrames: 60, srcInFrame: 0 }),
      expect.objectContaining({ id: "main-source-shot-1-2", startFrame: 60, durationInFrames: 54, srcInFrame: 90 }),
    ]));
    expect(() => assertConfirmedShotAudioReadable(render, observationFromProject(project))).not.toThrow();
  });

  it("creates no authoritative main voice for silent shots", () => {
    const render = confirmedTtsRender(false);
    render.confirmedShots[0].audioMode = "none";
    render.confirmedShots[0].audioTrackId = null;
    render.confirmedShots[0].preparationContract.audioMode = "none";
    render.confirmedShots[0].preparationContract.audioMix = { version: "shot-audio-mix/v1", mainVoice: { mode: "none", trackId: null, gainDb: 0, role: "none" }, bgm: null, sfx: null };
    render.members = render.members.filter((member) => member.memberKind !== "narration");
    render.members[0].audioMode = "none";
    render.members[0].audioTrackId = null;
    render.members[0].preparationContract = render.confirmedShots[0].preparationContract;
    const observation = observationFromProject(buildOpenChatCutProject(render));
    expect(() => assertConfirmedShotAudioReadable(render, observation)).not.toThrow();
    expect(observation.audioTracks.find((track) => track.id === "A1")).toBeUndefined();
    expect(observation.audibleVideoItems).toEqual([]);
  });

  it("keeps BGM as a follower and SFX outside automatic ducking", () => {
    const render = confirmedTtsRender(false);
    render.confirmedShots[0].preparationContract.audioMix.bgm = { selectionId: "bgm-selection", cueId: null, materialRevisionId: "bgm-material", gainDb: -12, role: "follower", duckingLevel: "strong", duckDepthDb: -14 };
    render.confirmedShots[0].preparationContract.audioMix.sfx = { selectionId: "sfx-selection", cueId: "sfx-1", materialRevisionId: null, gainDb: -6, role: "independent", automaticDucking: false };
    render.members.push(
      { memberKey: "bgm:episode", memberKind: "soundtrack", audioKind: "bgm", relativePath: "episodes/e/bgm.mp3", sha256: "c".repeat(64), startSeconds: 0, durationSeconds: 2 },
      { memberKey: "sfx:shot-1", memberKind: "soundtrack", audioKind: "sfx", relativePath: "episodes/e/sfx.mp3", sha256: "d".repeat(64), startSeconds: 0.5, durationSeconds: 0.5 },
    );
    const observation = observationFromProject(buildOpenChatCutProject(render));
    expect(() => assertConfirmedShotAudioReadable(render, observation)).not.toThrow();
    expect(observation.audioTracks.find((track) => track.items.some((item) => item.id === "bgm-shot-1"))).toMatchObject({ role: "follower", duckDepthDb: -14 });
    expect(observation.audioTracks.find((track) => track.id === "A3")).toMatchObject({ role: undefined, duckDepthDb: undefined });
  });

  it("maps contain and cover focal-point choices to explicit OpenChatCut transforms", () => {
    expect(openChatCutSlotTransform(shotCompositionRect("2up-horizontal", "left"), { id: "left", clipSegmentIndex: 0, fit: "contain", focalPoint: { x: 0.5, y: 0.5 } })).toEqual({ scale: 0.5, x: -25, y: 0, rotation: 0 });
    expect(openChatCutSlotTransform(shotCompositionRect("2up-vertical", "top"), { id: "top", clipSegmentIndex: 0, fit: "cover", focalPoint: { x: 0.5, y: 1 } })).toEqual({ scale: 1, x: 0, y: -50, rotation: 0, crop: { left: 0, top: 0.5, right: 0, bottom: 0 } });
  });

  it("rejects the removed legacy project writer while keeping the reader separate", () => {
    const render = { ...confirmedTtsRender(), confirmationMode: undefined, confirmedShots: undefined };
    expect(() => buildOpenChatCutProject(render as unknown as Parameters<typeof buildOpenChatCutProject>[0])).toThrow("只接受版本化镜头准备契约");
  });
});

function observationFromProject(project: ReturnType<typeof buildOpenChatCutProject>): OpenChatCutProjectObservation {
  const timeline = project.timelines[0];
  return {
    readable: true,
    activeTimelineId: project.activeTimelineId,
    captionTracks: [],
    textItemsOnCaptionTracks: 0,
    audioTracks: Object.entries(timeline.tracks).filter(([, track]) => track.kind === "audio").map(([id, track]) => ({ id, role: track.role, duckDepthDb: track.audioRouting?.duckDepthDb, items: timeline.items.filter((item) => item.kind === "audio" && item.track === id).map((item) => ({ id: String(item.id), src: String(item.src), sourceAssetId: String(item.sourceAssetId), startFrame: Number(item.startFrame), durationInFrames: Number(item.durationInFrames), srcInFrame: Number(item.srcInFrame ?? 0), volume: Number(item.volume ?? 1) })) })),
    audibleVideoItems: timeline.items.filter((item) => item.kind === "video" && Number(item.volume ?? 1) > 0).map((item) => ({ id: String(item.id), track: String(item.track), volume: Number(item.volume ?? 1) })),
    videoLayers: timeline.items.filter((item) => item.kind === "video").map((item) => ({ id: String(item.id), track: String(item.track), startFrame: Number(item.startFrame), durationInFrames: Number(item.durationInFrames), sourceAssetId: String(item.sourceAssetId), editable: true, transform: item.transform as Record<string, unknown> })),
    assets: project.assets.map(({ id, src }) => ({ id, src })),
  };
}
