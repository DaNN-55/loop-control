import { describe, expect, it } from "vitest";
import { isSupportedManualARollVideo, isSupportedManualAudio } from "./reviews/materialImport";

describe("人工 A-roll 上传", () => {
  it("只接受渲染链路支持的视频格式", () => {
    expect(isSupportedManualARollVideo("/tmp/a-roll.mp4", "video", "video/mp4")).toBe(true);
    expect(isSupportedManualARollVideo("/tmp/a-roll.avi", "video", "video/x-msvideo")).toBe(false);
    expect(isSupportedManualARollVideo("/tmp/a-roll.mp4", "document", "text/plain")).toBe(false);
  });

  it("拒绝将非音频文件登记为人工声轨", () => {
    expect(isSupportedManualAudio("/tmp/narration.mp3", "audio", "audio/mpeg")).toBe(true);
    expect(isSupportedManualAudio("/tmp/narration.mp3", "video", "video/mp4")).toBe(false);
  });
});
