import { describe, expect, it } from "vitest";
import { activeOpenChatCutState, buildOpenChatCutProject } from "./openchatcutProject";

describe("OpenChatCut production-order conversion", () => {
  it("keeps frozen media, timing, captions, and audio on one editable timeline", () => {
    const project = buildOpenChatCutProject({
      projectRelativePath: "episodes/e/review-render/v1/index.html",
      projectRevision: 1,
      preRenderReviewPackageId: "review",
      adjustments: { aspectRatio: "9:16", width: 1080, height: 1920, captionsEnabled: true, captionStyle: "minimal", pacing: "standard", crop: "cover", transition: "cut", layout: "center", narrationGainDb: 0, bgmGainDb: -12, sfxGainDb: -6, frameRate: 30, allowedFrames: 2, reason: "test" },
      storyboard: { version: "storyboard/v1", shots: [{ id: "shot-1", scriptSegment: "第一镜", durationSeconds: 2, shotType: "b_roll", productionMethod: "冻结素材", inputBasis: [], targetSpec: "9:16" }], audioCues: [] },
      members: [
        { memberKey: "shot:shot-1", memberKind: "shot_media", relativePath: "episodes/e/shot.mp4", sha256: "a".repeat(64), startSeconds: 0, durationSeconds: 2, audioMode: "none", subtitleText: "第一镜", subtitlesEnabled: true },
        { memberKey: "narration:shot-1", memberKind: "narration", relativePath: "episodes/e/voice.mp3", sha256: "b".repeat(64), startSeconds: 0, durationSeconds: 2, audioMode: "tts" },
      ],
    });
    const state = activeOpenChatCutState(project);
    expect(project.version).toBe(3);
    expect(project.assets).toHaveLength(2);
    expect(state.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "video", track: "V1", startFrame: 0, durationInFrames: 60 }),
      expect.objectContaining({ kind: "audio", track: "A1", startFrame: 0, durationInFrames: 60 }),
      expect.objectContaining({ kind: "text", track: "C1", durationInFrames: 60 }),
    ]));
  });
});
