import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {applyWorkspaceCandidate,workspaceCandidateTarget,type WorkspaceCandidate,type WorkspaceCandidateEdit,type WorkspaceUsedNarration} from '../workspaceCandidates.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {probeMp3Artifact,inspectMp4Artifact} from '../worker/mediaTools.js';
import {isOpenChatCutStudio,registerOpenChatCutStudioSource} from '../worker/openchatcutStudio.js';
import {readWorkspaceNarration,workspaceNarrationItemId} from './workspaceNarration.js';
import {ConfigurationError} from './configurationCommands.js';
import {verifyNativeFile} from './localFiles.js';
import {resolveWorkspaceSource} from './workspaceSources.js';
import {readProductionWorkspace,updateWorkspaceProject,type ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
export async function readWorkspaceCandidates(c:PoolClient,row:ProductionWorkspaceRecord,project:OpenChatCutProject):Promise<WorkspaceCandidate[]>{
 const main=(await c.query('SELECT context_snapshot FROM public.review_packages WHERE id=$1',[row.storyboard_package_id])).rows[0]?.context_snapshot?.worker_result?.storyboard?.shots??[];
 const narration=await readWorkspaceNarration(c,row,project),decisions=(await c.query('SELECT * FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1',[row.id])).rows;
 const results=(await c.query(`SELECT r.*,t.input_snapshot,a.id,a.relative_path,a.sha256,a.file_size,a.duration_seconds FROM local_identity.workspace_narration_requests r JOIN public.tasks t ON t.id=r.task_id AND t.status='completed' JOIN public.audio_tracks a ON a.source_task_id=t.id AND a.episode_id=r.episode_id AND a.track_kind='narration' WHERE r.workspace_id=$1 ORDER BY r.created_at DESC`,[row.id])).rows;
 return results.map(r=>{const n=narration.find(n=>n.shotId===r.shot_id),clip=row.bindings.find(b=>b.shotId===r.shot_id),target=project.timelines.flatMap(t=>t.items.filter(i=>i.id===workspaceNarrationItemId(r.shot_id)).map(item=>({item,fps:t.fps,timeline:t})))[0],d=decisions.find(d=>d.candidate_id===r.id);return{id:r.id,kind:'audio',shotId:r.shot_id,clipId:clip?.id??r.clip_id,targetItemId:workspaceNarrationItemId(r.shot_id),taskId:r.task_id,inputFingerprint:r.input_fingerprint,text:r.input_snapshot?.media?.narration?.text??'',mainScriptText:main.find((s:{id:string})=>s.id===r.shot_id)?.scriptSegment??clip?.text??'',audioTrackId:r.id,relativePath:r.relative_path,sha256:r.sha256,fileSize:Number(r.file_size),durationSeconds:Number(r.duration_seconds),pendingConfirmation:!d&&target?.item.sourceAssetId===`audio-track-${r.id}`&&!!target?.item.loopControlCandidate,currentDurationSeconds:target?Number(target.item.durationInFrames)/target.fps:null,...(target?{durationImpact:{deltaSeconds:Number(r.duration_seconds)-Number(target.item.durationInFrames)/target.fps,overlapItemIds:target.timeline.items.filter(i=>Math.ceil(Number(r.duration_seconds)*target.fps)>Number(target.item.durationInFrames)&&i.id!==target.item.id&&Number(i.startFrame)<Number(target.item.startFrame)+Math.ceil(Number(r.duration_seconds)*target.fps)&&Number(i.startFrame)+Number(i.durationInFrames)>Number(target.item.startFrame)+Number(target.item.durationInFrames)).map(i=>String(i.id))}}:{}),status:d?.decision??(target?.item.sourceAssetId===`audio-track-${r.id}`?'adopted':n?.inputFingerprint===r.input_fingerprint?'available':'stale')};});
}
export async function prepareRegisteredWorkspaceCandidate(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,candidate:WorkspaceCandidate,durationPolicy:unknown){
 if(candidate.status!=='available')throw new ConfigurationError(409,'候选已过期或已有决定，请读取当前版本。');
 if(!['keep-target','use-candidate'].includes(String(durationPolicy)))throw new ConfigurationError(400,'请明确选择保留目标时长或采用候选时长。');
 const source=await resolveWorkspaceSource(c,root,row.episode_id,candidate.relativePath);if(source.sha256!==candidate.sha256||Number(source.file_size)!==candidate.fileSize)throw new ConfigurationError(409,'候选源身份已变化。');
 await verifyNativeFile(root,candidate.relativePath,candidate.sha256,candidate.fileSize);
 const observed=candidate.kind==='audio'?await probeMp3Artifact(join(root,candidate.relativePath)):(await inspectMp4Artifact(join(root,candidate.relativePath))).durationSeconds;
 if(Math.abs(observed-candidate.durationSeconds)>0.05)throw new ConfigurationError(409,'候选实际时长与登记不同。');
 const item=project.timelines.flatMap(t=>t.items).find(i=>i.id===candidate.targetItemId);if(!item)throw new ConfigurationError(409,'目标主声尚未建立，请先在素材准备采用首次口播。');
 const edit:WorkspaceCandidateEdit={targetItemId:candidate.targetItemId,expectedTarget:workspaceCandidateTarget(item),durationPolicy:durationPolicy as WorkspaceCandidateEdit['durationPolicy'],source:{id:candidate.audioTrackId?`audio-track-${candidate.audioTrackId}`:`candidate-${candidate.id}`,kind:candidate.kind,src:candidate.relativePath,sha256:candidate.sha256,inputFingerprint:candidate.inputFingerprint,durationSeconds:candidate.durationSeconds}};
 try{applyWorkspaceCandidate(project,edit);}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'采用输入无效。');}
 const id=randomUUID();await c.query('INSERT INTO local_identity.workspace_candidate_adoptions(id,workspace_id,candidate_id,input_fingerprint,project_sha256,edit) VALUES($1,$2,$3,$4,$5,$6)',[id,row.id,candidate.id,candidate.inputFingerprint,row.project_sha256,JSON.stringify(edit)]);
 const nativeEdit=structuredClone(edit);if(isOpenChatCutStudio(row.episode_id)){nativeEdit.source.src=await registerOpenChatCutStudioSource(root,row.episode_id,candidate.relativePath,candidate.sha256,candidate.fileSize);if(typeof nativeEdit.expectedTarget.src==='string'){const current=await resolveWorkspaceSource(c,root,row.episode_id,nativeEdit.expectedTarget.src);nativeEdit.expectedTarget.src=await registerOpenChatCutStudioSource(root,row.episode_id,nativeEdit.expectedTarget.src,current.sha256,Number(current.file_size));}}
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
 const current=(await readWorkspaceNarration(c,row,project)).find(n=>n.shotId===candidate.shotId);if(current?.inputFingerprint!==candidate.inputFingerprint)throw new ConfigurationError(409,'口播正文已变化，请重新生成当前候选。');
 await finishRegisteredWorkspaceCandidate(c,root,row,project,candidate,data);
 await c.query('UPDATE local_identity.workspace_narrations SET adopted_audio_track_id=$3 WHERE workspace_id=$1 AND shot_id=$2',[row.id,candidate.shotId,candidate.audioTrackId]);
 return readProductionWorkspace(c,row.episode_id,root);
}
export async function finishRegisteredWorkspaceCandidate(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,candidate:WorkspaceCandidate,data:Record<string,unknown>){
 if(data.adoptionId!==undefined&&(typeof data.adoptionId!=='string'||!/^[a-f0-9-]{36}$/.test(data.adoptionId))||data.nativeApplied!==undefined&&typeof data.nativeApplied!=='boolean')throw new ConfigurationError(400,'采用身份无效。');
 const prepared=(await c.query('SELECT * FROM local_identity.workspace_candidate_adoptions WHERE workspace_id=$1 AND candidate_id=$2 AND ($3::text IS NULL OR id::text=$3) ORDER BY created_at DESC LIMIT 1',[row.id,candidate.id,data.adoptionId??null])).rows[0];
 if(!prepared||candidate.status==='rejected'||candidate.status==='stale'||prepared.input_fingerprint!==candidate.inputFingerprint)throw new ConfigurationError(409,'采用身份已失效，请重新比较当前候选。');
 await verifyNativeFile(root,candidate.relativePath,candidate.sha256,candidate.fileSize);
 const edit=prepared.edit as WorkspaceCandidateEdit;
 if(isOpenChatCutStudio(row.episode_id)||data.nativeApplied===true){
 const item=project.timelines.flatMap(t=>t.items).find(i=>i.id===edit.targetItemId);if(data.nativeApplied!==true||!item||item.sourceAssetId!==edit.source.id||item.src!==candidate.relativePath||item.sourceContentHash!==candidate.sha256||item.sourceRevision!==`source-sha256-${candidate.sha256}`||(item.loopControlCandidate as {inputFingerprint?:string}|undefined)?.inputFingerprint!==candidate.inputFingerprint||Number(item.srcInFrame??0)!==0||Number(item.playbackRate??1)!==1||Number(item.durationInFrames)!==(edit.durationPolicy==='use-candidate'?Math.ceil(candidate.durationSeconds*project.timelines.find(t=>t.items.includes(item))!.fps):edit.expectedTarget.durationInFrames))throw new ConfigurationError(409,'请先将此候选保存到当前原生编辑器。');
 }else{
 if(prepared.project_sha256!==row.project_sha256)throw new ConfigurationError(409,'工程已变化，请重新比较后采用。');
 let next;try{next=applyWorkspaceCandidate(project,edit);}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'采用未完成。');}
 await updateWorkspaceProject(c,root,row,next,row.bindings,'采用局部口播候选');
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
  const item=project.timelines.flatMap(t=>t.items).find(i=>i.id===workspaceNarrationItemId(clip.shotId)||i.id===`workspace-narration-${clip.id}`);if(!item||typeof item.src!=='string')continue;
  const track=(await c.query(`SELECT a.*,t.input_snapshot FROM public.audio_tracks a LEFT JOIN public.tasks t ON t.id=a.source_task_id WHERE a.episode_id=$1 AND a.relative_path=$2 AND a.track_kind='narration'`,[row.episode_id,item.src])).rows[0];if(!track||item.sourceContentHash&&item.sourceContentHash!==track.sha256)continue;
  const adoption=(await c.query("SELECT * FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1 AND candidate_id=$2 AND decision='adopted' AND source_sha256=$3",[row.id,track.id,track.sha256])).rows[0],identity=(item.loopControlCandidate as {inputFingerprint?:string}|undefined)?.inputFingerprint;
  const decision=adoption&&(!identity||adoption.input_fingerprint===identity)?adoption:null,text=decision?.text_version??track.input_snapshot?.media?.narration?.text??null;
  const fps=project.timelines.find(t=>t.items.includes(item))!.fps;
  results.push({sourceInFrame:Number(item.srcInFrame??0),durationInFrames:Number(item.durationInFrames),fps,fullSourceUsed:!item.edits&&Number(item.playbackRate??1)===1&&Number(item.srcInFrame??0)===0&&Number(item.durationInFrames)>=Math.ceil(Number(track.duration_seconds)*fps),shotId:clip.shotId,itemId:String(item.id),audioTrackId:track.id,sha256:track.sha256,taskId:track.source_task_id??null,text,mainScriptText:decision?.main_script_text??clip.text,inputFingerprint:decision?.input_fingerprint??null,provenance:decision?'owner_adoption':text?'immutable_task':'not_recorded'});
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
  if(item.src!==edit.source.src||item.id!==edit.targetItemId)throw new ConfigurationError(409,'候选目标或来源已变化，请重新比较。');
  if(edit.source.kind==='audio'&&String(item.id).startsWith('workspace-narration-')){
   const current=narrations.find(n=>n.itemId===item.id);if(!current||current.inputFingerprint!==identity.inputFingerprint||current.audioTrackId!==prepared.candidate_id)throw new ConfigurationError(409,'口播正文或候选已变化，旧候选未保存；请撤销本地替换或重新比较。');
  }
 }
}
