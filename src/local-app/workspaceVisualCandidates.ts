import {creativeAccountRules} from '../creativeAccountRules.js';
import {executeWorkspacePexels} from './workspacePexels.js';
import {resolveProductionSelection} from './productionSelection.js';
import {isWanGenerationSettings} from '../videoGenerationSettings.js';
import {resolveWorkspaceShotLineage} from './workspacePreparation.js';
import {queueWorkspaceImageCandidates} from './workspaceImageGeneration.js';
import {probeMp3Artifact} from '../worker/mediaTools.js';
import {join} from 'node:path';
import {lstat} from 'node:fs/promises';
import {resolveWorkspaceMainVoice} from '../workspaceAudio.js';
import {isVideoProvider,videoProviders} from '../worker/videoProviderCatalog.js';
import {workspaceVisualVoiceIdentity} from '../workspaceVisualCandidates.js';
import {verifyNativeFile} from './localFiles.js';
import type {InputRuntime} from './episodeCommands.js';
import {isOpenChatCutStudio,registerOpenChatCutStudioSource} from '../worker/openchatcutStudio.js';
import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import type {WorkspaceVisualCandidate} from '../workspaceVisualCandidates.js';
import {workspaceCandidateTarget,workspaceCandidateAppearance} from '../workspaceCandidates.js';
import {inspectWorkspaceVisualFile} from './workspaceVisualMedia.js';
import {ConfigurationError,canonical} from './configurationCommands.js';
import {resolveWorkspaceSource} from './workspaceSources.js';
import {readProductionWorkspace,updateWorkspaceProject,type ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import {prepareRegisteredWorkspaceCandidate,finishRegisteredWorkspaceCandidate} from './workspaceCandidates.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function target(row:ProductionWorkspaceRecord,project:OpenChatCutProject,id:unknown){
 const clip=row.bindings.find(b=>b.itemId===id),matches=project.timelines.flatMap(t=>t.items.filter(i=>i.id===id).map(item=>({item,timeline:t})));
 if(!clip||matches.length!==1||!['video','image','text'].includes(String(matches[0].item.kind)))throw new ConfigurationError(409,'指定画面已变化或不属于本工作空间。');
 return{clip,...matches[0]};
}
export async function readWorkspaceVisualCandidates(c:PoolClient,row:ProductionWorkspaceRecord,project:OpenChatCutProject,root:string):Promise<WorkspaceVisualCandidate[]>{
 const records=(await c.query('SELECT v.*,m.id output_material_id,m.storage_path,m.sha256,m.file_size,m.material_type FROM local_identity.workspace_visual_candidates v LEFT JOIN public.paid_generation_reservations r ON r.task_id=v.task_id JOIN public.production_material_revisions m ON m.id=coalesce(v.material_revision_id,r.material_revision_id) AND m.episode_id=v.episode_id WHERE v.workspace_id=$1 ORDER BY v.created_at DESC',[row.id])).rows;
 const decisions=(await c.query('SELECT * FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1',[row.id])).rows;
 return Promise.all(records.map(async r=>{let readable=true,observed:Awaited<ReturnType<typeof inspectWorkspaceVisualFile>>|null=null;try{const file=await lstat(join(root,r.storage_path));if(!file.isFile()||file.isSymbolicLink()||file.size!==Number(r.file_size))throw Error();if(r.task_id||r.request_snapshot.execution)observed=await inspectWorkspaceVisualFile(root,r.storage_path,r.material_type);}catch{readable=false;}const current=project.timelines.flatMap(t=>t.items.filter(i=>i.id===r.target_item_id).map(item=>({item,timeline:t})))[0],d=decisions.find(d=>d.candidate_id===r.id),pending=current?.item.sourceAssetId===`candidate-${r.id}`&&(current.item.loopControlCandidate as {inputFingerprint?:string}|undefined)?.inputFingerprint===r.input_fingerprint;
 const duration=observed?.durationSeconds??r.request_snapshot.durationSeconds??r.request_snapshot.providerDurationSeconds,frames=current?Math.ceil(duration*current.timeline.fps):0,deltaSeconds=current?(frames-Number(current.item.durationInFrames))/current.timeline.fps:0,overlapItemIds=current&&deltaSeconds>0?current.timeline.items.filter(i=>i.id!==current.item.id&&i.track===current.item.track&&Number(i.startFrame)<Number(current.item.startFrame)+frames&&Number(i.startFrame)+Number(i.durationInFrames)>Number(current.item.startFrame)+Number(current.item.durationInFrames)).map(i=>String(i.id)):[];
 return{...(r.request_snapshot.source?{source:r.request_snapshot.source}:{}),materialRevisionId:r.output_material_id,...(typeof r.request_snapshot.prompt==='string'?{generation:{...(r.request_snapshot.selection?{selection:r.request_snapshot.selection,connectionName:r.request_snapshot.connection?.name}:{}),prompt:r.request_snapshot.prompt,firstFrameMaterialRevisionId:r.request_snapshot.firstFrameId??'',durationSeconds:r.request_snapshot.providerDurationSeconds??r.request_snapshot.durationSeconds,...(r.request_snapshot.videoSettings?{videoSettings:r.request_snapshot.videoSettings}:{}),...(r.request_snapshot.firstFrameComposition?{firstFrameFit:r.request_snapshot.firstFrameComposition.fit}:{}),...(r.request_snapshot.imageSettings?{imageSettings:r.request_snapshot.imageSettings,referenceMaterialRevisionIds:r.request_snapshot.referenceMaterialRevisionIds}:{} )}}:{}),durationImpact:{deltaSeconds,overlapItemIds},id:r.id,kind:r.request_snapshot.kind,usage:r.request_snapshot.usage,shotId:r.shot_id,clipId:r.clip_id,targetItemId:r.target_item_id,taskId:r.task_id,inputFingerprint:r.input_fingerprint,text:'',mainScriptText:'',audioTrackId:null,relativePath:r.storage_path,sha256:r.sha256,fileSize:Number(r.file_size),durationSeconds:observed?.durationSeconds??r.request_snapshot.durationSeconds??r.request_snapshot.providerDurationSeconds,width:observed?.width??r.request_snapshot.width,height:observed?.height??r.request_snapshot.height,currentDurationSeconds:current?Number(current.item.durationInFrames)/current.timeline.fps:null,pendingConfirmation:!!pending&&!d,status:(r.request_snapshot.kind==='image'?(d?.decision==='rejected'?'rejected':current?.item.sourceAssetId===`candidate-${r.id}`?'adopted':undefined):d?.decision)??(readable&&(pending||current&&(r.request_snapshot.kind==='image'||hash(workspaceCandidateTarget(current.item))===hash(r.target_snapshot)))&&await visualContextCurrent(c,root,row,project,r)?'available':'stale')};}));
}
/** One real authorization, frozen input and private queue boundary for first fill and later candidates. */
export async function queueWorkspaceVisualGeneration(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,data:Record<string,unknown>,runtime:InputRuntime,mode:'candidate'|'first'='candidate'){
  const {clip,item,timeline}=target(row,project,data.targetItemId),resolved=await resolveProductionSelection(c,data.selection,'video'),lineage={shotType:'b_roll' as const};
  if(resolved&&resolved.choice.mode!=='generation')throw new ConfigurationError(400,'请选择视频生成服务；素材检索请使用检索入口。');
  if(typeof data.firstFrameMaterialRevisionId!=='string'||!uuid.test(data.firstFrameMaterialRevisionId)||typeof data.prompt!=='string'||!data.prompt.trim()||data.prompt.length>1500)throw new ConfigurationError(400,'首帧或动作描述无效。');
  const e=(await c.query('SELECT e.*,b.policy,s.rules series_rules FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id LEFT JOIN public.series_versions s ON s.id=e.series_version_id WHERE e.id=$1',[row.episode_id])).rows[0],config={...resolved.execution,max_attempts:1},provider=config?.executor?.provider??'';
  if(!config?.credential_ref||!(provider==='bailian'&&config.executor?.adapter==='wan_video'||isVideoProvider(provider)&&config.executor?.adapter===videoProviders[provider].adapter))throw new ConfigurationError(409,'请为当前镜头选择既有视频连接。');
  if(data.videoSettings!==undefined&&(provider!=='bailian'||!isWanGenerationSettings(data.videoSettings)||Object.keys(data.videoSettings).some(key=>!['resolution','audio','promptExtend','shotType','watermark','negativePrompt','seed'].includes(key))))throw new ConfigurationError(400,'视频参数无效或不适用于当前模型。');
  if(data.firstFrameFit!==undefined&&!['contain','cover'].includes(String(data.firstFrameFit)))throw new ConfigurationError(400,'首帧构图无效。');
  const authorized=(await c.query('SELECT * FROM local_identity.script_productions WHERE episode_id=$1 AND script_revision_id=$2 AND enabled AND authorized_at IS NOT NULL',[row.episode_id,row.script_revision_id])).rows[0];if(!authorized)throw new ConfigurationError(409,'请先确认并授权当前制作计划。');
  const first=(await c.query("SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type='image'",[data.firstFrameMaterialRevisionId,row.episode_id])).rows[0];if(!first)throw new ConfigurationError(404,'本期首帧图片不存在。');await verifyNativeFile(root,first.storage_path,first.sha256,Number(first.file_size));
  if(resolved){const input=resolved.choice.constraints.firstFrame;if(!input||!input.mimeTypes.includes(first.mime_type)||Number(first.file_size)>input.maxBytes)throw new ConfigurationError(400,'首帧格式或大小与所选模型不兼容。');}
  const mainVoice=await workspaceVisualMainVoice(c,root,row,project,clip.shotId),targetSeconds=mainVoice.windowDurationSeconds??Number(data.durationSeconds),bounds=resolved?{minDuration:resolved.choice.constraints.durationSeconds!.min,maxDuration:resolved.choice.constraints.durationSeconds!.max}:isVideoProvider(provider)?videoProviders[provider]:{minDuration:2,maxDuration:15},seconds=mainVoice.windowDurationSeconds!==null?Math.max(bounds.minDuration,Math.ceil(targetSeconds)):targetSeconds;
  if(mainVoice.windowDurationSeconds!==null&&targetSeconds>bounds.maxDuration)throw new ConfigurationError(409,`当前实际主声时长超过所选服务上限 ${bounds.maxDuration} 秒，请明确拆分镜头；不会截断口播。`);
  if(!Number.isInteger(seconds)||seconds<bounds.minDuration||seconds>bounds.maxDuration)throw new ConfigurationError(409,`当前画面时长不在所选服务 ${bounds.minDuration}～${bounds.maxDuration} 秒范围，请明确拆分或调整；不会变速或循环。`);
  if((resolved||isVideoProvider(provider))&&(!Number.isSafeInteger(data.reservationCents)||Number(data.reservationCents)<1||Number(data.reservationCents)>100000))throw new ConfigurationError(400,'请填写本次费用预留。');
  await runtime.checkReferences(c,[config.credential_ref]);if(!runtime.mediaReady)throw new ConfigurationError(503,'视频Worker未配置。');await runtime.mediaReady({[lineage.shotType]:config});
  if(mode==='first'){
   if(clip.source||clip.image||item.kind!=='text')throw new ConfigurationError(409,'首次生成只填入尚未匹配的占位。');
   const frames=Math.max(1,Math.ceil(targetSeconds*timeline.fps)),end=Number(item.startFrame)+Number(item.durationInFrames),delta=frames-Number(item.durationInFrames);
   for(const other of timeline.items)if(other.id!==item.id&&Number(other.startFrame)>=end)other.startFrame=Number(other.startFrame)+delta;
   item.durationInFrames=frames;
  }
  const creative=creativeAccountRules(e.policy),context={accountId:e.account_id,blueprintVersionId:e.blueprint_version_id,accountRules:creative,seriesVersionId:e.series_version_id,seriesRules:e.series_rules??null},actualPrompt=resolved?`${data.prompt.trim()}\n\n账号创作规则：${JSON.stringify(creative)}\n系列创作规则：${JSON.stringify(context.seriesRules)}`:data.prompt.trim();
  if(resolved&&actualPrompt.length>(resolved.choice.constraints.prompt?.maxLength??1500))throw new ConfigurationError(400,'动作描述与账号、系列规则合并后过长，请精简后提交。');
  const id=randomUUID(),expected=workspaceCandidateTarget(item),snapshot={...(resolved?{selectionVersion:1,selection:resolved.selection,connection:resolved.connection,context,actualPrompt,target:{targetItemId:item.id,shotId:clip.shotId,workspaceRevision:Number(row.revision),projectSha256:row.project_sha256,scriptRevisionId:row.script_revision_id},costBasis:{kind:'owner-reservation',reservationCents:data.reservationCents,model:resolved.selection.model,providerDurationSeconds:seconds}}:{}),origin:mode==='first'?'first-fill':'candidate',kind:'video',usage:'video',capability:lineage.shotType,execution:config,firstFrameId:first.id,firstFrameSha256:first.sha256,prompt:data.prompt.trim(),providerDurationSeconds:seconds,targetDurationSeconds:targetSeconds,reservationCents:data.reservationCents??null,authorizationHash:authorized.authorization_hash,nativeEditRevision:Number(row.native_edit_revision),expectedRevision:Number(row.revision),mainVoice,...(data.videoSettings?{videoSettings:data.videoSettings}:{}),...(data.firstFrameFit?{firstFrameComposition:{fit:data.firstFrameFit,width:timeline.width,height:timeline.height}}:{})};
  await c.query('INSERT INTO local_identity.workspace_visual_candidates(id,workspace_id,episode_id,clip_id,shot_id,target_item_id,input_fingerprint,target_snapshot,request_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,row.id,row.episode_id,clip.id,clip.shotId,item.id,hash({expected,snapshot}),JSON.stringify(expected),JSON.stringify(snapshot)]);
  let taskId:string;
  try{taskId=(await c.query('SELECT local_identity.queue_workspace_visual($1) id',[id])).rows[0].id;}catch(error){if((error as {code?:string}).code==='55000')throw new ConfigurationError(409,'已有画面任务正在进行或供应商提交结果未知，请先恢复已有任务或核对结果；不会重复付费提交。');if((error as {code?:string}).code==='22023')throw new ConfigurationError(409,'视频生成预算不足，请调整费用预留或账号额度。');if((error as {code?:string;message?:string}).code==='P0001'&&(error as Error).message==='Approve a generation budget first')throw new ConfigurationError(409,'请先设置并批准账号生成预算，再提交视频生成。');throw error;}
  return{id,taskId,clip,item,targetSeconds,providerSeconds:seconds};
}
export async function executeWorkspaceVisualCandidate(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,command:string,data:Record<string,unknown>,runtime:InputRuntime){
 if(['searchWorkspacePexelsVideos','previewWorkspacePexelsVideo','importWorkspacePexelsVideo'].includes(command)){await executeWorkspacePexels(c,root,row,project,command,data,runtime);return readProductionWorkspace(c,row.episode_id,root);}
 if(command==='requestWorkspaceImageCandidates'){
  await queueWorkspaceImageCandidates(c,root,row,project,data,runtime);
  return readProductionWorkspace(c,row.episode_id,root);
 }

 if(command==='retryWorkspaceVisualCandidate'){
  if(typeof data.candidateId!=='string'||!uuid.test(data.candidateId))throw new ConfigurationError(400,'候选标识无效。');
  if(!(await c.query('SELECT 1 FROM local_identity.workspace_visual_candidates WHERE id=$1 AND workspace_id=$2 AND episode_id=$3',[data.candidateId,row.id,row.episode_id])).rowCount)throw new ConfigurationError(404,'本工作空间视觉候选不存在。');
  try{await c.query('SELECT local_identity.retry_workspace_visual($1)',[data.candidateId]);}catch(error){if((error as {code?:string}).code==='55000')throw new ConfigurationError(409,'供应商提交结果未知或不能恢复；必须核对已有结果，不会创建重复付费任务。');throw error;}return readProductionWorkspace(c,row.episode_id,root);
 }
 if(command==='requestWorkspaceVisualCandidate'){

  await queueWorkspaceVisualGeneration(c,root,row,project,data,runtime);
  return readProductionWorkspace(c,row.episode_id,root);
 }
 if(command==='prepareWorkspaceVisualPool'){
  if(typeof data.materialRevisionId!=='string'||!uuid.test(data.materialRevisionId))throw new ConfigurationError(400,'素材标识无效。');
  const m=(await c.query("SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type IN ('video','image')",[data.materialRevisionId,row.episode_id])).rows[0];if(!m)throw new ConfigurationError(404,'本期视觉素材不存在；声音请从声音素材入口添加。');
  await resolveWorkspaceSource(c,root,row.episode_id,m.storage_path);const observed=await inspectWorkspaceVisualFile(root,m.storage_path,m.material_type),fps=project.timelines[0].fps;
  const asset={id:`material-${m.id}`,name:m.source_path.split('/').pop(),kind:m.material_type as 'video'|'image',src:m.storage_path,sourceRevision:`source-sha256-${m.sha256}`,sourceContentHash:m.sha256,durationInFrames:Math.ceil((observed.durationSeconds??3)*fps),width:observed.width,height:observed.height};
  if(isOpenChatCutStudio(row.episode_id))return{asset:{...asset,src:await registerOpenChatCutStudioSource(root,row.episode_id,m.storage_path,m.sha256,Number(m.file_size))}};
  if(!project.assets.some(a=>a.id===asset.id)){project.assets.push(asset);await updateWorkspaceProject(c,root,row,project,row.bindings,'登记补充视觉素材',{nativeEdit:true});}return{asset};
 }
 if(command==='registerWorkspaceVisualCandidate'){
  const {clip,item}=target(row,project,data.targetItemId);
  if(typeof data.materialRevisionId!=='string'||!uuid.test(data.materialRevisionId)||!['video','still','pan-zoom'].includes(String(data.usage)))throw new ConfigurationError(400,'请选择本期视频素材与使用方式。');
  const m=(await c.query("SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type IN ('video','image')",[data.materialRevisionId,row.episode_id])).rows[0];if(!m)throw new ConfigurationError(404,'本期视觉素材不存在。');
  await resolveWorkspaceSource(c,root,row.episode_id,m.storage_path);if((m.material_type==='video')!==(data.usage==='video'))throw new ConfigurationError(400,'素材类型与使用方式不一致。');
  const observed=await inspectWorkspaceVisualFile(root,m.storage_path,m.material_type);if(m.material_type==='image'&&(typeof data.durationSeconds!=='number'||!Number.isFinite(data.durationSeconds)||data.durationSeconds<0.1||data.durationSeconds>120))throw new ConfigurationError(400,'请填写图片使用时长。');
  const snapshot={kind:m.material_type,usage:data.usage,durationSeconds:observed.durationSeconds??data.durationSeconds,width:observed.width,height:observed.height},expected=workspaceCandidateTarget(item);
  await c.query('INSERT INTO local_identity.workspace_visual_candidates(id,workspace_id,episode_id,clip_id,shot_id,target_item_id,input_fingerprint,target_snapshot,request_snapshot,material_revision_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[randomUUID(),row.id,row.episode_id,clip.id,clip.shotId,item.id,hash({expected,materialId:m.id,sha256:m.sha256,snapshot}),JSON.stringify(expected),JSON.stringify(snapshot),m.id]);
  return readProductionWorkspace(c,row.episode_id,root);
 }
 const candidate=(await readWorkspaceVisualCandidates(c,row,project,root)).find(v=>v.id===data.candidateId);if(!candidate)throw new ConfigurationError(404,'本工作空间视觉候选不存在。');
 if(command==='retainWorkspaceImageCandidate'){
  if(candidate.kind!=='image'||!['available','adopted'].includes(candidate.status))throw new ConfigurationError(409,'请选择当前有效的图片候选。');
  await c.query('INSERT INTO local_identity.workspace_visual_image_choices(workspace_id,target_item_id,candidate_id) VALUES($1,$2,$3) ON CONFLICT(workspace_id,target_item_id) DO UPDATE SET candidate_id=excluded.candidate_id',[row.id,candidate.targetItemId,candidate.id]);
  return readProductionWorkspace(c,row.episode_id,root);
 }
 if(command==='prepareWorkspaceVisualCandidate'){
  if(candidate.kind==='image'&&target(row,project,candidate.targetItemId).item.kind==='video')throw new ConfigurationError(409,'当前视频优先；请将图片保留为备用画面或视频首帧。');
  const {item}=target(row,project,candidate.targetItemId);
  if(data.imageUsage!==undefined&&(candidate.kind!=='image'||!['still','pan-zoom'].includes(String(data.imageUsage))))throw new ConfigurationError(400,'图片使用方式无效。');
  if(candidate.kind==='image'&&data.imageUsage)candidate.usage=data.imageUsage as 'still'|'pan-zoom';
  if(data.acceptTimelineImpact!==undefined&&typeof data.acceptTimelineImpact!=='boolean'||data.motionPolicy!==undefined&&!['preserve-target','replace-motion'].includes(String(data.motionPolicy)))throw new ConfigurationError(400,'请明确本次时长与运动处理。');
  if(candidate.usage==='pan-zoom'&&!data.motionPolicy)throw new ConfigurationError(400,'请选择保留当前运动或采用新图片推拉。');
  const sourceIn=data.sourceInSeconds??0,sourceOut=data.sourceOutSeconds??candidate.durationSeconds;
  if((data.sourceInSeconds!==undefined||data.sourceOutSeconds!==undefined)&&(candidate.kind!=='video'||typeof sourceIn!=='number'||!Number.isFinite(sourceIn)||sourceIn<0||typeof sourceOut!=='number'||!Number.isFinite(sourceOut)||sourceOut<=sourceIn||sourceOut>candidate.durationSeconds+0.001))throw new ConfigurationError(400,'视频使用区间无效。');
  candidate.visual={...(candidate.kind==='video'&&data.sourceInSeconds!==undefined?{sourceInSeconds:Number(sourceIn),sourceOutSeconds:Number(sourceOut)}:{}),usage:candidate.usage,motionPolicy:(data.motionPolicy??'preserve-target') as 'preserve-target'|'replace-motion',acceptTimelineImpact:data.acceptTimelineImpact===true,expectedAppearance:workspaceCandidateAppearance(item),placeholder:item.kind==='text'};
  return prepareRegisteredWorkspaceCandidate(c,root,row,project,candidate,data.durationPolicy);
 }
 if(command==='adoptWorkspaceVisualCandidate'){await finishRegisteredWorkspaceCandidate(c,root,row,project,candidate,data);return readProductionWorkspace(c,row.episode_id,root);}
 if(command==='rejectWorkspaceVisualCandidate'){
  if(candidate.status==='adopted')throw new ConfigurationError(409,'当前采用版本不能作为未用候选拒绝。');
  await c.query("INSERT INTO local_identity.workspace_candidate_decisions(workspace_id,candidate_id,decision,text_version,main_script_text,input_fingerprint,source_sha256,project_sha256) VALUES($1,$2,'rejected','','',$3,$4,$5) ON CONFLICT DO NOTHING",[row.id,candidate.id,candidate.inputFingerprint,candidate.sha256,row.project_sha256]);return readProductionWorkspace(c,row.episode_id,root);
 }
 throw new ConfigurationError(400,'不支持的视觉候选操作。');
}

/** Existing approved-board lineage only; T13 may extend this resolver with a versioned local-shot contract. */
export async function resolveWorkspaceVisualLineage(c:PoolClient,row:ProductionWorkspaceRecord,shotId:string){
 const shot=await resolveWorkspaceShotLineage(c,row,shotId);
 if(!['a_roll','b_roll'].includes(shot.shotType))throw new ConfigurationError(409,'请选择并确认此镜头的生成能力。');return{id:shotId,shotType:shot.shotType as 'a_roll'|'b_roll'};
}
export async function workspaceVisualMainVoice(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,shotId:string){
 const route=resolveWorkspaceMainVoice(project,shotId),item=route.item;
 if(!item)return{mode:'none',windowDurationSeconds:null,identity:workspaceVisualVoiceIdentity(project,shotId),source:null};
 if(typeof item.src!=='string'||item.edits||!(Number(item.playbackRate??1)>0))throw new ConfigurationError(409,'当前实际主声音窗口无法用于画面生成，请先明确其使用区间。');
 const source=await resolveWorkspaceSource(c,root,row.episode_id,item.src),timeline=project.timelines.find(t=>t.items.includes(item))!,duration=Number(item.durationInFrames)/timeline.fps,observed=await probeMp3Artifact(join(root,item.src));if(Number(item.srcInFrame??0)/timeline.fps+duration*Number(item.playbackRate??1)>observed+0.05)throw new ConfigurationError(409,'实际主声音轨短于当前使用窗口。');
 return{mode:item.id===`workspace-source-shot-${shotId}`?'source':'tts',windowDurationSeconds:duration,identity:workspaceVisualVoiceIdentity(project,shotId),source:{id:source.id,relativePath:item.src,sha256:source.sha256,fileSize:Number(source.file_size),srcInFrame:Number(item.srcInFrame??0),playbackRate:Number(item.playbackRate??1),coverage:route.coverage}};
}
export async function readWorkspaceVisualTasks(c:PoolClient,row:ProductionWorkspaceRecord){
 return(await c.query(`SELECT v.id,v.shot_id "shotId",v.request_snapshot->>'kind' kind,t.id "taskId",t.status,t.last_result#>>'{blockers,0,detail}' error,(t.status IN ('failed','blocked') AND r.provider_task_id IS NOT NULL AND s.outcome<>'rejected') "canResume" FROM local_identity.workspace_visual_candidates v JOIN public.tasks t ON t.id=v.task_id LEFT JOIN public.paid_generation_reservations r ON r.task_id=t.id LEFT JOIN local_identity.workspace_visual_submissions s ON s.task_id=t.id WHERE v.workspace_id=$1 ORDER BY v.created_at DESC`,[row.id])).rows;
}

async function visualContextCurrent(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,record:Record<string,any>){
 if(!record.request_snapshot.execution)return true;
 if(record.request_snapshot.kind==='image'){
  const current=(await c.query('SELECT b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[row.episode_id])).rows[0];
  if(record.request_snapshot.selectionVersion!==1&&hash(current?.policy.static_visual)!==hash(record.request_snapshot.execution))return false;
  try{for(const ref of record.request_snapshot.references??[])await verifyNativeFile(root,ref.relativePath,ref.sha256,Number(ref.fileSize));return true;}catch{return false;}
 }
 try{const e=(await c.query('SELECT b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[row.episode_id])).rows[0],lineage=record.request_snapshot.selectionVersion===1?{shotType:'b_roll'}:await resolveWorkspaceVisualLineage(c,row,record.shot_id),first=(await c.query('SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2',[record.request_snapshot.firstFrameId,row.episode_id])).rows[0];
 if(record.request_snapshot.selectionVersion!==1&&hash(e.policy[lineage.shotType])!==hash(record.request_snapshot.execution)||first?.sha256!==record.request_snapshot.firstFrameSha256)return false;await verifyNativeFile(root,first.storage_path,first.sha256,Number(first.file_size));
 const voice=await workspaceVisualMainVoice(c,root,row,project,record.shot_id);return voice.identity===record.request_snapshot.mainVoice.identity&&voice.source?.id===record.request_snapshot.mainVoice.source?.id&&voice.source?.sha256===record.request_snapshot.mainVoice.source?.sha256;
 }catch{return false;}
}
/** Prepared visual inputs are rechecked at the real Owner save boundary. */
export async function validateWorkspaceVisualUses(c:PoolClient,root:string,row:ProductionWorkspaceRecord,baseline:OpenChatCutProject,document:OpenChatCutProject){
 for(const item of document.timelines.flatMap(t=>t.items)){
 const identity=item.loopControlCandidate as {sourceId?:string;inputFingerprint?:string}|undefined;if(!identity?.sourceId?.startsWith('candidate-'))continue;
 if(baseline.timelines.flatMap(t=>t.items).some(i=>i.id===item.id&&i.src===item.src&&i.sourceContentHash===item.sourceContentHash))continue;
 const id=identity.sourceId.slice('candidate-'.length);if(!uuid.test(id))continue;
 if((await c.query("SELECT 1 FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1 AND candidate_id=$2 AND decision='adopted' AND source_sha256=$3",[row.id,id,item.sourceContentHash])).rowCount)continue;
 const record=(await c.query('SELECT * FROM local_identity.workspace_visual_candidates WHERE workspace_id=$1 AND id=$2',[row.id,id])).rows[0];if(record&&!await visualContextCurrent(c,root,row,document,record))throw new ConfigurationError(409,'当前实际主声、首帧或视觉输入已变化，旧候选未保存；请保留当前编辑并重新比较。');
 }
}

export async function readWorkspaceVisualTargets(c:PoolClient,row:ProductionWorkspaceRecord,project:OpenChatCutProject){
 const data=(await c.query('SELECT b.policy,p.context_snapshot FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id JOIN public.review_packages p ON p.id=$2 WHERE e.id=$1',[row.episode_id,row.storyboard_package_id])).rows[0];
 const shotInputs=(await c.query('SELECT shot_id,shot_type FROM local_identity.workspace_shot_inputs WHERE workspace_id=$1 AND preparation_id=$2',[row.id,row.storyboard_package_id])).rows;
 return row.bindings.map(clip=>{const route=resolveWorkspaceMainVoice(project,clip.shotId),shot=data?.context_snapshot?.worker_result?.storyboard?.shots?.find((s:{id:string})=>s.id===clip.shotId),shotType=shotInputs.find(s=>s.shot_id===clip.shotId)?.shot_type??shot?.shotType,provider=data?.policy[shotType]?.executor?.provider??'',bounds=isVideoProvider(provider)?videoProviders[provider]:{minDuration:2,maxDuration:15},duration=route.item?Number(route.window.durationSeconds):null;
 const timeline=project.timelines.find(t=>t.items.some(i=>i.id===clip.itemId))!;
 return{...(data?.policy[shotType]?.credential_ref?{defaultSelection:{capability:'video' as const,provider,adapter:data.policy[shotType].executor?.adapter,model:data.policy[shotType].executor?.model,connectionVersionId:data.policy[shotType].credential_ref}}:{}),targetItemId:clip.itemId,width:timeline.width,height:timeline.height,model:data?.policy[shotType]?.executor?.model,provider,voiceMode:(route.item?.id===`workspace-source-shot-${clip.shotId}`?'source':route.item?'tts':'none') as 'source'|'tts'|'none',durationSeconds:duration,providerDurationSeconds:duration===null?null:Math.max(bounds.minDuration,Math.ceil(duration)),minimumSeconds:bounds.minDuration,maximumSeconds:bounds.maxDuration};});
}
