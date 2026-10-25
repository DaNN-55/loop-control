import { supabase } from "../lib/supabase";

export type {ServerPage,WorkerSummary,EpisodeCatalog,CatalogQuery} from "./episodeCatalogTypes";
import type {EpisodeCatalog,CatalogQuery} from "./episodeCatalogTypes";
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

export {episodeCatalogChanged} from "./episodeCatalogChanged";
