import { describe, expect, it } from "vitest";
import { manualMaterialChecklistForStoryboard } from "./manualMaterialChecklist";

describe("人工素材清单", () => {
  it("按冻结分镜目标列出人工能力的缺失素材，而不是生成 Worker task", () => {
    const items = manualMaterialChecklistForStoryboard({
      a_roll: { execution_path: "manual" },
      b_roll: { execution_path: "external" },
      narration: { execution_path: "manual" },
      soundtrack: { execution_path: "manual" },
    }, {
      shots: [{ id: "shot-01", scriptSegment: "出镜", durationSeconds: 2, shotType: "a_roll", productionMethod: "manual", inputBasis: [], targetSpec: "竖屏" }],
      audioCues: [{ id: "cue-01", kind: "bgm", description: "氛围", searchQuery: "ambient", startSeconds: 0, durationSeconds: 2 }],
    }, [{ material_purpose: "narration", material_type: "audio" }]);

    expect(items).toEqual([
      expect.objectContaining({ capability: "a_roll_generation", targetId: "shot-01", status: "missing" }),
      expect.objectContaining({ capability: "narration_generation", targetId: "shot-01", status: "uploaded" }),
      expect.objectContaining({ capability: "soundtrack_generation", targetId: "cue-01", status: "missing" }),
    ]);
    expect(items.some((item) => item.capability === "b_roll_generation")).toBe(false);
  });
});
