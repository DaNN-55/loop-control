import { describe, expect, it } from "vitest";
import { applyStoryboardStructureRevision } from "./storyboardRevision";
import type { StoryboardManifest } from "./contracts";

const shot = (id: string, durationSeconds = 4) => ({ id, scriptSegment: id, durationSeconds, shotType: "a_roll" as const, productionMethod: "manual", inputBasis: [{ relativePath: "script.md", sha256: "a".repeat(64) }], targetSpec: "固定镜头" });
const base: StoryboardManifest = { version: "storyboard/v1", audioCues: [], shots: [shot("s1"), shot("s2")] };

describe("applyStoryboardStructureRevision", () => {
  it("supports add, delete, reorder, type and duration changes", () => {
    const added = applyStoryboardStructureRevision(base, { kind: "add_after", afterShotId: "s1", shot: shot("s3") });
    expect(added.shots.map((item) => item.id)).toEqual(["s1", "s3", "s2"]);
    expect(applyStoryboardStructureRevision(added, { kind: "delete", shotId: "s3" }).shots.map((item) => item.id)).toEqual(["s1", "s2"]);
    expect(applyStoryboardStructureRevision(base, { kind: "reorder", shotIds: ["s2", "s1"] }).shots[0].id).toBe("s2");
    expect(applyStoryboardStructureRevision(base, { kind: "change_type", shotId: "s1", shotType: "b_roll" }).shots[0].shotType).toBe("b_roll");
    expect(applyStoryboardStructureRevision(base, { kind: "change_duration", shotId: "s1", durationSeconds: 5 }).shots[0].durationSeconds).toBe(5);
  });

  it("splits and merges while preserving stable IDs and duration", () => {
    const split = applyStoryboardStructureRevision(base, { kind: "split", shotId: "s1", parts: [{ id: "s1a", scriptSegment: "a", durationSeconds: 2 }, { id: "s1b", scriptSegment: "b", durationSeconds: 2 }] });
    expect(split.shots.map((item) => item.id)).toEqual(["s1a", "s1b", "s2"]);
    expect(split.shots[0].inputBasis).toEqual(base.shots[0].inputBasis);
    expect(split.shots[1].inputBasis).toEqual(base.shots[0].inputBasis);
    const merged = applyStoryboardStructureRevision(base, { kind: "merge", shotIds: ["s1", "s2"], newShotId: "s12" });
    expect(merged.shots).toHaveLength(1);
    expect(merged.shots[0]).toMatchObject({ id: "s12", durationSeconds: 8 });
  });

  it("rejects non-adjacent merges", () => {
    const three = { ...base, shots: [shot("s1"), shot("s2"), shot("s3")] };
    expect(() => applyStoryboardStructureRevision(three, { kind: "merge", shotIds: ["s1", "s3"], newShotId: "s13" })).toThrow("相邻");
  });
});
