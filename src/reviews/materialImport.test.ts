import { describe, expect, it } from "vitest";
import { defaultMaterialPurpose, materialPurposeOptions, materialPurposeLabel, materialTypeForFile } from "./materialImport";

describe("生产材料导入规则", () => {
  it("根据文件名和 MIME 类型识别材料类型", () => {
    expect(materialTypeForFile(new File(["# script"], "episode.md", { type: "text/markdown" }))).toBe("script");
    expect(materialTypeForFile(new File(["image"], "character.png", { type: "image/png" }))).toBe("image");
    expect(materialTypeForFile(new File(["audio"], "voice.wav", { type: "audio/wav" }))).toBe("audio");
    expect(materialTypeForFile(new File(["video"], "reference.mov", { type: "video/quicktime" }))).toBe("video");
    expect(materialTypeForFile(new File(["notes"], "notes.pdf", { type: "application/pdf" }))).toBe("reference");
  });

  it("为不同类型提供可理解的用途，并为自动识别提供默认用途", () => {
    expect(defaultMaterialPurpose("script", true)).toBe("main_script");
    expect(defaultMaterialPurpose("image", false)).toBe("visual_reference");
    expect(defaultMaterialPurpose("audio", false)).toBe("narration");
    expect(defaultMaterialPurpose("video", false)).toBe("b_roll");
    expect(materialPurposeOptions("script", false).map((option) => option.value)).not.toContain("main_script");
    expect(materialPurposeOptions("image", false).map((option) => option.value)).toContain("visual_reference");
    expect(materialPurposeLabel("background_music")).toBe("背景音乐");
  });
});
