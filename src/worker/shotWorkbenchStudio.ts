import type {WorkerTaskPackage, ShotPreparationContract, StoryboardManifest} from "./contracts.js";
import {shotCompositionTiming} from "../shotComposition.js";
const isEpisodeId=(id:string)=>/^[0-9a-f-]{36}$/i.test(id);
export interface ShotWorkbenchStudioInput {
  allowedFrames: number;
  audioTracks: Array<{ id?: string; cueId: string; relativePath: string; sha256: string; startSeconds: number; durationSeconds: number }>;
  drafts: Array<{ audioMode: "none" | "source" | "tts"; audioTrackId: string | null; clipSegments: Array<{ startSeconds: number; endSeconds: number }>; composition: ShotPreparationContract["composition"]; confirmationStatus: "confirmed"; inputFingerprint: string; materialRevisionId: string | null; preparationContract: ShotPreparationContract; shotId: string; subtitleText: string; subtitlesEnabled: boolean; ttsText: string | null; videoArtifactId: string | null; videoTaskId: string | null }>;
  soundtrackMembers?: NonNullable<WorkerTaskPackage["reviewRender"]>["members"];
  frameRate: number;
  materials: Array<{ id: string; relativePath: string; sha256: string }>;
  storyboard: StoryboardManifest;
}

export function parseShotWorkbenchClipSegments(value: unknown): Array<{ startSeconds: number; endSeconds: number }> {
  if (!Array.isArray(value)) return [];
  return value.map((segment) => {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) throw new Error("Studio 片段标记无效。");
    const record = segment as Record<string, unknown>;
    const startSeconds = record.start_seconds;
    const endSeconds = record.end_seconds;
    if (typeof startSeconds !== "number" || !Number.isFinite(startSeconds) || startSeconds < 0 || typeof endSeconds !== "number" || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) throw new Error("Studio 片段标记无效。");
    return { startSeconds, endSeconds };
  });
}

export function shotWorkbenchReviewRender(episodeId: string, projectRelativePath: string, input: ShotWorkbenchStudioInput): NonNullable<WorkerTaskPackage["reviewRender"]> {
  if (!isEpisodeId(episodeId)) throw new Error("无效的 Episode ID。");
  const materialById = new Map(input.materials.map((material) => [material.id, material]));
  const trackByCueId = new Map(input.audioTracks.map((track) => [track.cueId, track]));
  const members: NonNullable<WorkerTaskPackage["reviewRender"]>["members"] = [];
  let timelineStartSeconds = 0;
  for (const shot of input.storyboard.shots) {
    const draft = input.drafts.find((candidate) => candidate.shotId === shot.id);
    const material = draft?.materialRevisionId ? materialById.get(draft.materialRevisionId) : undefined;
    const segments = draft?.clipSegments?.length ? draft.clipSegments : [{ startSeconds: 0, endSeconds: shot.durationSeconds }];
    const durationSeconds = shotCompositionTiming(segments, draft?.composition).playbackDurationSeconds;
    members.push({
      memberKey: `shot:${shot.id}`,
      memberKind: "shot_media",
      mediaMissing: !material,
      sourceMaterialRevisionId: material?.id,
      clipSegments: segments,
      composition: draft?.composition,
      preparationContract: draft?.preparationContract,
      inputFingerprint: draft?.inputFingerprint,
      audioTrackId: draft?.audioTrackId,
      audioMode: draft?.audioMode ?? "none",
      relativePath: material?.relativePath ?? `episodes/${episodeId}/studio-work/missing-${members.length}.mp4`,
      sha256: material?.sha256 ?? "0".repeat(64),
      subtitleText: draft?.subtitlesEnabled === false ? "" : draft?.subtitleText ?? shot.scriptSegment,
      subtitlesEnabled: draft?.subtitlesEnabled !== false,
      startSeconds: timelineStartSeconds,
      durationSeconds,
    });
    const track = trackByCueId.get(shot.id);
    if (draft?.audioMode === "tts" && track) {
      members.push({
        memberKey: `narration:${shot.id}`,
        memberKind: "narration",
        audioTrackId: track.id ?? track.cueId,
        audioMode: "tts",
        relativePath: track.relativePath,
        sha256: track.sha256,
        startSeconds: timelineStartSeconds + track.startSeconds,
        durationSeconds: track.durationSeconds,
      });
    }
    timelineStartSeconds += durationSeconds;
  }
  return {
    compositionId: "shot-workbench",
    projectRelativePath,
    projectRevision: 1,
    preRenderReviewPackageId: "shot-workbench",
    confirmationMode: "shot_preparation",
    confirmedShots: input.storyboard.shots.map((shot) => {
      const draft = input.drafts.find((candidate) => candidate.shotId === shot.id);
      if (!draft) throw new Error(`镜头 ${shot.id} 缺少当前版本化准备契约。`);
      return {
        shotId: shot.id,
        confirmationStatus: draft.confirmationStatus,
        inputFingerprint: draft.inputFingerprint,
        ...(draft.videoArtifactId ? { videoArtifactId: draft.videoArtifactId } : {}),
        ...(draft.videoTaskId ? { videoTaskId: draft.videoTaskId } : {}),
        ...(draft.materialRevisionId ? { sourceMaterialRevisionId: draft.materialRevisionId, clipSegments: draft.clipSegments } : {}),
        composition: draft.composition,
        preparationContract: draft.preparationContract,
        audioMode: draft.audioMode,
        audioTrackId: draft.audioTrackId,
        subtitleText: draft.subtitleText,
        subtitlesEnabled: draft.subtitlesEnabled,
      };
    }),
    adjustments: {
      aspectRatio: "9:16",
      width: 1080,
      height: 1920,
      captionsEnabled: true,
      captionStyle: "minimal",
      pacing: "standard",
      crop: "cover",
      transition: "cut",
      layout: "lower_third",
      narrationGainDb: 0,
      bgmGainDb: -12,
      sfxGainDb: -6,
      frameRate: input.frameRate,
      allowedFrames: input.allowedFrames,
      reason: "镜头工作版本",
    },
    storyboard: input.storyboard,
    members: [...members, ...(input.soundtrackMembers ?? [])],
  };
}
