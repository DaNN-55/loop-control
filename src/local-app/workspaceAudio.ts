import {recordValidatedRequestLogContext} from './runtimeRequestLog.js';
import {adoptWorkspaceRecordedVoice} from './workspaceRecordedVoice.js';
import {installWorkspaceMusic} from '../workspaceMusicAdoption.js';
import {workspaceRenderPreferences} from '../workspaceRenderPreferences.js';
import {registeredWorkspaceAudio,workspacePreparedAudioJoin} from './registeredWorkspaceAudio.js';
import {workspaceTaskRetryColumns,projectWorkspaceTaskRetry} from './workspaceTaskRetry.js';
import {canUseWorkspaceAudioMaterial} from './workspaceAudioMaterial.js';
import {soundIntentQuery} from '../soundIntent.js';
import {currentWorkspaceCallAuthorization} from './workspaceCallConfirmation.js';
import {episodeStorageLocationAtRoot,requireWritableEpisodeStorage} from './episodeStorageLocation.js';
import {creativeAccountRules} from '../creativeAccountRules.js';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {applyWorkspaceAudioMix,readWorkspaceAudioMix,readWorkspaceSoundEnabled,setWorkspaceSoundEnabled,type WorkspaceAudioEdit} from '../workspaceAudio.js';
import {ConfigurationError,jsonFingerprint as hash} from './configurationCommands.js';
import {verifyEpisodeFile,resolveEpisodeFileReference} from './episodeFiles.js';
import {resolveWorkspaceSource} from './workspaceSources.js';
import {probeMp3Artifact,inspectMp4Artifact} from '../worker/mediaTools.js';
import {isOpenChatCutStudio} from '../worker/openchatcutStudio.js';
import {persistWorkspaceRevision,type ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import {resolveProductionSelection} from './productionSelection.js';
import type {InputRuntime} from './episodeCommands.js';
export function workspaceAudioShotIds(row:ProductionWorkspaceRecord){return Object.fromEntries([...new Set(row.bindings.map(b=>b.shotId))].map(id=>[id,row.bindings.filter(b=>b.shotId===id).map(b=>b.itemId)]));}
async function preparationCurrent(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,p:Record<string,any>,verifiedSources?:ReadonlyMap<string,string|null>){
 if(p.shot_id&&!row.bindings.some(b=>b.shotId===p.shot_id))return false;
 if(p.kind!=='source')return true;
 const clip=row.bindings.find(b=>b.itemId===p.source_item_id),timeline=project.timelines.find(t=>t.items.some(i=>i.id===p.source_item_id)),item=timeline?.items.find(i=>i.id===p.source_item_id),source=p.input_snapshot?.workspace_source;
 if(!(clip&&timeline&&item&&source&&typeof item.src==='string'&&item.src===source.relativePath&&Number(item.srcInFrame??0)===Number(source.sourceInFrame)&&timeline.fps===Number(source.sourceFrameRate)&&Number(item.playbackRate??1)===Number(source.playbackRate)&&Number(item.durationInFrames)===Number(source.visualDurationInFrames)))return false;
 // Candidate adoption and native relinks can leave the initial binding empty
 // or stale. The current registered file, not that cached input, owns its SHA.
 if(verifiedSources)return verifiedSources.get(item.src)===p.source_sha256;
 try{return(await resolveWorkspaceSource(c,root,row.episode_id,item.src)).sha256===p.source_sha256;}catch(error){if(error instanceof ConfigurationError)return false;throw error;}
}
/** Derive an old extraction's origin from its exact registered result, never native hints. */
async function priorSourceProvenance(c:PoolClient,root:string,episodeId:string,workspaceId:string,item:Record<string,unknown>,asset:OpenChatCutProject['assets'][number]){
 const id=String(asset.id).match(/^audio-track-([a-f0-9-]{36})$/)?.[1];
 if(!id||typeof item.src!=='string'||item.src!==asset.src)throw new ConfigurationError(409,'原声来源身份无法核验，请保留当前工程核对。');
 const previous=await registeredWorkspaceAudio(c,root,episodeId,id,'source');
 if(item.sourceContentHash!==undefined&&item.sourceContentHash!==previous.track.sha256)throw new ConfigurationError(409,'原声音轨版本已变化。');
 if(item.src!==previous.track.relative_path)await verifyEpisodeFile(c,root,episodeId,item.src,previous.track.sha256,Number(previous.track.file_size));
 const receipt=(await c.query("SELECT request_snapshot FROM local_identity.workspace_audio_preparations WHERE workspace_id=$1 AND episode_id=$2 AND kind='source' AND adopted_item_id=$3 AND request_snapshot->>'version'='registered-audio-input/v1' AND request_snapshot->>'purpose'='recorded-primary-voice/v1' AND request_snapshot->>'audioTrackId'=$4 AND request_snapshot->>'sha256'=$5 AND request_snapshot->>'fileSize'=$6 AND request_snapshot->>'sourceArtifactId'=$7 AND request_snapshot->>'sourceTaskId' IS NOT DISTINCT FROM $8 ORDER BY created_at DESC LIMIT 1",[workspaceId,episodeId,item.id,id,previous.track.sha256,String(previous.track.file_size),previous.track.source_artifact_id,previous.track.source_task_id])).rows[0]?.request_snapshot;
 if(receipt&&typeof receipt.sourceFrameRate==='number'&&Number.isFinite(receipt.sourceFrameRate)&&receipt.sourceFrameRate>0)return{sha256:previous.track.sha256,sourceInFrame:0,sourceFrameRate:receipt.sourceFrameRate};
 const source=(await c.query("SELECT input_snapshot->'workspace_source' source FROM public.tasks WHERE id=$1 AND episode_id=$2",[previous.track.source_task_id,episodeId])).rows[0]?.source;
 if(!source||typeof source.sha256!=='string'||!/^[a-f0-9]{64}$/.test(source.sha256)||!Number.isSafeInteger(source.sourceInFrame)||source.sourceInFrame<0||typeof source.sourceFrameRate!=='number'||!Number.isFinite(source.sourceFrameRate)||source.sourceFrameRate<=0)throw new ConfigurationError(409,'原声提取区间缺少可核验证据，请保留当前工程核对。');
 return{sha256:source.sha256,sourceInFrame:source.sourceInFrame,sourceFrameRate:source.sourceFrameRate};
}
export async function readWorkspaceAudio(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,verifiedSources:ReadonlyMap<string,string|null>){
 const entries=(await c.query(`SELECT ${workspaceTaskRetryColumns},p.*,t.status,t.last_result,t.input_snapshot,h.attempt publication_attempt,a.id audio_track_id,a.relative_path,a.sha256,a.file_size,a.duration_seconds actual_duration,m.storage_path,m.sha256 material_sha256,m.file_size material_size
 FROM local_identity.workspace_audio_preparations p LEFT JOIN public.tasks t ON t.id=p.task_id LEFT JOIN local_identity.workspace_publication_holds($2) h ON h.task_id=t.id ${workspacePreparedAudioJoin} LEFT JOIN public.production_material_revisions m ON m.id=p.material_revision_id AND m.episode_id=p.episode_id WHERE p.workspace_id=$1 ORDER BY p.created_at DESC`,[row.id,row.episode_id])).rows;
 for(const p of entries)if(p.task_id&&p.invalidatedAt==null)p.currentPreparation=await preparationCurrent(c,root,row,project,p,verifiedSources);
 const defaults=(await c.query('SELECT music_defaults FROM local_identity.production_workspaces WHERE id=$1',[row.id])).rows[0]?.music_defaults??null;
 return{enabled:{bgm:readWorkspaceSoundEnabled(project,'bgm'),sfx:readWorkspaceSoundEnabled(project,'sfx')},defaults,mix:readWorkspaceAudioMix(project,workspaceAudioShotIds(row)),preparations:entries.map(p=>({...(p.task_id?{generationTask:{...projectWorkspaceTaskRetry({status:p.status,attempt:p.attempt,maxAttempts:p.maxAttempts,invalidatedAt:p.invalidatedAt??(p.currentPreparation?null:new Date(0)),retryAt:p.retryAt}),id:p.id,taskId:p.task_id,status:p.status,error:p.last_result?.blockers?.[0]?.detail??p.last_result?.retry?.reason??null,publicationAttempt:p.publication_attempt}}:{}),id:p.id,kind:p.kind,shotId:p.shot_id,sourceItemId:p.source_item_id,sourceSha256:p.source_sha256,description:p.description,...(p.kind==='source'?{sourceWindow:p.input_snapshot?.workspace_source??null}:{}),query:p.query,selection:p.request_snapshot?.selection??p.input_snapshot?.production_selection??null,connection:p.request_snapshot?.connection??null,anchor:p.anchor,offsetSeconds:Number(p.offset_seconds),durationSeconds:Number(p.duration_seconds),taskId:p.task_id,status:p.material_revision_id||p.request_snapshot?.version==='registered-audio-input/v1'&&p.audio_track_id?'ready':p.request_snapshot?.version==='registered-audio-input/v1'?'unavailable':p.status??'pending',error:['failed','blocked'].includes(p.status)?p.last_result?.blockers?.[0]?.detail??p.last_result?.retry?.reason??null:null,audioTrackId:p.audio_track_id??null,relativePath:p.relative_path??p.storage_path??null,sha256:p.sha256??p.material_sha256??null,fileSize:Number(p.file_size??p.material_size??0),adoptedItemId:p.adopted_item_id,source:p.request_snapshot?.version==='registered-audio-input/v1'?{provider:'registered',audioTrackId:p.request_snapshot.audioTrackId}:p.last_result?.mediaSource??(p.material_revision_id?{provider:'manual',materialRevisionId:p.material_revision_id}:null)}))};
}
async function persistEdit(c:PoolClient,root:string,row:ProductionWorkspaceRecord,_before:OpenChatCutProject,after:OpenChatCutProject,reason:string){
 return persistWorkspaceRevision(c,root,row,after,row.bindings,reason,{nativeEdit:true});
}
export async function executeWorkspaceAudio(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,runtime:InputRuntime,command:string,data:Record<string,unknown>){
 await requireWritableEpisodeStorage(c,root,row.episode_id);
 if(command==='refreshWorkspaceAudio')return;
 if(command==='setWorkspaceAudioEnabled'){
  if(!['bgm','sfx'].includes(String(data.kind))||typeof data.enabled!=='boolean')throw new ConfigurationError(400,'声音开关配置无效。');
  if(isOpenChatCutStudio(row.episode_id))throw new ConfigurationError(409,'请先保存并退出剪辑面板，再切换声音。');
  const next=setWorkspaceSoundEnabled(project,data.kind as 'bgm'|'sfx',data.enabled);
  await persistEdit(c,root,row,project,next,'切换配乐或音效');return;
 }
 if(command==='saveWorkspaceMusicSettings'){
  const value=data.settings as Record<string,unknown>|undefined;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['description','query','materialRevisionId'].includes(key))||typeof value.description!=='string'||!value.description.trim()||value.description.length>100||typeof value.query!=='string'||value.query.length>100||typeof value.materialRevisionId!=='string')throw new ConfigurationError(400,'本期配乐配置无效。');
  if(value.materialRevisionId){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.materialRevisionId))throw new ConfigurationError(400,'配乐素材标识无效。');const material=(await c.query("SELECT material_purpose FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type='audio'",[value.materialRevisionId,row.episode_id])).rows[0];if(!material||!canUseWorkspaceAudioMaterial(material.material_purpose,'background_music'))throw new ConfigurationError(409,'请选择本生产单内的配乐素材。');}
  await c.query("UPDATE local_identity.production_workspaces SET music_defaults=coalesce(music_defaults,'{}'::jsonb)||jsonb_build_object('settings',$2::jsonb) WHERE id=$1",[row.id,JSON.stringify(value)]);return;
 }
 if(command==='saveWorkspaceAudioDefaults'){
  const resolved=await resolveProductionSelection(c,data.selection,'music_sound');
  await c.query("UPDATE local_identity.production_workspaces SET music_defaults=coalesce(music_defaults,'{}'::jsonb)||$2::jsonb WHERE id=$1",[row.id,JSON.stringify({selection:resolved.selection})]);return;
 }
 if(command==='prepareWorkspaceAudio'){
  if(!['bgm','sfx','source'].includes(String(data.kind)))throw new ConfigurationError(400,'音频类型无效。');
  if(data.kind!=='source'&&!readWorkspaceSoundEnabled(project,data.kind as 'bgm'|'sfx'))throw new ConfigurationError(409,'请先开启对应声音，再准备或检索。');
  if(Object.hasOwn(data,'audioTrackId')&&(data.kind==='source'||data.materialRevisionId||data.preparationId||data.retry!==undefined||data.candidateCount!==undefined))throw new ConfigurationError(400,'原登记音轨不能与素材、重试或批量请求混用。');
  const candidateCount=data.candidateCount??1;
  if(!Number.isInteger(candidateCount)||Number(candidateCount)<1||Number(candidateCount)>3||data.candidateCount!==undefined&&(data.kind!=='sfx'||data.materialRevisionId||data.preparationId)||data.intent!==undefined&&(data.kind!=='sfx'||typeof data.intent!=='string'||!data.intent.trim()||data.intent.length>240))throw new ConfigurationError(400,'音效意图或候选数量无效。');
  if(data.retry!==undefined&&typeof data.retry!=='boolean')throw new ConfigurationError(400,'重试参数无效。');
  if(data.preparationId){
   const p=(await c.query('SELECT * FROM local_identity.workspace_audio_preparations WHERE workspace_id=$1 AND id=$2',[row.id,data.preparationId])).rows[0];
   if(!p||!p.task_id||!data.retry)throw new ConfigurationError(409,'请选择失败的音频准备任务重试。');
   if(['bgm','sfx'].includes(p.kind)&&!readWorkspaceSoundEnabled(project,p.kind))throw new ConfigurationError(409,'请先开启对应声音，再重试。');
   const task=(await c.query('SELECT input_snapshot,invalidated_at FROM public.tasks WHERE id=$1',[p.task_id])).rows[0];
   if(task?.invalidated_at||!await preparationCurrent(c,root,row,project,{...p,input_snapshot:task?.input_snapshot}))throw new ConfigurationError(409,'目标或输入已失效，请核对当前内容后重新准备。');
   await audioRuntime(runtime,p.kind,task?.input_snapshot);const queued=(await c.query('SELECT local_identity.queue_workspace_audio($1,true) task_id',[p.id])).rows[0];recordValidatedRequestLogContext({taskId:queued?.task_id});return;
  }
  const preferences=data.kind==='sfx'&&typeof data.shotId==='string'?workspaceRenderPreferences(project,data.shotId):undefined;
  let duration=Number(data.durationSeconds??preferences?.sfxDuration),description=data.description??'原片音轨',query=data.query??null,anchor=data.anchor??(data.kind==='sfx'&&data.shotId?'shot':'absolute'),offset=Number(data.offsetSeconds??preferences?.sfxStart??0),shotId=data.shotId??null,sourceItemId=data.sourceItemId??null,sourceSha:string|null=null,source:any=null;
  if(data.intent&&!query)query=soundIntentQuery(String(data.intent));
  if(data.kind==='source'){
   const clip=row.bindings.find(b=>b.itemId===sourceItemId&&(!shotId||b.shotId===shotId)),item=project.timelines.flatMap(t=>t.items).find(i=>i.id===sourceItemId);
   if(!clip||!item||item.kind!=='video'||typeof item.src!=='string')throw new ConfigurationError(409,'请选择当前工程中的原片画面。');
   source=await resolveWorkspaceSource(c,root,row.episode_id,item.src);const observed=await inspectMp4Artifact(await resolveEpisodeFileReference(c,await episodeStorageLocationAtRoot(c,root,row.episode_id),source.relative_path));if(!observed.hasAudio)throw new ConfigurationError(409,'所选原片没有音频流。');
   const timeline=project.timelines.find(t=>t.items.includes(item))!,rate=Number(item.playbackRate??1),start=Number(item.srcInFrame??0)/timeline.fps;duration=Number(item.durationInFrames)*rate/timeline.fps;if(!Number.isFinite(rate)||rate<=0||!Number.isFinite(start)||start<0||!Number.isFinite(duration)||duration<=0||start+duration>observed.durationSeconds+.025)throw new ConfigurationError(409,'所选原片使用窗口无效或超出实际源长。');sourceSha=source.sha256;shotId=clip.shotId;anchor='shot';offset=0;description=`${clip.shotId} 原片 ${start.toFixed(2)}–${(start+duration).toFixed(2)}s`;source={...source,duration,startSeconds:start,sourceInFrame:Number(item.srcInFrame??0),sourceFrameRate:timeline.fps,playbackRate:rate,visualDurationInFrames:Number(item.durationInFrames)};
  }
  if(typeof description!=='string'||!description.trim()||description.length>100||!Number.isFinite(duration)||duration<=0||duration>7200||!['absolute','shot'].includes(String(anchor))||!Number.isFinite(offset)||offset<0||anchor==='shot'&&!row.bindings.some(b=>b.shotId===shotId))throw new ConfigurationError(400,'音频说明、时长或位置无效。');
  if(data.kind==='sfx'&&anchor==='shot'&&(preferences?.sfxStart!==undefined||preferences?.sfxDuration!==undefined)){
   const ids=new Set(workspaceAudioShotIds(row)[String(shotId)]??[]),timeline=project.timelines.find(t=>t.items.some(i=>ids.has(String(i.id)))),items=timeline?.items.filter(i=>ids.has(String(i.id)))??[];
   const shotFrames=items.length?Math.max(...items.map(i=>Number(i.startFrame)+Number(i.durationInFrames)))-Math.min(...items.map(i=>Number(i.startFrame))):0;
   if(!timeline||Math.round(offset*timeline.fps)+Math.max(1,Math.round(duration*timeline.fps))>shotFrames)throw new ConfigurationError(409,'音效区间超出实际镜头时长，请调整起点或时长。');
  }
  if(data.kind==='bgm'){anchor='absolute';offset=0;shotId=null;}
  if(data.kind!=='source'&&!data.materialRevisionId&&!Object.hasOwn(data,'audioTrackId')&&(typeof query!=='string'||!query.trim()||query.length>100||!/^[\x20-\x7e]+$/.test(query)))throw new ConfigurationError(400,'请填写不超过 100 字符的英文 Freesound 检索词。');
  let materialId=null,requestSnapshot:Record<string,unknown>={};
  if(Object.hasOwn(data,'audioTrackId')){
   const registered=await registeredWorkspaceAudio(c,root,row.episode_id,data.audioTrackId,data.kind==='bgm'?'bgm':'sfx');
   if(registered.duration+.05<duration)throw new ConfigurationError(409,'原登记音轨短于请求使用时长。');requestSnapshot=registered.snapshot;query=null;
  }else if(data.materialRevisionId){
   const m=(await c.query("SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type='audio'",[data.materialRevisionId,row.episode_id])).rows[0];
   if(!m||data.kind==='source'||!canUseWorkspaceAudioMaterial(m.material_purpose,data.kind==='bgm'?'background_music':'sound_effect'))throw new ConfigurationError(409,'请选择本期已登记的对应人工音频。');
   await verifyEpisodeFile(c,root,row.episode_id,m.storage_path,m.sha256,Number(m.file_size));if(await probeMp3Artifact(await resolveEpisodeFileReference(c,await episodeStorageLocationAtRoot(c,root,row.episode_id),m.storage_path))+.05<duration)throw new ConfigurationError(409,'人工音频短于请求使用时长。');materialId=m.id;query=null;
  }else if(data.kind==='source')await audioRuntime(runtime,'source');else{
   const resolved=await resolveProductionSelection(c,data.selection,'music_sound');
   const max=resolved.choice.constraints.query?.maxLength??100;if(String(query).length>max)throw new ConfigurationError(400,`检索词不能超过 ${max} 字符。`);
   const authorized=await currentWorkspaceCallAuthorization(c,row);
   const context=(await c.query('SELECT e.account_id,e.blueprint_version_id,e.series_version_id,b.policy,s.rules series_rules FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id LEFT JOIN public.series_versions s ON s.id=e.series_version_id WHERE e.id=$1',[row.episode_id])).rows[0];
   const execution={...resolved.execution,executor:{...resolved.execution.executor,model:'freesound-preview-v1'},allowed_tools:['read','write','network'],budget_cents:0,max_attempts:1};
   requestSnapshot={selectionVersion:1,selection:resolved.selection,connection:resolved.connection,execution,query,description,parameters:{durationSeconds:duration,anchor,offsetSeconds:offset,shotId},context:{accountId:context.account_id,blueprintVersionId:context.blueprint_version_id,seriesVersionId:context.series_version_id,accountRules:creativeAccountRules(context.policy),seriesRules:context.series_rules},target:{workspaceId:row.id,preparationRevisionId:row.preparation_revision_id,scriptRevisionId:row.script_revision_id,projectSha256:row.project_sha256,revision:row.revision,shotId},costBasis:{kind:'freesound_preview_search',reservationCents:0},authorizationHash:authorized.authorization_hash};
   await audioRuntime(runtime,String(data.kind),{execution});await runtime.checkReferences(c,[resolved.connection!.id],{purpose:'workspace-generation'});
  }
  for(let candidateIndex=0;candidateIndex<Number(candidateCount);candidateIndex++){
  const snapshot=data.candidateCount===undefined?requestSnapshot:{...requestSnapshot,candidateIndex,intent:data.intent??null};
  const id=randomUUID(),fingerprint=hash([row.id,row.script_revision_id,data.kind,description,query,duration,anchor,offset,shotId,sourceItemId,sourceSha,source?.startSeconds??null,source?.playbackRate??null,materialId,snapshot]);
  await c.query('INSERT INTO local_identity.workspace_audio_preparations(id,workspace_id,episode_id,kind,shot_id,source_item_id,source_sha256,description,query,anchor,offset_seconds,duration_seconds,material_revision_id,input_fingerprint,request_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[id,row.id,row.episode_id,data.kind,shotId,sourceItemId,sourceSha,description,query,anchor,offset,duration,materialId,fingerprint,snapshot]);
  if(!materialId&&!Object.hasOwn(data,'audioTrackId')){const queued=(await c.query('SELECT local_identity.queue_workspace_audio($1,false,$2) task_id',[id,source?JSON.stringify({relativePath:source.relative_path,sha256:source.sha256,fileSize:Number(source.file_size),durationSeconds:duration,startSeconds:source.startSeconds,sourceInFrame:source.sourceInFrame,sourceFrameRate:source.sourceFrameRate,playbackRate:source.playbackRate,visualDurationInFrames:source.visualDurationInFrames}):null])).rows[0];recordValidatedRequestLogContext({taskId:queued?.task_id,...(typeof shotId==='string'?{shotId}: {})});}
  }return;
 }
 if(isOpenChatCutStudio(row.episode_id))throw new ConfigurationError(409,'请在剪辑面板调整混音；添加音轨请先保存并返回素材准备。');
 if(command==='adoptWorkspaceRecordedVoice'){await adoptWorkspaceRecordedVoice(c,root,row,project,data);return;}
 if(command==='mixWorkspaceAudio'){
  const edit=data.edit as WorkspaceAudioEdit;if(edit?.workspaceId!==row.id)throw new ConfigurationError(400,'混音工程身份无效。');
  if(edit.kind==='voice'){
   const actual=workspaceAudioShotIds(row)[edit.shotId];if(!actual||!Array.isArray(edit.visualItemIds)||JSON.stringify([...actual].sort())!==JSON.stringify([...edit.visualItemIds].sort()))throw new ConfigurationError(409,'镜头范围已变化，请刷新。');
  }
  let next;try{next=applyWorkspaceAudioMix(project,edit);}catch(e){throw new ConfigurationError(409,e instanceof Error?e.message:'混音输入无效。');}
  await persistEdit(c,root,row,project,next,'调整实际混音');return;
 }
 if(command!=='adoptWorkspaceAudio')throw new ConfigurationError(400,'不支持的音频操作。');
 const p=(await c.query(`SELECT p.*,t.input_snapshot,a.id audio_track_id,a.relative_path,a.sha256,a.file_size,a.duration_seconds actual_duration FROM local_identity.workspace_audio_preparations p LEFT JOIN public.tasks t ON t.id=p.task_id AND t.status='completed' ${workspacePreparedAudioJoin} WHERE p.workspace_id=$1 AND p.id=$2`,[row.id,data.preparationId])).rows[0];
 if(!p)throw new ConfigurationError(404,'音频准备记录不存在。');
 if(p.request_snapshot?.version==='registered-audio-input/v1'){
  const current=await registeredWorkspaceAudio(c,root,row.episode_id,p.request_snapshot.audioTrackId,p.kind==='source'?'source':p.kind==='bgm'?'bgm':'sfx');
  if(current.track.sha256!==p.request_snapshot.sha256||Number(current.track.file_size)!==p.request_snapshot.fileSize||current.track.source_artifact_id!==p.request_snapshot.sourceArtifactId||current.track.source_task_id!==p.request_snapshot.sourceTaskId)throw new ConfigurationError(409,'原登记音轨版本已变化。');
  if(p.kind==='source'){
   if(p.request_snapshot.purpose!=='recorded-primary-voice/v1')throw new ConfigurationError(409,'原声准备记录缺少明确采用来源。');
   await adoptWorkspaceRecordedVoice(c,root,row,project,{shotId:p.shot_id,audioTrackId:p.request_snapshot.audioTrackId,expectedSha256:p.request_snapshot.sha256});return;
  }
 }
 if(['bgm','sfx'].includes(p.kind)&&!readWorkspaceSoundEnabled(project,p.kind))throw new ConfigurationError(409,'请先开启对应声音，再采用。');
 let path=p.relative_path,sha=p.sha256,size=Number(p.file_size),duration=Number(p.actual_duration),assetId=`audio-track-${p.audio_track_id}`;
 if(p.material_revision_id){const m=(await c.query('SELECT * FROM public.production_material_revisions WHERE episode_id=$1 AND id=$2',[row.episode_id,p.material_revision_id])).rows[0];if(!m)throw new ConfigurationError(409,'人工音频登记已变化。');path=m.storage_path;sha=m.sha256;size=Number(m.file_size);assetId=`material-${m.id}`;}
 if(!path)throw new ConfigurationError(409,'音频任务尚未成功完成，请刷新或重试。');
 await verifyEpisodeFile(c,root,row.episode_id,path,sha,size);duration=await probeMp3Artifact(await resolveEpisodeFileReference(c,await episodeStorageLocationAtRoot(c,root,row.episode_id),path));
 const timeline=project.timelines.find(t=>t.id===project.activeTimelineId)!;const next=structuredClone(project);let tl=next.timelines.find(t=>t.id===project.activeTimelineId)!;
 if(!next.assets.some(a=>a.id===assetId))next.assets.push({id:assetId,name:p.description,kind:'audio',src:path,durationInFrames:Math.floor(duration*timeline.fps)});
 let itemId:string;
 if(p.kind==='source'){
  const visual=tl.items.find(i=>i.id===p.source_item_id);if(!visual||typeof visual.src!=='string'||(await resolveWorkspaceSource(c,root,row.episode_id,visual.src)).sha256!==p.source_sha256)throw new ConfigurationError(409,'原片来源已变化，请重新提取当前原声。');
  const frozen=p.input_snapshot?.workspace_source;if(!frozen||Number(visual.srcInFrame??0)!==Number(frozen.sourceInFrame)||Number(visual.durationInFrames)!==Number(frozen.visualDurationInFrames)||Number(visual.playbackRate??1)!==Number(frozen.playbackRate)||tl.fps!==Number(frozen.sourceFrameRate))throw new ConfigurationError(409,'所选原片使用窗口已变化，请按当前区间重新提取。');
  const prior=tl.items.find(i=>i.id===`workspace-source-shot-${p.shot_id}`),priorAsset=next.assets.find(a=>a.id===prior?.sourceAssetId);
  if(prior&&prior.sourceAssetId!==assetId){if(!priorAsset)throw new ConfigurationError(409,'原声音轨来源缺失。');Object.assign(priorAsset,{loopControlAudioSource:{...((priorAsset as unknown as {loopControlAudioSource?:object}).loopControlAudioSource??{}),...await priorSourceProvenance(c,root,row.episode_id,row.id,prior,priorAsset)}});}else if(prior&&(prior.src!==path||priorAsset?.src!==path))throw new ConfigurationError(409,'当前原声音轨与所选登记来源不同。');
  const audioAsset=next.assets.find(a=>a.id===assetId)! as unknown as Record<string,unknown>;audioAsset.durationInFrames=Math.floor(duration*timeline.fps);audioAsset.loopControlAudioSource={videoAssetId:visual.sourceAssetId,sha256:p.source_sha256,sourceInFrame:Number(frozen.sourceInFrame),sourceFrameRate:Number(frozen.sourceFrameRate)};
  let mixed;try{mixed=applyWorkspaceAudioMix(next,{kind:'voice',workspaceId:row.id,shotId:p.shot_id,visualItemIds:workspaceAudioShotIds(row)[p.shot_id],mode:'source',sourceItemId:p.source_item_id,sourceAssetId:assetId,gainDb:workspaceRenderPreferences(project,p.shot_id)?.voiceGainDb??0,ambienceGainDb:null},{preserveSourcePresentation:true});}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'原声采用未完成。');}
  itemId=`workspace-source-shot-${p.shot_id}`;
  // Source extraction has its own registered real track; no legacy video-ready draft is fabricated.
  await c.query('SELECT local_identity.use_production_source_track($1,$2,$3)',[row.id,p.shot_id,p.audio_track_id]);
  await c.query('UPDATE local_identity.workspace_audio_preparations SET adopted_item_id=$2 WHERE id=$1',[p.id,itemId]);await persistEdit(c,root,row,project,mixed,'采用原片主声');return;
 }
 if(p.kind==='bgm'){
  try{itemId=installWorkspaceMusic(next,row.id,p.id,{assetId,path,sha256:sha,durationSeconds:duration,description:p.description});}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'配乐采用未完成。');}
  await c.query('UPDATE local_identity.workspace_audio_preparations SET adopted_item_id=$2 WHERE id=$1',[p.id,itemId]);await persistEdit(c,root,row,project,next,'采用配乐');return;
 }
 const shotIds=p.anchor==='shot'?new Set(workspaceAudioShotIds(row)[p.shot_id]??[]):null,anchorItems=shotIds?tl.items.filter(i=>shotIds.has(String(i.id))):[];
 if(shotIds&&!anchorItems.length)throw new ConfigurationError(409,'音效锚点镜头已删除。');
 const start=(anchorItems.length?Math.min(...anchorItems.map(i=>Number(i.startFrame))):0)+Math.round(Number(p.offset_seconds)*tl.fps);
 const frames=Math.max(1,Math.round(Number(p.duration_seconds)*tl.fps));
 itemId=`workspace-sfx-${p.id}`;const previous=tl.items.find(i=>i.id===itemId),track=typeof previous?.track==='string'?previous.track:`workspace-sfx-${p.id}`;
 const actualStart=Number(previous?.startFrame??start),actualFrames=Number(previous?.durationInFrames??frames),sourceIn=Number(previous?.srcInFrame??0),rate=Number(previous?.playbackRate??1);
 if(duration+.05<(sourceIn+actualFrames*rate)/tl.fps)throw new ConfigurationError(409,'音频短于当前整期或音效窗口，请重新准备；不会自动循环。');
 const preferences=p.shot_id?workspaceRenderPreferences(project,p.shot_id):undefined;
 const item:Record<string,unknown>={...previous,id:itemId,kind:'audio',name:previous?.name??p.description,track,src:path,sourceAssetId:assetId,sourceContentHash:sha,startFrame:actualStart,durationInFrames:actualFrames,srcInFrame:sourceIn,volume:previous?.volume??10**((preferences?.sfxGainDb??-6)/20),loopControlAudio:{...((previous?.loopControlAudio as Record<string,unknown>|undefined)??{}),workspaceId:row.id,kind:p.kind,preparationId:p.id,...(!previous?(p.anchor==='shot'?{shotId:p.shot_id,anchor:'shot',offsetSeconds:Number(p.offset_seconds)}:{anchor:'absolute'}):{})}};
 if(previous&&previous.sourceAssetId!==assetId){delete item.sourceRevision;delete item.sourceFilename;}
 tl.items=tl.items.filter(i=>i.id!==itemId);tl.items.push(item);
 if(!tl.trackOrder.includes(track))tl.trackOrder.push(track);if(!tl.tracks[track])tl.tracks[track]={kind:'audio',name:'音效'};
 await c.query('UPDATE local_identity.workspace_audio_preparations SET adopted_item_id=$2 WHERE id=$1',[p.id,itemId]);await persistEdit(c,root,row,project,next,'采用配乐或音效');
}
async function audioRuntime(runtime:InputRuntime,kind:string,snapshot?:Record<string,any>){
 if(!runtime.mediaReady)throw new ConfigurationError(503,'本地音频执行器未配置。');
 if(kind==='source'){await runtime.mediaReady({});return;}
 const execution=snapshot?.execution??{execution_path:'external',credential_ref:snapshot?.credential_ref,executor:snapshot?.executor};
 await runtime.mediaReady({soundtrack:execution});
}
