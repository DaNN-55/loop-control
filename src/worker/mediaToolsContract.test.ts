import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("媒体流映射与时长边界", () => {

  it("单段和多段裁剪只映射第一条音频流", () => {
    const source = readFileSync(resolve("src/worker/mediaTools.ts"), "utf8");

    expect(source.split('"0:a:0?"').length - 1).toBe(2);
    expect(source).not.toContain('"-map", "0:a?"');
  });

  it("视频时长校验使用可配置的帧级尾差", () => {
    const source = readFileSync(resolve("src/worker/mediaTools.ts"), "utf8");

    expect(source).toContain("videoDurationMeetsMinimum(duration, minimumDurationSeconds, frameRate, allowedFrames)");
    expect(source).toContain("视频不可播放或时长不足");
  });
});
