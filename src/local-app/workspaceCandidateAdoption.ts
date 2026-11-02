// Shared adoption evidence for visual and speech candidates; native editing remains authoritative.
import {episodeFileIO,verifyEpisodeFile,resolveEpisodeFileReference} from './episodeFiles.js';
import {episodeStorageLocationAtRoot} from './episodeStorageLocation.js';
import {inspectWorkspaceVisualFile} from './workspaceVisualMedia.js';
import {relative} from 'node:path';
import {resolveWorkspaceMainVoice} from '../workspaceAudio.js';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {applyWorkspaceCandidate,workspaceCandidateTarget,workspaceCandidateVoiceRoute,workspaceCandidateDurationFrames,type WorkspaceCandidate,type WorkspaceCandidateEdit,type WorkspaceCandidatePreparation} from '../workspaceCandidates.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {probeMp3Artifact,inspectMp4Artifact} from '../worker/mediaTools.js';
import {isOpenChatCutStudio,registerOpenChatCutStudioSource,inspectOpenChatCutStoredProject} from '../worker/openchatcutStudio.js';
import {workspaceNarrationItemId,validateSpeechParameters} from './workspaceNarration.js';
import {ConfigurationError} from './configurationCommands.js';
import {resolveWorkspaceSource} from './workspaceSources.js';
import {updateWorkspaceProject,type ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
export async function prepareRegisteredWorkspaceCandidate(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,candidate:WorkspaceCandidate,durationPolicy:unknown){
 if(isOpenChatCutStudio(row.episode_id)){const native=await inspectOpenChatCutStoredProject(root,row.episode_id,await episodeFileIO(c,root,row.episode_id));if(!native)throw new ConfigurationError(409,'当前原生工程不可读取，请先保存并重新比较。');project=native.project;}
 if(candidate.status!=='available')throw new ConfigurationError(409,'候选已过期或已有决定，请读取当前版本。');
 if(!['keep-target','use-candidate'].includes(String(durationPolicy)))throw new ConfigurationError(400,'请明确选择保留目标时长或采用候选时长。');
 const source=await resolveWorkspaceSource(c,root,row.episode_id,candidate.relativePath);if(source.sha256!==candidate.sha256||Number(source.file_size)!==candidate.fileSize)throw new ConfigurationError(409,'候选源身份已变化。');
 await verifyEpisodeFile(c,root,row.episode_id,candidate.relativePath,candidate.sha256,candidate.fileSize);
 const physical=await resolveEpisodeFileReference(c,await episodeStorageLocationAtRoot(c,root,row.episode_id),candidate.relativePath);
 const observed=candidate.kind==='image'?(await inspectWorkspaceVisualFile(root,relative(root,physical),'image'),candidate.durationSeconds):candidate.kind==='audio'?await probeMp3Artifact(physical):(await inspectMp4Artifact(physical)).durationSeconds;
 if(Math.abs(observed-candidate.durationSeconds)>0.05)throw new ConfigurationError(409,'候选实际时长与登记不同。');
 let explicitSpeech=false;
 if(candidate.kind==='audio'){const frozen=(await c.query('SELECT t.input_snapshot FROM public.tasks t JOIN local_identity.workspace_narration_requests r ON r.task_id=t.id WHERE r.workspace_id=$1 AND t.id=$2',[row.id,candidate.taskId])).rows[0]?.input_snapshot;if(frozen?.selectionVersion===1){explicitSpeech=true;const voice=frozen.media.narration.voice;validateSpeechParameters(frozen.production_selection,voice.name,voice.language_code,Number(voice.speaking_rate));}}
 const item=project.timelines.flatMap(t=>t.items).find(i=>i.id===candidate.targetItemId),canonical=candidate.kind==='audio'&&candidate.targetItemId===workspaceNarrationItemId(candidate.shotId),ids=new Set(row.bindings.filter(b=>b.shotId===candidate.shotId).map(b=>b.itemId)),timelines=project.timelines.filter(t=>t.items.some(v=>ids.has(String(v.id))));
 if(!item&&!canonical)throw new ConfigurationError(409,'候选目标已删除。');
 if(timelines.length!==1)throw new ConfigurationError(409,'镜头画面跨时间线或已删除，请重新读取。');
 const timeline=timelines[0],visuals=timeline.items.filter(v=>ids.has(String(v.id))),start=Math.min(...visuals.map(v=>Number(v.startFrame))),end=Math.max(...visuals.map(v=>Number(v.startFrame)+Number(v.durationInFrames))),route=resolveWorkspaceMainVoice(project,candidate.shotId),activate=route.item?.id!==candidate.targetItemId;
 if(explicitSpeech&&durationPolicy==='keep-target'&&Math.ceil(observed*timeline.fps)>(activate?end-start:Number(item!.durationInFrames)))throw new ConfigurationError(409,'完整口播长于当前画面窗口，请采用候选时长后补充画面或拆镜；不会截断口播。');
 const edit:WorkspaceCandidateEdit={...(candidate.visual?{visual:candidate.visual}:{}),shotWindow:{startFrame:start,durationInFrames:end-start},...(canonical?{mainVoice:{workspaceId:row.id,shotId:candidate.shotId,visualItemIds:[...ids],expectedRoute:workspaceCandidateVoiceRoute(project,candidate.shotId,[...ids]),activate,volume:Number(route.item?.volume??1),window:activate?{startFrame:start,durationInFrames:end-start}:{startFrame:Number(item!.startFrame),durationInFrames:Number(item!.durationInFrames)}}}:{}),targetItemId:candidate.targetItemId,expectedTarget:item?workspaceCandidateTarget(item):null,durationPolicy:durationPolicy as WorkspaceCandidateEdit['durationPolicy'],source:{id:candidate.audioTrackId?`audio-track-${candidate.audioTrackId}`:`candidate-${candidate.id}`,kind:candidate.kind,width:candidate.width,height:candidate.height,src:candidate.relativePath,sha256:candidate.sha256,inputFingerprint:candidate.inputFingerprint,durationSeconds:candidate.visual?.sourceOutSeconds!==undefined?candidate.visual.sourceOutSeconds-(candidate.visual.sourceInSeconds??0):candidate.durationSeconds,...(candidate.visual?.sourceInSeconds!==undefined?{sourceInSeconds:candidate.visual.sourceInSeconds,fullDurationSeconds:candidate.durationSeconds}:{})}};
 let applied:OpenChatCutProject;try{applied=applyWorkspaceCandidate(project,edit);}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'采用输入无效。');}
 const id=randomUUID();await c.query('INSERT INTO local_identity.workspace_candidate_adoptions(id,workspace_id,candidate_id,input_fingerprint,project_sha256,edit) VALUES($1,$2,$3,$4,$5,$6)',[id,row.id,candidate.id,candidate.inputFingerprint,row.project_sha256,JSON.stringify(edit)]);
 const nativeEdit=structuredClone(edit);if(isOpenChatCutStudio(row.episode_id)){nativeEdit.source.src=await registerOpenChatCutStudioSource(root,row.episode_id,candidate.relativePath,candidate.sha256,candidate.fileSize,await episodeFileIO(c,root,row.episode_id,true));if(typeof nativeEdit.expectedTarget?.src==='string'){const current=await resolveWorkspaceSource(c,root,row.episode_id,nativeEdit.expectedTarget.src);nativeEdit.expectedTarget.src=await registerOpenChatCutStudioSource(root,row.episode_id,nativeEdit.expectedTarget.src,current.sha256,Number(current.file_size),await episodeFileIO(c,root,row.episode_id,true));}if(nativeEdit.mainVoice){const routes=JSON.parse(nativeEdit.mainVoice.expectedRoute);for(const route of routes)for(const voice of route.voices)if(typeof voice.src==='string'){const current=await resolveWorkspaceSource(c,root,row.episode_id,voice.src);voice.src=await registerOpenChatCutStudioSource(root,row.episode_id,voice.src,current.sha256,Number(current.file_size),await episodeFileIO(c,root,row.episode_id,true));}nativeEdit.mainVoice.expectedRoute=JSON.stringify(routes);}}
 const appliedItem=applied.timelines.flatMap(t=>t.items).find(i=>i.id===edit.targetItemId)!;
 const currentFrames=Number(edit.mainVoice?.window.durationInFrames??item?.durationInFrames),appliedFrames=Number(appliedItem.durationInFrames),appliedStart=Number(appliedItem.startFrame),changedStart=appliedStart+Math.min(currentFrames,appliedFrames),changedEnd=appliedStart+Math.max(currentFrames,appliedFrames),fps=timeline.fps;
 const impact:WorkspaceCandidatePreparation['impact']={currentSeconds:currentFrames/fps,sourceSeconds:edit.source.durationSeconds,appliedSeconds:appliedFrames/fps,deltaSeconds:(appliedFrames-currentFrames)/fps,startSeconds:appliedStart/fps,endSeconds:(appliedStart+appliedFrames)/fps,fps,affectedFragments:timeline.items.filter(other=>other.id!==edit.targetItemId&&changedStart<changedEnd&&Number(other.startFrame)<changedEnd&&Number(other.startFrame)+Number(other.durationInFrames)>changedStart).map(other=>({itemId:String(other.id),label:row.bindings.find(binding=>binding.itemId===other.id)?.text||String(other.name??other.id),kind:String(other.kind),track:String(other.track),startSeconds:Number(other.startFrame)/fps,endSeconds:(Number(other.startFrame)+Number(other.durationInFrames))/fps,changedStartSeconds:Math.max(changedStart,Number(other.startFrame))/fps,changedEndSeconds:Math.min(changedEnd,Number(other.startFrame)+Number(other.durationInFrames))/fps}))};
 return{adoptionId:id,candidateId:candidate.id,projectSha256:row.project_sha256,edit:nativeEdit,impact} satisfies WorkspaceCandidatePreparation;
}
export async function finishRegisteredWorkspaceCandidate(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,candidate:WorkspaceCandidate,data:Record<string,unknown>){
 if(data.adoptionId!==undefined&&(typeof data.adoptionId!=='string'||!/^[a-f0-9-]{36}$/.test(data.adoptionId))||data.nativeApplied!==undefined&&typeof data.nativeApplied!=='boolean')throw new ConfigurationError(400,'采用身份无效。');
 const prepared=(await c.query('SELECT * FROM local_identity.workspace_candidate_adoptions WHERE workspace_id=$1 AND candidate_id=$2 AND ($3::text IS NULL OR id::text=$3) ORDER BY created_at DESC LIMIT 1',[row.id,candidate.id,data.adoptionId??null])).rows[0];
 if(!prepared||candidate.status==='rejected'||candidate.status==='stale'||prepared.input_fingerprint!==candidate.inputFingerprint)throw new ConfigurationError(409,'采用身份已失效，请重新比较当前候选。');
 await verifyEpisodeFile(c,root,row.episode_id,candidate.relativePath,candidate.sha256,candidate.fileSize);
 const edit=prepared.edit as WorkspaceCandidateEdit;
 if(isOpenChatCutStudio(row.episode_id)||data.nativeApplied===true){
 const item=project.timelines.flatMap(t=>t.items).find(i=>i.id===edit.targetItemId);if(data.nativeApplied!==true||!item||item.sourceAssetId!==edit.source.id||item.src!==candidate.relativePath||item.sourceContentHash!==candidate.sha256||item.sourceRevision!==`source-sha256-${candidate.sha256}`||(item.loopControlCandidate as {inputFingerprint?:string}|undefined)?.inputFingerprint!==candidate.inputFingerprint||Number(item.srcInFrame??0)!==Math.round((edit.source.sourceInSeconds??0)*project.timelines.find(t=>t.items.includes(item))!.fps)||Number(item.playbackRate??1)!==1||Number(item.durationInFrames)!==workspaceCandidateDurationFrames(edit,project.timelines.find(t=>t.items.includes(item))!.fps))throw new ConfigurationError(409,'请先将此候选保存到当前原生编辑器。');
 if(edit.mainVoice&&resolveWorkspaceMainVoice(project,edit.mainVoice.shotId).item?.id!==edit.targetItemId)throw new ConfigurationError(409,'候选尚未成为实际口播主声，请保留当前编辑并重新比较。');
 }else{
 if(prepared.project_sha256!==row.project_sha256)throw new ConfigurationError(409,'工程已变化，请重新比较后采用。');
 let next;try{next=applyWorkspaceCandidate(project,edit);}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'采用未完成。');}
 await updateWorkspaceProject(c,root,row,next,row.bindings,'采用局部口播候选',{nativeEdit:true});
 }
 await recordWorkspaceCandidateDecision(c,row,candidate,'adopted');
}
export async function recordWorkspaceCandidateDecision(c:PoolClient,row:ProductionWorkspaceRecord,candidate:WorkspaceCandidate,decision:'adopted'|'rejected'){
 const current=(await c.query('SELECT project_sha256 FROM local_identity.production_workspaces WHERE id=$1',[row.id])).rows[0];
 await c.query('INSERT INTO local_identity.workspace_candidate_decisions(workspace_id,candidate_id,decision,text_version,main_script_text,input_fingerprint,source_sha256,project_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[row.id,candidate.id,decision,candidate.text,candidate.mainScriptText,candidate.inputFingerprint,candidate.sha256,current.project_sha256]);
}

/** Pending native uses must still match the prepared workspace and source before saving. */
export async function* pendingWorkspaceCandidateUses(c:PoolClient,row:ProductionWorkspaceRecord,baseline:OpenChatCutProject,document:OpenChatCutProject){
 const previous=baseline.timelines.flatMap(t=>t.items);
 for(const item of document.timelines.flatMap(t=>t.items)){
  const identity=item.loopControlCandidate as {sourceId?:string;inputFingerprint?:string}|undefined;
  // Native manual relinks may retain unrelated extension metadata. They remain
  // registered-source edits, never evidence for the old candidate's adoption.
  if(!identity||identity.sourceId!==item.sourceAssetId)continue;
  const committed=previous.find(v=>v.id===item.id);if(committed?.sourceAssetId===item.sourceAssetId&&committed?.src===item.src&&committed?.sourceContentHash===item.sourceContentHash)continue;
  const known=(await c.query("SELECT 1 FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1 AND decision='adopted' AND input_fingerprint=$2 AND source_sha256=$3 AND (('audio-track-'||candidate_id::text)=$4 OR ('candidate-'||candidate_id::text)=$4)",[row.id,identity.inputFingerprint,item.sourceContentHash,identity.sourceId])).rowCount;if(known)continue;
  const prepared=(await c.query(`SELECT * FROM local_identity.workspace_candidate_adoptions WHERE workspace_id=$1 AND input_fingerprint=$2 AND project_sha256=$3 AND edit#>>'{source,id}'=$4 AND edit#>>'{source,sha256}'=$5 ORDER BY created_at DESC LIMIT 1`,[row.id,identity.inputFingerprint,row.project_sha256,identity.sourceId,item.sourceContentHash])).rows[0];
  const decision=prepared?(await c.query('SELECT decision FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1 AND candidate_id=$2',[row.id,prepared.candidate_id])).rows[0]:null;
  if(!prepared||decision?.decision==='rejected')throw new ConfigurationError(409,'候选采用准备已失效，请保留当前编辑并重新比较。');
  const edit=prepared.edit as WorkspaceCandidateEdit;
  if(edit.mainVoice&&resolveWorkspaceMainVoice(document,edit.mainVoice.shotId).item?.id!==item.id)throw new ConfigurationError(409,'候选未成为实际口播主声，请重新比较。');
  if(item.src!==edit.source.src||item.id!==edit.targetItemId)throw new ConfigurationError(409,'候选目标或来源已变化，请重新比较。');
  yield {item,edit,candidateId:prepared.candidate_id as string,inputFingerprint:identity.inputFingerprint};
 }
}
