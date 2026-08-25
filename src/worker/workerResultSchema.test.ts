import { describe, expect, it } from "vitest";
import { workerResultJsonSchema } from "./workerResultSchema.js";

describe("workerResultJsonSchema", () => {
  it("requires storyboard only for storyboard-planning tasks", () => {
    const schema = workerResultJsonSchema("storyboard_planning");

    expect(schema.required).toContain("storyboard");
    expect(schema.properties.storyboard).toMatchObject({ type: ["object", "null"] });
  });

  it("does not request a storyboard for other task capabilities", () => {
    const schema = workerResultJsonSchema("script_generation");

    expect(schema.required).not.toContain("storyboard");
    expect(schema.properties).not.toHaveProperty("storyboard");
  });

  it("uses an OpenAI strict-compatible schema", () => {
    const schema = workerResultJsonSchema("visual_planning");

    expect(schema.required).toEqual(expect.arrayContaining(Object.keys(schema.properties)));
    expect(schema.properties.blockers.items).toMatchObject({ required: ["code", "detail"] });
  });
});
