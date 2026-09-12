import { defaultShotComposition, type ShotCompositionLayout } from "../shotComposition";
import { defaultShotCaptionContract } from "../shotCaptions";
import { normalizeShotAudioMix } from "../shotAudioMix";
import type { WorkerTaskPackage } from "./contracts";

type ConfirmedTtsRender = NonNullable<WorkerTaskPackage["reviewRender"]> & {
  confirmedShots: NonNullable<NonNullable<WorkerTaskPackage["reviewRender"]>["confirmedShots"]>;
};

export function confirmedTtsRender(subtitlesEnabled = true, layout: ShotCompositionLayout = "full"): ConfirmedTtsRender {
  const subtitleText = "  已确认正文，必须原样保留。\n第二行也不能改写。  ";
  const composition = defaultShotComposition(layout, 1);
  const captions = { ...defaultShotCaptionContract(subtitleText, "follow_tts", subtitlesEnabled), cues: subtitlesEnabled ? [{ id: "aligned-1", text: subtitleText, startMs: 0, endMs: 2000 }] : [] };
  const preparationContract = { version: "shot-preparation/v1" as const, storyboardFingerprint: "0".repeat(32), sourceMaterialRevisionId: "material-1", clipSegments: [{ startSeconds: 0, endSeconds: 2 }], composition, transitionMode: "cut" as const, audioMode: "tts" as const, ttsText: subtitleText, ttsVoice: "voice-a", ttsSpeakingRate: 1.2, audioMix: normalizeShotAudioMix(undefined, { audioMode: "tts", audioTrackId: "audio-track-1" }), captions, inputFingerprint: "1".repeat(32) };
  return {
    projectRelativePath: "episodes/e/review-render/v1/index.html",
    projectRevision: 1,
    preRenderReviewPackageId: "review",
    confirmationMode: "shot_preparation" as const,
    confirmedShots: [{ shotId: "shot-1", confirmationStatus: "confirmed" as const, inputFingerprint: "1".repeat(32), videoArtifactId: "video-artifact-1", videoTaskId: "video-task-1", composition, preparationContract, audioMode: "tts" as const, audioTrackId: "audio-track-1", subtitleText, subtitlesEnabled }],
    adjustments: { aspectRatio: "9:16" as const, width: 1080, height: 1920, captionsEnabled: true, captionStyle: "minimal" as const, pacing: "standard" as const, crop: "cover" as const, transition: "cut" as const, layout: "center" as const, narrationGainDb: 0, bgmGainDb: -12, sfxGainDb: -6, frameRate: 30, allowedFrames: 2, reason: "test" },
    storyboard: { version: "storyboard/v1" as const, shots: [{ id: "shot-1", scriptSegment: "第一镜", durationSeconds: 2, shotType: "a_roll" as const, productionMethod: "全屏 TTS", inputBasis: [], targetSpec: "9:16" }], audioCues: [] },
    members: [
      { memberKey: "shot:shot-1", memberKind: "shot_media" as const, taskId: "video-task-1", artifactId: "video-artifact-1", inputFingerprint: "1".repeat(32), composition, preparationContract, relativePath: "episodes/e/shot.mp4", sha256: "a".repeat(64), startSeconds: 0, durationSeconds: 2, audioMode: "tts" as const, subtitleText, subtitlesEnabled },
      { memberKey: "narration:shot-1", memberKind: "narration" as const, taskId: "audio-task-1", audioTrackId: "audio-track-1", relativePath: "episodes/e/voice.mp3", sha256: "b".repeat(64), startSeconds: 0, durationSeconds: 2, audioMode: "tts" as const },
    ],
  };
}
