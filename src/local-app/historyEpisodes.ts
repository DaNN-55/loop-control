import type{Pool}from'pg';import{ownerTransaction,sessionTransaction}from'./ownerTransaction.js';import{ConfigurationError}from'./configurationCommands.js';import{tokenHash,type OwnerSession}from'./sessions.js';import{historyFilePresentation,historyRecordTitle}from'./historyPresentation.js';
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const catalog=`WITH records AS MATERIALIZED(SELECT * FROM local_identity.history_episode_records WHERE owner_id=$1),files AS MATERIALIZED(SELECT * FROM local_identity.history_episode_files WHERE owner_id=$1),
 ids AS(SELECT episode_id FROM (SELECT episode_id FROM records UNION SELECT episode_id FROM files) candidates WHERE NOT EXISTS(SELECT 1 FROM local_identity.history_episode_deletions d WHERE d.owner_id=$1 AND d.episode_id=candidates.episode_id)),
 labels AS(SELECT DISTINCT ON(payload->>'id') payload->>'id' id,payload->>'title' title,payload->>'account_id' account_id,coalesce(payload->>'updated_at',payload->>'created_at','') updated_at FROM local_identity.history_versions WHERE owner_id=$1 AND table_name='public.episodes' ORDER BY payload->>'id',coalesce(payload->>'updated_at',payload->>'created_at','') DESC,payload_sha256),
 accounts AS(SELECT DISTINCT ON(payload->>'id')payload->>'id' id,payload->>'name' name FROM local_identity.history_versions WHERE owner_id=$1 AND table_name='public.accounts' ORDER BY payload->>'id',payload_sha256),
 file_counts AS(SELECT episode_id,count(DISTINCT(logical_path,sha256))::int file_count FROM files GROUP BY episode_id),record_counts AS(SELECT episode_id,count(*)::int record_count,count(*) FILTER(WHERE table_name IN('public.artifacts','public.production_material_revisions'))::int content_count FROM records GROUP BY episode_id),
 catalog AS(SELECT ids.episode_id,coalesce(nullif(e.title,''),nullif(l.title,''),'未命名生产单 · '||left(ids.episode_id,8)) title,coalesce(nullif(a.name,''),nullif(ha.name,''),'历史账号') account_name,coalesce(e.updated_at::text,l.updated_at,'') updated_at,coalesce(f.file_count,0) file_count,coalesce(r.record_count,0) record_count,coalesce(r.content_count,0) content_count,p.archived_at
 FROM ids LEFT JOIN labels l ON l.id=ids.episode_id LEFT JOIN public.episodes e ON e.id::text=ids.episode_id LEFT JOIN public.accounts a ON a.id=e.account_id LEFT JOIN accounts ha ON ha.id=l.account_id LEFT JOIN file_counts f USING(episode_id) LEFT JOIN record_counts r USING(episode_id) LEFT JOIN local_identity.history_episode_preferences p ON p.owner_id=$1 AND p.episode_id=ids.episode_id)`;
