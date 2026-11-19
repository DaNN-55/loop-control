import {recordValidatedRequestLogContext} from './runtimeRequestLog.js';
import {episodeFileIO,verifyEpisodeFile} from './episodeFiles.js';
import {nativeSoundWindowAudibility} from './workspaceSoundAudibility.js';
import {resolveWorkspaceShotLineage} from './workspacePreparation.js';
import {readWorkspaceNarrationSource} from './workspaceNarrationSource.js';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import type {PoolClient} from 'pg';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import type {ArtifactManifest} from '../worker/contracts.js';
import type {WorkspaceDelivery} from '../workspaceDelivery.js';
import {requireConfirmedWorkspaceExport,usedWorkspaceContent} from './workspaceExportCommands.js';
import {ConfigurationError} from './configurationCommands.js';
import {safeAssetOutputPath} from '../worker/controlledMediaExecutor.js';
import {normalizeDeliveryTags,deliveryTagsError} from '../publishing/deliveryMetadata.js';
import {validateImportedMaterial} from './materialAcceptance.js';
import {coverImageExtension} from '../publishing/coverImage.js';
import {parseWorkspaceCoverSource,type WorkspaceCoverSource} from '../workspaceCover.js';
import {readWorkspaceCoverInputs} from './workspaceCover.js';
import {readWorkspaceTemplateInputs} from './workspaceTemplateInputs.js';
import {verifyPublishPackage} from '../publishing/publishPackage.js';
import {isOpenChatCutStudio} from '../worker/openchatcutStudio.js';
import {isWorkspaceVideoTrack} from '../workspaceExecution.js';
export async function readWorkspaceDeliveries(c:PoolClient,root:string,row:ProductionWorkspaceRecord):Promise<WorkspaceDelivery[]>{
 if(!(await c.query("SELECT to_regclass('local_identity.workspace_deliveries') present")).rows[0].present)return[];
 const values=(await c.query('SELECT d.*,t.status,t.last_result FROM local_identity.workspace_deliveries d JOIN public.tasks t ON t.id=d.task_id WHERE workspace_id=$1 ORDER BY d.created_at DESC,d.id DESC',[row.id])).rows;
 return Promise.all(values.map(async(d,index)=>{let verified=d.status==='completed',error=d.last_result?.retry?.reason??null;const identity=d.last_result?.deliveryIdentity;const artifacts=[...(d.last_result?.artifacts??[]),...(identity?[identity.video,identity.project]:[])];
 const verificationDeferred=verified&&index>0;
 if(verified&&!verificationDeferred)try{const pack=artifacts.find((a:ArtifactManifest)=>a.artifactType==='publish_package');if(!pack)throw Error();await verifyPublishPackage({assetRoot:root,episodeId:row.episode_id,publishPackage:pack,storage:await episodeFileIO(c,root,row.episode_id)});}catch{verified=false;error='交付包文件缺失、损坏或指纹已变化。';}
 return{id:d.id,exportId:d.export_id,taskId:d.task_id,status:d.status,error:verified?null:error,verified:verified&&!verificationDeferred,...(verificationDeferred?{verificationDeferred:true}:{}),artifacts,createdAt:d.created_at};}));
}
export async function executeWorkspaceDelivery(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,command:string,data:Record<string,unknown>){
 const storage=await episodeFileIO(c,root,row.episode_id,true);
 if(isOpenChatCutStudio(row.episode_id))throw new ConfigurationError(409,'请先保存并返回，再准备或重试交付。');
 const confirmed=await requireConfirmedWorkspaceExport(c,root,row,project);
 if(command==='retryWorkspaceDelivery'){
 const old=(await c.query('SELECT d.*,t.input_snapshot,t.status FROM local_identity.workspace_deliveries d JOIN public.tasks t ON t.id=d.task_id WHERE d.id=$1 AND d.workspace_id=$2',[data.deliveryId,row.id])).rows[0];
 if(!old||!['failed','blocked'].includes(old.status)||old.export_id!==confirmed.id)throw new ConfigurationError(409,'只能重试当前已确认文件的失败交付。');
 const snapshot=structuredClone(old.input_snapshot);delete snapshot.native_output_namespace;delete snapshot.runtime_constraints;delete snapshot.allowed_tools;const id=randomUUID();snapshot.output.relative_path=`${storage.relativePath}/workspace-deliveries/${id}/manifest.json`;
 const queued=(await c.query('SELECT local_identity.queue_workspace_delivery($1,$2,$3,$4) task_id',[id,row.id,confirmed.id,snapshot])).rows[0];recordValidatedRequestLogContext({taskId:queued?.task_id});return;
 }
 if(data.exportId!==confirmed.id||data.expectedExportSha256!==confirmed.artifact.sha256||data.expectedContentSha256!==confirmed.contentSha256)throw new ConfigurationError(409,'请为这份已确认文件重新准备交付。');
 if(typeof data.title!=='string'||!data.title.trim()||data.title.length>200||typeof data.description!=='string'||data.description.length>5000)throw new ConfigurationError(400,'请填写有效交付标题和简介。');
 if(!Array.isArray(data.tags)||data.tags.some(t=>typeof t!=='string'))throw new ConfigurationError(400,'标签格式无效，请使用文字标签。');
 const tags=normalizeDeliveryTags(data.tags),tagsError=deliveryTagsError(tags);if(tagsError)throw new ConfigurationError(400,tagsError);
 let cover:Buffer,coverSource:WorkspaceCoverSource|undefined;
 if(Object.hasOwn(data,'coverSource')){
  if(Object.hasOwn(data,'coverBase64'))throw new ConfigurationError(400,'请只选择一种封面来源。');
  try{coverSource=parseWorkspaceCoverSource(data.coverSource);}catch{throw new ConfigurationError(400,'封面来源协议或身份无效。');}
  const templateInputs=await readWorkspaceTemplateInputs(c,root,row);
  const candidate=(await readWorkspaceCoverInputs(c,row,templateInputs?.cover?.material)).find(v=>v.source.kind===coverSource!.kind&&v.source.id===coverSource!.id&&v.source.sha256===coverSource!.sha256);
  if(!candidate?.file||candidate.unavailableReason)throw new ConfigurationError(409,'当前封面候选不存在或已变化，请重新选择。');
  try{cover=await verifyEpisodeFile(c,root,row.episode_id,candidate.file.relativePath,candidate.file.sha256,candidate.file.fileSize);}catch(error){
   if(['ENOENT','ENOTDIR','EACCES','EPERM','EIO'].includes((error as NodeJS.ErrnoException).code??''))throw new ConfigurationError(409,'原封面文件不可读取，请恢复原文件或另选封面。');throw error;
  }
 }else{
  if(typeof data.coverBase64!=='string'||data.coverBase64.length>28*1024*1024)throw new ConfigurationError(400,'封面不能超过 20 MB，请选择 JPG、PNG 或 WebP 图片。');
  cover=Buffer.from(data.coverBase64,'base64');if(cover.toString('base64')!==data.coverBase64)throw new ConfigurationError(400,'请上传有效 JPG、PNG 或 WebP 封面。');
 }
 const extension=coverImageExtension(cover);if(!cover.length)throw new ConfigurationError(400,'封面为空，请重新选择。');if(cover.length>20*1024*1024)throw new ConfigurationError(400,'封面不能超过 20 MB。');if(!extension)throw new ConfigurationError(400,'请上传有效 JPG、PNG 或 WebP 封面。');
 await validateImportedMaterial(cover,{sourcePath:`封面.${extension}`,materialType:'image',mimeType:'',materialPurpose:'cover',isMainScript:false});
 const approvedProject=JSON.parse((await verifyEpisodeFile(c,root,row.episode_id,confirmed.project.relativePath,confirmed.project.sha256,confirmed.project.fileSize)).toString()) as OpenChatCutProject,used=usedWorkspaceContent(approvedProject),narration=[];
 for(const clip of row.bindings.filter((x,i,all)=>all.findIndex(v=>v.shotId===x.shotId)===i)){
 const item=used.items.find(x=>x.id===`workspace-narration-shot-${clip.shotId}`||x.id===`workspace-narration-${clip.id}`);
 const source=item?await readWorkspaceNarrationSource(c,row,item):null,track=source?.track,adopted=source?.adoption;
 const sourceText=source?.text??null,baselineText=(await resolveWorkspaceShotLineage(c,row,clip.shotId)).baseline_text,windows=item?usedNarrationWindows(approvedProject,String(item.id)):[];
 const fullSource=!!track&&windows.length===1&&windows[0].audible&&windows[0].textCoverageVerified&&windows[0].srcInFrame===0&&windows[0].playbackRate===1&&Math.abs(windows[0].sourceDurationSeconds-Number(track.duration_seconds))<=1/windows[0].fps;
 const actualText=fullSource?sourceText:null;
 narration.push({shotId:clip.shotId,baselineText,sourceText,adoptedText:actualText,textCoverage:sourceText===null?'no_recorded_text':fullSource?'complete_source':'partial_or_retimed_unverified',windows,textSource:adopted?'owner_adoption':sourceText===null?'not_recorded':'frozen_task',sourceDiffersFromBaseline:sourceText===null?null:sourceText!==baselineText,differsFromBaseline:actualText===null?null:actualText!==baselineText,audioTrackId:track?.id??null,sha256:track?.sha256??null,itemId:item?.id??null,source:item?.src??null});
 }
 const id=randomUUID(),prefix=`${storage.relativePath}/workspace-deliveries/${id}`;
 const immutable=async(type:string,path:string,bytes:Buffer)=>{const a={artifactType:type,relativePath:path,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length};await writeFile(await safeAssetOutputPath(root,path),bytes,{flag:'wx',mode:0o600});return a;};
 const coverArtifact=await immutable('cover',`${prefix}/cover.${extension}`,cover);
 const metadata=await immutable('metadata',`${prefix}/metadata.json`,Buffer.from(JSON.stringify({title:data.title.trim(),description:data.description.trim(),tags,exportId:confirmed.id,contentSha256:confirmed.contentSha256,scriptRevisionId:row.script_revision_id,...(coverSource?{coverSource}:{}),narration},null,2)+'\n'));
 const checks=await immutable('final_qc_report',`${prefix}/checks.json`,Buffer.from(JSON.stringify({passed:true,exportId:confirmed.id,contentSha256:confirmed.contentSha256,checks:confirmed.checks},null,2)+'\n'));
 const identity={workspaceId:row.id,exportId:confirmed.id,projectContentVersion:confirmed.projectContentVersion,contentSha256:confirmed.contentSha256,video:{artifactType:'final_render',...confirmed.artifact},project:{artifactType:'editable_project',...confirmed.project}};
 const snapshot={capability:'workspace_delivery',workspace_delivery:{identity,artifacts:[identity.video,identity.project,coverArtifact,metadata,checks]},input_artifacts:[identity.video,identity.project,coverArtifact,metadata,checks],output:{relative_path:`${prefix}/manifest.json`,required_artifact_types:['publish_package'],content_type:'application/json'}};
 const queued=(await c.query('SELECT local_identity.queue_workspace_delivery($1,$2,$3,$4) task_id',[id,row.id,confirmed.id,snapshot])).rows[0];recordValidatedRequestLogContext({taskId:queued?.task_id});
}

