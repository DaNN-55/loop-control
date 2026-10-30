import {resolveWorkspaceMainVoice} from '../workspaceAudio.js';
import {adoptFirstWorkspaceNarration,readWorkspaceNarration,readWorkspaceNarrationTarget} from './workspaceNarration.js';
import {queueWorkspaceVisualGeneration} from './workspaceVisualCandidates.js';
import {inspectMp4Artifact} from '../worker/mediaTools.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {ConfigurationError} from './configurationCommands.js';
import {verifyNativeFile} from './localFiles.js';
import {isOpenChatCutStudio} from '../worker/openchatcutStudio.js';
import {lockProductionWorkspace,updateWorkspaceProject,workspaceContentSha256} from './productionWorkspaceCommands.js';
const exec=promisify(execFile);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Preparation fills a placeholder once. Native image items remain the only editable authority. */
export async function matchWorkspaceImage(c:PoolClient,root:string,episodeId:string,data:Record<string,unknown>){
 const {row,project}=await lockProductionWorkspace(c,root,episodeId,data.workspaceId,data.expectedRevision);
 if(isOpenChatCutStudio(episodeId))throw new ConfigurationError(409,'请先保存并返回素材匹配。');
 const clip=row.bindings.find(b=>b.id===data.clipId);if(!clip||clip.source||clip.image)throw new ConfigurationError(409,'占位已变化，请刷新当前工程。');
 if(!['still','pan-zoom'].includes(String(data.usage))||typeof data.durationSeconds!=='number'||!Number.isFinite(data.durationSeconds)||data.durationSeconds<0.1||data.durationSeconds>120||!['contain','cover'].includes(String(data.fit))||typeof data.focusX!=='number'||!Number.isFinite(data.focusX)||Math.abs(data.focusX)>100||typeof data.focusY!=='number'||!Number.isFinite(data.focusY)||Math.abs(data.focusY)>100)throw new ConfigurationError(400,'图片使用方式、时长或构图无效。');
 if(typeof data.materialRevisionId!=='string'||!uuid.test(data.materialRevisionId))throw new ConfigurationError(400,'图片标识无效。');
 const material=(await c.query("SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type='image' AND mime_type IN ('image/png','image/jpeg','image/webp','image/bmp')",[data.materialRevisionId,episodeId])).rows[0];if(!material)throw new ConfigurationError(404,'本期图片不存在。');
 try{await verifyNativeFile(root,material.storage_path,material.sha256,Number(material.file_size));}catch{throw new ConfigurationError(409,'输入图片缺失或指纹已变化，请重新注册原图。');}
 let width:number,height:number;try{const {stdout}=await exec('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',join(root,material.storage_path)],{timeout:15000});const stream=JSON.parse(stdout).streams[0];width=Number(stream.width);height=Number(stream.height);if(!(width>0&&height>0))throw Error();}catch{throw new ConfigurationError(409,'输入图片无法读取。');}
 const timeline=project.timelines.find(t=>t.items.some(i=>i.id===clip.itemId)),item=timeline?.items.find(i=>i.id===clip.itemId);if(!timeline||!item||item.kind!=='text')throw new ConfigurationError(409,'占位已由剪辑修改，请在当前工程中操作。');
 const frames=Math.max(1,Math.round(data.durationSeconds*timeline.fps)),delta=frames-Number(item.durationInFrames),end=Number(item.startFrame)+Number(item.durationInFrames);
 for(const other of timeline.items)if(other.id!==item.id&&Number(other.startFrame)>=end)other.startFrame=Number(other.startFrame)+delta;
 // The native timeline owns fit. Express per-image fit against that canvas through its transform.
 const contain=Math.min(timeline.width/width,timeline.height/height),cover=Math.max(timeline.width/width,timeline.height/height),base=timeline.fit==='contain'?contain:cover,scale=(data.fit==='contain'?contain:cover)/base;
 const assetId=`material-${material.id}`;if(!project.assets.some(a=>a.id===assetId))project.assets.push({id:assetId,name:material.source_path.split('/').pop()??clip.shotId,kind:'image',src:material.storage_path,durationInFrames:frames});
 Object.assign(item,{kind:'image',name:clip.shotId,src:material.storage_path,sourceAssetId:assetId,sourceRevision:material.id,sourceContentHash:material.sha256,sourceFilename:material.source_path.split('/').pop(),durationInFrames:frames,fit:data.fit,transform:{scale,x:data.focusX,y:data.focusY,rotation:0},width,height,volume:0});delete item.props;
 if(data.usage==='pan-zoom'&&frames>1)item.keyframes={scale:[{frame:0,value:scale,easing:'linear'},{frame:frames-1,value:scale*1.15,easing:'linear'}],x:[{frame:0,value:data.focusX,easing:'linear'},{frame:frames-1,value:Math.min(100,data.focusX+3),easing:'linear'}]};
 clip.source={materialRevisionId:material.id,relativePath:material.storage_path,sha256:material.sha256,fileSize:Number(material.file_size),kind:'image'};
 clip.image={usage:data.usage as 'still'|'pan-zoom',durationSeconds:frames/timeline.fps,fit:data.fit as 'contain'|'cover',focusX:data.focusX,focusY:data.focusY};
 return updateWorkspaceProject(c,root,row,project,row.bindings,'匹配图片');
}

