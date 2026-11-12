import { mediaCapabilityKeyForCapability, type MediaCapabilityKey } from "../worker/productionCapabilities";
import type { WorkerBlocker } from "./reviewSelectors";

export type RepairTarget =
  | { kind: "media"; key: MediaCapabilityKey }
  | { kind: "executor"; key: "script_writing" | "storyboard_planning" };

export function repairTargetForBlocker(blocker: Pick<WorkerBlocker, "action" | "capability" | "code" | "detail" | "taskType">): RepairTarget | null {
  if (["script_writing","visual_planning","storyboard_planning"].includes(blocker.capability??"") || ["draft_script","prepare_visual_brief","draft_storyboard","draft_storyboard_revision"].includes(blocker.taskType??"")) return null;
  if (blocker.action) return structuredRepairTarget(blocker);
  return legacyRepairTarget(blocker);
}

function structuredRepairTarget(blocker: Pick<WorkerBlocker, "action" | "capability">): RepairTarget | null {
  if (blocker.action !== "edit_blueprint") return null;
  const mediaKey = blocker.capability ? mediaCapabilityKeyForCapability(blocker.capability) : undefined;
  if (mediaKey) return { kind: "media", key: mediaKey };
  return null;
}

function legacyRepairTarget(blocker: Pick<WorkerBlocker, "code" | "detail" | "taskType">): RepairTarget | null {
  const source = `${blocker.code} ${blocker.detail}`.toLowerCase();
  if (/static[_-]?visual|image.?generation|图片|静态视觉/.test(source)) return { kind: "media", key: "static_visual" };
  if (/a[_-]?roll/.test(source)) return { kind: "media", key: "a_roll" };
  if (/b[_-]?roll/.test(source)) return { kind: "media", key: "b_roll" };
  if (/narration|旁白/.test(source)) return { kind: "media", key: "narration" };
  if (/soundtrack|sound.?effect|配乐|音效/.test(source)) return { kind: "media", key: "soundtrack" };
  return null;
}
