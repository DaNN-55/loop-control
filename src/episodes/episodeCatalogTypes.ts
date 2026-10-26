import type {Database} from "../lib/database.types.js";
import type {WorkerBlocker} from "../reviews/workerBlocker.js";
type Episode=Database["public"]["Tables"]["episodes"]["Row"];
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
