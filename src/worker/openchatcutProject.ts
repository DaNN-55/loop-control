import type { StoryboardShotManifest, WorkerTaskPackage } from "./contracts.js";
import { normalizeShotComposition, shotCompositionRect, shotCompositionTiming, type ShotCompositionRect, type ShotCompositionSlot } from "../shotComposition.js";
import { captionCuesForShot, shotCaptionSafeAreaGeometry } from "../shotCaptions.js";
import { normalizeShotAudioMix, type BgmDuckingLevel, type ShotAudioMixContract } from "../shotAudioMix.js";

type ReviewRender = NonNullable<WorkerTaskPackage["reviewRender"]>;

export interface OpenChatCutProject {
  version: 3;
  loopControl?: {
    version: "shot-sync-preview/v1";
    inputFingerprint: string;
    transitionMode: "cut" | "fade" | "studio";
  };
  assets: Array<{ id: string; name: string; kind: "video" | "audio"; src: string; durationInFrames: number }>;
  mediaFolders: [];
  timelines: [OpenChatCutTimeline];
  activeTimelineId: string;
}

export interface OpenChatCutTimeline {
  id: string;
  name: string;
  order: 0;
  fps: number;
  width: number;
  height: number;
  fit: "cover" | "contain";
  items: Array<Record<string, unknown>>;
  trackOrder: string[];
  tracks: Record<string, OpenChatCutTrack>;
  transitions: Array<Record<string, unknown>>;
  selectedId: null;
  captionsHidden: boolean;
}

interface OpenChatCutCaptionCue {
  id: string;
  text: string;
  start: number;
  end: number;
}

interface OpenChatCutTrack {
  kind: "video" | "audio" | "caption";
  name: string;
  role?: "anchor" | "follower";
  audioRouting?: { duckDepthDb: number };
  captions?: {
    enabled: true;
    template: "black-bar";
    pacing: "phrase";
    sourceMode: "item";
    sourceEntries: Array<{ id: string; itemId: string; label: string; slotId: string; widthRatio: number; heightRatio: number; maxCharactersPerLine: number; words: OpenChatCutCaptionCue[] }>;
    layoutPolicy: { mode: "manual-slots"; slots: Array<{ id: string; anchor: string; offsetXRatio: number; offsetYRatio: number; widthRatio: number; heightRatio: number }> };
    perSource: Record<string, { maxLines: number; maxCharactersPerLine: number }>;
  };
}

