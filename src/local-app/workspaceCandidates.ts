import {prepareRegisteredWorkspaceCandidate,finishRegisteredWorkspaceCandidate,recordWorkspaceCandidateDecision,pendingWorkspaceCandidateUses} from './workspaceCandidateAdoption.js';
import {resolveWorkspaceShotLineage} from './workspacePreparation.js';
import {resolveWorkspaceMainVoice} from '../workspaceAudio.js';
import type {PoolClient} from 'pg';
import type {WorkspaceCandidate,WorkspaceUsedNarration} from '../workspaceCandidates.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {readWorkspaceNarration,restoreWorkspaceNarrationDraft,workspaceNarrationItemId} from './workspaceNarration.js';
import {isOpenChatCutStudio} from '../worker/openchatcutStudio.js';
import {ConfigurationError} from './configurationCommands.js';
import {readProductionWorkspace,type ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
export async function readWorkspaceCandidates(c:PoolClient,row:ProductionWorkspaceRecord,project:OpenChatCutProject):Promise<WorkspaceCandidate[]>{
 const main=(await c.query('SELECT context_snapshot FROM public.review_packages WHERE id=$1',[row.storyboard_package_id])).rows[0]?.context_snapshot?.worker_result?.storyboard?.shots??[];
 const narration=await readWorkspaceNarration(c,row,project),decisions=(await c.query('SELECT * FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1',[row.id])).rows;
 const results=(await c.query(`SELECT r.*,t.input_snapshot,a.id,a.relative_path,a.sha256,a.file_size,a.duration_seconds FROM local_identity.workspace_narration_requests r JOIN public.tasks t ON t.id=r.task_id AND t.status='completed' JOIN public.audio_tracks a ON a.source_task_id=t.id AND a.episode_id=r.episode_id AND a.track_kind='narration' WHERE r.workspace_id=$1 ORDER BY r.created_at DESC`,[row.id])).rows;
 return Promise.all(results.map(async r=>{
  const n=narration.find(n=>n.shotId===r.shot_id),clip=row.bindings.find(b=>b.shotId===r.shot_id),ids=new Set(row.bindings.filter(b=>b.shotId===r.shot_id).map(b=>b.itemId)),timeline=project.timelines.find(t=>t.items.some(i=>ids.has(String(i.id)))),target=timeline?.items.find(i=>i.id===workspaceNarrationItemId(r.shot_id)),route=resolveWorkspaceMainVoice(project,r.shot_id),visuals=timeline?.items.filter(i=>ids.has(String(i.id)))??[],d=decisions.find(d=>d.candidate_id===r.id);
  const mode=route.item?.id===workspaceNarrationItemId(r.shot_id)?'tts':route.item?'source':'none',start=mode==='tts'&&target?Number(target.startFrame):Math.min(...visuals.map(i=>Number(i.startFrame))),window=mode==='tts'&&target?Number(target.durationInFrames):Math.max(...visuals.map(i=>Number(i.startFrame)+Number(i.durationInFrames)))-start,fps=timeline?.fps??30;
  const savedText=r.input_snapshot?.media?.narration?.text??'',generated=r.request_snapshot?.selectionVersion===1;
  const sameScript=r.request_snapshot?.target?.scriptRevisionId===row.script_revision_id&&!!clip;
  const status=n?.adoptedAudioTrackId===r.id?'adopted':d?.decision==='rejected'?'rejected':(generated?sameScript&&n?.text===savedText:n?.inputFingerprint===r.input_fingerprint)?'available':'stale';
  const canRestoreNarration=status==='stale'&&sameScript&&!!n&&(generated||r.request_snapshot?.manualUpload===true);
  return{...(r.request_snapshot?.selectionVersion===1?{speech:{selection:r.request_snapshot.selection,connectionName:r.request_snapshot.connection?.name,voice:r.input_snapshot.media.narration.voice.name,languageCode:r.input_snapshot.media.narration.voice.language_code,speakingRate:Number(r.input_snapshot.media.narration.voice.speaking_rate)}}:{}),id:r.id,kind:'audio',shotId:r.shot_id,clipId:clip?.id??r.clip_id,targetItemId:workspaceNarrationItemId(r.shot_id),taskId:r.task_id,inputFingerprint:r.input_fingerprint,text:r.input_snapshot?.media?.narration?.text??'',mainScriptText:(await resolveWorkspaceShotLineage(c,row,r.shot_id,r.input_snapshot?.storyboard_review_package_id??row.storyboard_package_id).catch(()=>null))?.baseline_text??main.find((s:{id:string})=>s.id===r.shot_id)?.scriptSegment??'',audioTrackId:r.id,relativePath:r.relative_path,sha256:r.sha256,fileSize:Number(r.file_size),durationSeconds:Number(r.duration_seconds),pendingConfirmation:!d&&mode==='tts'&&target?.sourceAssetId===`audio-track-${r.id}`&&!!target?.loopControlCandidate,currentVoiceMode:mode,currentDurationSeconds:route.item?Number(route.item.durationInFrames)/fps:null,targetDurationSeconds:window/fps,...(timeline&&Number.isFinite(window)?{durationImpact:{deltaSeconds:Number(r.duration_seconds)-window/fps,overlapItemIds:timeline.items.filter(i=>Math.ceil(Number(r.duration_seconds)*fps)>window&&i.id!==target?.id&&Number(i.startFrame)>=start+window&&Number(i.startFrame)<start+Math.ceil(Number(r.duration_seconds)*fps)).map(i=>String(i.id))}}:{}),status,...(canRestoreNarration?{canRestoreNarration}:{})};
 }));
}
export async function executeWorkspaceCandidateCommand(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,command:string,data:Record<string,unknown>){
 const candidates=await readWorkspaceCandidates(c,row,project),candidate=candidates.find(v=>v.id===data.candidateId);if(!candidate)throw new ConfigurationError(404,'本工作空间候选不存在。');
 if(command==='rejectWorkspaceCandidate'){
 if(candidate.status==='adopted')throw new ConfigurationError(409,'当前已采用版本不能作为未用候选拒绝。');
 await recordWorkspaceCandidateDecision(c,row,candidate,'rejected');return readProductionWorkspace(c,row.episode_id,root);
 }
 const current=(await readWorkspaceNarration(c,row,project)).find(n=>n.shotId===candidate.shotId);
 if(current?.enabled===false)throw new ConfigurationError(409,'请先启用口播，再采用候选。');
 const restoring=data.restoreNarration===true;
 if(data.restoreNarration!==undefined&&typeof data.restoreNarration!=='boolean')throw new ConfigurationError(400,'恢复口播参数无效。');
 if(restoring&&(!candidate.canRestoreNarration||!current||isOpenChatCutStudio(row.episode_id)||data.nativeApplied===true))throw new ConfigurationError(409,'旧口播已无法按此次核对恢复，请重新读取候选。');
 const selected=restoring?{...candidate,status:'available' as const}:candidate;
 const restoreFingerprint=restoring?current!.inputFingerprint:undefined;
 if(command==='prepareWorkspaceCandidate'){
  const prepared=await prepareRegisteredWorkspaceCandidate(c,root,row,project,selected,data.durationPolicy,restoreFingerprint);
  return restoring?{...prepared,restoration:{currentText:current!.text,restoredText:candidate.text}}:prepared;
 }
 if(command!=='adoptWorkspaceCandidate')throw new ConfigurationError(400,'候选操作无效。');
 const frozen=(await c.query('SELECT request_snapshot FROM local_identity.workspace_narration_requests WHERE task_id=$1 AND workspace_id=$2',[candidate.taskId,row.id])).rows[0]?.request_snapshot;
 if(!restoring&&(frozen?.selectionVersion===1?(current?.text!==candidate.text||frozen.target?.scriptRevisionId!==row.script_revision_id):current?.inputFingerprint!==candidate.inputFingerprint))throw new ConfigurationError(409,'口播正文已变化，请重新核对旧候选。');
 if(restoring&&!data.adoptionId)throw new ConfigurationError(409,'请先核对要恢复的口播。');
 await finishRegisteredWorkspaceCandidate(c,root,row,project,selected,data,restoreFingerprint,restoring?()=>restoreWorkspaceNarrationDraft(c,row,candidate):undefined);
 await c.query('UPDATE local_identity.workspace_narrations SET adopted_audio_track_id=$3 WHERE workspace_id=$1 AND shot_id=$2',[row.id,candidate.shotId,candidate.audioTrackId]);
 return readProductionWorkspace(c,row.episode_id,root);
}
/** Delivery metadata follows actual native use, never the mutable narration draft. */
export async function readUsedWorkspaceNarrationVersions(c:PoolClient,row:ProductionWorkspaceRecord,project:OpenChatCutProject){
 const results:WorkspaceUsedNarration[]=[];
 for(const clip of row.bindings.filter((b,index,all)=>all.findIndex(v=>v.shotId===b.shotId)===index)){
  const route=resolveWorkspaceMainVoice(project,clip.shotId),item=route.item??(!route.explicitRoute?project.timelines.flatMap(t=>t.items.filter(i=>Number(i.volume??1)>0&&(t.tracks[String(i.track)] as {muted?:boolean}|undefined)?.muted!==true)).find(i=>i.id===`workspace-narration-${clip.id}`):undefined);if(!item||typeof item.src!=='string')continue;
  const track=(await c.query(`SELECT a.*,t.input_snapshot FROM public.audio_tracks a LEFT JOIN public.tasks t ON t.id=a.source_task_id WHERE a.episode_id=$1 AND a.relative_path=$2 AND a.track_kind='narration' AND ($3::uuid IS NULL OR a.id=$3)`,[row.episode_id,item.src,typeof item.sourceAssetId==='string'&&item.sourceAssetId.startsWith('audio-track-')?item.sourceAssetId.slice(12):null])).rows[0];if(!track||item.sourceContentHash&&item.sourceContentHash!==track.sha256)continue;
  const adoption=(await c.query("SELECT * FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1 AND candidate_id=$2 AND decision='adopted' AND source_sha256=$3",[row.id,track.id,track.sha256])).rows[0],identity=(item.loopControlCandidate as {inputFingerprint?:string}|undefined)?.inputFingerprint;
  const decision=adoption&&(!identity||adoption.input_fingerprint===identity)?adoption:null,text=decision?.text_version??track.input_snapshot?.media?.narration?.text??null;
  const fps=project.timelines.find(t=>t.items.includes(item))!.fps;
  results.push({sourceInFrame:Number(item.srcInFrame??0),durationInFrames:Number(item.durationInFrames),fps,fullSourceUsed:!item.edits&&Number(item.playbackRate??1)===1&&Number(item.srcInFrame??0)===0&&Number(item.durationInFrames)>=Math.ceil(Number(track.duration_seconds)*fps),shotId:clip.shotId,itemId:String(item.id),audioTrackId:track.id,sha256:track.sha256,taskId:track.source_task_id??null,text,mainScriptText:decision?.main_script_text??(await resolveWorkspaceShotLineage(c,row,clip.shotId)).baseline_text,inputFingerprint:decision?.input_fingerprint??null,provenance:decision?'owner_adoption':text?'immutable_task':'not_recorded'});
 }
 return results;
}
/** Speech-specific inputs remain independent of shared adoption evidence. */
export async function validateWorkspaceCandidateUses(c:PoolClient,row:ProductionWorkspaceRecord,baseline:OpenChatCutProject,document:OpenChatCutProject){
 const narrations=await readWorkspaceNarration(c,row,document);
 for await(const {item,edit,candidateId,inputFingerprint} of pendingWorkspaceCandidateUses(c,row,baseline,document)){
  if(edit.source.kind==='audio'&&String(item.id).startsWith('workspace-narration-')){
   const current=narrations.find(n=>n.itemId===item.id),candidate=(await readWorkspaceCandidates(c,row,document)).find(c=>c.id===candidateId),request=(await c.query('SELECT request_snapshot FROM local_identity.workspace_narration_requests WHERE workspace_id=$1 AND task_id=$2',[row.id,candidate?.taskId])).rows[0]?.request_snapshot;const compatible=request?.selectionVersion===1?current?.text===candidate?.text&&request.target?.scriptRevisionId===row.script_revision_id:current?.inputFingerprint===inputFingerprint&&current?.audioTrackId===candidateId;if(!current||!candidate||!compatible||!['available','adopted'].includes(candidate.status)||candidate.inputFingerprint!==inputFingerprint)throw new ConfigurationError(409,'口播正文或候选已变化，旧候选未保存；请撤销本地替换或重新比较。');
  }
 }
}
