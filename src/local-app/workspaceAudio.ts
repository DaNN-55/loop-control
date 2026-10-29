import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {applyWorkspaceAudioMix,readWorkspaceAudioMix,type WorkspaceAudioEdit} from '../workspaceAudio.js';
import {ConfigurationError} from './configurationCommands.js';
import {verifyNativeFile} from './localFiles.js';
import {resolveWorkspaceSource} from './workspaceSources.js';
import {probeMp3Artifact,inspectMp4Artifact} from '../worker/mediaTools.js';
import {isOpenChatCutStudio} from '../worker/openchatcutStudio.js';
import {updateWorkspaceProject,type ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import {productionHash} from './scriptProductionStore.js';
import type {InputRuntime} from './episodeCommands.js';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function workspaceAudioShotIds(row:ProductionWorkspaceRecord){return Object.fromEntries([...new Set(row.bindings.map(b=>b.shotId))].map(id=>[id,row.bindings.filter(b=>b.shotId===id).map(b=>b.itemId)]));}
export async function readWorkspaceAudio(c:PoolClient,row:ProductionWorkspaceRecord,project:OpenChatCutProject){
 const entries=(await c.query(`SELECT p.*,t.status,t.last_result,a.id audio_track_id,a.relative_path,a.sha256,a.file_size,a.duration_seconds actual_duration,m.storage_path,m.sha256 material_sha256,m.file_size material_size
 FROM local_identity.workspace_audio_preparations p LEFT JOIN public.tasks t ON t.id=p.task_id LEFT JOIN public.audio_tracks a ON a.source_task_id=t.id AND a.episode_id=p.episode_id LEFT JOIN public.production_material_revisions m ON m.id=p.material_revision_id AND m.episode_id=p.episode_id WHERE p.workspace_id=$1 ORDER BY p.created_at DESC`,[row.id])).rows;
 return{mix:readWorkspaceAudioMix(project,workspaceAudioShotIds(row)),preparations:entries.map(p=>({id:p.id,kind:p.kind,shotId:p.shot_id,sourceItemId:p.source_item_id,sourceSha256:p.source_sha256,description:p.description,query:p.query,anchor:p.anchor,offsetSeconds:Number(p.offset_seconds),durationSeconds:Number(p.duration_seconds),taskId:p.task_id,status:p.material_revision_id?'ready':p.status??'pending',error:p.last_result?.blockers?.[0]?.detail??p.last_result?.retry?.reason??null,audioTrackId:p.audio_track_id??null,relativePath:p.relative_path??p.storage_path??null,sha256:p.sha256??p.material_sha256??null,fileSize:Number(p.file_size??p.material_size??0),adoptedItemId:p.adopted_item_id,source:p.last_result?.mediaSource??(p.material_revision_id?{provider:'manual',materialRevisionId:p.material_revision_id}:null)}))};
}
async function persistEdit(c:PoolClient,root:string,row:ProductionWorkspaceRecord,_before:OpenChatCutProject,after:OpenChatCutProject,reason:string){
 return updateWorkspaceProject(c,root,row,after,row.bindings,reason,{nativeEdit:true});
}
export async function executeWorkspaceAudio(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,runtime:InputRuntime,command:string,data:Record<string,unknown>){
 if(command==='refreshWorkspaceAudio')return;
 if(command==='prepareWorkspaceAudio'){
  if(!['bgm','sfx','source'].includes(String(data.kind)))throw new ConfigurationError(400,'音频类型无效。');
  if(data.retry!==undefined&&typeof data.retry!=='boolean')throw new ConfigurationError(400,'重试参数无效。');
  if(data.preparationId){
   const p=(await c.query('SELECT * FROM local_identity.workspace_audio_preparations WHERE workspace_id=$1 AND id=$2',[row.id,data.preparationId])).rows[0];
   if(!p||!p.task_id||!data.retry)throw new ConfigurationError(409,'请选择失败的音频准备任务重试。');
   await ready(c,row,runtime,p.kind);await c.query('SELECT local_identity.queue_workspace_audio($1,true)',[p.id]);return;
  }
  let duration=Number(data.durationSeconds),description=data.description??'原片音轨',query=data.query??null,anchor=data.anchor??'absolute',offset=Number(data.offsetSeconds??0),shotId=data.shotId??null,sourceItemId=data.sourceItemId??null,sourceSha:string|null=null,source:any=null;
  if(data.kind==='source'){
   const clip=row.bindings.find(b=>b.itemId===sourceItemId&&(!shotId||b.shotId===shotId)),item=project.timelines.flatMap(t=>t.items).find(i=>i.id===sourceItemId);
   if(!clip||!item||item.kind!=='video'||typeof item.src!=='string')throw new ConfigurationError(409,'请选择当前工程中的原片画面。');
   source=await resolveWorkspaceSource(c,root,row.episode_id,item.src);const observed=await inspectMp4Artifact(join(root,source.relative_path));if(!observed.hasAudio)throw new ConfigurationError(409,'所选原片没有音频流。');
   duration=observed.durationSeconds;sourceSha=source.sha256;shotId=clip.shotId;anchor='shot';offset=0;source={...source,duration};
  }
  if(typeof description!=='string'||!description.trim()||description.length>100||!Number.isFinite(duration)||duration<=0||duration>7200||!['absolute','shot'].includes(String(anchor))||!Number.isFinite(offset)||offset<0||anchor==='shot'&&!row.bindings.some(b=>b.shotId===shotId))throw new ConfigurationError(400,'音频说明、时长或位置无效。');
  if(data.kind==='bgm'){anchor='absolute';offset=0;shotId=null;}
  if(data.kind!=='source'&&!data.materialRevisionId&&(typeof query!=='string'||!query.trim()||query.length>100||!/^[\x20-\x7e]+$/.test(query)))throw new ConfigurationError(400,'请填写不超过 100 字符的英文 Freesound 检索词。');
  let materialId=null;
  if(data.materialRevisionId){
   const m=(await c.query("SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type='audio'",[data.materialRevisionId,row.episode_id])).rows[0];
   if(!m||m.material_purpose!==(data.kind==='bgm'?'background_music':'sound_effect'))throw new ConfigurationError(409,'请选择本期已登记的对应人工音频。');
   await verifyNativeFile(root,m.storage_path,m.sha256,Number(m.file_size));if(await probeMp3Artifact(join(root,m.storage_path))+.05<duration)throw new ConfigurationError(409,'人工音频短于请求使用时长。');materialId=m.id;query=null;
  }else await ready(c,row,runtime,String(data.kind));
  const id=randomUUID(),fingerprint=hash([row.id,row.script_revision_id,data.kind,description,query,duration,anchor,offset,shotId,sourceItemId,sourceSha,materialId]);
  await c.query('INSERT INTO local_identity.workspace_audio_preparations(id,workspace_id,episode_id,kind,shot_id,source_item_id,source_sha256,description,query,anchor,offset_seconds,duration_seconds,material_revision_id,input_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[id,row.id,row.episode_id,data.kind,shotId,sourceItemId,sourceSha,description,query,anchor,offset,duration,materialId,fingerprint]);
  if(!materialId)await c.query('SELECT local_identity.queue_workspace_audio($1,false,$2)',[id,source?JSON.stringify({relativePath:source.relative_path,sha256:source.sha256,fileSize:Number(source.file_size),durationSeconds:duration}):null]);return;
 }
 if(isOpenChatCutStudio(row.episode_id))throw new ConfigurationError(409,'请在剪辑面板调整混音；添加音轨请先保存并返回素材准备。');
 if(command==='mixWorkspaceAudio'){
  const edit=data.edit as WorkspaceAudioEdit;if(edit?.workspaceId!==row.id)throw new ConfigurationError(400,'混音工程身份无效。');
  if(edit.kind==='voice'){
   const actual=workspaceAudioShotIds(row)[edit.shotId];if(!actual||!Array.isArray(edit.visualItemIds)||JSON.stringify([...actual].sort())!==JSON.stringify([...edit.visualItemIds].sort()))throw new ConfigurationError(409,'镜头范围已变化，请刷新。');
  }
  let next;try{next=applyWorkspaceAudioMix(project,edit);}catch(e){throw new ConfigurationError(409,e instanceof Error?e.message:'混音输入无效。');}
  await persistEdit(c,root,row,project,next,'调整实际混音');return;
 }
 if(command!=='adoptWorkspaceAudio')throw new ConfigurationError(400,'不支持的音频操作。');
 const p=(await c.query(`SELECT p.*,a.id audio_track_id,a.relative_path,a.sha256,a.file_size,a.duration_seconds actual_duration FROM local_identity.workspace_audio_preparations p LEFT JOIN public.tasks t ON t.id=p.task_id AND t.status='completed' LEFT JOIN public.audio_tracks a ON a.source_task_id=t.id WHERE p.workspace_id=$1 AND p.id=$2`,[row.id,data.preparationId])).rows[0];
 if(!p)throw new ConfigurationError(404,'音频准备记录不存在。');
 let path=p.relative_path,sha=p.sha256,size=Number(p.file_size),duration=Number(p.actual_duration),assetId=`audio-track-${p.audio_track_id}`;
 if(p.material_revision_id){const m=(await c.query('SELECT * FROM public.production_material_revisions WHERE episode_id=$1 AND id=$2',[row.episode_id,p.material_revision_id])).rows[0];if(!m)throw new ConfigurationError(409,'人工音频登记已变化。');path=m.storage_path;sha=m.sha256;size=Number(m.file_size);assetId=`material-${m.id}`;}
 if(!path)throw new ConfigurationError(409,'音频任务尚未成功完成，请刷新或重试。');
 await verifyNativeFile(root,path,sha,size);duration=await probeMp3Artifact(join(root,path));
 const timeline=project.timelines.find(t=>t.id===project.activeTimelineId)!;const next=structuredClone(project);let tl=next.timelines.find(t=>t.id===project.activeTimelineId)!;
 if(!next.assets.some(a=>a.id===assetId))next.assets.push({id:assetId,name:p.description,kind:'audio',src:path,durationInFrames:Math.floor(duration*timeline.fps)});
 let itemId:string;
 if(p.kind==='source'){
  const visual=tl.items.find(i=>i.id===p.source_item_id);if(!visual||typeof visual.src!=='string'||(await resolveWorkspaceSource(c,root,row.episode_id,visual.src)).sha256!==p.source_sha256)throw new ConfigurationError(409,'原片来源已变化，请重新提取当前原声。');
  const mixed=applyWorkspaceAudioMix(next,{kind:'voice',workspaceId:row.id,shotId:p.shot_id,visualItemIds:workspaceAudioShotIds(row)[p.shot_id],mode:'source',sourceItemId:p.source_item_id,sourceAssetId:assetId,gainDb:0,ambienceGainDb:null});
  itemId=`workspace-source-shot-${p.shot_id}`;
  // Source extraction has its own registered real track; no legacy video-ready draft is fabricated.
  await c.query('SELECT local_identity.use_workspace_source_track($1,$2,$3,$4)',[row.episode_id,row.storyboard_package_id,p.shot_id,p.audio_track_id]);
  await c.query('UPDATE local_identity.workspace_audio_preparations SET adopted_item_id=$2 WHERE id=$1',[p.id,itemId]);await persistEdit(c,root,row,project,mixed,'采用原片主声');return;
 }
 const shotIds=p.anchor==='shot'?new Set(workspaceAudioShotIds(row)[p.shot_id]??[]):null,anchorItems=shotIds?tl.items.filter(i=>shotIds.has(String(i.id))):[];
 if(shotIds&&!anchorItems.length)throw new ConfigurationError(409,'音效锚点镜头已删除。');
 const start=p.kind==='bgm'?0:(anchorItems.length?Math.min(...anchorItems.map(i=>Number(i.startFrame))):0)+Math.round(Number(p.offset_seconds)*tl.fps);
 const end=Math.max(...tl.items.filter(i=>['video','image','text','sequence'].includes(String(i.kind))).map(i=>Number(i.startFrame)+Number(i.durationInFrames)),1),frames=p.kind==='bgm'?end:Math.round(Number(p.duration_seconds)*tl.fps);
 if(duration+.05<frames/tl.fps)throw new ConfigurationError(409,'音频短于当前整期或音效窗口，请重新准备；不会自动循环。');
 itemId=p.kind==='bgm'?'workspace-bgm':`workspace-sfx-${p.id}`;const track=p.kind==='bgm'?'workspace-bgm':`workspace-sfx-${p.id}`;
 tl.items=tl.items.filter(i=>i.id!==itemId);tl.items.push({id:itemId,kind:'audio',name:p.description,track,src:path,sourceAssetId:assetId,startFrame:start,durationInFrames:frames,srcInFrame:0,volume:10**((p.kind==='bgm'?-12:-6)/20),loopControlAudio:{workspaceId:row.id,kind:p.kind,preparationId:p.id,...(p.anchor==='shot'?{shotId:p.shot_id,anchor:'shot',offsetSeconds:Number(p.offset_seconds)}:{anchor:'absolute'})}});
 if(!tl.trackOrder.includes(track))tl.trackOrder.push(track);tl.tracks[track]={kind:'audio',name:p.kind==='bgm'?'整期配乐':'音效',...(p.kind==='bgm'?{role:'follower',audioRouting:{duckDepthDb:10}}:{})};
 await c.query('UPDATE local_identity.workspace_audio_preparations SET adopted_item_id=$2 WHERE id=$1',[p.id,itemId]);await persistEdit(c,root,row,project,next,'采用配乐或音效');
}
async function ready(c:PoolClient,row:ProductionWorkspaceRecord,runtime:InputRuntime,kind:string){
 if(kind==='source'){if(!runtime.mediaReady)throw new ConfigurationError(503,'本地音频执行器未配置。');await runtime.mediaReady({});return;}
 const e=(await c.query('SELECT b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[row.episode_id])).rows[0],config=e.policy.soundtrack;
 if(config?.execution_path!=='external'||config?.executor?.provider!=='freesound'||config.executor.adapter!=='freesound_preview')throw new ConfigurationError(409,'配乐 / 音效能力为关闭、人工或不可执行；请使用人工音频。');
 const authorized=(await c.query('SELECT * FROM local_identity.script_productions WHERE episode_id=$1 AND script_revision_id=$2 AND enabled AND authorized_at IS NOT NULL',[row.episode_id,row.script_revision_id])).rows[0];
 if(!authorized||authorized.plan?.executionFingerprint!==productionHash(e.policy))throw new ConfigurationError(409,'请先确认并授权当前制作能力。');
 if(!runtime.mediaReady)throw new ConfigurationError(503,'本地媒体执行器未配置。');await runtime.mediaReady({soundtrack:config});await runtime.checkReferences(c,[config.credential_ref]);
}
