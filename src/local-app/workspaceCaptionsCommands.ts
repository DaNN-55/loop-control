import {workspaceCaptionFieldErrors} from '../workspaceCaptionValidation.js';
import {episodeStorageLocationAtRoot,requireEpisodeStorageDirectory,requireWritableEpisodeStorage} from './episodeStorageLocation.js';
import {readUsedWorkspaceNarrationVersions} from './workspaceCandidates.js';
import {resolveWorkspaceMainVoice} from '../workspaceAudio.js';
import {readWorkspaceShotWindow} from '../workspaceShots.js';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {applyWorkspaceCaptionEdit,readWorkspaceCaption,setWorkspaceCaptionText,type WorkspaceCaptionState} from '../workspaceCaptions.js';
import {defaultShotCaptionContract,isValidShotCaptionContract,normalizeShotCaptionContract,shotCaptionContractToDatabase,type ShotCaptionContract} from '../shotCaptions.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {isOpenChatCutStudio} from '../worker/openchatcutStudio.js';
import {probeMp3Artifact} from '../worker/mediaTools.js';
import {verifyEpisodeFile,resolveEpisodeFileReference} from './episodeFiles.js';
import {ConfigurationError} from './configurationCommands.js';
import {readProductionWorkspace,updateWorkspaceProject,type ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
const fingerprint=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const comparable=(v:string)=>v.replace(/\s/gu,'');
async function captionContext(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,clipId:unknown){
 await requireEpisodeStorageDirectory(c,await episodeStorageLocationAtRoot(c,root,row.episode_id));
 const clip=row.bindings.find(b=>b.id===clipId);if(!clip)throw new ConfigurationError(404,'当前片段不存在。');
 const window=readWorkspaceShotWindow(project,clip.itemId),timeline=window?.timeline,item=window?{...window.item,startFrame:window.startFrame,durationInFrames:window.durationInFrames}:undefined;if(!timeline||!item)throw new ConfigurationError(409,'片段已从当前工程删除。');
 const draft=(await c.query('SELECT * FROM public.shot_preparation_drafts WHERE episode_id=$1 AND review_package_id=$2 AND shot_id=$3',[row.episode_id,row.storyboard_package_id,clip.shotId])).rows[0];
 const lane=readWorkspaceCaption(project,clip.itemId),route=resolveWorkspaceMainVoice(project,clip.shotId);
 const contract=lane?.contract??normalizeShotCaptionContract(draft?.caption_contract,{enabled:draft?.subtitles_enabled??true,text:draft?.subtitle_text??clip.text,audioMode:draft?.audio_mode==='source'||route.item?.id===`workspace-source-shot-${clip.shotId}`?'source':undefined});
 const narration=(await c.query('SELECT clip_id FROM local_identity.workspace_narrations WHERE workspace_id=$1 AND shot_id=$2',[row.id,clip.shotId])).rows[0];
 const nativeAudio=route.item??(!route.explicitRoute?timeline.items.find(i=>i.id===`workspace-narration-${narration?.clip_id??clip.id}`):undefined),nativeTrack=typeof nativeAudio?.sourceAssetId==='string'&&nativeAudio.sourceAssetId.startsWith('audio-track-')?nativeAudio.sourceAssetId.slice(12):null;
 const audioId=nativeTrack??(!route.explicitRoute&&draft?.audio_mode!=='none'?draft?.current_audio_track_id:null),audio=audioId?(await c.query('SELECT * FROM public.audio_tracks WHERE id=$1 AND episode_id=$2',[audioId,row.episode_id])).rows[0]:null;
 if(audio)try{await verifyEpisodeFile(c,root,row.episode_id,audio.relative_path,audio.sha256,Number(audio.file_size));}catch{throw new ConfigurationError(409,'当前字幕音轨不可用或指纹已变化。');}
 const usedNarration=route.explicitRoute?(await readUsedWorkspaceNarrationVersions(c,row,project)).find(n=>n.shotId===clip.shotId):null,followText=route.explicitRoute?usedNarration?.text??null:draft?.tts_text??null;
 const voiceItems=timeline.items.filter(i=>i===nativeAudio||!route.explicitRoute&&draft?.audio_mode==='source'&&i.id===clip.itemId).map(i=>({id:i.id,src:i.src,sourceAssetId:i.sourceAssetId,sourceContentHash:i.sourceContentHash,sourceRevision:i.sourceRevision,startFrame:i.startFrame,durationInFrames:i.durationInFrames,srcInFrame:i.srcInFrame,playbackRate:i.playbackRate,edits:i.edits}));
 const inputFingerprint=fingerprint({version:'workspace-caption-input/v1',workspaceId:row.id,shotId:clip.shotId,text:contract.text,followText:contract.contentMode==='follow_tts'?followText:null,audioTrackId:audio?.id??null,audioSha256:audio?.sha256??null,startFrame:item.startFrame,durationInFrames:item.durationInFrames,fps:timeline.fps,voiceItems});
 return{route,clip,timeline,item,draft,lane,contract,audio,followText,inputFingerprint,laneFingerprint:fingerprint(lane?.words??[])};
}
export async function readWorkspaceCaptions(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject):Promise<WorkspaceCaptionState[]>{
 const records=(await c.query('SELECT * FROM local_identity.workspace_caption_evidence WHERE workspace_id=$1',[row.id])).rows;
 const states:WorkspaceCaptionState[]=[];
 const seen=new Set<string>();
 for(const clip of row.bindings){if(seen.has(clip.shotId))continue;seen.add(clip.shotId);if(!project.timelines.some(t=>t.items.some(i=>i.id===clip.itemId)))continue;const x=await captionContext(c,root,row,project,clip.id),e=records.find(r=>r.shot_id===clip.shotId),current=e?.input_fingerprint===x.inputFingerprint&&e?.lane_fingerprint===x.laneFingerprint,task=e?.task_id?(await c.query('SELECT status,last_result FROM public.tasks WHERE id=$1 AND episode_id=$2',[e.task_id,row.episode_id])).rows[0]:null;
  states.push({clipId:clip.id,itemId:clip.itemId,shotId:clip.shotId,durationMs:Math.round(Number(x.item.durationInFrames)*1000/x.timeline.fps),contract:x.contract,inputFingerprint:x.inputFingerprint,timing:!x.contract.enabled?'missing':current&&e.method==='waiting'?['failed','blocked','superseded'].includes(task?.status)?'failed':'waiting':!x.lane?.words.length?'missing':current?'current':'stale',textConfirmed:!!(current&&e?.confirmed_at),audioTrackId:x.audio?.id??null,narrationText:x.followText,taskId:e?.task_id??null,alignmentInputVersion:e?.alignment_input_version??null,detail:x.route.explicitRoute&&x.route.item?.id===`workspace-source-shot-${x.clip.shotId}`&&!x.route.alignmentReady?(x.route.coverage==='partial'?'原声仅覆盖部分镜头；字幕可独立校时，整段声学对齐不可用。':'原声音轨已裁切或变速；请重新提取区间或手工校时。'):task&&['failed','blocked'].includes(task.status)?task.last_result?.blockers?.[0]?.detail??'对齐未完成，可重试或手工校时。':null});
 }
 return states;
}
async function recordEvidence(c:PoolClient,row:ProductionWorkspaceRecord,clipId:string,input:string,lane:string,method:string,taskId:string|null=null,alignment:string|null=null){
 await c.query(`INSERT INTO local_identity.workspace_caption_evidence(workspace_id,clip_id,shot_id,input_fingerprint,lane_fingerprint,method,task_id,alignment_input_version) VALUES($1,$2,$8,$3,$4,$5,$6,$7)
 ON CONFLICT(workspace_id,shot_id) DO UPDATE SET clip_id=excluded.clip_id, input_fingerprint=excluded.input_fingerprint,lane_fingerprint=excluded.lane_fingerprint,method=excluded.method,task_id=excluded.task_id,alignment_input_version=excluded.alignment_input_version,
 confirmed_by=CASE WHEN workspace_caption_evidence.input_fingerprint=excluded.input_fingerprint AND workspace_caption_evidence.lane_fingerprint=excluded.lane_fingerprint THEN workspace_caption_evidence.confirmed_by END,
 confirmed_at=CASE WHEN workspace_caption_evidence.input_fingerprint=excluded.input_fingerprint AND workspace_caption_evidence.lane_fingerprint=excluded.lane_fingerprint THEN workspace_caption_evidence.confirmed_at END`,[row.id,clipId,input,lane,method,taskId,alignment,row.bindings.find(b=>b.id===clipId)!.shotId]);
}
/** First assembly seeds frozen subtitles as editable native lanes; later opens preserve native edits. */
export async function assembleWorkspaceCaptions(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject){
 if((await c.query("SELECT 1 FROM local_identity.production_workspace_versions WHERE workspace_id=$1 AND reason='保存原生剪辑' LIMIT 1",[row.id])).rowCount)return project;
 let next=project;const seen=new Set<string>();
 for(const clip of row.bindings){
  if(seen.has(clip.shotId)||readWorkspaceCaption(next,clip.itemId))continue;seen.add(clip.shotId);
  const x=await captionContext(c,root,row,next,clip.id);if(!x.contract.enabled||!x.contract.text.trim())continue;
  const contract={...x.contract,cues:x.contract.cues.length?x.contract.cues:[{id:`initial-${clip.shotId}`,text:x.contract.text,startMs:0,endMs:Math.round(Number(x.item.durationInFrames)*1000/x.timeline.fps)}]};
  next=applyWorkspaceCaptionEdit(next,clip.itemId,contract);
 }
 return next;
}
/** A native save adopts actual cue edits without claiming that a human reviewed the text. */
export async function syncNativeWorkspaceCaptions(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject){
 const records=(await c.query('SELECT * FROM local_identity.workspace_caption_evidence WHERE workspace_id=$1',[row.id])).rows;
 const seen=new Set<string>();
 for(const clip of row.bindings){
  if(seen.has(clip.shotId)||!project.timelines.some(t=>t.items.some(i=>i.id===clip.itemId)))continue;seen.add(clip.shotId);
  const lane=readWorkspaceCaption(project,clip.itemId);
  // Removing a managed lane in the editor disables that shot's inherited subtitle input.
  if(!lane){await c.query('SELECT local_identity.save_workspace_caption_input($1,$2,$3)',[row.id,clip.id,shotCaptionContractToDatabase({...defaultShotCaptionContract(clip.text,'independent',false),enabled:false,contentMode:'independent',cues:[]})]);continue;}
  if(!lane||!lane.contract.enabled)continue;
  let x:Awaited<ReturnType<typeof captionContext>>;
  try{
   x=await captionContext(c,root,row,project,clip.id);
   if(!x.contract.cues.length||lane.words.length!==x.contract.cues.length)continue;
   validateCues(x.contract,Number(x.item.durationInFrames)*1000/x.timeline.fps);
  }catch{continue;} // Invalid or unavailable inputs remain visible to the export checks.
  const old=records.find(e=>e.shot_id===clip.shotId);
  if(old?.input_fingerprint===x.inputFingerprint&&old?.lane_fingerprint===x.laneFingerprint)continue;
  // An audio/shot change alone is not evidence of manually retiming unchanged cues.
  if(old&&old.input_fingerprint!==x.inputFingerprint&&old.lane_fingerprint===x.laneFingerprint)continue;
  await recordEvidence(c,row,clip.id,x.inputFingerprint,x.laneFingerprint,'manual',old?.input_fingerprint===x.inputFingerprint?old.task_id:null,old?.input_fingerprint===x.inputFingerprint?old.alignment_input_version:null);
 }
}
/** Final-file approval reviews the current rendered text once for the whole episode. */
export async function confirmWorkspaceCaptionTexts(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject){
 const states=await readWorkspaceCaptions(c,root,row,project);
 for(const state of states.filter(s=>s.contract.enabled)){
  if(state.timing!=='current')throw new ConfigurationError(409,'字幕时序已变化，请重新检查当前工程。');
  await c.query('UPDATE local_identity.workspace_caption_evidence SET confirmed_by=local_identity.owner_id(),confirmed_at=clock_timestamp() WHERE workspace_id=$1 AND shot_id=$2 AND input_fingerprint=$3',[row.id,state.shotId,state.inputFingerprint]);
 }
}
export async function executeWorkspaceCaptionCommand(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,runtime:{postReady?(kind:'alignment'):Promise<void>;wake?(id:string):void},command:string,data:Record<string,unknown>){
 await requireWritableEpisodeStorage(c,root,row.episode_id);
 let x=await captionContext(c,root,row,project,data.clipId);
 if(command==='setWorkspaceCaptionsEnabled'){
  if(typeof data.enabled!=='boolean')throw new ConfigurationError(400,'字幕开关无效。');
  if(isOpenChatCutStudio(row.episode_id))throw new ConfigurationError(409,'请先退出剪辑工作台，再修改字幕开关。');
  const contract={...x.contract,enabled:data.enabled};
  const next=data.enabled&&!contract.cues.length?setWorkspaceCaptionText(project,x.clip.itemId,contract,contract.text,x.route.item):applyWorkspaceCaptionEdit(project,x.clip.itemId,contract);
  const saved=readWorkspaceCaption(next,x.clip.itemId)!.contract;
  await c.query('SELECT local_identity.save_workspace_caption_input($1,$2,$3)',[row.id,x.clip.id,shotCaptionContractToDatabase({...saved,contentMode:'independent'})]);
  return updateWorkspaceProject(c,root,row,next,row.bindings,data.enabled?'启用镜头字幕':'关闭镜头字幕',{nativeEdit:true});
 }
 if(command==='saveWorkspaceNarrationCaptions'){
  if(isOpenChatCutStudio(row.episode_id))throw new ConfigurationError(409,'请先退出剪辑工作台，再修改分镜台字幕。');
  const mode=data.contentMode;
  if(mode!=='follow_tts'&&mode!=='independent')throw new ConfigurationError(400,'请选择字幕模式。');
  if(mode==='independent'&&(typeof data.text!=='string'||!data.text.trim()||data.text.length>100000))throw new ConfigurationError(400,'请填写有效的字幕正文。');
  const voice=x.route.item?.id===`workspace-narration-shot-${x.clip.shotId}`?x.route.item:undefined;
  if(mode==='follow_tts'&&data.text!==undefined&&(typeof data.text!=='string'||!data.text.trim()||data.text.length>100000))throw new ConfigurationError(400,'口播文案无效。');
  const text=mode==='independent'?String(data.text):voice&&x.followText?.trim()?x.followText:typeof data.text==='string'?data.text:x.followText??x.contract.text;
  const next=setWorkspaceCaptionText(project,x.clip.itemId,{...x.contract,enabled:true,contentMode:mode},text,mode==='follow_tts'?voice:undefined);
  const saved=readWorkspaceCaption(next,x.clip.itemId)!.contract;
  await c.query('SELECT local_identity.save_workspace_caption_input($1,$2,$3)',[row.id,x.clip.id,shotCaptionContractToDatabase({...saved,contentMode:'independent'})]);
  return updateWorkspaceProject(c,root,row,next,row.bindings,'修改口播字幕');
 }
 if(command==='saveWorkspaceCaptions'){
  const errors=workspaceCaptionFieldErrors(data.captionContract,Number(x.item.durationInFrames)*1000/x.timeline.fps);
  if(Object.keys(errors).length)throw new ConfigurationError(400,Object.values(errors).join(' '));
  if(!isValidShotCaptionContract(data.captionContract))throw new ConfigurationError(400,'字幕正文、布局或时序无效。');const contract=data.captionContract;
  if(contract.text.length>100000||contract.cues.length>1000||new Set(contract.cues.map(cue=>cue.id)).size!==contract.cues.length)throw new ConfigurationError(400,'字幕正文或字幕条目数量无效。');
  if(contract.contentMode==='follow_tts'&&(x.route.explicitRoute&&x.route.item?.id!==`workspace-narration-shot-${x.clip.shotId}`||(!x.route.explicitRoute&&x.draft?.audio_mode!=='tts')||x.followText!==contract.text))throw new ConfigurationError(409,'跟随口播须采用当前口播正文，请刷新后重试。');
  validateCues(contract,Number(x.item.durationInFrames)*1000/x.timeline.fps);
  if(data.nativeApplied!==undefined&&typeof data.nativeApplied!=='boolean')throw new ConfigurationError(400,'原生字幕保存状态无效。');
  const next=applyWorkspaceCaptionEdit(project,x.clip.itemId,contract);
  if(isOpenChatCutStudio(row.episode_id)){
   if(data.nativeApplied!==true||JSON.stringify(readWorkspaceCaption(project,x.clip.itemId)?.contract)!==JSON.stringify(contract))throw new ConfigurationError(409,'请先将字幕修改保存到当前编辑器。');
  }
  await c.query('SELECT local_identity.save_workspace_caption_input($1,$2,$3)',[row.id,x.clip.id,shotCaptionContractToDatabase(x.route.explicitRoute&&contract.contentMode==='follow_tts'?{...contract,contentMode:'independent'}:contract)]);
  if(x.audio&&contract.cues.length&&(!x.route.explicitRoute||x.route.alignmentReady)){const duration=await probeMp3Artifact(await resolveEpisodeFileReference(c,await episodeStorageLocationAtRoot(c,root,row.episode_id),x.audio.relative_path));if(contract.cues.some(cue=>cue.endMs>duration*1000+1))throw new ConfigurationError(400,'字幕时序超出当前实际音轨。');if(!x.route.explicitRoute)await c.query('SELECT public.save_shot_manual_alignment($1,$2,$3,$4)',[row.episode_id,row.storyboard_package_id,x.clip.shotId,JSON.stringify(shotCaptionContractToDatabase(contract).cues)]);}
  const finalProject=isOpenChatCutStudio(row.episode_id)?project:next;
  x=await captionContext(c,root,row,finalProject,x.clip.id);
  await recordEvidence(c,row,x.clip.id,x.inputFingerprint,x.laneFingerprint,'manual',null,x.draft?.acoustic_alignment?.inputVersion??null);
  return updateWorkspaceProject(c,root,row,finalProject,row.bindings,'编辑字幕',{nativeEdit:true});
 }
 if(command==='requestWorkspaceCaptionAlignment'){
  if(x.route.explicitRoute&&!x.route.alignmentReady){const label=x.route.item?.id===`workspace-source-shot-${x.clip.shotId}`?'原声':'主声';throw new ConfigurationError(409,x.route.coverage==='partial'?`${label}仅覆盖部分镜头，不能执行整段声学对齐；请按当前镜头明确调整音轨或手工校时。`:`${label}音轨已裁切或变速，请重新提取所选区间或手工校时。`);}
  if(!x.audio||!x.draft||(!x.route.explicitRoute&&x.draft.current_audio_track_id!==x.audio.id)||!x.contract.enabled)throw new ConfigurationError(409,'请先采用当前成功口播或原声音轨，再对齐字幕。');
  if(data.localOnly!==undefined&&typeof data.localOnly!=='boolean')throw new ConfigurationError(400,'对齐策略无效。');
  if(!runtime.postReady)throw new ConfigurationError(503,'本地对齐执行环境尚未就绪。');await runtime.postReady('alignment');
  await c.query('SELECT local_identity.save_workspace_caption_input($1,$2,$3)',[row.id,x.clip.id,shotCaptionContractToDatabase(x.route.explicitRoute&&x.contract.contentMode==='follow_tts'?{...x.contract,contentMode:'independent'}:x.contract)]);
  await c.query('UPDATE local_identity.input_episodes SET alignment_enabled=true WHERE episode_id=$1',[row.episode_id]);
  const task=x.route.explicitRoute?(await c.query('SELECT to_jsonb(local_identity.request_workspace_caption_alignment($1,$2,$3,$4,$5,$6,$7)) result',[row.episode_id,row.storyboard_package_id,x.clip.shotId,data.localOnly??true,x.audio.id,x.contract.text,row.id])).rows[0].result:(await c.query('SELECT to_jsonb(public.request_shot_acoustic_alignment($1,$2,$3,$4)) result',[row.episode_id,row.storyboard_package_id,x.clip.shotId,data.localOnly??true])).rows[0].result;
  await recordEvidence(c,row,x.clip.id,x.inputFingerprint,x.laneFingerprint,'waiting',task.id,task.input_snapshot.acoustic_alignment.input_version);
  return{workspace:await readProductionWorkspace(c,row.episode_id,root),task};
 }
 if(command==='applyWorkspaceCaptionAlignment'||command==='prepareWorkspaceCaptionAlignment'){
  if(command==='applyWorkspaceCaptionAlignment'&&isOpenChatCutStudio(row.episode_id)&&data.nativeApplied!==true)throw new ConfigurationError(409,'请先保存并返回，再采用声学对齐结果。');
  const e=(await c.query('SELECT * FROM local_identity.workspace_caption_evidence WHERE workspace_id=$1 AND shot_id=$2',[row.id,x.clip.shotId])).rows[0],task=typeof data.taskId==='string'?(await c.query('SELECT * FROM public.tasks WHERE id=$1 AND episode_id=$2',[data.taskId,row.episode_id])).rows[0]:null,alignment=x.route.explicitRoute?task?.last_result?.acousticAlignment:x.draft?.acoustic_alignment;
  if(!e||e.task_id!==data.taskId||e.input_fingerprint!==x.inputFingerprint||data.expectedInputFingerprint!==x.inputFingerprint||!task||task.status!=='completed'||task.task_type!=='align_shot_captions'||alignment?.status!=='completed'||alignment.inputVersion!==task.input_snapshot.acoustic_alignment.input_version||alignment.textFingerprint!==createHash('sha256').update(x.contract.text).digest('hex')||alignment.audioSha256!==x.audio?.sha256)throw new ConfigurationError(409,'对齐结果已过期或尚未完成，请按当前正文和音轨重新对齐。');
  const artifact=(await c.query("SELECT * FROM public.artifacts WHERE producer_task_id=$1 AND episode_id=$2 AND artifact_type='acoustic_alignment_evidence'",[task.id,row.episode_id])).rows[0];if(!artifact)throw new ConfigurationError(409,'对齐证据文件不存在。');await verifyEpisodeFile(c,root,row.episode_id,artifact.relative_path,artifact.sha256,Number(artifact.file_size));
  const alignedInput={...x.contract,cues:alignment.cues};validateCues(alignedInput,Number(x.item.durationInFrames)*1000/x.timeline.fps);
  const contract=normalizeShotCaptionContract(alignedInput,{enabled:x.contract.enabled,text:x.contract.text});
  if(command==='prepareWorkspaceCaptionAlignment')return{captionContract:contract};
  if(data.nativeApplied!==undefined&&typeof data.nativeApplied!=='boolean')throw new ConfigurationError(400,'原生字幕保存状态无效。');
  const aligned=applyWorkspaceCaptionEdit(project,x.clip.itemId,contract,{timingOnly:true});
  if(data.nativeApplied===true&&JSON.stringify(readWorkspaceCaption(project,x.clip.itemId)?.contract.cues)!==JSON.stringify(readWorkspaceCaption(aligned,x.clip.itemId)?.contract.cues))throw new ConfigurationError(409,'对齐结果尚未保存到当前编辑器。');
  const next=data.nativeApplied===true?project:aligned;
  x=await captionContext(c,root,row,next,x.clip.id);await recordEvidence(c,row,x.clip.id,x.inputFingerprint,x.laneFingerprint,'alignment',task.id,alignment.inputVersion);return updateWorkspaceProject(c,root,row,next,row.bindings,'采用当前字幕对齐',{nativeEdit:true});
 }
 if(command==='confirmWorkspaceCaptionText'){
  const e=(await c.query('SELECT * FROM local_identity.workspace_caption_evidence WHERE workspace_id=$1 AND shot_id=$2',[row.id,x.clip.shotId])).rows[0];
  if(x.contract.contentMode==='follow_tts'&&(!x.audio||x.route.explicitRoute&&x.route.item?.id!==`workspace-narration-shot-${x.clip.shotId}`))throw new ConfigurationError(409,'请先采用当前口播音轨，再核对跟随字幕。');
  if(!x.contract.enabled||!x.lane?.words.length||!e||e.method==='waiting'||data.expectedInputFingerprint!==x.inputFingerprint||e.input_fingerprint!==x.inputFingerprint||e.lane_fingerprint!==x.laneFingerprint)throw new ConfigurationError(409,'正文、音轨或字幕时序已变化，请重新校时后核对。');
  if(x.audio&&!x.route.explicitRoute)await c.query('SELECT local_identity.confirm_caption_text($1,$2,$3,$4,$5,$6,$7)',[row.episode_id,row.storyboard_package_id,x.clip.shotId,x.audio.id,x.audio.sha256,createHash('sha256').update(x.contract.text).digest('hex'),x.draft.acoustic_alignment?.inputVersion]);
  await c.query('UPDATE local_identity.workspace_caption_evidence SET confirmed_by=local_identity.owner_id(),confirmed_at=clock_timestamp() WHERE workspace_id=$1 AND shot_id=$2',[row.id,x.clip.shotId]);return readProductionWorkspace(c,row.episode_id,root);
 }
 throw new ConfigurationError(400,'字幕操作无效。');
}
function validateCues(contract:ShotCaptionContract,duration:number){
 let previous=0;for(const cue of contract.cues){if(!cue.text.trim()||cue.id.length>200||cue.startMs<previous||cue.endMs>duration+1)throw new ConfigurationError(400,'字幕条目重叠或超出当前镜头窗口。');previous=cue.endMs;}
 if(contract.cues.length&&comparable(contract.cues.map(c=>c.text).join(''))!==comparable(contract.text))throw new ConfigurationError(400,'字幕时序正文与当前字幕不一致，请重新校时。');
}
