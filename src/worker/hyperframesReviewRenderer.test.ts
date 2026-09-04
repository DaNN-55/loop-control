import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createWorkerTaskPackage } from "./contracts";
import type { WorkerTaskPackageInput } from "./contracts";
import { buildQcReport, clipVideoArguments, projectHtml } from "./hyperframesReviewRenderer";

describe("HyperFrames 审核渲染工程", () => {
  it("确认快照完整覆盖 TTS、原声和无口播三种镜头音频模式", () => {
    const input: WorkerTaskPackageInput = {
      task: { id: "render-audio-modes", type: "generate_review_render", attempt: 0, budgetLimitCents: 0, maxAttempts: 1, provider: "hyperframes", model: "hyperframes@0.7.109", promptVersion: "review-render-v1" },
      episode: { id: "episode-audio-modes", accountId: "account-1", blueprintVersionId: "blueprint-1", title: "三种声音模式" },
      capability: "review_rendering", allowedTools: ["read", "write"], allowedAssetRoot: "/Volumes/Media/account-1",
      output: { requiredArtifactTypes: ["render", "review_render_project", "review_qc_report"], contentType: "video/mp4", relativePath: "episodes/episode-audio-modes/review-render/v1/review-render.mp4", reviewStage: "qc_review" },
      inputArtifacts: [
        { artifactType: "shot_video", relativePath: "episodes/episode-audio-modes/video/shot-tts.mp4", sha256: "a".repeat(64), fileSize: 10 },
        { artifactType: "shot_video", relativePath: "episodes/episode-audio-modes/video/shot-source.mp4", sha256: "b".repeat(64), fileSize: 10 },
        { artifactType: "shot_video", relativePath: "episodes/episode-audio-modes/video/shot-none.mp4", sha256: "c".repeat(64), fileSize: 10 },
        { artifactType: "narration_audio", relativePath: "episodes/episode-audio-modes/audio/shot-tts.mp3", sha256: "d".repeat(64), fileSize: 10 },
        { artifactType: "source_audio", relativePath: "episodes/episode-audio-modes/audio/shot-source.mp3", sha256: "e".repeat(64), fileSize: 10 },
      ],
      reviewRender: {
        projectRelativePath: "episodes/episode-audio-modes/review-render/v1/index.html", projectRevision: 1, preRenderReviewPackageId: "package-audio-modes", confirmationMode: "shot_preparation",
        confirmedShots: [
          { shotId: "shot-tts", confirmationStatus: "confirmed", inputFingerprint: "1".repeat(32), videoArtifactId: "video-tts", videoTaskId: "task-video-tts", audioMode: "tts", audioTrackId: "track-tts", subtitleText: "TTS 字幕", subtitlesEnabled: true },
          { shotId: "shot-source", confirmationStatus: "confirmed", inputFingerprint: "2".repeat(32), videoArtifactId: "video-source", videoTaskId: "task-video-source", audioMode: "source", audioTrackId: "track-source", subtitleText: "原声字幕", subtitlesEnabled: true },
          { shotId: "shot-none", confirmationStatus: "confirmed", inputFingerprint: "3".repeat(32), videoArtifactId: "video-none", videoTaskId: "task-video-none", audioMode: "none", audioTrackId: null, subtitleText: "静音字幕", subtitlesEnabled: false },
        ],
        adjustments: { aspectRatio: "9:16", width: 1080, height: 1920, captionsEnabled: true, captionStyle: "minimal", pacing: "standard", crop: "cover", transition: "cut", layout: "lower_third", narrationGainDb: 0, bgmGainDb: -12, sfxGainDb: -6, reason: "确认三种镜头声音模式。" },
        storyboard: { version: "storyboard/v1", audioCues: [], shots: [
          { id: "shot-tts", scriptSegment: "TTS", durationSeconds: 2, shotType: "a_roll", productionMethod: "人工", inputBasis: [{ relativePath: "episodes/episode-audio-modes/video/shot-tts.mp4", sha256: "a".repeat(64) }], targetSpec: "9:16" },
          { id: "shot-source", scriptSegment: "原声", durationSeconds: 2, shotType: "a_roll", productionMethod: "人工", inputBasis: [{ relativePath: "episodes/episode-audio-modes/video/shot-source.mp4", sha256: "b".repeat(64) }], targetSpec: "9:16" },
          { id: "shot-none", scriptSegment: "静音", durationSeconds: 2, shotType: "b_roll", productionMethod: "素材", inputBasis: [{ relativePath: "episodes/episode-audio-modes/video/shot-none.mp4", sha256: "c".repeat(64) }], targetSpec: "9:16" },
        ] },
        members: [
          { memberKey: "shot:shot-tts", memberKind: "shot_media", taskId: "task-video-tts", artifactId: "video-tts", inputFingerprint: "1".repeat(32), audioMode: "tts", subtitleText: "TTS 字幕", subtitlesEnabled: true, relativePath: "episodes/episode-audio-modes/video/shot-tts.mp4", sha256: "a".repeat(64), startSeconds: 0, durationSeconds: 2 },
          { memberKey: "narration:shot-tts", memberKind: "narration", taskId: "task-tts", audioTrackId: "track-tts", audioMode: "tts", relativePath: "episodes/episode-audio-modes/audio/shot-tts.mp3", sha256: "d".repeat(64), startSeconds: 0, durationSeconds: 2 },
          { memberKey: "shot:shot-source", memberKind: "shot_media", taskId: "task-video-source", artifactId: "video-source", inputFingerprint: "2".repeat(32), audioMode: "source", subtitleText: "原声字幕", subtitlesEnabled: true, relativePath: "episodes/episode-audio-modes/video/shot-source.mp4", sha256: "b".repeat(64), startSeconds: 2, durationSeconds: 2 },
          { memberKey: "narration:shot-source", memberKind: "narration", taskId: "task-source", audioTrackId: "track-source", audioMode: "source", relativePath: "episodes/episode-audio-modes/audio/shot-source.mp3", sha256: "e".repeat(64), startSeconds: 2, durationSeconds: 2 },
          { memberKey: "shot:shot-none", memberKind: "shot_media", taskId: "task-video-none", artifactId: "video-none", inputFingerprint: "3".repeat(32), audioMode: "none", subtitleText: "静音字幕", subtitlesEnabled: false, relativePath: "episodes/episode-audio-modes/video/shot-none.mp4", sha256: "c".repeat(64), startSeconds: 4, durationSeconds: 2 },
        ],
      },
    };

    const taskPackage = createWorkerTaskPackage(input);
    const html = projectHtml(taskPackage);
    expect(html).toContain("TTS 字幕");
    expect(html).toContain("原声字幕");
    expect(html).not.toContain("静音字幕");
    expect((html.match(/<audio /g) ?? []).length).toBe(2);
    expect(() => createWorkerTaskPackage({ ...input, reviewRender: { ...input.reviewRender!, members: input.reviewRender!.members.map((member) => member.memberKey === "narration:shot-source" ? { ...member, audioTrackId: "stale-track" } : member) } })).toThrow("音频版本");
    expect(() => createWorkerTaskPackage({ ...input, reviewRender: { ...input.reviewRender!, members: [...input.reviewRender!.members, { ...input.reviewRender!.members[1], memberKey: "narration:shot-none", audioTrackId: "track-none", audioMode: "none" }] } })).toThrow("音频版本");
  });

  it("只引用冻结的镜头媒体与音轨，并为每个镜头建立时间线字幕", () => {
    const input: WorkerTaskPackageInput = {
      task: { id: "render-1", type: "generate_review_render", attempt: 0, budgetLimitCents: 0, maxAttempts: 1, provider: "hyperframes", model: "hyperframes@0.7.109", promptVersion: "review-render-v1" },
      episode: { id: "episode-1", accountId: "account-1", blueprintVersionId: "blueprint-1", title: "雨夜" },
      capability: "review_rendering", allowedTools: ["read", "write"], allowedAssetRoot: "/Volumes/Media/account-1",
      output: { requiredArtifactTypes: ["render", "review_render_project", "review_qc_report"], contentType: "video/mp4", relativePath: "episodes/episode-1/review-render/v1/review-render.mp4", reviewStage: "qc_review" },
      inputArtifacts: [
        { artifactType: "b_roll_asset", relativePath: "episodes/episode-1/b-roll/shot-1.mp4", sha256: "a".repeat(64), fileSize: 10 },
        { artifactType: "narration_audio", relativePath: "episodes/episode-1/audio/shot-1.mp3", sha256: "b".repeat(64), fileSize: 10 },
        { artifactType: "audio_track", relativePath: "episodes/episode-1/audio/bgm-1.mp3", sha256: "c".repeat(64), fileSize: 10 },
      ],
      reviewRender: {
        projectRelativePath: "episodes/episode-1/review-render/v1/index.html", projectRevision: 1, preRenderReviewPackageId: "package-1", confirmationMode: "shot_preparation", confirmedShots: [{ shotId: "shot-1", confirmationStatus: "confirmed", inputFingerprint: "a".repeat(32), videoArtifactId: "video-artifact-1", videoTaskId: "video-task-1", audioMode: "tts", audioTrackId: "audio-track-1", subtitleText: "确认字幕。", subtitlesEnabled: true }], studioProject: { relativePath: "episodes/episode-1/studio-frozen/00000000-0000-0000-0000-000000000001/index.html", sha256: "d".repeat(64), fileSize: 48 },
        adjustments: { aspectRatio: "9:16", width: 1080, height: 1920, captionsEnabled: true, captionStyle: "minimal", pacing: "gentle", crop: "contain", transition: "cut", layout: "center", narrationGainDb: 0, bgmGainDb: -12, sfxGainDb: -6, reason: "字幕需要更克制，保留完整画面。" },
        storyboard: { version: "storyboard/v1", shots: [{ id: "shot-1", scriptSegment: "雨落在旧街。", durationSeconds: 4, shotType: "b_roll", productionMethod: "Pexels", inputBasis: [{ relativePath: "episodes/episode-1/b-roll/shot-1.mp4", sha256: "a".repeat(64) }], targetSpec: "9:16" }], audioCues: [] },
        members: [
          { memberKey: "shot:shot-1", memberKind: "shot_media", taskId: "video-task-1", artifactId: "video-artifact-1", inputFingerprint: "a".repeat(32), audioMode: "tts", subtitleText: "确认字幕。", subtitlesEnabled: true, relativePath: "episodes/episode-1/b-roll/shot-1.mp4", sha256: "a".repeat(64), startSeconds: 10, durationSeconds: 4 },
          { memberKey: "narration:shot-1", memberKind: "narration", taskId: "narration-task-1", audioTrackId: "audio-track-1", audioMode: "tts", relativePath: "episodes/episode-1/audio/shot-1.mp3", sha256: "b".repeat(64), startSeconds: 0, durationSeconds: 4 },
          { memberKey: "soundtrack:bgm-1", memberKind: "soundtrack", audioKind: "bgm", relativePath: "episodes/episode-1/audio/bgm-1.mp3", sha256: "c".repeat(64), startSeconds: 0, durationSeconds: 4 },
        ],
      },
    };
    const taskPackage = createWorkerTaskPackage(input);
    const html = projectHtml(taskPackage);
    expect(html).toContain("assets/");
    expect(html).not.toContain("../");
    expect(html).toContain("确认字幕。");
    expect(html).not.toContain("雨落在旧街。");
    expect(() => createWorkerTaskPackage({ ...input, reviewRender: { ...input.reviewRender!, confirmedShots: [{ ...input.reviewRender!.confirmedShots![0], videoArtifactId: "another-video" }] } })).toThrow("版本不一致");
    expect(html).toContain('data-duration="4"');
    expect(html).toContain(`${createHash("sha256").update("episodes/episode-1/b-roll/shot-1.mp4:shot:shot-1:10:4").digest("hex")}.mp4`);
    expect(html).toContain("review-render-v1");
    expect(html).toContain("caption-minimal");
    expect(html).toContain("object-fit:contain");
    expect(html).toContain("bottom:780px");
    expect(html).toContain("scale:1.025");
    expect(html).toContain('id="audio-1"');
    expect(html).toContain("data-volume=\"0.251189\"");
    expect(html).toContain(`assets/${createHash("sha256").update("episodes/episode-1/audio/bgm-1.looped.mp3").digest("hex")}.mp3`);
    expect(html).not.toContain("tl.from(node,{opacity:0,duration:.35},start)");

    const actualDurationHtml = projectHtml({ ...taskPackage, reviewRender: { ...taskPackage.reviewRender!, members: taskPackage.reviewRender!.members.map((member) => member.memberKind === "shot_media" ? { ...member, durationSeconds: 3 } : member) } });
    expect(actualDurationHtml).toContain('data-duration="3"');

    expect(taskPackage.reviewRender?.studioProject).toEqual({ relativePath: "episodes/episode-1/studio-frozen/00000000-0000-0000-0000-000000000001/index.html", sha256: "d".repeat(64), fileSize: 48 });

    const fadedHtml = projectHtml({ ...taskPackage, reviewRender: { ...taskPackage.reviewRender!, adjustments: { ...taskPackage.reviewRender!.adjustments, transition: "fade", pacing: "compact" } } });
    expect(fadedHtml).toContain("tl.from(node,{opacity:0,duration:.35},start).to(node,{opacity:0,duration:.35},start+duration-.35)");
    expect(fadedHtml).toContain("scale:1.08");

    const wideHtml = projectHtml({ ...taskPackage, reviewRender: { ...taskPackage.reviewRender!, adjustments: { ...taskPackage.reviewRender!.adjustments, aspectRatio: "16:9", width: 1920, height: 1080, captionsEnabled: false, narrationGainDb: -3 } } });
    expect(wideHtml).toContain('data-aspect-ratio="16:9"');
    expect(wideHtml).toContain("width:1920px;height:1080px");
    expect(wideHtml).not.toContain("caption-0");
    expect(wideHtml).toContain('data-volume="0.707946"');

    const report = buildQcReport({ taskPackage, projectContents: html, inspection: { durationSeconds: 4, width: 1080, height: 1920, hasAudio: true, blackFrameCount: 0 }, outputRelativePath: taskPackage.output.relativePath, projectRelativePath: taskPackage.reviewRender!.projectRelativePath });
    expect(report.passed).toBe(true);
    expect(report.checks.map((check) => check.name)).toEqual(["duration_coverage", "resolution", "audio", "black_frames", "subtitles", "completeness"]);

    const wideReport = buildQcReport({ taskPackage: { ...taskPackage, reviewRender: { ...taskPackage.reviewRender!, adjustments: { ...taskPackage.reviewRender!.adjustments, aspectRatio: "16:9", width: 1920, height: 1080, captionsEnabled: false } } }, projectContents: wideHtml, inspection: { durationSeconds: 4, width: 1920, height: 1080, hasAudio: true, blackFrameCount: 0 }, outputRelativePath: taskPackage.output.relativePath, projectRelativePath: taskPackage.reviewRender!.projectRelativePath });
    expect(wideReport.passed).toBe(true);
    expect(clipVideoArguments("source.mov", "clip.mp4", 10, 4)).toEqual(["-nostdin", "-v", "error", "-ss", "10", "-i", "source.mov", "-t", "4", "-map", "0:v:0", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "clip.mp4"]);
  });

  it("把原片与多段标记交给 Studio，并按 Studio 修改后的总时长做 QC", () => {
    const input: WorkerTaskPackageInput = {
      task: { id: "render-markers", type: "generate_review_render", attempt: 0, budgetLimitCents: 0, maxAttempts: 1, provider: "hyperframes", model: "hyperframes@0.7.109", promptVersion: "review-render-v1" },
      episode: { id: "episode-markers", accountId: "account-1", blueprintVersionId: "blueprint-1", title: "原片标记" },
      capability: "review_rendering", allowedTools: ["read", "write"], allowedAssetRoot: "/Volumes/Media/account-1",
      output: { requiredArtifactTypes: ["render", "review_render_project", "review_qc_report"], contentType: "video/mp4", relativePath: "episodes/episode-markers/review-render/v1/review-render.mp4", reviewStage: "qc_review" },
      inputArtifacts: [{ artifactType: "source_video", relativePath: "episodes/episode-markers/materials/source.mp4", sha256: "a".repeat(64), fileSize: 10 }],
      reviewRender: {
        projectRelativePath: "episodes/episode-markers/review-render/v1/index.html", projectRevision: 1, preRenderReviewPackageId: "package-markers", confirmationMode: "shot_preparation",
        confirmedShots: [{ shotId: "shot-1", confirmationStatus: "confirmed", inputFingerprint: "1".repeat(32), sourceMaterialRevisionId: "material-1", clipSegments: [{ startSeconds: 1, endSeconds: 2.5 }, { startSeconds: 4, endSeconds: 6.5 }], audioMode: "source", audioTrackId: null, subtitleText: "原声字幕", subtitlesEnabled: true }],
        adjustments: { aspectRatio: "9:16", width: 1080, height: 1920, captionsEnabled: true, captionStyle: "minimal", pacing: "standard", crop: "cover", transition: "cut", layout: "lower_third", narrationGainDb: 0, bgmGainDb: -12, sfxGainDb: -6, reason: "保留可回改原片。" },
        storyboard: { version: "storyboard/v1", audioCues: [], shots: [{ id: "shot-1", scriptSegment: "原声", durationSeconds: 3.8, shotType: "a_roll", productionMethod: "人工", inputBasis: [{ relativePath: "script.md", sha256: "b".repeat(64) }], targetSpec: "9:16" }] },
        members: [{ memberKey: "shot:shot-1", memberKind: "shot_media", sourceMaterialRevisionId: "material-1", clipSegments: [{ startSeconds: 1, endSeconds: 2.5 }, { startSeconds: 4, endSeconds: 6.5 }], inputFingerprint: "1".repeat(32), audioMode: "source", subtitleText: "原声字幕", subtitlesEnabled: true, relativePath: "episodes/episode-markers/materials/source.mp4", sha256: "a".repeat(64), startSeconds: 0, durationSeconds: 4 }],
      },
    };
    const taskPackage = createWorkerTaskPackage(input);
    const html = projectHtml(taskPackage);
    expect((html.match(/<video /g) ?? [])).toHaveLength(2);
    expect(html).toContain('data-media-start="1"');
    expect(html).toContain('data-media-start="4"');
    expect(html).toContain('data-has-audio="true"');
    expect(html).toContain(`${createHash("sha256").update("episodes/episode-markers/materials/source.mp4").digest("hex")}.mp4`);
    const editedHtml = html.replace('data-duration="4" data-width', 'data-duration="5" data-width');
    expect(buildQcReport({ taskPackage, projectContents: editedHtml, inspection: { durationSeconds: 5, width: 1080, height: 1920, hasAudio: true, blackFrameCount: 0 }, outputRelativePath: input.output.relativePath, projectRelativePath: input.reviewRender!.projectRelativePath }).passed).toBe(true);
  });

  it("最终渲染固定已审核工程与其 QC 证据", () => {
    const reviewRender = {
      projectRelativePath: "episodes/episode-1/review-render/v1/index.html", projectRevision: 1, preRenderReviewPackageId: "package-1",
      adjustments: { aspectRatio: "9:16" as const, width: 1080, height: 1920, captionsEnabled: true, captionStyle: "cinematic" as const, pacing: "standard" as const, crop: "cover" as const, transition: "fade" as const, layout: "lower_third" as const, narrationGainDb: 0, bgmGainDb: -12, sfxGainDb: -6, reason: "默认合成配置。" },
      storyboard: { version: "storyboard/v1" as const, shots: [{ id: "shot-1", scriptSegment: "雨落在旧街。", durationSeconds: 4, shotType: "b_roll" as const, productionMethod: "Pexels", inputBasis: [{ relativePath: "episodes/episode-1/b-roll/shot-1.mp4", sha256: "a".repeat(64) }], targetSpec: "9:16" }], audioCues: [] },
      members: [{ memberKey: "shot:shot-1", memberKind: "shot_media" as const, relativePath: "episodes/episode-1/b-roll/shot-1.mp4", sha256: "a".repeat(64), startSeconds: 0, durationSeconds: 4 }],
    };
    const sourceProject = { artifactType: "review_render_project", relativePath: reviewRender.projectRelativePath, sha256: "b".repeat(64), fileSize: 12 };
    const sourceRuntime = { artifactType: "review_render_runtime", relativePath: "episodes/episode-1/review-render/v1/assets/gsap.min.js", sha256: "d".repeat(64), fileSize: 12 };
    const sourceQcReport = { artifactType: "review_qc_report", relativePath: "episodes/episode-1/review-render/v1/qc-report.json", sha256: "c".repeat(64), fileSize: 12 };
    const base = { task: { id: "final-1", type: "generate_final_render", attempt: 0, budgetLimitCents: 0, maxAttempts: 1, provider: "hyperframes" as const, model: "hyperframes@0.7.109", promptVersion: "final-render-v1" }, episode: { id: "episode-1", accountId: "account-1", blueprintVersionId: "blueprint-1", title: "雨夜" }, capability: "final_rendering", allowedTools: ["read", "write"], allowedAssetRoot: "/Volumes/Media/account-1", output: { requiredArtifactTypes: ["final_render", "final_render_project", "final_qc_report"], contentType: "video/mp4", relativePath: "episodes/episode-1/final-render/v1/final-render.mp4", reviewStage: "qc_passed" }, inputArtifacts: [{ artifactType: "b_roll_asset", relativePath: reviewRender.members[0].relativePath, sha256: reviewRender.members[0].sha256, fileSize: 10 }, sourceProject, sourceRuntime, sourceQcReport], finalRender: { sourceReviewPackageId: "qc-package-1", sourceProject, sourceRuntime, sourceQcReport, projectRelativePath: "episodes/episode-1/final-render/v1/index.html", projectRevision: 1, reviewRender } };
    expect(createWorkerTaskPackage(base).finalRender?.sourceProject.sha256).toBe(sourceProject.sha256);
    expect(() => createWorkerTaskPackage({ ...base, finalRender: { ...base.finalRender, projectRevision: 2 } })).toThrow("最终渲染冻结工程不一致");
  });
});