/** Existing registered provider path, connection, explicit submission and budget checks remain authoritative. */
export async function generateWorkspaceImage(c:PoolClient,root:string,e:{id:string;account_id:string;policy:Record<string,unknown>},runtime:import('./episodeCommands.js').InputRuntime,data:Record<string,unknown>){
 let {row,project}=await lockProductionWorkspace(c,root,e.id,data.workspaceId,data.expectedRevision);
 if(isOpenChatCutStudio(e.id))throw new ConfigurationError(409,'请先保存并返回素材准备。');
 const clip=row.bindings.find(b=>b.id===data.clipId);if(!clip||clip.source||clip.image)throw new ConfigurationError(409,'首次生成只填入尚未匹配的占位。');
 if(typeof data.materialRevisionId!=='string'||!uuid.test(data.materialRevisionId))throw new ConfigurationError(400,'首帧图片标识无效。');
 const image=(await c.query("SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type='image'",[data.materialRevisionId,e.id])).rows[0];if(!image)throw new ConfigurationError(409,'首帧图片不存在，请选择本期图片。');
 try{await verifyNativeFile(root,image.storage_path,image.sha256,Number(image.file_size));}catch{throw new ConfigurationError(409,'首帧图片缺失或指纹已变化。');}
 const item=project.timelines.flatMap(t=>t.items).find(i=>i.id===clip.itemId);if(!item||item.kind!=='text')throw new ConfigurationError(409,'占位已由剪辑修改，不能首次生成覆盖。');
 // Prepare the existing first voice through the same guarded assembly used by refresh, then freeze the actual native route.
 if(await adoptFirstWorkspaceNarration(c,root,row,project,clip.shotId)){
  const revision=Number((await c.query('SELECT revision FROM local_identity.production_workspaces WHERE id=$1',[row.id])).rows[0].revision);
  ({row,project}=await lockProductionWorkspace(c,root,e.id,row.id,revision));
 }
 const currentClip=row.bindings.find(b=>b.id===data.clipId)!;
 const narration=(await readWorkspaceNarration(c,row,project)).find(n=>n.shotId===currentClip.shotId),voice=resolveWorkspaceMainVoice(project,currentClip.shotId).item,hasVoice=(!voice||voice.id===narration?.itemId)&&(narration?.mode==='tts'||narration?.mode==='manual');
 const narrationTarget=hasVoice?await readWorkspaceNarrationTarget(c,root,row.id,clip.id):null;
 const queued=await queueWorkspaceVisualGeneration(c,root,row,project,{targetItemId:clip.itemId,firstFrameMaterialRevisionId:image.id,prompt:data.prompt,durationSeconds:data.durationSeconds,reservationCents:data.reservationCents},runtime,'first');
 const targetDuration=queued.targetSeconds,providerDuration=queued.providerSeconds,task={id:queued.taskId};
 await c.query('INSERT INTO local_identity.workspace_image_requests(task_id,workspace_id,episode_id,clip_id,item_id,native_edit_revision,project_content_sha256,image_revision_id,image_sha256,duration_seconds,provider_duration_seconds,narration_target) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[task.id,row.id,e.id,clip.id,clip.itemId,row.native_edit_revision,workspaceContentSha256(project),image.id,image.sha256,targetDuration,providerDuration,narrationTarget?JSON.stringify(narrationTarget):null]);
 currentClip.image={usage:'ai-video',durationSeconds:targetDuration,providerDurationSeconds:providerDuration,fit:project.timelines.find(t=>t.items.some(i=>i.id===clip.itemId))!.fit,focusX:0,focusY:0,taskId:task.id,materialRevisionId:image.id};
 return updateWorkspaceProject(c,root,row,project,row.bindings,'请求首次图片视频');
}

/** No Worker callback mutates the project. Owner explicitly collects first output; edited projects retain a candidate. */
export async function fillWorkspaceImageResult(c:PoolClient,root:string,episodeId:string,data:Record<string,unknown>){
 const {row,project}=await lockProductionWorkspace(c,root,episodeId,data.workspaceId,data.expectedRevision);
 if(isOpenChatCutStudio(episodeId))throw new ConfigurationError(409,'请先保存并返回素材准备。');
 if(typeof data.taskId!=='string'||!uuid.test(data.taskId))throw new ConfigurationError(400,'首次图片任务标识无效。');
 const request=(await c.query('SELECT r.*,t.status,p.material_revision_id FROM local_identity.workspace_image_requests r JOIN public.tasks t ON t.id=r.task_id LEFT JOIN public.paid_generation_reservations p ON p.task_id=r.task_id WHERE r.task_id=$1 AND r.workspace_id=$2 AND r.episode_id=$3',[data.taskId,row.id,episodeId])).rows[0];
 if(!request)throw new ConfigurationError(404,'首次图片任务不存在。');
 if(request.status!=='completed'||!request.material_revision_id)throw new ConfigurationError(409,'首次图片任务尚未完成，请保留占位后重试。');
 const clip=row.bindings.find(b=>b.id===request.clip_id),item=project.timelines.flatMap(t=>t.items).find(i=>i.id===request.item_id);
 if(Number(row.native_edit_revision)!==Number(request.native_edit_revision)||!clip||clip.source||clip.image?.usage!=='ai-video'||clip.image.taskId!==request.task_id||clip.image.materialRevisionId!==request.image_revision_id||item?.kind!=='text')throw new ConfigurationError(409,'工程已人工编辑或占位已变化，结果保留为候选，请在剪辑中明确采用。');
 if(request.narration_target){
  const current=await readWorkspaceNarrationTarget(c,root,row.id,request.clip_id),frozen=request.narration_target;
  if(current.audioTrackId!==frozen.audioTrackId||current.artifactId!==frozen.artifactId||current.sha256!==frozen.sha256||current.inputFingerprint!==frozen.inputFingerprint||current.durationSeconds!==frozen.durationSeconds)throw new ConfigurationError(409,'主声音输入或实际时长已变化，视频结果保留为候选。');
 }
 const source=(await c.query('SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2',[request.image_revision_id,episodeId])).rows[0];if(!source||source.sha256!==request.image_sha256)throw new ConfigurationError(409,'首帧图片身份已变化。');
 try{await verifyNativeFile(root,source.storage_path,source.sha256,Number(source.file_size));}catch{throw new ConfigurationError(409,'首帧图片缺失或指纹已变化。');}
 const material=(await c.query("SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type='video'",[request.material_revision_id,episodeId])).rows[0];if(!material)throw new ConfigurationError(409,'生成结果尚未登记。');
 let observed:Awaited<ReturnType<typeof inspectMp4Artifact>>;try{await verifyNativeFile(root,material.storage_path,material.sha256,Number(material.file_size));observed=await inspectMp4Artifact(join(root,material.storage_path));}catch{throw new ConfigurationError(409,'生成视频缺失、指纹已变化或无法读取。');}const timeline=project.timelines.find(t=>t.items.some(i=>i.id===item.id))!;
 const duration=Math.max(1,Math.round(Number(request.duration_seconds)*timeline.fps));if(observed.durationSeconds+0.05<duration/timeline.fps)throw new ConfigurationError(409,'生成视频短于请求时长，结果保留为候选。');
 if(Number(item.durationInFrames)!==duration)throw new ConfigurationError(409,'占位时长已变化，结果保留为候选。');
 const assetId=`material-${material.id}`;project.assets.push({id:assetId,name:material.source_path,kind:'video',src:material.storage_path,durationInFrames:Math.round(observed.durationSeconds*timeline.fps)});
 Object.assign(item,{kind:'video',name:clip.shotId,src:material.storage_path,sourceAssetId:assetId,sourceRevision:material.id,sourceContentHash:material.sha256,durationInFrames:duration,srcInFrame:0,volume:0});delete item.props;
 clip.source={materialRevisionId:material.id,relativePath:material.storage_path,sha256:material.sha256,fileSize:Number(material.file_size),kind:'video'};
 return updateWorkspaceProject(c,root,row,project,row.bindings,'填入首次图片视频');
}
