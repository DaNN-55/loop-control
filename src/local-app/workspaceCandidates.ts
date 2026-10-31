import {episodeFileIO} from './episodeFiles.js';
import {episodeStorageLocationAtRoot} from './episodeStorageLocation.js';
import {resolveWorkspaceShotLineage} from './workspacePreparation.js';
import {inspectWorkspaceVisualFile} from './workspaceVisualMedia.js';
import {resolveWorkspaceMainVoice} from '../workspaceAudio.js';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {applyWorkspaceCandidate,workspaceCandidateTarget,workspaceCandidateVoiceRoute,workspaceCandidateDurationFrames,type WorkspaceCandidate,type WorkspaceCandidateEdit,type WorkspaceUsedNarration} from '../workspaceCandidates.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {probeMp3Artifact,inspectMp4Artifact} from '../worker/mediaTools.js';
import {isOpenChatCutStudio,registerOpenChatCutStudioSource,inspectOpenChatCutStoredProject} from '../worker/openchatcutStudio.js';
import {readWorkspaceNarration,workspaceNarrationItemId,validateSpeechParameters} from './workspaceNarration.js';
import {ConfigurationError} from './configurationCommands.js';
import {verifyEpisodeFile,resolveEpisodeFileReference} from './episodeFiles.js';
import {resolveWorkspaceSource} from './workspaceSources.js';
import {readProductionWorkspace,updateWorkspaceProject,type ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
export async function readWorkspaceCandidates(c:PoolClient,row:ProductionWorkspaceRecord,project:OpenChatCutProject):Promise<WorkspaceCandidate[]>{
 const main=(await c.query('SELECT context_snapshot FROM public.review_packages WHERE id=$1',[row.storyboard_package_id])).rows[0]?.context_snapshot?.worker_result?.storyboard?.shots??[];
 const narration=await readWorkspaceNarration(c,row,project),decisions=(await c.query('SELECT * FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1',[row.id])).rows;
 const results=(await c.query(`SELECT r.*,t.input_snapshot,a.id,a.relative_path,a.sha256,a.file_size,a.duration_seconds FROM local_identity.workspace_narration_requests r JOIN public.tasks t ON t.id=r.task_id AND t.status='completed' JOIN public.audio_tracks a ON a.source_task_id=t.id AND a.episode_id=r.episode_id AND a.track_kind='narration' WHERE r.workspace_id=$1 ORDER BY r.created_at DESC`,[row.id])).rows;
 return Promise.all(results.map(async r=>{
  const n=narration.find(n=>n.shotId===r.shot_id),clip=row.bindings.find(b=>b.shotId===r.shot_id),ids=new Set(row.bindings.filter(b=>b.shotId===r.shot_id).map(b=>b.itemId)),timeline=project.timelines.find(t=>t.items.some(i=>ids.has(String(i.id)))),target=timeline?.items.find(i=>i.id===workspaceNarrationItemId(r.shot_id)),route=resolveWorkspaceMainVoice(project,r.shot_id),visuals=timeline?.items.filter(i=>ids.has(String(i.id)))??[],d=decisions.find(d=>d.candidate_id===r.id);
  const mode=route.item?.id===workspaceNarrationItemId(r.shot_id)?'tts':route.item?'source':'none',start=mode==='tts'&&target?Number(target.startFrame):Math.min(...visuals.map(i=>Number(i.startFrame))),window=mode==='tts'&&target?Number(target.durationInFrames):Math.max(...visuals.map(i=>Number(i.startFrame)+Number(i.durationInFrames)))-start,fps=timeline?.fps??30;
  return{...(r.request_snapshot?.selectionVersion===1?{speech:{selection:r.request_snapshot.selection,connectionName:r.request_snapshot.connection?.name,voice:r.input_snapshot.media.narration.voice.name,languageCode:r.input_snapshot.media.narration.voice.language_code,speakingRate:Number(r.input_snapshot.media.narration.voice.speaking_rate)}}:{}),id:r.id,kind:'audio',shotId:r.shot_id,clipId:clip?.id??r.clip_id,targetItemId:workspaceNarrationItemId(r.shot_id),taskId:r.task_id,inputFingerprint:r.input_fingerprint,text:r.input_snapshot?.media?.narration?.text??'',mainScriptText:(await resolveWorkspaceShotLineage(c,row,r.shot_id,r.input_snapshot?.storyboard_review_package_id??row.storyboard_package_id).catch(()=>null))?.baseline_text??main.find((s:{id:string})=>s.id===r.shot_id)?.scriptSegment??'',audioTrackId:r.id,relativePath:r.relative_path,sha256:r.sha256,fileSize:Number(r.file_size),durationSeconds:Number(r.duration_seconds),pendingConfirmation:!d&&mode==='tts'&&target?.sourceAssetId===`audio-track-${r.id}`&&!!target?.loopControlCandidate,currentVoiceMode:mode,currentDurationSeconds:route.item?Number(route.item.durationInFrames)/fps:null,targetDurationSeconds:window/fps,...(timeline&&Number.isFinite(window)?{durationImpact:{deltaSeconds:Number(r.duration_seconds)-window/fps,overlapItemIds:timeline.items.filter(i=>Math.ceil(Number(r.duration_seconds)*fps)>window&&i.id!==target?.id&&Number(i.startFrame)>=start+window&&Number(i.startFrame)<start+Math.ceil(Number(r.duration_seconds)*fps)).map(i=>String(i.id))}}:{}),status:mode==='tts'&&target?.sourceAssetId===`audio-track-${r.id}`?'adopted':d?.decision==='rejected'?'rejected':(r.request_snapshot?.selectionVersion===1?r.request_snapshot.target?.scriptRevisionId===row.script_revision_id&&!!clip&&n?.text===r.input_snapshot?.media?.narration?.text:n?.inputFingerprint===r.input_fingerprint)?'available':'stale'};
 }));
}
export async function prepareRegisteredWorkspaceCandidate(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,candidate:WorkspaceCandidate,durationPolicy:unknown){
 if(isOpenChatCutStudio(row.episode_id)){const native=await inspectOpenChatCutStoredProject(root,row.episode_id,await episodeFileIO(c,root,row.episode_id));if(!native)throw new ConfigurationError(409,'当前原生工程不可读取，请先保存并重新比较。');project=native.project;}
 if(candidate.status!=='available')throw new ConfigurationError(409,'候选已过期或已有决定，请读取当前版本。');
 if(!['keep-target','use-candidate'].includes(String(durationPolicy)))throw new ConfigurationError(400,'请明确选择保留目标时长或采用候选时长。');
 const source=await resolveWorkspaceSource(c,root,row.episode_id,candidate.relativePath);if(source.sha256!==candidate.sha256||Number(source.file_size)!==candidate.fileSize)throw new ConfigurationError(409,'候选源身份已变化。');
 await verifyEpisodeFile(c,root,row.episode_id,candidate.relativePath,candidate.sha256,candidate.fileSize);
 const observed=candidate.kind==='image'?(await inspectWorkspaceVisualFile(root,candidate.relativePath,'image'),candidate.durationSeconds):candidate.kind==='audio'?await probeMp3Artifact(await resolveEpisodeFileReference(c,await episodeStorageLocationAtRoot(c,root,row.episode_id),candidate.relativePath)):(await inspectMp4Artifact(await resolveEpisodeFileReference(c,await episodeStorageLocationAtRoot(c,root,row.episode_id),candidate.relativePath))).durationSeconds;
 if(Math.abs(observed-candidate.durationSeconds)>0.05)throw new ConfigurationError(409,'候选实际时长与登记不同。');
 let explicitSpeech=false;
 if(candidate.kind==='audio'){const frozen=(await c.query('SELECT t.input_snapshot FROM public.tasks t JOIN local_identity.workspace_narration_requests r ON r.task_id=t.id WHERE r.workspace_id=$1 AND t.id=$2',[row.id,candidate.taskId])).rows[0]?.input_snapshot;if(frozen?.selectionVersion===1){explicitSpeech=true;const voice=frozen.media.narration.voice;validateSpeechParameters(frozen.production_selection,voice.name,voice.language_code,Number(voice.speaking_rate));}}
 const item=project.timelines.flatMap(t=>t.items).find(i=>i.id===candidate.targetItemId),canonical=candidate.kind==='audio'&&candidate.targetItemId===workspaceNarrationItemId(candidate.shotId),ids=new Set(row.bindings.filter(b=>b.shotId===candidate.shotId).map(b=>b.itemId)),timelines=project.timelines.filter(t=>t.items.some(v=>ids.has(String(v.id))));
 if(!item&&!canonical)throw new ConfigurationError(409,'候选目标已删除。');
 if(timelines.length!==1)throw new ConfigurationError(409,'镜头画面跨时间线或已删除，请重新读取。');
 const timeline=timelines[0],visuals=timeline.items.filter(v=>ids.has(String(v.id))),start=Math.min(...visuals.map(v=>Number(v.startFrame))),end=Math.max(...visuals.map(v=>Number(v.startFrame)+Number(v.durationInFrames))),route=resolveWorkspaceMainVoice(project,candidate.shotId),activate=route.item?.id!==candidate.targetItemId;
 if(explicitSpeech&&durationPolicy==='keep-target'&&Math.ceil(observed*timeline.fps)>(activate?end-start:Number(item!.durationInFrames)))throw new ConfigurationError(409,'完整口播长于当前画面窗口，请采用候选时长后补充画面或拆镜；不会截断口播。');
 const edit:WorkspaceCandidateEdit={...(candidate.visual?{visual:candidate.visual}:{}),shotWindow:{startFrame:start,durationInFrames:end-start},...(canonical?{mainVoice:{workspaceId:row.id,shotId:candidate.shotId,visualItemIds:[...ids],expectedRoute:workspaceCandidateVoiceRoute(project,candidate.shotId,[...ids]),activate,volume:Number(route.item?.volume??1),window:activate?{startFrame:start,durationInFrames:end-start}:{startFrame:Number(item!.startFrame),durationInFrames:Number(item!.durationInFrames)}}}:{}),targetItemId:candidate.targetItemId,expectedTarget:item?workspaceCandidateTarget(item):null,durationPolicy:durationPolicy as WorkspaceCandidateEdit['durationPolicy'],source:{id:candidate.audioTrackId?`audio-track-${candidate.audioTrackId}`:`candidate-${candidate.id}`,kind:candidate.kind,width:candidate.width,height:candidate.height,src:candidate.relativePath,sha256:candidate.sha256,inputFingerprint:candidate.inputFingerprint,durationSeconds:candidate.visual?.sourceOutSeconds!==undefined?candidate.visual.sourceOutSeconds-(candidate.visual.sourceInSeconds??0):candidate.durationSeconds,...(candidate.visual?.sourceInSeconds!==undefined?{sourceInSeconds:candidate.visual.sourceInSeconds,fullDurationSeconds:candidate.durationSeconds}:{})}};
 try{applyWorkspaceCandidate(project,edit);}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'采用输入无效。');}
 const id=randomUUID();await c.query('INSERT INTO local_identity.workspace_candidate_adoptions(id,workspace_id,candidate_id,input_fingerprint,project_sha256,edit) VALUES($1,$2,$3,$4,$5,$6)',[id,row.id,candidate.id,candidate.inputFingerprint,row.project_sha256,JSON.stringify(edit)]);
 const nativeEdit=structuredClone(edit);if(isOpenChatCutStudio(row.episode_id)){nativeEdit.source.src=await registerOpenChatCutStudioSource(root,row.episode_id,candidate.relativePath,candidate.sha256,candidate.fileSize,await episodeFileIO(c,root,row.episode_id,true));if(typeof nativeEdit.expectedTarget?.src==='string'){const current=await resolveWorkspaceSource(c,root,row.episode_id,nativeEdit.expectedTarget.src);nativeEdit.expectedTarget.src=await registerOpenChatCutStudioSource(root,row.episode_id,nativeEdit.expectedTarget.src,current.sha256,Number(current.file_size),await episodeFileIO(c,root,row.episode_id,true));}if(nativeEdit.mainVoice){const routes=JSON.parse(nativeEdit.mainVoice.expectedRoute);for(const route of routes)for(const voice of route.voices)if(typeof voice.src==='string'){const current=await resolveWorkspaceSource(c,root,row.episode_id,voice.src);voice.src=await registerOpenChatCutStudioSource(root,row.episode_id,voice.src,current.sha256,Number(current.file_size),await episodeFileIO(c,root,row.episode_id,true));}nativeEdit.mainVoice.expectedRoute=JSON.stringify(routes);}}
 return{adoptionId:id,candidateId:candidate.id,edit:nativeEdit};
}
export async function executeWorkspaceCandidateCommand(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,command:string,data:Record<string,unknown>){
 const candidates=await readWorkspaceCandidates(c,row,project),candidate=candidates.find(v=>v.id===data.candidateId);if(!candidate)throw new ConfigurationError(404,'本工作空间候选不存在。');
 if(command==='prepareWorkspaceCandidate')return prepareRegisteredWorkspaceCandidate(c,root,row,project,candidate,data.durationPolicy);
 if(command==='rejectWorkspaceCandidate'){
 if(candidate.status==='adopted')throw new ConfigurationError(409,'当前已采用版本不能作为未用候选拒绝。');
 await decision(c,row,candidate,'rejected');return readProductionWorkspace(c,row.episode_id,root);
 }
 if(command!=='adoptWorkspaceCandidate')throw new ConfigurationError(400,'候选操作无效。');
 const current=(await readWorkspaceNarration(c,row,project)).find(n=>n.shotId===candidate.shotId);const frozen=(await c.query('SELECT request_snapshot FROM local_identity.workspace_narration_requests WHERE task_id=$1 AND workspace_id=$2',[candidate.taskId,row.id])).rows[0]?.request_snapshot;if(frozen?.selectionVersion===1?(current?.text!==candidate.text||frozen.target?.scriptRevisionId!==row.script_revision_id):current?.inputFingerprint!==candidate.inputFingerprint)throw new ConfigurationError(409,'口播正文已变化，请重新生成当前候选。');
 await finishRegisteredWorkspaceCandidate(c,root,row,project,candidate,data);
 await c.query('UPDATE local_identity.workspace_narrations SET adopted_audio_track_id=$3 WHERE workspace_id=$1 AND shot_id=$2',[row.id,candidate.shotId,candidate.audioTrackId]);
 return readProductionWorkspace(c,row.episode_id,root);
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
 await decision(c,row,candidate,'adopted');
}
async function decision(c:PoolClient,row:ProductionWorkspaceRecord,candidate:WorkspaceCandidate,decision:'adopted'|'rejected'){
 const current=(await c.query('SELECT project_sha256 FROM local_identity.production_workspaces WHERE id=$1',[row.id])).rows[0];
 await c.query('INSERT INTO local_identity.workspace_candidate_decisions(workspace_id,candidate_id,decision,text_version,main_script_text,input_fingerprint,source_sha256,project_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[row.id,candidate.id,decision,candidate.text,candidate.mainScriptText,candidate.inputFingerprint,candidate.sha256,current.project_sha256]);
}

/** Delivery metadata follows actual native use, never the mutable narration draft. */
export async function readUsedWorkspaceNarrationVersions(c:PoolClient,row:ProductionWorkspaceRecord,project:OpenChatCutProject){
 const results:WorkspaceUsedNarration[]=[];
 for(const clip of row.bindings.filter((b,index,all)=>all.findIndex(v=>v.shotId===b.shotId)===index)){
  const route=resolveWorkspaceMainVoice(project,clip.shotId),item=route.item??(!route.explicitRoute?project.timelines.flatMap(t=>t.items.filter(i=>Number(i.volume??1)>0&&(t.tracks[String(i.track)] as {muted?:boolean}|undefined)?.muted!==true)).find(i=>i.id===`workspace-narration-${clip.id}`):undefined);if(!item||typeof item.src!=='string')continue;
  const track=(await c.query(`SELECT a.*,t.input_snapshot FROM public.audio_tracks a LEFT JOIN public.tasks t ON t.id=a.source_task_id WHERE a.episode_id=$1 AND a.relative_path=$2 AND a.track_kind='narration'`,[row.episode_id,item.src])).rows[0];if(!track||item.sourceContentHash&&item.sourceContentHash!==track.sha256)continue;
  const adoption=(await c.query("SELECT * FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1 AND candidate_id=$2 AND decision='adopted' AND source_sha256=$3",[row.id,track.id,track.sha256])).rows[0],identity=(item.loopControlCandidate as {inputFingerprint?:string}|undefined)?.inputFingerprint;
  const decision=adoption&&(!identity||adoption.input_fingerprint===identity)?adoption:null,text=decision?.text_version??track.input_snapshot?.media?.narration?.text??null;
  const fps=project.timelines.find(t=>t.items.includes(item))!.fps;
  results.push({sourceInFrame:Number(item.srcInFrame??0),durationInFrames:Number(item.durationInFrames),fps,fullSourceUsed:!item.edits&&Number(item.playbackRate??1)===1&&Number(item.srcInFrame??0)===0&&Number(item.durationInFrames)>=Math.ceil(Number(track.duration_seconds)*fps),shotId:clip.shotId,itemId:String(item.id),audioTrackId:track.id,sha256:track.sha256,taskId:track.source_task_id??null,text,mainScriptText:decision?.main_script_text??(await resolveWorkspaceShotLineage(c,row,clip.shotId)).baseline_text,inputFingerprint:decision?.input_fingerprint??null,provenance:decision?'owner_adoption':text?'immutable_task':'not_recorded'});
 }
 return results;
}
/** A pending native relink must still own its prepared input at the LC save boundary. */
export async function validateWorkspaceCandidateUses(c:PoolClient,row:ProductionWorkspaceRecord,baseline:OpenChatCutProject,document:OpenChatCutProject){
 const previous=baseline.timelines.flatMap(t=>t.items),narrations=await readWorkspaceNarration(c,row,document);
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
  if(edit.source.kind==='audio'&&String(item.id).startsWith('workspace-narration-')){
   const current=narrations.find(n=>n.itemId===item.id),candidate=(await readWorkspaceCandidates(c,row,document)).find(c=>c.id===prepared.candidate_id),request=(await c.query('SELECT request_snapshot FROM local_identity.workspace_narration_requests WHERE workspace_id=$1 AND task_id=$2',[row.id,candidate?.taskId])).rows[0]?.request_snapshot;const compatible=request?.selectionVersion===1?current?.text===candidate?.text&&request.target?.scriptRevisionId===row.script_revision_id:current?.inputFingerprint===identity.inputFingerprint&&current?.audioTrackId===prepared.candidate_id;if(!current||!candidate||!compatible||!['available','adopted'].includes(candidate.status)||candidate.inputFingerprint!==identity.inputFingerprint)throw new ConfigurationError(409,'口播正文或候选已变化，旧候选未保存；请撤销本地替换或重新比较。');
  }
 }
}