export async function readHistoryEpisodes(pool:Pool,ownerId:string,search:URLSearchParams){
 const keys=['q','state','page','episode','filesPage','recordsPage','contentOnly'];const q=search.get('q')??'',state=search.get('state')??'active',episode=search.get('episode')??'',contentOnly=search.get('contentOnly')??'true';
 function page(key:string){const value=search.get(key)??'1';if(!/^[1-9][0-9]{0,4}$/.test(value))throw new ConfigurationError(400,'历史页码无效。');return Number(value);}
 const currentPage=page('page'),filesPage=page('filesPage'),recordsPage=page('recordsPage');
 if([...search.keys()].some(k=>!keys.includes(k)||search.getAll(k).length!==1)||q.length>200||!['active','archived','all'].includes(state)||!['true','false'].includes(contentOnly)||episode&&!uuid.test(episode))throw new ConfigurationError(400,'历史生产单查询无效。');
 return ownerTransaction(pool,ownerId,true,async c=>{
  // Historical hash joins are badly underestimated under RLS; avoid scanning
  // the same materialized file inventory once per historical artifact.
  await c.query('SET LOCAL enable_nestloop=off');
  const where=`($2='' OR title ILIKE '%'||$2||'%' OR account_name ILIKE '%'||$2||'%' OR episode_id ILIKE '%'||$2||'%') AND ($3='all' OR (archived_at IS NOT NULL)=($3='archived')) AND ($4='false' OR file_count>0 OR content_count>0)`;
  const result=(await c.query(`${catalog}, filtered AS MATERIALIZED(SELECT * FROM catalog WHERE ${where}) SELECT
   coalesce((SELECT jsonb_agg(x) FROM(SELECT * FROM filtered ORDER BY file_count>0 DESC,updated_at DESC,episode_id LIMIT 30 OFFSET $5)x),'[]'::jsonb) items,
   (SELECT count(*) FROM filtered) total,(SELECT count(*) FROM catalog) "totalHistory",
   (SELECT jsonb_build_object('active',count(*) filter(where archived_at is null),'archived',count(*) filter(where archived_at is not null)) FROM catalog WHERE ($4='false' OR file_count>0 OR content_count>0)) "scopeCounts",(SELECT to_jsonb(x) FROM catalog x WHERE episode_id=$6) selected`,[ownerId,q,state,contentOnly,(currentPage-1)*30,episode])).rows[0];
  const rows=result.items,total=Number(result.total);
  let selected=result.selected,files:Record<string,unknown>[]=[],versions:Record<string,unknown>[]=[],fileTotal=0,recordTotal=0;
  if(episode){
   if(!selected)throw new ConfigurationError(404,'历史生产单不可见。');
   const fileQuery=`FROM local_identity.history_episode_files f LEFT JOIN local_identity.history_file_protections p ON p.original_sha256=f.sha256 WHERE f.owner_id=$1 AND f.episode_id=$2`;
   files=(await c.query(`SELECT DISTINCT ON(f.logical_path,coalesce(p.protected_sha256,f.sha256)) f.logical_path,coalesce(p.protected_sha256,f.sha256) sha256,coalesce(p.protected_bytes,f.bytes) bytes,f.kind ${fileQuery} ORDER BY f.logical_path,coalesce(p.protected_sha256,f.sha256) LIMIT 50 OFFSET $3`,[ownerId,episode,(filesPage-1)*50])).rows.map(file=>({...file,...historyFilePresentation(file.logical_path,file.kind),section:/script|narration|脚本/i.test(file.logical_path)?'script':/storyboard|分镜/i.test(file.logical_path)?'storyboard':/review-render|final-render|发布包|成片|publish-package/i.test(file.logical_path)?'delivery':/\.(mp4|mov|webm|mp3|wav|m4a|png|jpe?g|webp|srt|vtt)$/i.test(file.logical_path)?'media':'other'}));
   fileTotal=Number((await c.query(`SELECT count(*) count FROM(SELECT DISTINCT f.logical_path,coalesce(p.protected_sha256,f.sha256) ${fileQuery})x`,[ownerId,episode])).rows[0].count);
   versions=(await c.query(`SELECT r.table_name,r.row_key,r.payload_sha256,coalesce(v.payload->>'title',v.payload->>'name',v.payload->>'task_type',v.payload->>'artifact_type',v.payload->>'id',r.row_key::text) label FROM local_identity.history_episode_records r JOIN local_identity.history_versions v USING(owner_id,table_name,row_key,payload_sha256) WHERE r.owner_id=$1 AND r.episode_id=$2 ORDER BY r.table_name,r.row_key,r.payload_sha256 LIMIT 50 OFFSET $3`,[ownerId,episode,(recordsPage-1)*50])).rows.map(row=>({...row,title:historyRecordTitle(row.table_name,row.label)}));
   recordTotal=Number((await c.query('SELECT count(*) count FROM local_identity.history_episode_records WHERE owner_id=$1 AND episode_id=$2',[ownerId,episode])).rows[0].count);
  }
  return{totalHistory:Number(result.totalHistory),scopeCounts:result.scopeCounts,items:rows,total,page:currentPage,pageSize:30,selected,files,versions,pagination:{filesPage,recordsPage,fileTotal,recordTotal}};
 });
}
export async function manageHistoryEpisode(pool:Pool,session:OwnerSession,body:Record<string,unknown>){
 const {command,data,idempotencyKey}=body;if(Object.keys(body).some(k=>!['command','data','idempotencyKey'].includes(k))||typeof command!=='string'||!['archive','restore','preview'].includes(command)||typeof idempotencyKey!=='string'||!uuid.test(idempotencyKey)||!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==1||typeof(data as {episodeId?:unknown}).episodeId!=='string'||!uuid.test((data as {episodeId:string}).episodeId))throw new ConfigurationError(400,'历史生产单操作无效。');
 const episode=(data as {episodeId:string}).episodeId;
 return sessionTransaction(pool,session,async c=>{
  const owned=(await c.query('SELECT 1 FROM local_identity.history_episode_records WHERE owner_id=$1 AND episode_id=$2 UNION SELECT 1 FROM local_identity.history_episode_files WHERE owner_id=$1 AND episode_id=$2 LIMIT 1',[session.id,episode])).rowCount;if(!owned)throw new ConfigurationError(404,'历史生产单不可见。');
  if(command==='preview'){await c.query('SET LOCAL enable_nestloop=off');return(await c.query('SELECT local_identity.preview_history_episode($1,$2) result',[episode,tokenHash(session.token)])).rows[0].result;}
  const archived=command==='archive';await c.query(`INSERT INTO local_identity.history_episode_preferences(owner_id,episode_id,archived_at)VALUES($1,$2,CASE WHEN $3 THEN clock_timestamp() ELSE NULL END)ON CONFLICT(owner_id,episode_id)DO UPDATE SET archived_at=CASE WHEN $3 THEN coalesce(history_episode_preferences.archived_at,excluded.archived_at)ELSE NULL END WHERE(history_episode_preferences.archived_at IS NOT NULL)IS DISTINCT FROM $3`,[session.id,episode,archived]);return{episodeId:episode,archived};
 });
}
