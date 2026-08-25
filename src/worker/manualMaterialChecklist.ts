import type { StoryboardManifest } from "./contracts.js";

export type ManualMaterialChecklistItem = {
  capability: "static_visual_generation" | "a_roll_generation" | "b_roll_generation" | "narration_generation" | "soundtrack_generation";
  label: string;
  materialPurpose: string;
  materialType: string;
  targetId: string;
  status: "bound" | "missing" | "pending";
};

export type MaterialAvailability = Pick<{
  material_purpose: string;
  material_type: string;
}, "material_purpose" | "material_type">;

export function manualMaterialChecklistForStoryboard(policy: unknown, episodeId: string, storyboard: Pick<StoryboardManifest, "shots" | "audioCues">, materials: readonly MaterialAvailability[], tasks: readonly { input_snapshot: unknown; status?: string; provider?: string }[] = [], reviewPackageId = ""): ManualMaterialChecklistItem[] {
  const root = record(policy);
  const items: ManualMaterialChecklistItem[] = [];
  const isBound = (capability: ManualMaterialChecklistItem["capability"], targetId: string) => tasks.some((task) => {
    const snapshot = record(task.input_snapshot);
    const manualCapability = snapshot.capability;
    const boundCapability = manualCapability === "static_visual_manual_upload" ? "static_visual_generation" : manualCapability === "a_roll_manual_upload" ? "a_roll_generation" : manualCapability === "b_roll_manual_upload" ? "b_roll_generation" : manualCapability === "narration_manual_upload" ? "narration_generation" : manualCapability === "soundtrack_manual_upload" ? "soundtrack_generation" : "";
    const shot = record(snapshot.shot);
    const audioTrack = record(snapshot.audio_track);
    return task.status === "completed" && task.provider === "manual_upload" && snapshot.storyboard_review_package_id === reviewPackageId && boundCapability === capability && (shot.id === targetId || audioTrack.cue_id === targetId);
  });
  const add = (capability: ManualMaterialChecklistItem["capability"], targetId: string, label: string, materialPurpose: string, materialType: string) => {
    if (record(root[capabilityKey(capability)]).execution_path !== "manual") return;
    const status = isBound(capability, targetId) ? "bound" : materials.some((material) => material.material_purpose === materialPurpose && material.material_type === materialType) ? "pending" : "missing";
    items.push({ capability, label, materialPurpose, materialType, targetId, status });
  };

  if (record(root.narration).execution_path === "manual") add("narration_generation", episodeId, "旁白 · Episode", "narration", "audio");
  for (const shot of storyboard.shots) {
    add("static_visual_generation", shot.id, `静态视觉 · ${shot.id}`, "visual_reference", "image");
    if (shot.shotType === "a_roll") add("a_roll_generation", shot.id, `A-roll · ${shot.id}`, "a_roll", "video");
    if (shot.shotType === "b_roll") add("b_roll_generation", shot.id, `B-roll · ${shot.id}`, "b_roll", "video");
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
