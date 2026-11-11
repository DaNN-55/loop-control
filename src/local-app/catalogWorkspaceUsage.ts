import type {PoolClient} from 'pg';
import {readWorkspaceProject,type ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import {usedWorkspaceContent} from './workspaceExportCommands.js';
import {readWorkspaceNarrationEnabled} from '../workspaceNarrationToggle.js';
import {resolveWorkspaceMainVoice} from '../workspaceAudio.js';
import type {CatalogQuery} from '../episodes/episodeCatalogTypes.js';

/** Verified native content is the authority; this read-only catalog projection is never persisted. */
export async function readCatalogWorkspaceUsage(c:PoolClient,query:CatalogQuery){
 const workspaces=(await c.query(`SELECT w.*,local_identity.storage_physical_root(location.asset_root) asset_root
 FROM local_identity.production_workspaces w JOIN public.episodes e ON e.id=w.episode_id
 CROSS JOIN LATERAL local_identity.episode_storage_location(e.id) location
 LEFT JOIN public.series_versions version ON version.id=e.series_version_id LEFT JOIN public.series series ON series.id=version.series_id
 LEFT JOIN LATERAL local_identity.episode_storage_collection(e.id) collection ON true
 WHERE e.archived_at IS NULL AND e.stage<>'production_completed' AND NOT local_identity.is_historical_episode(e.id)
 AND ($1::uuid IS NULL OR e.account_id=$1)
 AND ($2::text='' OR strpos(lower(e.title),lower($2))>0 OR strpos(lower(e.id::text),lower($2))>0)
 AND ($3::text='all' OR $3::text='unassigned' AND (collection.container_id IS NOT NULL AND collection.series_id IS NULL OR collection.container_id IS NULL AND e.series_version_id IS NULL)
  OR $3::text='unavailable' AND collection.container_id IS NULL AND e.series_version_id IS NOT NULL AND series.id IS NULL
  OR CASE WHEN collection.container_id IS NOT NULL THEN collection.series_id ELSE series.id END::text=$3)
 AND EXISTS(SELECT 1 FROM public.tasks t WHERE t.episode_id=e.id AND t.status IN ('ready','running','failed','blocked') AND t.invalidated_at IS NULL AND NOT local_identity.is_historical_task(t.id))`,[query.accountId||null,query.q??'',query.seriesId])).rows;
 const usage:Record<string,unknown>={};
 for(const w of workspaces){
  try{
   const project=await readWorkspaceProject(c,w.asset_root,w as ProductionWorkspaceRecord),used=usedWorkspaceContent(project);
   const shots=[...new Set(w.bindings.map((b:{shotId:string})=>b.shotId))].map(shotId=>{
    const ids=w.bindings.filter((b:{shotId:string})=>b.shotId===shotId).map((b:{itemId:string})=>b.itemId);
    return{shotId,enabled:readWorkspaceNarrationEnabled(project,ids),used:ids.some((id:string)=>used.ids.has(id)),hasVoice:!!resolveWorkspaceMainVoice(project,shotId as string).item};
   });
   usage[w.id]={projectSha256:w.project_sha256,shots,usedItemIds:[...used.ids],missingVisualIds:w.bindings.filter((b:{itemId:string})=>used.items.some(i=>i.id===b.itemId&&i.kind==='text'&&!i.src)).map((b:{itemId:string})=>b.itemId)};
  }catch{
   usage[w.id]={projectSha256:w.project_sha256,unavailable:true};
  }
 }
 return usage;
}
