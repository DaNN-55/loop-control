import {workspaceUnknownRetryAllowed,workspaceTaskRetryColumns,projectWorkspaceTaskRetry} from './workspaceTaskRetry.js';
import {legacyVideoDefault} from './legacyVideoCompatibility.js';
import {resolveWorkspaceVideoRequest,workspaceVisualMainVoice} from './workspaceVisualRequest.js';
import {prepareWorkspaceVideoSound} from './workspaceVideoSound.js';
import {applyWorkspaceVideoSound,hasSeparatedVideoSound,removeLinkedVideoSound} from '../workspaceVideoSound.js';
import type {FrozenVideoVisualInput,VideoOutputRatio} from '../videoVisualInputs.js';
import {currentWorkspaceCallAuthorization} from './workspaceCallConfirmation.js';
import {episodeFileIO,verifyEpisodeFile} from './episodeFiles.js';
import {executeWorkspacePexels} from './workspacePexels.js';
import {resolveWorkspaceShotLineage} from './workspacePreparation.js';
import {queueWorkspaceImageCandidates} from './workspaceImageGeneration.js';
import {relative} from 'node:path';
import {lstat} from 'node:fs/promises';
import {resolveWorkspaceMainVoice} from '../workspaceAudio.js';
import {isVideoProvider,klingOmniModel,videoProviders} from '../worker/videoProviderCatalog.js';
import type {InputRuntime} from './episodeCommands.js';
import {isOpenChatCutStudio,registerOpenChatCutStudioSource} from '../worker/openchatcutStudio.js';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import type {WorkspaceVisualCandidate} from '../workspaceVisualCandidates.js';
import {workspaceCandidateTarget,workspaceCandidateAppearance} from '../workspaceCandidates.js';
import {inspectWorkspaceVisualFile,requireVisualStorageLocation} from './workspaceVisualMedia.js';
import {ConfigurationError,canonicalFingerprint as hash} from './configurationCommands.js';
import {resolveWorkspaceSource} from './workspaceSources.js';
import {readProductionWorkspace,persistWorkspaceRevision,updateWorkspaceProject,type ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import {prepareRegisteredWorkspaceCandidate,finishRegisteredWorkspaceCandidate} from './workspaceCandidateAdoption.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function target(row:ProductionWorkspaceRecord,project:OpenChatCutProject,id:unknown){
 const clip=row.bindings.find(b=>b.itemId===id),matches=project.timelines.flatMap(t=>t.items.filter(i=>i.id===id).map(item=>({item,timeline:t})));
 if(!clip||matches.length!==1||!['video','image','text'].includes(String(matches[0].item.kind)))throw new ConfigurationError(409,'指定画面已变化或不属于本工作空间。');
 return{clip,...matches[0]};
}
/** Only nonsecret execution facts cross the Owner read boundary. */
function workspaceVisualGenerationRecord(snapshot:Record<string,any>):WorkspaceVisualCandidate['generation'] {
 if(typeof snapshot.prompt!=='string')return undefined;
 return {...(snapshot.selection?{selection:snapshot.selection,connectionName:snapshot.connection?.name}:{}),prompt:snapshot.prompt,...(snapshot.videoResolution?{videoResolution:snapshot.videoResolution}:{}),...(typeof snapshot.actualPrompt==='string'?{actualPrompt:snapshot.actualPrompt}:{}),firstFrameMaterialRevisionId:snapshot.firstFrameId??'',durationSeconds:snapshot.providerDurationSeconds??snapshot.durationSeconds,...(snapshot.videoSettings?{videoSettings:snapshot.videoSettings}:{}),...(snapshot.firstFrameComposition?{firstFrameFit:snapshot.firstFrameComposition.fit}:{}),...(snapshot.imageSettings?{imageSettings:snapshot.imageSettings,imageBrief:snapshot.imageBrief,referenceMaterialRevisionIds:snapshot.referenceMaterialRevisionIds}:{})};
}
export async function readWorkspaceVisualCandidates(c:PoolClient,row:ProductionWorkspaceRecord,project:OpenChatCutProject,root:string):Promise<WorkspaceVisualCandidate[]>{
 const records=(await c.query(`SELECT v.*,m.id output_material_id,coalesce(m.storage_path,a.relative_path) storage_path,coalesce(m.sha256,a.sha256) sha256,coalesce(m.file_size,a.file_size) file_size,coalesce(m.material_type,v.request_snapshot->>'kind') material_type FROM local_identity.workspace_visual_candidates v LEFT JOIN public.paid_generation_reservations r ON r.task_id=v.task_id LEFT JOIN public.production_material_revisions m ON m.id=coalesce(v.material_revision_id,r.material_revision_id) AND m.episode_id=v.episode_id LEFT JOIN public.artifacts a ON a.id=v.source_artifact_id AND a.episode_id=v.episode_id WHERE v.workspace_id=$1 AND (m.id IS NOT NULL OR a.id IS NOT NULL) ORDER BY v.created_at DESC`,[row.id])).rows;
 const decisions=(await c.query('SELECT * FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1',[row.id])).rows;
 return Promise.all(records.map(async r=>{let readable=true,observed:Awaited<ReturnType<typeof inspectWorkspaceVisualFile>>|null=null;try{const physical=await (await episodeFileIO(c,root,row.episode_id)).resolveReference(r.storage_path),file=await lstat(physical);if(!file.isFile()||file.isSymbolicLink()||file.size!==Number(r.file_size))throw Error();if(r.task_id||r.request_snapshot.execution)observed=await inspectWorkspaceVisualFile(root,relative(root,physical),r.material_type);}catch{readable=false;}const current=project.timelines.flatMap(t=>t.items.filter(i=>i.id===r.target_item_id).map(item=>({item,timeline:t})))[0],d=decisions.find(d=>d.candidate_id===r.id),pending=current?.item.sourceAssetId===`candidate-${r.id}`&&(current.item.loopControlCandidate as {inputFingerprint?:string}|undefined)?.inputFingerprint===r.input_fingerprint;
 const currentUse=current?.item.sourceAssetId===`candidate-${r.id}`;
 const status=r.dismissed_at||d?.decision==='rejected'?'rejected':currentUse&&(r.request_snapshot.kind==='image'||d?.decision==='adopted')?'adopted':
  readable&&current&&(d?.decision==='adopted'||((pending||r.request_snapshot.kind==='image'||hash(workspaceCandidateTarget(current.item))===hash(workspaceCandidateTarget(r.target_snapshot)))&&await visualContextCurrent(c,root,row,project,r)))?'available':'stale';
 const duration=observed?.durationSeconds??r.request_snapshot.durationSeconds??r.request_snapshot.providerDurationSeconds,frames=current?Math.ceil(duration*current.timeline.fps):0,deltaSeconds=current?(frames-Number(current.item.durationInFrames))/current.timeline.fps:0,overlapItemIds=current&&deltaSeconds>0?current.timeline.items.filter(i=>i.id!==current.item.id&&i.track===current.item.track&&Number(i.startFrame)<Number(current.item.startFrame)+frames&&Number(i.startFrame)+Number(i.durationInFrames)>Number(current.item.startFrame)+Number(current.item.durationInFrames)).map(i=>String(i.id)):[];
 return{...(r.request_snapshot.source?{source:r.request_snapshot.source}:{}),materialRevisionId:r.output_material_id,...(typeof r.request_snapshot.prompt==='string'?{generation:workspaceVisualGenerationRecord(r.request_snapshot)}:{}),durationImpact:{deltaSeconds,overlapItemIds},id:r.id,kind:r.request_snapshot.kind,usage:r.request_snapshot.usage,shotId:r.shot_id,clipId:r.clip_id,targetItemId:r.target_item_id,taskId:r.task_id,inputFingerprint:r.input_fingerprint,text:'',mainScriptText:'',audioTrackId:null,relativePath:r.storage_path,sha256:r.sha256,fileSize:Number(r.file_size),durationSeconds:observed?.durationSeconds??r.request_snapshot.durationSeconds??r.request_snapshot.providerDurationSeconds,width:observed?.width??r.request_snapshot.width,height:observed?.height??r.request_snapshot.height,currentDurationSeconds:current?Number(current.item.durationInFrames)/current.timeline.fps:null,pendingConfirmation:!!pending&&!d,status};}));
}
/** One real authorization, frozen input and private queue boundary for first fill and later candidates. */
export async function queueWorkspaceVisualGeneration(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,data:Record<string,unknown>,runtime:InputRuntime,mode:'candidate'|'first'='candidate'){
  await requireVisualStorageLocation(c,root,row.episode_id,runtime.minimumFreeBytes);
  const {clip,item,timeline}=target(row,project,data.targetItemId);
  const {resolved,creativeContext:context,visual,mainVoice,targetSeconds,providerSeconds:seconds,actualPrompt,videoSettings,videoResolution,prompt}=await resolveWorkspaceVideoRequest(c,root,row,project,data,'queue');
  const config={...resolved.execution,max_attempts:1},authorized=await currentWorkspaceCallAuthorization(c,row),first=visual.frozen.find(input=>input.role==='firstFrame');
  if(mode==='first'&&visual.advanced)throw new ConfigurationError(400,'占位首次生成仅支持首帧模式。');
  if(data.firstFrameFit!==undefined&&!first)throw new ConfigurationError(400,'当前生成模式不使用首帧构图。');
  await runtime.checkReferences(c,[config.credential_ref!],{purpose:'workspace-generation'});if(!runtime.mediaReady)throw new ConfigurationError(503,'视频Worker未配置。');await runtime.mediaReady({video:config});
  if(mode==='first'){
   if(clip.source||clip.image||item.kind!=='text')throw new ConfigurationError(409,'首次生成只填入尚未匹配的占位。');
   const frames=Math.max(1,Math.ceil(targetSeconds*timeline.fps)),end=Number(item.startFrame)+Number(item.durationInFrames),delta=frames-Number(item.durationInFrames);
   for(const other of timeline.items)if(other.id!==item.id&&Number(other.startFrame)>=end)other.startFrame=Number(other.startFrame)+delta;
   item.durationInFrames=frames;
  }
  const referenceOutputRatio:VideoOutputRatio=timeline.width>timeline.height?'16:9':timeline.width<timeline.height?'9:16':'1:1';
  const referenceRatio=visual.mode.characterOrder||resolved.selection.model===klingOmniModel||resolved.selection.model==='MiniMax-H3-Lite'&&visual.mode.id==='references'?referenceOutputRatio:undefined;
  const id=randomUUID(),expected=workspaceCandidateTarget(item),snapshot={...(resolved?{selectionVersion:1,selection:resolved.selection,connection:resolved.connection,context,actualPrompt,target:{targetItemId:item.id,shotId:clip.shotId,workspaceRevision:Number(row.revision),projectSha256:row.project_sha256,scriptRevisionId:row.script_revision_id},costBasis:{kind:'owner-reservation',reservationCents:data.reservationCents,model:resolved.selection.model,providerDurationSeconds:seconds}}:{}),origin:mode==='first'?'first-fill':'candidate',kind:'video',usage:'video',capability:'video',execution:config,...(first?{firstFrameId:first.materialRevisionId,firstFrameSha256:first.sha256}:{}),...(visual.advanced?{videoMode:visual.mode.id,visualInputs:visual.frozen,...(referenceRatio?{referenceRatio}:{})}:{}),prompt:prompt.trim(),...(data.promptReferences!==undefined?{promptReferences:data.promptReferences}:{}),providerDurationSeconds:seconds,targetDurationSeconds:targetSeconds,reservationCents:data.reservationCents??null,authorizationHash:authorized.authorization_hash,nativeEditRevision:Number(row.native_edit_revision),expectedRevision:Number(row.revision),mainVoice,...(videoSettings?{videoSettings}:{}),...(videoResolution?{videoResolution}:{}),...(data.firstFrameFit?{firstFrameComposition:{fit:data.firstFrameFit,width:timeline.width,height:timeline.height}}:{})};
  await c.query('INSERT INTO local_identity.workspace_visual_candidates(id,workspace_id,episode_id,clip_id,shot_id,target_item_id,input_fingerprint,target_snapshot,request_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,row.id,row.episode_id,clip.id,clip.shotId,item.id,hash({expected,snapshot}),JSON.stringify(expected),JSON.stringify(snapshot)]);
  let taskId:string;
  try{taskId=(await c.query('SELECT local_identity.queue_workspace_visual($1) id',[id])).rows[0].id;}catch(error){if((error as {code?:string}).code==='55000')throw new ConfigurationError(409,'已有画面任务正在进行或供应商提交结果未知，请先恢复已有任务或核对结果；不会重复付费提交。');if((error as {code?:string}).code==='22023')throw new ConfigurationError(409,'本次视频费用预留或生成参数无效，请检查后重试。');throw error;}
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
  const record=(await c.query('SELECT * FROM local_identity.workspace_visual_candidates WHERE id=$1 AND workspace_id=$2 AND episode_id=$3',[data.candidateId,row.id,row.episode_id])).rows[0];
  if(!record)throw new ConfigurationError(404,'本工作空间视觉候选不存在。');
  if(record.dismissed_at||!row.bindings.some(b=>b.itemId===record.target_item_id))throw new ConfigurationError(409,'目标或输入已失效，请核对当前内容后重新准备。');
  try{await c.query('SELECT local_identity.retry_workspace_visual($1)',[data.candidateId]);}catch(error){if((error as {code?:string}).code==='55000')throw new ConfigurationError(409,'供应商提交结果未知或不能恢复；必须核对已有结果，不会创建重复付费任务。');throw error;}return readProductionWorkspace(c,row.episode_id,root);
 }
 if(command==='requestWorkspaceVisualCandidate'){

  await queueWorkspaceVisualGeneration(c,root,row,project,data,runtime);
  return readProductionWorkspace(c,row.episode_id,root);
 }
 if(command==='prepareWorkspaceVisualPool'){
  if(typeof data.materialRevisionId!=='string'||!uuid.test(data.materialRevisionId))throw new ConfigurationError(400,'素材标识无效。');
  const m=(await c.query("SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type IN ('video','image')",[data.materialRevisionId,row.episode_id])).rows[0];if(!m)throw new ConfigurationError(404,'本期视觉素材不存在；声音请从声音素材入口添加。');
  await resolveWorkspaceSource(c,root,row.episode_id,m.storage_path);const observed=await inspectWorkspaceVisualFile(root,relative(root,await (await episodeFileIO(c,root,row.episode_id)).resolveReference(m.storage_path)),m.material_type),fps=project.timelines[0].fps;
  const asset={id:`material-${m.id}`,name:m.source_path.split('/').pop(),kind:m.material_type as 'video'|'image',src:m.storage_path,sourceRevision:`source-sha256-${m.sha256}`,sourceContentHash:m.sha256,durationInFrames:Math.ceil((observed.durationSeconds??3)*fps),width:observed.width,height:observed.height};
  if(isOpenChatCutStudio(row.episode_id))return{asset:{...asset,src:await registerOpenChatCutStudioSource(root,row.episode_id,m.storage_path,m.sha256,Number(m.file_size),await episodeFileIO(c,root,row.episode_id,true))}};
  if(!project.assets.some(a=>a.id===asset.id)){project.assets.push(asset);await persistWorkspaceRevision(c,root,row,project,row.bindings,'登记补充视觉素材',{nativeEdit:true});}return{asset};
 }
 if(command==='registerWorkspaceVisualCandidate'){
  const {clip,item}=target(row,project,data.targetItemId);
  if(typeof data.materialRevisionId!=='string'||!uuid.test(data.materialRevisionId)||!['video','still','pan-zoom'].includes(String(data.usage)))throw new ConfigurationError(400,'请选择本期视频素材与使用方式。');
  const m=(await c.query("SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type IN ('video','image')",[data.materialRevisionId,row.episode_id])).rows[0];if(!m)throw new ConfigurationError(404,'本期视觉素材不存在。');
  await resolveWorkspaceSource(c,root,row.episode_id,m.storage_path);if((m.material_type==='video')!==(data.usage==='video'))throw new ConfigurationError(400,'素材类型与使用方式不一致。');
  const observed=await inspectWorkspaceVisualFile(root,relative(root,await (await episodeFileIO(c,root,row.episode_id)).resolveReference(m.storage_path)),m.material_type);if(m.material_type==='image'&&(typeof data.durationSeconds!=='number'||!Number.isFinite(data.durationSeconds)||data.durationSeconds<0.1||data.durationSeconds>120))throw new ConfigurationError(400,'请填写图片使用时长。');
  const snapshot={kind:m.material_type,usage:data.usage,durationSeconds:observed.durationSeconds??data.durationSeconds,width:observed.width,height:observed.height},expected=workspaceCandidateTarget(item);
  await c.query('INSERT INTO local_identity.workspace_visual_candidates(id,workspace_id,episode_id,clip_id,shot_id,target_item_id,input_fingerprint,target_snapshot,request_snapshot,material_revision_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[randomUUID(),row.id,row.episode_id,clip.id,clip.shotId,item.id,hash({expected,materialId:m.id,sha256:m.sha256,snapshot}),JSON.stringify(expected),JSON.stringify(snapshot),m.id]);
  return readProductionWorkspace(c,row.episode_id,root);
 }
 if(command==='splitWorkspaceVideoSound'){
  if(isOpenChatCutStudio(row.episode_id))throw new ConfigurationError(409,'请先保存并返回分镜台，再拆分视频原声。');
  const {clip,item,timeline}=target(row,project,data.targetItemId);
  if(item.kind!=='video'||typeof item.src!=='string')throw new ConfigurationError(409,'请先采用视频。');
  if(hasSeparatedVideoSound(timeline,item))return readProductionWorkspace(c,row.episode_id,root);
  if(item.edits)throw new ConfigurationError(409,'当前视频已分段，请先在剪辑工作台拆成独立片段。');
  const source=await resolveWorkspaceSource(c,root,row.episode_id,item.src);
  const sound=await prepareWorkspaceVideoSound(c,root,row.episode_id,item.src,source.sha256,timeline.fps,
   Number(item.srcInFrame??0),Number(item.durationInFrames),Number(item.playbackRate??1));
  if(sound.mode==='silent')throw new ConfigurationError(409,'这个视频没有音频流。');
  if(sound.mode==='embedded')throw new ConfigurationError(409,'当前原声无法提取，可以在剪辑工作台调整视频片段的音量。');
  applyWorkspaceVideoSound(project,timeline,item,clip.shotId,sound,!!resolveWorkspaceMainVoice(project,clip.shotId).item);
  return updateWorkspaceProject(c,root,row,project,row.bindings,'拆分视频原声',{nativeEdit:true});
 }
 if(command==='clearWorkspaceVisualCandidate'){
  const {clip,item,timeline}=target(row,project,data.targetItemId);
  if(data.sourcePath===undefined){
   const removed=await c.query('DELETE FROM local_identity.workspace_visual_image_choices WHERE workspace_id=$1 AND target_item_id=$2 AND candidate_id::text=$3',[row.id,item.id,data.candidateId]);
   if(!removed.rowCount)throw new ConfigurationError(409,'备用图片已变化，请刷新后重试。');
   return readProductionWorkspace(c,row.episode_id,root);
  }
  if(isOpenChatCutStudio(row.episode_id))throw new ConfigurationError(409,'请先保存并返回分镜台，再取消采用。');
  if(typeof item.src!=='string'||item.src!==data.sourcePath||(item.kind!=='image'&&item.kind!=='video'))throw new ConfigurationError(409,'当前画面已变化，请刷新后重试。');
  const source=await resolveWorkspaceSource(c,root,row.episode_id,item.src),kind=item.kind;
  if(source.sha256!==data.sourceSha256||source.registration==='audio_track')throw new ConfigurationError(409,'当前画面已变化，请刷新后重试。');
  const candidates=await readWorkspaceVisualCandidates(c,row,project,root);
  const previous=candidates.find(v=>v.targetItemId===item.id&&v.relativePath===item.src&&v.sha256===source.sha256&&v.status!=='rejected'&&(item.sourceAssetId===`candidate-${v.id}`||v.id===data.candidateId));
  if(data.candidateId&&!previous)throw new ConfigurationError(409,'当前画面已变化，请刷新后重试。');
  const sourcePath=item.src;
  removeLinkedVideoSound(timeline,item);
  // Keep the target's identity and window. The source stays in the pool for reuse.
  for(const key of ['src','sourceAssetId','sourceRevision','sourceContentHash','srcInFrame','playbackRate','loopControlCandidate'])delete item[key];
  Object.assign(item,{kind:'text',name:'待匹配画面',width:timeline.width,height:timeline.height,props:{text:'待匹配画面',fontSize:56,color:'#a3acc2',align:'center'}});
  clip.source=null;
  delete clip.image;
  if(previous){
   await c.query('DELETE FROM local_identity.workspace_visual_image_choices WHERE workspace_id=$1 AND target_item_id=$2 AND candidate_id=$3',[row.id,item.id,previous.id]);
  }
  // An already adopted candidate remains reusable. Register a shelf entry for
  // legacy/direct matches and sources that had no completed adoption decision.
  const reusable=previous&&(await c.query("SELECT 1 FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1 AND candidate_id=$2 AND decision='adopted'",[row.id,previous.id])).rowCount;
  if(!reusable){
   const physical=await (await episodeFileIO(c,root,row.episode_id)).resolveReference(sourcePath);
   const observed=await inspectWorkspaceVisualFile(root,relative(root,physical),kind);
   const snapshot={kind,usage:kind==='video'?'video':'still',durationSeconds:observed.durationSeconds??Number(item.durationInFrames)/timeline.fps,width:observed.width,height:observed.height},expected=workspaceCandidateTarget(item);
   if(previous)await c.query('UPDATE local_identity.workspace_visual_candidates SET dismissed_at=clock_timestamp() WHERE id=$1 AND workspace_id=$2',[previous.id,row.id]);
   await c.query('INSERT INTO local_identity.workspace_visual_candidates(id,workspace_id,episode_id,clip_id,shot_id,target_item_id,input_fingerprint,target_snapshot,request_snapshot,material_revision_id,source_artifact_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[randomUUID(),row.id,row.episode_id,clip.id,clip.shotId,item.id,hash({expected,sourcePath,sha256:source.sha256,snapshot}),JSON.stringify(expected),JSON.stringify(snapshot),source.registration==='material'?source.id:null,source.registration==='task_artifact'?source.id:null]);
  }
  return updateWorkspaceProject(c,root,row,project,row.bindings,'取消采用镜头画面',{nativeEdit:true});
 }
 const candidate=(await readWorkspaceVisualCandidates(c,row,project,root)).find(v=>v.id===data.candidateId);if(!candidate)throw new ConfigurationError(404,'本工作空间视觉候选不存在。');
 if(command==='retainWorkspaceImageCandidate'){
  if(candidate.kind!=='image'||!['available','adopted'].includes(candidate.status))throw new ConfigurationError(409,'请选择当前有效的图片候选。');
  await c.query('INSERT INTO local_identity.workspace_visual_image_choices(workspace_id,target_item_id,candidate_id) VALUES($1,$2,$3) ON CONFLICT(workspace_id,target_item_id) DO UPDATE SET candidate_id=excluded.candidate_id',[row.id,candidate.targetItemId,candidate.id]);
  return readProductionWorkspace(c,row.episode_id,root);
 }
 if(command==='prepareWorkspaceVisualCandidate'){
  if(data.replaceCurrentVisual!==undefined&&typeof data.replaceCurrentVisual!=='boolean')throw new ConfigurationError(400,'画面替换参数无效。');
  if(candidate.kind==='image'&&data.replaceCurrentVisual!==true&&target(row,project,candidate.targetItemId).item.kind==='video')throw new ConfigurationError(409,'当前视频优先；请将图片保留为备用画面或视频首帧。');
  const {item}=target(row,project,candidate.targetItemId);
  if(data.imageUsage!==undefined&&(candidate.kind!=='image'||!['still','pan-zoom'].includes(String(data.imageUsage))))throw new ConfigurationError(400,'图片使用方式无效。');
  if(candidate.kind==='image'&&data.imageUsage)candidate.usage=data.imageUsage as 'still'|'pan-zoom';
  if(data.acceptTimelineImpact!==undefined&&typeof data.acceptTimelineImpact!=='boolean'||data.motionPolicy!==undefined&&!['preserve-target','replace-motion'].includes(String(data.motionPolicy)))throw new ConfigurationError(400,'请明确本次时长与运动处理。');
  if(candidate.usage==='pan-zoom'&&!data.motionPolicy)throw new ConfigurationError(400,'请选择保留当前运动或采用新图片推拉。');
  const sourceIn=data.sourceInSeconds??0,sourceOut=data.sourceOutSeconds??candidate.durationSeconds;
  if((data.sourceInSeconds!==undefined||data.sourceOutSeconds!==undefined)&&(candidate.kind!=='video'||typeof sourceIn!=='number'||!Number.isFinite(sourceIn)||sourceIn<0||typeof sourceOut!=='number'||!Number.isFinite(sourceOut)||sourceOut<=sourceIn||sourceOut>candidate.durationSeconds+0.001))throw new ConfigurationError(400,'视频使用区间无效。');
  candidate.visual={...(candidate.kind==='video'&&(data.sourceInSeconds!==undefined||data.sourceOutSeconds!==undefined)?{sourceInSeconds:Number(sourceIn),sourceOutSeconds:Number(sourceOut)}:{}),usage:candidate.usage,motionPolicy:(data.motionPolicy??'preserve-target') as 'preserve-target'|'replace-motion',acceptTimelineImpact:data.acceptTimelineImpact===true,expectedAppearance:workspaceCandidateAppearance(item),placeholder:item.kind==='text'};
  return prepareRegisteredWorkspaceCandidate(c,root,row,project,candidate,data.durationPolicy);
 }
 if(command==='adoptWorkspaceVisualCandidate'){await finishRegisteredWorkspaceCandidate(c,root,row,project,candidate,data);return readProductionWorkspace(c,row.episode_id,root);}
 if(command==='rejectWorkspaceVisualCandidate'){
  const {item}=target(row,project,candidate.targetItemId);
  const selected=(await c.query('SELECT 1 FROM local_identity.workspace_visual_image_choices WHERE workspace_id=$1 AND target_item_id=$2 AND candidate_id=$3',[row.id,item.id,candidate.id])).rowCount;
  if(item.sourceAssetId===`candidate-${candidate.id}`||selected)throw new ConfigurationError(409,'已采用的画面请先确认取消采用。');
  const decision=await c.query("INSERT INTO local_identity.workspace_candidate_decisions(workspace_id,candidate_id,decision,text_version,main_script_text,input_fingerprint,source_sha256,project_sha256) VALUES($1,$2,'rejected','','',$3,$4,$5) ON CONFLICT DO NOTHING",[row.id,candidate.id,candidate.inputFingerprint,candidate.sha256,row.project_sha256]);
  if(!decision.rowCount)await c.query('UPDATE local_identity.workspace_visual_candidates SET dismissed_at=clock_timestamp() WHERE id=$1 AND workspace_id=$2',[candidate.id,row.id]);
  return readProductionWorkspace(c,row.episode_id,root);
 }
 throw new ConfigurationError(400,'不支持的视觉候选操作。');
}

/** Existing approved-board lineage only; T13 may extend this resolver with a versioned local-shot contract. */
export async function resolveWorkspaceVisualLineage(c:PoolClient,row:ProductionWorkspaceRecord,shotId:string){
 const shot=await resolveWorkspaceShotLineage(c,row,shotId);
 // Invoked only for pre-selection candidates; never used by current video requests.
 const legacyType=shot.shot_type??shot.snapshot?.shotType;
 if(!['a_roll','b_roll'].includes(legacyType))throw new ConfigurationError(409,'旧候选缺少冻结镜头分类，请使用当前视频来源重新制作。');return{id:shotId,shotType:legacyType as 'a_roll'|'b_roll'};
}
export async function readWorkspaceVisualTasks(c:PoolClient,row:ProductionWorkspaceRecord,usedItemIds?:Set<string>){
 return(await c.query(`SELECT ${workspaceTaskRetryColumns},v.id,v.request_snapshot,v.shot_id "shotId",v.target_item_id "targetItemId",v.request_snapshot->>'kind' kind,t.id "taskId",t.status,t.provider,t.model,t.created_at "createdAt",v.request_snapshot#>>'{connection,name}' "connectionName",
 coalesce(t.last_result#>>'{blockers,0,detail}',t.last_result#>>'{retry,reason}',CASE WHEN t.status IN ('failed','blocked') THEN '生成未完成，请核对原任务与连接。' END) error,
 (SELECT retry.task_id FROM local_identity.workspace_visual_candidates retry
  WHERE retry.workspace_id=v.workspace_id AND retry.target_item_id=v.target_item_id
    AND retry.task_id IS NOT NULL AND retry.request_snapshot->>'retryOfTaskId'=t.id::text LIMIT 1) "retryTaskId",
 local_identity.provider_dispatch_observation(t.id) "dispatchObservation",CASE WHEN t.last_result#>>'{blockers,0,code}' IN ('VIDEO_REQUEST_NOT_SENT','PROVIDER_REQUEST_NOT_SENT') OR local_identity.provider_dispatch_observation(t.id)->>'phase' IN ('preparing','reserved') THEN 'not_sent' ELSE s.outcome END "submissionOutcome",to_jsonb(s)->>'video_phase' "videoPhase",r.provider_task_id "providerTaskId",r.request_state "requestState",h.attempt "publicationAttempt",
 (t.status IN ('failed','blocked') AND coalesce(local_identity.provider_dispatch_observation(t.id)->>'phase','dispatching') NOT IN ('preparing','reserved','rejected') AND r.request_state='submitting' AND r.provider_task_id IS NULL AND coalesce(s.outcome,'started')<>'rejected') "submissionUnknown",r.reserved_cents "reservationCents",
 (t.status IN ('failed','blocked') AND t.invalidated_at IS NULL AND r.provider_task_id IS NOT NULL AND s.outcome<>'rejected' AND h.task_id IS NULL) "canResume"
 FROM local_identity.workspace_visual_candidates v JOIN public.tasks t ON t.id=v.task_id LEFT JOIN public.paid_generation_reservations r ON r.task_id=t.id LEFT JOIN local_identity.workspace_visual_submissions s ON s.task_id=t.id LEFT JOIN local_identity.workspace_publication_holds($2) h ON h.task_id=t.id WHERE v.workspace_id=$1 ORDER BY v.created_at DESC`,[row.id,row.episode_id])).rows.map(({request_snapshot,...task})=>{
  const evidence=projectWorkspaceTaskRetry(task),removed=usedItemIds!==undefined&&!usedItemIds.has(task.targetItemId);
  return{...evidence,unknownRetryAllowed:!removed&&workspaceUnknownRetryAllowed(evidence),invalidated:evidence.invalidated||removed,retryAllowed:evidence.retryAllowed&&!removed,canResume:task.canResume&&!removed,...(typeof request_snapshot.prompt==='string'?{generation:workspaceVisualGenerationRecord(request_snapshot)}:{})};
 });
}

async function visualContextCurrent(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,record:Record<string,any>){
 if(!record.request_snapshot.execution)return true;
 if(record.request_snapshot.kind==='image'){
  const current=(await c.query('SELECT b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[row.episode_id])).rows[0];
  if(record.request_snapshot.selectionVersion!==1&&hash(current?.policy.static_visual)!==hash(record.request_snapshot.execution))return false;
  try{for(const ref of record.request_snapshot.references??[])await verifyEpisodeFile(c,root,row.episode_id,ref.relativePath,ref.sha256,Number(ref.fileSize));return true;}catch{return false;}
 }
 try{const e=(await c.query('SELECT b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[row.episode_id])).rows[0],first=(await c.query('SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2',[record.request_snapshot.firstFrameId,row.episode_id])).rows[0];
 if(record.request_snapshot.selectionVersion!==1){const legacy=await resolveWorkspaceVisualLineage(c,row,record.shot_id);if(hash(e.policy[legacy.shotType])!==hash(record.request_snapshot.execution))return false;}
 if(record.request_snapshot.visualInputs){
  for(const input of record.request_snapshot.visualInputs as FrozenVideoVisualInput[])await verifyEpisodeFile(c,root,row.episode_id,input.relativePath,input.sha256,input.fileSize);
 }else{
  if(first?.sha256!==record.request_snapshot.firstFrameSha256||!first)return false;
  await verifyEpisodeFile(c,root,row.episode_id,first.storage_path,first.sha256,Number(first.file_size));
 }
 const voice=await workspaceVisualMainVoice(c,root,row,project,record.shot_id);return voice.identity===record.request_snapshot.mainVoice.identity&&voice.source?.id===record.request_snapshot.mainVoice.source?.id&&voice.source?.sha256===record.request_snapshot.mainVoice.source?.sha256;
 }catch{return false;}
}
/** Prepared visual inputs are rechecked at the real Owner save boundary. */
export async function validateWorkspaceVisualUses(c:PoolClient,root:string,row:ProductionWorkspaceRecord,baseline:OpenChatCutProject,document:OpenChatCutProject){
 for(const item of document.timelines.flatMap(t=>t.items)){
 const identity=item.loopControlCandidate as {sourceId?:string;inputFingerprint?:string}|undefined;if(!identity?.sourceId?.startsWith('candidate-'))continue;
 if(baseline.timelines.flatMap(t=>t.items).some(i=>i.id===item.id&&i.src===item.src&&i.sourceContentHash===item.sourceContentHash))continue;
 const id=identity.sourceId.slice('candidate-'.length);if(!uuid.test(id))continue;
 const record=(await c.query('SELECT * FROM local_identity.workspace_visual_candidates WHERE workspace_id=$1 AND id=$2',[row.id,id])).rows[0];
 if(record?.dismissed_at)throw new ConfigurationError(409,'该画面已从候选区移除，请重新选取素材。');
 if((await c.query("SELECT 1 FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1 AND candidate_id=$2 AND decision='adopted' AND source_sha256=$3",[row.id,id,item.sourceContentHash])).rowCount)continue;
 if(record&&!await visualContextCurrent(c,root,row,document,record))throw new ConfigurationError(409,'当前实际主声、首帧或视觉输入已变化，旧候选未保存；请保留当前编辑并重新比较。');
 }
}

export async function readWorkspaceVisualTargets(c:PoolClient,row:ProductionWorkspaceRecord,project:OpenChatCutProject){
 const data=(await c.query('SELECT b.policy,p.context_snapshot FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id JOIN public.review_packages p ON p.id=$2 WHERE e.id=$1',[row.episode_id,row.storyboard_package_id])).rows[0];
 const legacyDefault=legacyVideoDefault(data?.policy);
 return row.bindings.map(clip=>{const route=resolveWorkspaceMainVoice(project,clip.shotId),provider=legacyDefault?.executor?.provider??'',bounds=isVideoProvider(provider)?videoProviders[provider]:{minDuration:2,maxDuration:15},duration=route.item?Number(route.window.durationSeconds):null;
 const timeline=project.timelines.find(t=>t.items.some(i=>i.id===clip.itemId))!;
 return{...(legacyDefault?.credential_ref?{defaultSelection:{capability:'video' as const,provider,adapter:legacyDefault.executor?.adapter,model:legacyDefault.executor?.model,connectionVersionId:legacyDefault.credential_ref}}:{}),targetItemId:clip.itemId,width:timeline.width,height:timeline.height,model:legacyDefault?.executor?.model,provider,voiceMode:(route.item?.id===`workspace-source-shot-${clip.shotId}`?'source':route.item?'tts':'none') as 'source'|'tts'|'none',durationSeconds:duration,providerDurationSeconds:duration===null?null:Math.max(bounds.minDuration,Math.ceil(duration)),minimumSeconds:bounds.minDuration,maximumSeconds:bounds.maxDuration};});
}
