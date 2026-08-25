import type { StoryboardManifest } from "./contracts.js";

export type ManualMaterialChecklistItem = {
  capability: "static_visual_generation" | "a_roll_generation" | "b_roll_generation" | "narration_generation" | "soundtrack_generation";
  label: string;
  materialPurpose: string;
  materialType: string;
  targetId: string;
  status: "uploaded" | "missing";
};

type MaterialAvailability = Pick<{
  material_purpose: string;
  material_type: string;
}, "material_purpose" | "material_type">;

export function manualMaterialChecklistForStoryboard(policy: unknown, storyboard: Pick<StoryboardManifest, "shots" | "audioCues">, materials: readonly MaterialAvailability[]): ManualMaterialChecklistItem[] {
  const root = record(policy);
  const items: ManualMaterialChecklistItem[] = [];
  const add = (capability: ManualMaterialChecklistItem["capability"], targetId: string, label: string, materialPurpose: string, materialType: string) => {
    if (record(root[capabilityKey(capability)]).execution_path !== "manual") return;
    items.push({ capability, label, materialPurpose, materialType, targetId, status: materials.some((material) => material.material_purpose === materialPurpose && material.material_type === materialType) ? "uploaded" : "missing" });
  };

  for (const shot of storyboard.shots) {
    add("static_visual_generation", shot.id, `静态视觉 · ${shot.id}`, "visual_reference", "image");
    if (shot.shotType === "a_roll") add("a_roll_generation", shot.id, `A-roll · ${shot.id}`, "a_roll", "video");
    if (shot.shotType === "b_roll") add("b_roll_generation", shot.id, `B-roll · ${shot.id}`, "b_roll", "video");
    add("narration_generation", shot.id, `旁白 · ${shot.id}`, "narration", "audio");
  }
  for (const cue of storyboard.audioCues) add("soundtrack_generation", cue.id, `${cue.kind === "bgm" ? "配乐" : "音效"} · ${cue.id}`, cue.kind === "bgm" ? "background_music" : "sound_effect", "audio");
  return items;
}

function capabilityKey(capability: ManualMaterialChecklistItem["capability"]): "static_visual" | "a_roll" | "b_roll" | "narration" | "soundtrack" {
  return capability.replace("_generation", "") as ReturnType<typeof capabilityKey>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
