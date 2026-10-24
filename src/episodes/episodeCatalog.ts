import { supabase } from "../lib/supabase";
import type { Database } from "../lib/database.types";
import type { WorkerBlocker } from "../reviews/reviewSelectors";

type Episode = Database["public"]["Tables"]["episodes"]["Row"];
export interface ServerPage { page: number; total: number; pageSize: number; onPageChange: (page: number) => void }
export interface WorkerSummary { running: number; blocked: number; failed: number; latestCompleted: boolean; latest?: { task_type: string; at: string } | null }
export interface EpisodeCatalog {
  episodes: Episode[]; page: number; total: number; pageSize: number; episodeCount: number;
  accountCounts: Record<string, number>; reviewCount: number; stages: Record<string, number>; artifactCounts: Record<string, number>;
  pending: { page: number; total: number; items: Array<Episode & { revision_number: number }> };
  blocked: { page: number; total: number; items: Array<{ episode: Episode; blocker: WorkerBlocker }> };
  worker: WorkerSummary;
  operationRows: Array<{ episodeId: string; reviewRevision: number | null; reviewPending: boolean; blockerCount: number }>;
}
export interface CatalogQuery {
  view: "accounts" | "episodes" | "reviews" | "operations"; page: number;
  accountId: string; seriesId: string; visibility: "active" | "archived" | "all";
  pendingPage: number; blockedPage: number;
}
export async function readEpisodeCatalog(query: CatalogQuery, accessToken: string): Promise<EpisodeCatalog> {
  const { data, error } = await supabase.rpc("read_episode_catalog", {
    p_view: query.view, p_page: query.page, p_account_id: query.accountId || null,
    p_series_id: query.seriesId, p_visibility: query.visibility,
    p_pending_page: query.pendingPage, p_blocked_page: query.blockedPage,
  }).setHeader("Authorization", `Bearer ${accessToken}`);
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.episodes)) throw new Error("生产单分页响应无效。");
  return data as unknown as EpisodeCatalog;
}

// Catalog fields depend on business state, not lease heartbeats or task-run
// polling array identity. Compare only changed rows; frozen history keeps refs.
export function episodeCatalogChanged(previous: import('./EpisodeProductionContainer').EpisodeProductionSnapshot | null, next: import('./EpisodeProductionContainer').EpisodeProductionSnapshot): boolean {
  if (!previous || previous.episode !== next.episode) return true;
  const sameJson = (left: unknown, right: unknown) => left === right || JSON.stringify(left) === JSON.stringify(right);
  const sameRows = <T,>(left: T[], right: T[], key: (row: T) => string, equal: (a: T, b: T) => boolean): boolean => {
    if (left === right) return true;
    if (left.length !== right.length) return false;
    const byId = new Map(left.map(row => [key(row), row]));
    return right.every(row => { const old = byId.get(key(row)); return old !== undefined && (old === row || equal(old, row)); });
  };
  if (!sameRows(previous.tasks, next.tasks, row => row.id, (a, b) =>
    a.status === b.status && a.task_type === b.task_type && a.created_at === b.created_at && a.completed_at === b.completed_at && (a as { invalidated_at?: string | null }).invalidated_at === (b as { invalidated_at?: string | null }).invalidated_at && sameJson(a.last_result, b.last_result) && sameJson(a.input_snapshot, b.input_snapshot))) return true;
  if (!sameRows(previous.artifacts, next.artifacts, row => row.id, () => true)) return true;
  if (!sameRows(previous.reviewPackages, next.reviewPackages, row => row.id, (a, b) =>
    a.stage === b.stage && a.revision_number === b.revision_number && (a as { invalidated_at?: string | null }).invalidated_at === (b as { invalidated_at?: string | null }).invalidated_at && sameJson(a.context_snapshot, b.context_snapshot))) return true;
  if (!sameRows(previous.preRenderReviewMembers, next.preRenderReviewMembers, row => row.id, (a, b) => a.member_key === b.member_key && a.review_package_id === b.review_package_id)) return true;
  return !sameRows(previous.preRenderReviewMemberDecisions, next.preRenderReviewMemberDecisions, row => `${row.review_package_id}:${row.member_key}`, () => true);
}
