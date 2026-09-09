import type { Database, Json } from "../lib/database.types";
import type { WorkerPreflightAction, WorkerPreflightPhase, WorkerPreflightScope, WorkerPreflightStatus } from "../worker/contracts";

type Episode = Database["public"]["Tables"]["episodes"]["Row"];
type PreRenderReviewMember = Database["public"]["Tables"]["pre_render_review_members"]["Row"];
type PreRenderReviewMemberDecision = Database["public"]["Tables"]["pre_render_review_member_decisions"]["Row"];
type ReviewPackage = Database["public"]["Tables"]["review_packages"]["Row"];
type Task = Database["public"]["Tables"]["tasks"]["Row"];

export interface WorkerBlocker {
  code: string;
  detail: string;
  taskId?: string;
  taskType?: Task["task_type"];
  capability?: string;
  check?: string;
  phase?: WorkerPreflightPhase;
  status?: WorkerPreflightStatus;
  action?: WorkerPreflightAction;
  scope?: WorkerPreflightScope;
}

export function currentReviewPackage(reviewPackages: ReviewPackage[], episode: Episode): ReviewPackage | null {
  return reviewPackages
    .filter((candidate) => candidate.episode_id === episode.id && candidate.stage === episode.stage && !candidate.invalidated_at)
    .reduce<ReviewPackage | null>((latest, candidate) => !latest || candidate.revision_number > latest.revision_number ? candidate : latest, null);
}

export function blockersFromResult(result: Json | null): WorkerBlocker[] {
  if (!result || Array.isArray(result) || typeof result !== "object") return [];
  const explicit = "blockers" in result && Array.isArray(result.blockers)
    ? result.blockers.flatMap((blocker) => blockerFromRecord(blocker))
    : [];
  if (explicit.length) return explicit;
  if (!("preflight" in result) || !result.preflight || Array.isArray(result.preflight) || typeof result.preflight !== "object" || !("checks" in result.preflight) || !Array.isArray(result.preflight.checks)) return [];
  return result.preflight.checks.flatMap((check) => {
    if (!check || Array.isArray(check) || typeof check !== "object") return [];
    const record = check as Record<string, unknown>;
    if (record.status === "passed" || typeof record.check !== "string" || !record.check || typeof record.reason !== "string" || !record.reason) return [];
    return [{ code: record.check, detail: record.reason, ...structuredFields(record) }];
  });
}

function blockerFromRecord(blocker: Json | undefined): WorkerBlocker[] {
  if (!blocker || Array.isArray(blocker) || typeof blocker !== "object") return [];
  const record = blocker as Record<string, unknown>;
  if (typeof record.code !== "string" || !record.code || typeof record.detail !== "string" || !record.detail) return [];
  return [{ code: record.code, detail: record.detail, ...structuredFields(record) }];
}

function structuredFields(record: Record<string, unknown>): Pick<WorkerBlocker, "capability" | "check" | "phase" | "status" | "action" | "scope"> {
  const fields: Pick<WorkerBlocker, "capability" | "check" | "phase" | "status" | "action" | "scope"> = {};
  if (typeof record.capability === "string" && record.capability) fields.capability = record.capability;
  if (typeof record.check === "string" && record.check) fields.check = record.check;
  if (record.phase === "preflight" || record.phase === "execution") fields.phase = record.phase;
  if (record.status === "passed" || record.status === "blocked" || record.status === "retryable" || record.status === "unavailable") fields.status = record.status;
  if (record.action === "none" || record.action === "edit_blueprint" || record.action === "manage_connection" || record.action === "retry" || record.action === "contact_environment_admin") fields.action = record.action;
  if (record.scope === "blueprint" || record.scope === "connection" || record.scope === "episode" || record.scope === "worker") fields.scope = record.scope;
  return fields;
}

export function workerBlockers(tasks: Array<Pick<Task, "episode_id" | "status" | "last_result" | "id" | "task_type"> & { invalidated_at?: string | null }>, episodeId: string): WorkerBlocker[] {
  return tasks
    .filter((task) => task.episode_id === episodeId && !task.invalidated_at && (task.status === "blocked" || task.status === "failed"))
    .flatMap((task) => blockersFromResult(task.last_result).map((blocker) => ({ ...blocker, taskId: task.id, taskType: task.task_type })));
}

export function isReviewPackagePending(reviewPackage: ReviewPackage, members: PreRenderReviewMember[], decisions: PreRenderReviewMemberDecision[]): boolean {
  if (reviewPackage.stage !== "production_ready") return true;
  if (reviewPackage.context_snapshot && !Array.isArray(reviewPackage.context_snapshot) && typeof reviewPackage.context_snapshot === "object" && reviewPackage.context_snapshot.approval_mode === "qc_only") return false;
  const packageMembers = members.filter((member) => member.review_package_id === reviewPackage.id);
  return packageMembers.length === 0 || packageMembers.some((member) => !decisions.some((decision) => decision.review_package_id === reviewPackage.id && decision.member_key === member.member_key));
}
