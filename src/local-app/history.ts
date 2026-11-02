import type{Pool}from'pg';
import{ownerTransaction,sessionTransaction}from'./ownerTransaction.js';
import{ConfigurationError}from'./configurationCommands.js';
import{tokenHash,type OwnerSession}from'./sessions.js';
import{historySourcePresentation,historyRecordTitle,historyFilePresentation,type HistorySource,type HistoryCleanupPreview}from'./historyPresentation.js';
const shaPattern=/^[a-f0-9]{64}$/;
export async function readHistory(pool:Pool,ownerId:string,search:URLSearchParams){
 const source=search.get('source')??'',query=search.get('q')??'',sha=search.get('version')??'',category=search.get('category')??'',state=search.get('state')??'active',sourceQuery=search.get('sourcesQ')??'';
 const keys=['source','q','version','category','state','sourcesQ','filesPage','recordsPage'];
 const page=(key:string)=>{const value=search.get(key)??'1';if(!/^[1-9][0-9]{0,5}$/.test(value))throw new ConfigurationError(400,'历史页码无效。');return Number(value);};
 const filesPage=page('filesPage'),recordsPage=page('recordsPage');
 if(keys.some(k=>search.getAll(k).length>1)||[...search.keys()].some(k=>!keys.includes(k))||source&&!shaPattern.test(source)||sha&&!shaPattern.test(sha)||query.length>200||sourceQuery.length>200||!['','business','configuration','diagnostics'].includes(category)||!['active','archived','all'].includes(state))throw new ConfigurationError(400,'历史查询无效。');
 return ownerTransaction(pool,ownerId,true,async c=>{
  if(sha){const rows=(await c.query('SELECT table_name,row_key,payload::text AS payload_json FROM local_identity.history_versions WHERE owner_id=$1 AND payload_sha256=$2 LIMIT 1',[ownerId,sha])).rows;if(!rows.length)throw new ConfigurationError(404,'历史版本不可见。');return{version:rows[0]};}
  const allSources=(await c.query(`SELECT s.id,s.kind,s.label,s.imported_at,p.archived_at,
   (SELECT count(*) FROM local_identity.history_source_rows r WHERE r.source_id=s.id) rows,
   (SELECT count(*) FROM local_identity.history_files f WHERE f.source_id=s.id) files
   FROM local_identity.history_sources s LEFT JOIN local_identity.history_source_preferences p ON p.source_id=s.id WHERE s.owner_id=$1 ORDER BY s.imported_at DESC,s.id`,[ownerId])).rows.map(row=>({...row,...historySourcePresentation(row)})) as HistorySource[];
  if(source&&!allSources.some(item=>item.id===source))throw new ConfigurationError(404,'历史来源不可见。');
  const sources=allSources.filter(item=>(!category||item.category===category)&&(state==='all'||Boolean(item.archived_at)===(state==='archived'))&&(!sourceQuery||[item.title,item.label].join(' ').toLocaleLowerCase().includes(sourceQuery.toLocaleLowerCase())));
  const versionWhere=`v.owner_id=$1 AND EXISTS(SELECT 1 FROM local_identity.history_source_rows linked JOIN local_identity.history_sources owned ON owned.id=linked.source_id WHERE owned.owner_id=$1 AND linked.table_name=v.table_name AND linked.row_key=v.row_key AND linked.payload_sha256=v.payload_sha256) AND ($2='' OR EXISTS(SELECT 1 FROM local_identity.history_source_rows r WHERE r.source_id=$2 AND r.table_name=v.table_name AND r.row_key=v.row_key AND r.payload_sha256=v.payload_sha256)) AND ($3='' OR v.table_name ILIKE '%'||$3||'%' OR v.payload::text ILIKE '%'||$3||'%')`;
  const versions=(await c.query(`SELECT v.table_name,v.row_key,v.payload_sha256,coalesce(p.status,'history-only') status,coalesce(v.payload->>'name',v.payload->>'title',v.payload->>'event_type',v.payload->>'id',v.row_key::text) label FROM local_identity.history_versions v LEFT JOIN local_identity.history_projection_results p USING(table_name,row_key,payload_sha256) WHERE ${versionWhere} ORDER BY v.table_name,v.row_key,v.payload_sha256 LIMIT 50 OFFSET $4`,[ownerId,source,query,(recordsPage-1)*50])).rows.map(item=>({...item,title:historyRecordTitle(item.table_name,item.label)}));
  const fileFrom=`FROM local_identity.history_files f JOIN local_identity.history_sources s ON s.id=f.source_id LEFT JOIN local_identity.history_file_protections p ON p.original_sha256=f.sha256 WHERE s.owner_id=$1 AND ($2='' OR f.source_id=$2) AND ($3='' OR f.logical_path ILIKE '%'||$3||'%' OR f.kind ILIKE '%'||$3||'%')`;
  const files=(await c.query(`SELECT DISTINCT ON(f.logical_path,coalesce(p.protected_sha256,f.sha256)) f.logical_path,coalesce(p.protected_sha256,f.sha256) sha256,coalesce(p.protected_bytes,f.bytes) bytes,f.kind ${fileFrom} ORDER BY f.logical_path,coalesce(p.protected_sha256,f.sha256),f.source_id LIMIT 50 OFFSET $4`,[ownerId,source,query,(filesPage-1)*50])).rows.map(item=>({...item,...historyFilePresentation(item.logical_path,item.kind)}));
  const versionTotal=(await c.query(`SELECT count(*) count FROM local_identity.history_versions v WHERE ${versionWhere}`,[ownerId,source,query])).rows[0].count;
  const fileTotal=(await c.query(`SELECT count(*) count FROM(SELECT DISTINCT f.logical_path,coalesce(p.protected_sha256,f.sha256) ${fileFrom})x`,[ownerId,source,query])).rows[0].count;
  const summary=(await c.query("SELECT (SELECT count(*) FROM local_identity.history_versions v WHERE v.owner_id=$1 AND EXISTS(SELECT 1 FROM local_identity.history_source_rows r JOIN local_identity.history_sources s ON s.id=r.source_id WHERE s.owner_id=$1 AND r.table_name=v.table_name AND r.row_key=v.row_key AND r.payload_sha256=v.payload_sha256)) versions,(SELECT count(DISTINCT f.sha256) FROM local_identity.history_files f JOIN local_identity.history_sources s ON s.id=f.source_id WHERE s.owner_id=$1) files",[ownerId])).rows[0];
  return{sources,versions,files,summary,source:allSources.find(item=>item.id===source)??null,pagination:{filesPage,recordsPage,fileTotal:Number(fileTotal),versionTotal:Number(versionTotal)},categoryCounts:Object.fromEntries(['business','configuration','diagnostics'].map(category=>[category,allSources.filter(s=>s.category===category).length])),sourceCounts:{active:allSources.filter(s=>!s.archived_at).length,archived:allSources.filter(s=>s.archived_at).length}};
 });
}
export async function manageHistory(pool:Pool,session:OwnerSession,body:Record<string,unknown>){
 const {command,data,idempotencyKey}=body;
 if(Object.keys(body).some(k=>!['command','data','idempotencyKey'].includes(k))||typeof command!=='string'||!['archive','restore','preview'].includes(command)||typeof idempotencyKey!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(idempotencyKey)||!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==1||typeof(data as {sourceId?:unknown}).sourceId!=='string'||!shaPattern.test((data as {sourceId:string}).sourceId))throw new ConfigurationError(400,'历史资料操作无效。');
 const source=(data as {sourceId:string}).sourceId;
 return sessionTransaction(pool,session,async c=>{
  const owned=(await c.query('SELECT id FROM local_identity.history_sources WHERE id=$1 AND owner_id=$2',[source,session.id])).rows[0];
  if(!owned)throw new ConfigurationError(404,'历史来源不可见。');
  if(command==='preview')return(await c.query('SELECT local_identity.preview_history_cleanup($1,$2) preview',[source,tokenHash(session.token)])).rows[0].preview as HistoryCleanupPreview;
  const archived=command==='archive';
  await c.query(`INSERT INTO local_identity.history_source_preferences(source_id,owner_id,archived_at)VALUES($1,$2,CASE WHEN $3 THEN clock_timestamp() ELSE NULL END)
   ON CONFLICT(source_id)DO UPDATE SET archived_at=CASE WHEN $3 THEN coalesce(history_source_preferences.archived_at,excluded.archived_at) ELSE NULL END,updated_at=clock_timestamp()
   WHERE (history_source_preferences.archived_at IS NOT NULL) IS DISTINCT FROM $3`,[source,session.id,archived]);
  return{sourceId:source,archived};
 });
}
export async function historyFile(pool:Pool,ownerId:string,sha:string){
 if(!shaPattern.test(sha))throw new ConfigurationError(400,'历史文件标识无效。');
 return ownerTransaction(pool,ownerId,true,async c=>{const row=(await c.query('SELECT coalesce(p.protected_bytes,f.bytes) bytes,coalesce(p.protected_sha256,f.sha256) sha256 FROM local_identity.history_file_catalog f LEFT JOIN local_identity.history_file_protections p ON p.original_sha256=f.sha256 WHERE f.owner_id=$1 AND (f.sha256=$2 OR p.protected_sha256=$2) LIMIT 1',[ownerId,sha])).rows[0];if(!row)throw new ConfigurationError(404,'历史文件不可见。');return{bytes:Number(row.bytes),sha256:String(row.sha256)};});
}
