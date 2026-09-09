import type { StoryboardShotManifest, WorkerTaskPackage } from "./contracts.js";

type ReviewRender = NonNullable<WorkerTaskPackage["reviewRender"]>;

export interface OpenChatCutProject {
  version: 3;
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
  tracks: Record<string, { kind: "video" | "audio" | "caption"; name: string; role?: "anchor" | "follower"; audioRouting?: { duckDepthDb: number } }>;
  transitions: Array<Record<string, unknown>>;
  selectedId: null;
  captionsHidden: boolean;
}

export function buildOpenChatCutProject(render: ReviewRender, projectId = "production-order"): OpenChatCutProject {
  const fps = render.adjustments.frameRate ?? 30;
  const items: Array<Record<string, unknown>> = [];
  const assets = new Map<string, { id: string; name: string; kind: "video" | "audio"; src: string; durationInFrames: number }>();
  let timelineFrame = 0;

  for (const shot of render.storyboard.shots) {
    const member = render.members.find((candidate) => candidate.memberKey === `shot:${shot.id}`);
    if (!member || member.mediaMissing) continue;
    const segments = member.clipSegments?.length ? member.clipSegments : [{ startSeconds: 0, endSeconds: member.durationSeconds }];
    const shotStartFrame = timelineFrame;
    let shotFrames = 0;
    for (const [segmentIndex, segment] of segments.entries()) {
      const durationInFrames = Math.max(1, Math.round((segment.endSeconds - segment.startSeconds) * fps));
      const itemId = `shot-${shot.id}-${segmentIndex}`;
      items.push({
        id: itemId,
        track: "V1",
        startFrame: timelineFrame,
        durationInFrames,
        kind: "video",
        name: shot.id,
        src: member.relativePath,
        srcInFrame: Math.max(0, Math.round(segment.startSeconds * fps)),
        volume: member.audioMode === "source" ? 1 : 0,
        fadeInFrames: render.adjustments.transition === "fade" && segmentIndex === 0 ? Math.round(fps * 0.35) : undefined,
        fadeOutFrames: render.adjustments.transition === "fade" && segmentIndex === segments.length - 1 ? Math.round(fps * 0.35) : undefined,
      });
      timelineFrame += durationInFrames;
      shotFrames += durationInFrames;
    }
    if (render.adjustments.captionsEnabled && member.subtitlesEnabled !== false && member.subtitleText?.trim()) {
      items.push({
        id: `caption-${shot.id}`,
        track: "C1",
        startFrame: shotStartFrame,
        durationInFrames: shotFrames,
        kind: "text",
        name: `字幕 ${shot.id}`,
        width: render.adjustments.width,
        height: render.adjustments.height,
        props: {
          text: member.subtitleText,
          align: render.adjustments.layout === "center" ? "center" : "left",
          color: "#ffffff",
          fontSize: render.adjustments.captionStyle === "cinematic" ? 72 : 58,
          fontWeight: 700,
        },
      });
    }
    addAsset(assets, member, fps, "video");
  }

  for (const member of render.members.filter((candidate) => candidate.memberKind !== "shot_media")) {
    const startFrame = Math.max(0, Math.round(member.startSeconds * fps));
    const durationInFrames = Math.max(1, Math.round(member.durationSeconds * fps));
    const isNarration = member.memberKind === "narration";
    items.push({
      id: `${isNarration ? "narration" : "soundtrack"}-${member.memberKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
      track: isNarration ? "A1" : "A2",
      startFrame,
      durationInFrames,
      kind: "audio",
      name: member.memberKey,
      src: member.relativePath,
      volume: dbToGain(isNarration ? render.adjustments.narrationGainDb : member.audioKind === "sfx" ? render.adjustments.sfxGainDb : render.adjustments.bgmGainDb),
    });
    addAsset(assets, member, fps, "audio");
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
    trackOrder: ["V1", "A1", "A2", "C1"],
    tracks: {
      V1: { kind: "video", name: "画面" },
      A1: { kind: "audio", name: "旁白", role: "anchor", audioRouting: { duckDepthDb: -10 } },
      A2: { kind: "audio", name: "配乐 / 音效", role: "follower" },
      C1: { kind: "caption", name: "字幕" },
    },
    transitions: [],
    selectedId: null,
    captionsHidden: !render.adjustments.captionsEnabled,
  };
  return { version: 3, assets: [...assets.values()], mediaFolders: [], timelines: [timeline], activeTimelineId: projectId };
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
): void {
  if (assets.has(member.relativePath)) return;
  assets.set(member.relativePath, { id: `asset-${assets.size + 1}`, name: member.relativePath.split("/").pop() ?? member.memberKey, kind, src: member.relativePath, durationInFrames: Math.max(1, Math.round(member.durationSeconds * fps)) });
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
