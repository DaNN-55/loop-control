import { describe, expect, it } from "vitest";
import { manualMaterialChecklistForStoryboard } from "./manualMaterialChecklist";

describe("人工素材清单", () => {
  it("旁白按 Episode 单项列出，且同类上传不会冒充多个目标已绑定", () => {
    const items = manualMaterialChecklistForStoryboard({
      a_roll: { execution_path: "manual" },
      b_roll: { execution_path: "manual" },
      narration: { execution_path: "manual" },
      soundtrack: { execution_path: "manual" },
    }, "episode-1", {
      shots: [
        { id: "shot-01", scriptSegment: "出镜", durationSeconds: 2, shotType: "a_roll", productionMethod: "manual", inputBasis: [], targetSpec: "竖屏" },
        { id: "shot-02", scriptSegment: "补充画面", durationSeconds: 1, shotType: "b_roll", productionMethod: "manual", inputBasis: [], targetSpec: "竖屏" },
        { id: "shot-03", scriptSegment: "另一补充画面", durationSeconds: 1, shotType: "b_roll", productionMethod: "manual", inputBasis: [], targetSpec: "竖屏" },
      ],
      audioCues: [
        { id: "cue-01", kind: "bgm", description: "氛围", searchQuery: "ambient", startSeconds: 0, durationSeconds: 2 },
        { id: "cue-02", kind: "sfx", description: "脚步", searchQuery: "footsteps", startSeconds: 1, durationSeconds: 1 },
      ],
    }, [{ material_purpose: "narration", material_type: "audio" }, { material_purpose: "b_roll", material_type: "video" }, { material_purpose: "background_music", material_type: "audio" }], [
      { input_snapshot: { capability: "b_roll_manual_upload", storyboard_review_package_id: "package-current", shot: { id: "shot-02" } }, provider: "manual_upload", status: "completed" },
      { input_snapshot: { capability: "b_roll_manual_upload", storyboard_review_package_id: "package-old", shot: { id: "shot-03" } }, provider: "manual_upload", status: "completed" },
    ], "package-current");

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "a_roll_generation", targetId: "shot-01", status: "missing" }),
      expect.objectContaining({ capability: "b_roll_generation", targetId: "shot-02", status: "bound" }),
      expect.objectContaining({ capability: "b_roll_generation", targetId: "shot-03", status: "pending" }),
      expect.objectContaining({ capability: "narration_generation", targetId: "episode-1", status: "pending" }),
      expect.objectContaining({ capability: "soundtrack_generation", targetId: "cue-01", status: "pending" }),
      expect.objectContaining({ capability: "soundtrack_generation", targetId: "cue-02", status: "missing" }),
    ]));
    expect(items.filter((item) => item.capability === "narration_generation")).toHaveLength(1);
  });
});
