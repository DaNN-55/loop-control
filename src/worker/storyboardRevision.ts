import type { StoryboardManifest, StoryboardShotManifest } from "./contracts.js";

export type StoryboardStructureOperation =
  | { kind: "add_after"; afterShotId: string; shot: StoryboardShotManifest }
  | { kind: "delete"; shotId: string }
  | { kind: "split"; shotId: string; parts: Array<{ id: string; scriptSegment: string; durationSeconds: number }> }
  | { kind: "merge"; shotIds: string[]; newShotId: string }
  | { kind: "reorder"; shotIds: string[] }
  | { kind: "change_type"; shotId: string; shotType: StoryboardShotManifest["shotType"] }
  | { kind: "change_duration"; shotId: string; durationSeconds: number };

export interface StoryboardStructureRevision {
  version: "storyboard-revision/v1";
  baseReviewPackageId: string;
  inputFingerprint: string;
  operation: StoryboardStructureOperation;
  storyboard: StoryboardManifest;
}

export function applyStoryboardStructureRevision(base: StoryboardManifest, operation: StoryboardStructureOperation): StoryboardManifest {
  const shots = base.shots.slice();
  const indexOf = (shotId: string) => shots.findIndex((shot) => shot.id === shotId);
  if (operation.kind === "add_after") {
    const index = indexOf(operation.afterShotId);
    if (index < 0) throw new Error("新增镜头的目标不存在。");
    shots.splice(index + 1, 0, operation.shot);
  } else if (operation.kind === "delete") {
    const index = indexOf(operation.shotId);
    if (index < 0 || shots.length === 1) throw new Error("删除镜头后必须至少保留一个镜头。");
    shots.splice(index, 1);
  } else if (operation.kind === "split") {
    const index = indexOf(operation.shotId);
    const source = shots[index];
    if (index < 0 || !source || operation.parts.length < 2) throw new Error("拆分镜头参数无效。");
    const duration = operation.parts.reduce((sum, part) => sum + part.durationSeconds, 0);
    if (Math.abs(duration - source.durationSeconds) > 0.05) throw new Error("拆分后的目标时长必须等于原镜头时长。");
    shots.splice(index, 1, ...operation.parts.map((part) => ({ ...source, ...part })));
  } else if (operation.kind === "merge") {
    const selected = operation.shotIds.map((shotId) => shots.find((shot) => shot.id === shotId));
    if (selected.length < 2 || selected.some((shot) => !shot)) throw new Error("合并镜头参数无效。");
    const ordered = selected as StoryboardShotManifest[];
    const indexes = operation.shotIds.map(indexOf);
    const firstIndex = Math.min(...indexes);
    if (new Set(operation.shotIds).size !== operation.shotIds.length || Math.max(...indexes) - firstIndex + 1 !== indexes.length || indexes.some((index, position) => index !== firstIndex + position)) throw new Error("只能按原顺序合并相邻镜头。");
    const selectedIds = new Set(operation.shotIds);
    shots.splice(firstIndex, shots.filter((shot) => selectedIds.has(shot.id)).length, {
      ...ordered[0],
      id: operation.newShotId,
      scriptSegment: ordered.map((shot) => shot.scriptSegment).join(" "),
      durationSeconds: ordered.reduce((sum, shot) => sum + shot.durationSeconds, 0),
      inputBasis: ordered.flatMap((shot) => shot.inputBasis).filter((input, index, all) => all.findIndex((candidate) => candidate.relativePath === input.relativePath && candidate.sha256 === input.sha256) === index),
    });
  } else if (operation.kind === "reorder") {
    const reordered = operation.shotIds.map((shotId) => shots.find((shot) => shot.id === shotId));
    if (reordered.length !== shots.length || reordered.some((shot) => !shot) || new Set(operation.shotIds).size !== shots.length) throw new Error("重排必须包含每个镜头且不能重复。");
    shots.splice(0, shots.length, ...(reordered as StoryboardShotManifest[]));
  } else if (operation.kind === "change_type") {
    const index = indexOf(operation.shotId);
    if (index < 0) throw new Error("修改类型的镜头不存在。");
    shots[index] = { ...shots[index], shotType: operation.shotType };
  } else {
    const index = indexOf(operation.shotId);
    if (index < 0 || operation.durationSeconds <= 0) throw new Error("修改时长的镜头参数无效。");
    shots[index] = { ...shots[index], durationSeconds: operation.durationSeconds };
  }
  if (new Set(shots.map((shot) => shot.id)).size !== shots.length) throw new Error("结构修订生成了重复镜头 ID。");
  return { ...base, shots };
}