export function buildOpenChatCutProject(render: ReviewRender, projectId = "production-order"): OpenChatCutProject {
  if (render.confirmationMode !== "shot_preparation" || !Array.isArray(render.confirmedShots)) {
    throw new Error("OpenChatCut 新工程只接受版本化镜头准备契约。");
  }
  const fps = render.adjustments.frameRate ?? 30;
  const items: Array<Record<string, unknown>> = [];
  const captionSourceEntries: NonNullable<OpenChatCutTrack["captions"]>["sourceEntries"] = [];
  const captionSlots: NonNullable<OpenChatCutTrack["captions"]>["layoutPolicy"]["slots"] = [];
  const captionPerSource: NonNullable<OpenChatCutTrack["captions"]>["perSource"] = {};
  const confirmedShots = new Map(render.confirmedShots.map((shot) => [shot.shotId, shot]));
  const assets = new Map<string, { id: string; name: string; kind: "video" | "audio"; src: string; durationInFrames: number }>();
  const shotWindows: Array<{ shotId: string; startFrame: number; durationInFrames: number; mix: ShotAudioMixContract }> = [];
  const audioTracks = new Map<string, OpenChatCutTrack>();
  let maximumVideoLayerCount = 1;
  let timelineFrame = 0;

  for (const shot of render.storyboard.shots) {
    const member = render.members.find((candidate) => candidate.memberKey === `shot:${shot.id}`);
    if (!member || member.mediaMissing) continue;
    const segments = member.clipSegments?.length ? member.clipSegments : [{ startSeconds: 0, endSeconds: member.durationSeconds }];
    const shotStartFrame = timelineFrame;
    const confirmedShot = confirmedShots?.get(shot.id);
    const audioMode = confirmedShot?.audioMode ?? member.audioMode ?? "none";
    const audioMix = normalizeShotAudioMix(confirmedShot?.preparationContract.audioMix, { audioMode, audioTrackId: confirmedShot?.audioTrackId ?? member.audioTrackId });
    const composition = normalizeShotComposition(confirmedShot?.composition ?? member.composition, segments.length);
    const timing = shotCompositionTiming(segments, composition);
    const shotFrames = Math.max(1, Math.round(timing.playbackDurationSeconds * fps));
    const asset = addAsset(assets, member, fps, "video");
    maximumVideoLayerCount = Math.max(maximumVideoLayerCount, composition.slots.length);
    const transitionMode = confirmedShot?.preparationContract.transitionMode ?? render.adjustments.transition;
    if (composition.layout === "full") {
      let segmentStartFrame = shotStartFrame;
      for (const [segmentIndex, segment] of segments.entries()) {
        const durationInFrames = Math.max(1, Math.round((segment.endSeconds - segment.startSeconds) * fps));
        items.push({
          id: segments.length === 1 ? `shot-${shot.id}-full` : `shot-${shot.id}-full-${segmentIndex + 1}`,
          track: "V1",
          startFrame: segmentStartFrame,
          durationInFrames,
          kind: "video",
          name: `${shot.id} · 片段 ${segmentIndex + 1}`,
          src: member.relativePath,
          sourceAssetId: asset.id,
          srcInFrame: Math.max(0, Math.round(segment.startSeconds * fps)),
          volume: 0,
          transform: openChatCutSlotTransform(shotCompositionRect("full", "full"), composition.slots[0]),
          fadeInFrames: transitionMode === "fade" && segmentIndex === 0 ? Math.round(fps * 0.35) : undefined,
          fadeOutFrames: transitionMode === "fade" && segmentIndex === segments.length - 1 ? Math.round(fps * 0.35) : undefined,
        });
        segmentStartFrame += durationInFrames;
      }
    } else {
      for (const [slotIndex, slot] of composition.slots.entries()) {
        const segment = segments[slot.clipSegmentIndex];
        items.push({
          id: `shot-${shot.id}-${slot.id}`,
          track: `V${slotIndex + 1}`,
          startFrame: shotStartFrame,
          durationInFrames: shotFrames,
          kind: "video",
          name: `${shot.id} · ${slot.id}`,
          src: member.relativePath,
          sourceAssetId: asset.id,
          srcInFrame: Math.max(0, Math.round(segment.startSeconds * fps)),
          volume: 0,
          transform: openChatCutSlotTransform(shotCompositionRect(composition.layout, slot.id), slot),
          fadeInFrames: transitionMode === "fade" ? Math.round(fps * 0.35) : undefined,
          fadeOutFrames: transitionMode === "fade" ? Math.round(fps * 0.35) : undefined,
        });
      }
    }
    shotWindows.push({ shotId: shot.id, startFrame: shotStartFrame, durationInFrames: shotFrames, mix: audioMix });
    if (audioMix.mainVoice.mode === "source") {
      const sourceSegments = composition.layout === "full" ? segments : [segments[composition.slots[0].clipSegmentIndex]];
      let sourceStartFrame = shotStartFrame;
      for (const [segmentIndex, sourceSegment] of sourceSegments.entries()) {
        const durationInFrames = composition.layout === "full" ? Math.max(1, Math.round((sourceSegment.endSeconds - sourceSegment.startSeconds) * fps)) : shotFrames;
        items.push({
          id: sourceSegments.length === 1 ? `main-source-${shot.id}` : `main-source-${shot.id}-${segmentIndex + 1}`,
          track: "A1",
          startFrame: sourceStartFrame,
          durationInFrames,
          kind: "audio",
          name: `${shot.id} · 权威原声${sourceSegments.length > 1 ? ` · 片段 ${segmentIndex + 1}` : ""}`,
          src: member.relativePath,
          sourceAssetId: asset.id,
          srcInFrame: Math.max(0, Math.round(sourceSegment.startSeconds * fps)),
          volume: dbToGain(audioMix.mainVoice.gainDb),
        });
        sourceStartFrame += durationInFrames;
      }
      audioTracks.set("A1", { kind: "audio", name: "主声音", role: "anchor" });
    }
    timelineFrame += shotFrames;
    const subtitlesEnabled = confirmedShot?.subtitlesEnabled ?? member.subtitlesEnabled;
    const subtitleText = confirmedShot?.subtitleText ?? member.subtitleText;
    if (render.adjustments.captionsEnabled && subtitlesEnabled !== false && subtitleText?.trim()) {
      const captions = confirmedShot?.preparationContract.captions;
      if (!captions) throw new Error(`镜头 ${shot.id} 缺少版本化字幕契约。`);
      const laneId = `lane-${shot.id}`;
      const slotId = `caption-slot-${shot.id}`;
      const safeArea = shotCaptionSafeAreaGeometry(captions.spatial);
      const localCues = captionCuesForShot(captions, shotFrames * 1000 / fps);
      if (!localCues.length) throw new Error(`镜头 ${shot.id} 字幕尚未完成声学对齐或手动时序，不能生成字幕轨。`);
      captionSourceEntries.push({
        id: laneId,
        itemId: `manual:${laneId}`,
        label: `${shot.id} 字幕`,
        slotId,
        widthRatio: safeArea.width,
        heightRatio: safeArea.height,
        maxCharactersPerLine: captions.spatial.maxCharactersPerLine,
        words: localCues.map((cue, index) => ({ id: localCues.length === 1 ? `cue-${shot.id}` : `cue-${shot.id}-${cue.id || index + 1}`, text: cue.text, start: Math.round(shotStartFrame * 1000 / fps + cue.startMs), end: Math.round(shotStartFrame * 1000 / fps + cue.endMs) })),
      });
      captionSlots.push({ id: slotId, anchor: captions.spatial.anchor, offsetXRatio: safeArea.offsetX, offsetYRatio: safeArea.offsetY, widthRatio: safeArea.width, heightRatio: safeArea.height });
      captionPerSource[laneId] = { maxLines: captions.spatial.maxLines, maxCharactersPerLine: captions.spatial.maxCharactersPerLine };
    }
  }

  const bgmMembers: ReviewRender["members"] = [];
  for (const member of render.members.filter((candidate) => candidate.memberKind !== "shot_media")) {
    const startFrame = Math.max(0, Math.round(member.startSeconds * fps));
    const durationInFrames = Math.max(1, Math.round(member.durationSeconds * fps));
    const isNarration = member.memberKind === "narration";
    if (member.audioKind === "bgm") { bgmMembers.push(member); continue; }
    const shotId = member.memberKey.split(":").slice(1).join(":");
    const shotWindow = shotWindows.find((candidate) => candidate.shotId === shotId);
    if (isNarration && (!shotWindow || shotWindow.mix.mainVoice.mode !== "tts" || (shotWindow.mix.mainVoice.trackId && member.audioTrackId !== shotWindow.mix.mainVoice.trackId))) continue;
    const isSfx = member.audioKind === "sfx";
    const track = isNarration ? "A1" : isSfx ? "A3" : "A2";
    items.push({
      id: `${isNarration ? "main-tts" : "soundtrack"}-${member.memberKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
      track,
      startFrame,
      durationInFrames,
      kind: "audio",
      name: member.memberKey,
      src: member.relativePath,
      volume: dbToGain(isNarration ? shotWindow?.mix.mainVoice.gainDb ?? render.adjustments.narrationGainDb : isSfx ? shotWindow?.mix.sfx?.gainDb ?? render.adjustments.sfxGainDb : render.adjustments.bgmGainDb),
    });
    addAsset(assets, member, fps, "audio");
    if (isNarration) audioTracks.set("A1", { kind: "audio", name: "主声音", role: "anchor" });
    else if (isSfx) audioTracks.set("A3", { kind: "audio", name: "音效" });
    else audioTracks.set("A2", { kind: "audio", name: "配乐", role: "follower", audioRouting: { duckDepthDb: -10 } });
  }

  for (const bgmMember of bgmMembers) {
      const bgmAsset = addAsset(assets, bgmMember, fps, "audio");
      for (const shotWindow of shotWindows) {
        const bgm = shotWindow.mix.bgm;
        if (!bgm) continue;
        const track = bgmTrackId(bgm.duckingLevel);
        audioTracks.set(track, { kind: "audio", name: `配乐 · 闪避${bgm.duckingLevel}`, role: "follower", audioRouting: { duckDepthDb: bgm.duckDepthDb } });
        items.push({
          id: `bgm-${shotWindow.shotId}`,
          track,
          startFrame: shotWindow.startFrame,
          durationInFrames: shotWindow.durationInFrames,
          kind: "audio",
          name: `${shotWindow.shotId} · BGM`,
          src: bgmMember.relativePath,
          sourceAssetId: bgmAsset.id,
          srcInFrame: Math.max(0, shotWindow.startFrame - Math.round(bgmMember.startSeconds * fps)),
          volume: dbToGain(bgm.gainDb),
        });
      }
  }

  const timeline: OpenChatCutTimeline = {
    id: projectId,
    name: "生产单审核时间线",
    order: 0,
    fps,
    width: render.adjustments.width,
    height: render.adjustments.height,
    fit: render.adjustments.crop,
    items,
    trackOrder: [...Array.from({ length: maximumVideoLayerCount }, (_, index) => `V${maximumVideoLayerCount - index}`), ...audioTrackOrder(audioTracks), "C1"],
    tracks: {
      ...Object.fromEntries(Array.from({ length: maximumVideoLayerCount }, (_, index) => [`V${index + 1}`, { kind: "video" as const, name: `画面层 ${index + 1}` }])),
      ...Object.fromEntries(audioTracks),
      C1: {
        kind: "caption",
        name: "字幕",
        captions: {
          enabled: true,
          template: "black-bar",
          pacing: "phrase",
          sourceMode: "item",
          sourceEntries: captionSourceEntries,
          layoutPolicy: { mode: "manual-slots", slots: captionSlots },
          perSource: captionPerSource,
        },
      },
    },
    transitions: [],
    selectedId: null,
    captionsHidden: !render.adjustments.captionsEnabled,
  };
  const onlyConfirmedShot = render.confirmedShots.length === 1 ? render.confirmedShots[0] : null;
  return {
    version: 3,
    ...(onlyConfirmedShot ? { loopControl: { version: "shot-sync-preview/v1" as const, inputFingerprint: onlyConfirmedShot.inputFingerprint, transitionMode: onlyConfirmedShot.preparationContract.transitionMode } } : {}),
    assets: [...assets.values()],
    mediaFolders: [],
    timelines: [timeline],
    activeTimelineId: projectId,
  };
}

function bgmTrackId(level: BgmDuckingLevel): string {
  return `A2-${level}`;
}

function audioTrackOrder(tracks: Map<string, OpenChatCutTrack>): string[] {
  return [...tracks.keys()].sort((left, right) => left.localeCompare(right));
}

export function buildOpenChatCutCardProject(shot: StoryboardShotManifest, projectId: string): OpenChatCutProject {
  const fps = 30;
  const durationInFrames = Math.max(1, Math.round(shot.durationSeconds * fps));
  const timeline: OpenChatCutTimeline = {
    id: projectId,
    name: `${shot.shotType === "a_roll" ? "A-roll" : "B-roll"} 卡片`,
    order: 0,
    fps,
    width: 1080,
    height: 1920,
    fit: "cover",
    items: [{
      id: `card-${shot.id}`,
      track: "C1",
      startFrame: 0,
      durationInFrames,
      kind: "text",
      name: shot.id,
      width: 1080,
      height: 1920,
      props: { text: `${shot.shotType === "a_roll" ? "A-ROLL" : "B-ROLL"}\n${shot.scriptSegment}\n${shot.productionMethod}`, align: "center", color: "#ffffff", fontSize: 64, fontWeight: 700 },
    }],
    trackOrder: ["C1"],
    tracks: { C1: { kind: "caption", name: "卡片" } },
    transitions: [],
    selectedId: null,
    captionsHidden: false,
  };
  return { version: 3, assets: [], mediaFolders: [], timelines: [timeline], activeTimelineId: projectId };
}

function addAsset(
  assets: Map<string, { id: string; name: string; kind: "video" | "audio"; src: string; durationInFrames: number }>,
  member: ReviewRender["members"][number],
  fps: number,
  kind: "video" | "audio",
): { id: string; name: string; kind: "video" | "audio"; src: string; durationInFrames: number } {
  const existing = assets.get(member.relativePath);
  if (existing) return existing;
  const asset = { id: `asset-${assets.size + 1}`, name: member.relativePath.split("/").pop() ?? member.memberKey, kind, src: member.relativePath, durationInFrames: Math.max(1, Math.round(member.durationSeconds * fps)) };
  assets.set(member.relativePath, asset);
  return asset;
}

export function openChatCutSlotTransform(rect: ShotCompositionRect, slot: ShotCompositionSlot): Record<string, unknown> {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  if (slot.fit === "contain") {
    return { scale: round(Math.min(rect.width, rect.height), 6), x: round((centerX - 0.5) * 100, 4), y: round((centerY - 0.5) * 100, 4), rotation: 0 };
  }
  const wide = rect.width >= rect.height;
  const visibleWidth = wide ? 1 : rect.width / rect.height;
  const visibleHeight = wide ? rect.height / rect.width : 1;
  const scale = rect.width / visibleWidth;
  const left = (1 - visibleWidth) * slot.focalPoint.x;
  const top = (1 - visibleHeight) * slot.focalPoint.y;
  const visibleCenterX = left + visibleWidth / 2;
  const visibleCenterY = top + visibleHeight / 2;
  const crop = visibleWidth < 1 || visibleHeight < 1 ? {
    left: round(left, 6), top: round(top, 6), right: round(1 - visibleWidth - left, 6), bottom: round(1 - visibleHeight - top, 6),
  } : undefined;
  return {
    scale: round(scale, 6),
    x: round((centerX - (0.5 + (visibleCenterX - 0.5) * scale)) * 100, 4),
    y: round((centerY - (0.5 + (visibleCenterY - 0.5) * scale)) * 100, 4),
    rotation: 0,
    ...(crop ? { crop } : {}),
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function dbToGain(db: number): number {
  return Math.max(0, Math.min(4, 10 ** (db / 20)));
}

export function activeOpenChatCutState(project: OpenChatCutProject): Record<string, unknown> {
  const timeline = project.timelines.find((candidate) => candidate.id === project.activeTimelineId) ?? project.timelines[0];
  return { ...timeline, assets: project.assets };
}

export function openChatCutProjectPath(path: string): string {
  return path.endsWith("/index.html") ? `${path.slice(0, -"/index.html".length)}/project.json` : path.endsWith(".json") ? path : `${path}/project.json`;
}
