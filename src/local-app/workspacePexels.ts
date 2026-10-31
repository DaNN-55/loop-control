import {episodeFileIO,verifyEpisodeFile} from './episodeFiles.js';
import {creativeAccountRules} from '../creativeAccountRules.js';
import {randomUUID} from 'node:crypto';
import {lstat,realpath} from 'node:fs/promises';
import {relative} from 'node:path';
import type {PoolClient} from 'pg';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import type {WorkspacePexelsRequest,WorkspacePexelsState} from '../workspacePexels.js';
import {validatePexelsSource,type PexelsVideoParameters} from '../worker/pexelsVideos.js';
import {workspaceCandidateTarget} from '../workspaceCandidates.js';
import {ConfigurationError} from './configurationCommands.js';
import {productionHash} from './scriptProductionStore.js';
import {snapshotInput} from './localFiles.js';
import {inspectWorkspaceVisualFile,requireVisualStorageLocation} from './workspaceVisualMedia.js';
import {resolveProductionSelection} from './productionSelection.js';
import type {InputRuntime} from './episodeCommands.js';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function readWorkspacePexels(c:PoolClient,root:string,row:ProductionWorkspaceRecord,requestId?:string):Promise<WorkspacePexelsState>{
 // Keep each target's current result set, independent from activity on other shots.
 const latest=`WITH searches AS (SELECT DISTINCT ON(target_item_id) id FROM local_identity.workspace_pexels_requests WHERE workspace_id=$1 AND request_snapshot->>'operation'='search' ORDER BY target_item_id,created_at DESC,id DESC), previews AS (SELECT DISTINCT ON(r.target_item_id,r.request_snapshot#>>'{source,id}') r.id FROM local_identity.workspace_pexels_requests r JOIN searches s ON s.id::text=r.request_snapshot#>>'{source,searchId}' WHERE r.workspace_id=$1 AND r.request_snapshot->>'operation'='preview' ORDER BY r.target_item_id,r.request_snapshot#>>'{source,id}',r.created_at DESC,r.id DESC)`;
 const selected=requestId?'r.id=$2':'(r.id IN(SELECT id FROM searches) OR r.id IN(SELECT id FROM previews))';
 const rows=(await c.query(`${requestId?'':latest} SELECT r.*,t.status,t.last_result,t.invalidated_at,(SELECT v.id FROM local_identity.workspace_visual_candidates v WHERE v.workspace_id=r.workspace_id AND v.request_snapshot->>'pexelsPreviewId'=r.id::text LIMIT 1) candidate_id FROM local_identity.workspace_pexels_requests r JOIN public.tasks t ON t.id=r.task_id WHERE r.workspace_id=$1 AND ${selected} ORDER BY r.created_at DESC,r.id DESC`,requestId?[row.id,requestId]:[row.id])).rows;
 const requests:WorkspacePexelsRequest[]=await Promise.all(rows.map(async r=>{
  const s=r.request_snapshot;const request:WorkspacePexelsRequest={id:r.id,taskId:r.task_id,targetItemId:r.target_item_id,operation:s.operation,query:s.query,parameters:s.parameters,selection:s.selection,connectionName:s.connection.name,status:r.invalidated_at?'stale':r.status,error:['failed','blocked'].includes(r.status)?r.last_result?.blockers?.[0]?.detail??r.last_result?.retry?.reason??'Pexels 任务未完成，请重试。':null,...(s.source?{source:s.source}:{}),...(r.candidate_id?{candidateId:r.candidate_id}:{})};
  if(r.status==='completed'&&!r.invalidated_at){try{const a=r.last_result.artifacts[0];if(Number(a.fileSize)>(s.operation==='search'?512*1024:100*1024*1024))throw Error();if(s.operation==='search'){const bytes=await verifyEpisodeFile(c,root,row.episode_id,a.relativePath,a.sha256,Number(a.fileSize));const results:unknown=JSON.parse(bytes.toString('utf8'));if(!Array.isArray(results)||results.length>15)throw Error();request.results=results.map(validatePexelsSource);}else {const path=await (await episodeFileIO(c,root,row.episode_id)).resolveReference(a.relativePath),file=await lstat(path);if(await realpath(path)!==path||!file.isFile()||file.nlink!==1||file.size!==Number(a.fileSize))throw Error();request.preview={relativePath:a.relativePath,sha256:a.sha256,fileSize:Number(a.fileSize)};}}catch{request.status='failed';request.error='Pexels 结果文件不可读取，请重新检索或预览。';}}
  return request;
 }));return{requests};
}
export async function executeWorkspacePexels(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,command:string,data:Record<string,unknown>,runtime:InputRuntime){
 const location=await requireVisualStorageLocation(c,root,row.episode_id,runtime.minimumFreeBytes);
 const requestedId=command==='importWorkspacePexelsVideo'?data.previewId:command==='previewWorkspacePexelsVideo'?data.searchId:undefined;
 if(requestedId!==undefined&&(typeof requestedId!=='string'||!uuid.test(requestedId)))throw new ConfigurationError(400,'Pexels 请求标识无效。');
 const state=await readWorkspacePexels(c,root,row,requestedId as string|undefined);
 if(command==='importWorkspacePexelsVideo'){
  const preview=state.requests.find(r=>r.id===data.previewId&&r.operation==='preview');if(!preview?.preview||preview.status!=='completed'||!preview.source)throw new ConfigurationError(409,'请先完成选定素材的预览下载，再导入候选。');
  if(preview.candidateId)return;
  const record=(await c.query('SELECT * FROM local_identity.workspace_pexels_requests WHERE id=$1 AND workspace_id=$2',[preview.id,row.id])).rows[0],item=project.timelines.flatMap(t=>t.items).find(i=>i.id===preview.targetItemId),clip=row.bindings.find(b=>b.itemId===preview.targetItemId);
  if(!clip||!item||productionHash(workspaceCandidateTarget(item))!==productionHash(record.target_snapshot))throw new ConfigurationError(409,'目标画面已变化，请针对当前镜头重新检索。');
  const a=preview.preview,bytes=await verifyEpisodeFile(c,root,row.episode_id,a.relativePath,a.sha256,a.fileSize),observed=await inspectWorkspaceVisualFile(root,relative(root,await (await episodeFileIO(c,root,row.episode_id)).resolveReference(a.relativePath)),'video');
  const stored=await snapshotInput(root,row.episode_id,{sourceKind:'file',sourcePath:`pexels-${preview.source.id}.mp4`,contentBase64:bytes.toString('base64')} as never,location.relativePath);
  const material=(await c.query('SELECT to_jsonb(public.import_production_material($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)) result',[row.episode_id,'video','worker',stored.sourcePath,stored.storagePath,'video/mp4',stored.sha256,stored.fileSize,false,'b_roll'])).rows[0].result;
  const snapshot={kind:'video',usage:'video',durationSeconds:observed.durationSeconds,width:observed.width,height:observed.height,pexelsPreviewId:preview.id,source:preview.source,context:record.request_snapshot.context,target:record.request_snapshot.target};
  await c.query('INSERT INTO local_identity.workspace_visual_candidates(id,workspace_id,episode_id,clip_id,shot_id,target_item_id,input_fingerprint,target_snapshot,request_snapshot,material_revision_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[randomUUID(),row.id,row.episode_id,clip.id,clip.shotId,item.id,productionHash({snapshot,sha256:stored.sha256,target:record.target_snapshot}),record.target_snapshot,snapshot,material.id]);return;
 }
 let snapshot:Record<string,any>,expected:unknown,itemId:string;
 if(command==='searchWorkspacePexelsVideos'){
  const clip=row.bindings.find(b=>b.itemId===data.targetItemId),timeline=project.timelines.find(t=>t.items.some(i=>i.id===data.targetItemId)),item=timeline?.items.find(i=>i.id===data.targetItemId);
  if(!clip||!timeline||!item||!['video','image','text'].includes(String(item.kind)))throw new ConfigurationError(409,'目标画面不属于当前工作空间。');
  const resolved=await resolveProductionSelection(c,data.selection,'video');if(resolved.choice.mode!=='search'||resolved.selection.provider!=='pexels'||resolved.selection.adapter!=='pexels_video')throw new ConfigurationError(400,'请选择 Pexels 素材检索连接。');
  if(typeof data.query!=='string'||!data.query.trim()||data.query.length>100)throw new ConfigurationError(400,'请输入 1～100 个字符的检索词。');
  const parameters={orientation:data.orientation??'portrait',size:data.size??'medium',page:data.page??1} as PexelsVideoParameters;if(!['portrait','landscape','square'].includes(parameters.orientation)||!['large','medium','small'].includes(parameters.size)||!Number.isInteger(parameters.page)||parameters.page<1||parameters.page>100)throw new ConfigurationError(400,'Pexels 检索参数无效。');
  await runtime.checkReferences(c,[resolved.connection!.id]);if(!runtime.mediaReady)throw new ConfigurationError(503,'媒体 Worker 未配置。');await runtime.mediaReady({b_roll:resolved.execution});
  const e=(await c.query('SELECT e.account_id,e.blueprint_version_id,e.series_version_id,b.policy,s.rules FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id LEFT JOIN public.series_versions s ON s.id=e.series_version_id WHERE e.id=$1',[row.episode_id])).rows[0],script=(await c.query('SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2',[row.script_revision_id,row.episode_id])).rows[0];await verifyEpisodeFile(c,root,row.episode_id,script.storage_path,script.sha256,Number(script.file_size));
  const inputs=[{artifactType:'main_script',relativePath:script.storage_path,sha256:script.sha256,fileSize:Number(script.file_size)}],seconds=Number(item.durationInFrames)/timeline.fps,query=data.query.replace(/\s+/g,' ').trim();
  expected=workspaceCandidateTarget(item);itemId=String(item.id);snapshot={operation:'search',query,parameters,selection:resolved.selection,connection:resolved.connection,execution:resolved.execution,inputs,targetDurationSeconds:seconds,context:{accountId:e.account_id,blueprintVersionId:e.blueprint_version_id,accountRules:creativeAccountRules(e.policy),seriesVersionId:e.series_version_id,seriesRules:e.rules??null},target:{targetItemId:itemId,shotId:clip.shotId,workspaceRevision:Number(row.revision),scriptRevisionId:row.script_revision_id,projectSha256:row.project_sha256}};
 }else{
  if(typeof data.searchId!=='string'||!uuid.test(data.searchId)||!Number.isSafeInteger(data.resultId))throw new ConfigurationError(400,'请选择检索结果。');
  const search=state.requests.find(r=>r.id===data.searchId&&r.operation==='search'),selected=search?.results?.find(r=>r.id===data.resultId);if(!search||search.status!=='completed'||!selected)throw new ConfigurationError(409,'检索结果不存在或已不可读取，请重新检索。');
  const record=(await c.query('SELECT * FROM local_identity.workspace_pexels_requests WHERE id=$1 AND workspace_id=$2',[search.id,row.id])).rows[0];itemId=search.targetItemId;expected=record.target_snapshot;const item=project.timelines.flatMap(t=>t.items).find(i=>i.id===itemId);if(!item||productionHash(workspaceCandidateTarget(item))!==productionHash(expected))throw new ConfigurationError(409,'目标画面已变化，请重新检索。');
  snapshot={...record.request_snapshot,operation:'preview',source:{...selected,query:search.query,parameters:search.parameters,selection:search.selection,connectionName:search.connectionName,searchId:search.id}};
 }
 const id=randomUUID();snapshot.expectedRevision=Number(row.revision);snapshot.fingerprint=productionHash({expected,snapshot});
 await c.query('INSERT INTO local_identity.workspace_pexels_requests(id,workspace_id,episode_id,target_item_id,target_snapshot,request_snapshot) VALUES($1,$2,$3,$4,$5,$6)',[id,row.id,row.episode_id,itemId!,expected,snapshot]);
 try{await c.query('SELECT local_identity.queue_workspace_pexels($1)',[id]);}catch(e){if((e as {code?:string}).code==='55000')throw new ConfigurationError(409,'同一镜头已有 Pexels 检索或预览正在进行，请等待后重试。');throw e;}
}