// Preserve the actual used source window, including parent sequence trims/rate.
// A partial/retimed/muted source never claims its full source text was spoken.
export function usedNarrationWindows(project:OpenChatCutProject,itemId:string){
 type Audibility=ReturnType<typeof nativeSoundWindowAudibility>;
 const windows:Array<{srcInFrame:number;usedDurationSeconds:number;sourceDurationSeconds:number;playbackRate:number;fps:number;audible:boolean;audibility:Audibility;textCoverageVerified:boolean}>=[];
 const hasEdits=(item:Record<string,unknown>)=>[item.transcript,item.edits,item.deletedWordIdx].some(value=>Array.isArray(value)?value.length>0:!!value);
 const visit=(id:string,from=0,to=Infinity,parentRate=1,parentAudibility:Audibility='audible',depth=0,parentUnverified=false)=>{
  if(depth>32)throw Error('嵌套口播窗口超出检查范围。');
  const timeline=project.timelines.find(t=>t.id===id);if(!timeline)throw Error('口播所属时间线缺失。');
  for(const item of timeline.items){
   const start=Number(item.startFrame),end=start+Number(item.durationInFrames),left=Math.max(from,start),right=Math.min(to,end);
   if(right<=left||item.kind==='sequence'&&!isWorkspaceVideoTrack(timeline,String(item.track)))continue;
   const rate=Number(item.playbackRate??1),src=Number(item.srcInFrame??0)+(left-start)*rate;
   const track=timeline.tracks[String(item.track)] as {muted?:boolean;hidden?:boolean}|undefined;
   // Native sequence gain is ignored; track mute/hidden and parent edits still apply.
   const own:Audibility=track?.muted||track?.hidden?'silent':item.kind==='sequence'?'audible':nativeSoundWindowAudibility(item,left,right);
   const audibility:Audibility=parentAudibility==='silent'||own==='silent'?'silent':parentAudibility==='unknown'||own==='unknown'||hasEdits(item)?'unknown':'audible';
   const automated=Array.isArray((item.keyframes as {volume?:unknown}|undefined)?.volume)&&((item.keyframes as {volume:unknown[]}).volume.length>0);
   const unverified=parentUnverified||hasEdits(item)||item.kind!=='sequence'&&(automated||Number(item.fadeInFrames??0)>0||Number(item.fadeOutFrames??0)>0);
   if(item.kind==='sequence'){visit(String(item.timelineId),src,src+(right-left)*rate,parentRate*rate,audibility,depth+1,unverified||rate!==1);continue;}
   if(item.id===itemId)windows.push({srcInFrame:src,usedDurationSeconds:(right-left)/timeline.fps/parentRate,sourceDurationSeconds:(right-left)*rate/timeline.fps,playbackRate:rate*parentRate,fps:timeline.fps,audible:audibility==='audible',audibility,textCoverageVerified:audibility==='audible'&&!unverified});
  }
 };
 visit(project.activeTimelineId);return windows;
}
