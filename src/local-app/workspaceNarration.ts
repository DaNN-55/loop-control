import {episodeStorageLocationAtRoot,requireWritableEpisodeStorage} from './episodeStorageLocation.js';
import {creativeAccountRules} from '../creativeAccountRules.js';
import {resolveProductionSelection} from './productionSelection.js';
import {registeredAdapters} from '../worker/registeredAdapters.js';
import type {ProductionSelection} from '../productionSelection.js';
import {resolveWorkspaceShotLineage} from './workspacePreparation.js';
import {applyWorkspaceAudioMix,resolveWorkspaceMainVoice} from '../workspaceAudio.js';
import {isVideoProvider,videoProviders} from '../worker/videoProviderCatalog.js';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {WorkspaceNarration} from '../productionWorkspace.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import type {InputRuntime} from './episodeCommands.js';
import {productionHash} from './scriptProductionStore.js';
import {ConfigurationError} from './configurationCommands.js';
import {verifyEpisodeFile,resolveEpisodeFileReference} from './episodeFiles.js';
import {resolveWorkspaceSource} from './workspaceSources.js';
import {inspectMp4Artifact} from '../worker/mediaTools.js';
import {probeMp3Artifact} from '../worker/mediaTools.js';
import {isOpenChatCutStudio} from '../worker/openchatcutStudio.js';
import {type ProductionWorkspaceRecord,updateWorkspaceProject} from './productionWorkspaceCommands.js';
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const workspaceNarrationItemId=(shotId:string)=>`workspace-narration-shot-${shotId}`;
async function inputs(c:PoolClient,row:ProductionWorkspaceRecord){
 const selections=(await c.query('SELECT shot_id,selection FROM local_identity.workspace_narrations WHERE workspace_id=$1',[row.id])).rows;
 const drafts=(await c.query('SELECT * FROM public.shot_preparation_drafts WHERE episode_id=$1 AND review_package_id=$2',[row.episode_id,row.storyboard_package_id])).rows;
 return row.bindings.filter((clip,index,clips)=>clips.findIndex(c=>c.shotId===clip.shotId)===index).map(clip=>{const d=drafts.find(d=>d.shot_id===clip.shotId);return{clip,d,hash:fingerprint([row.script_revision_id,row.storyboard_package_id,clip.shotId,d?.audio_mode,d?.tts_text,...(d?.audio_mode==='source'?[d?.current_audio_track_id]:[d?.tts_voice,d?.tts_speaking_rate,d?.tts_language_code,...(selections.find(s=>s.shot_id===clip.shotId)?.selection?[selections.find(s=>s.shot_id===clip.shotId).selection]:[])])])};});
}
export async function readWorkspaceNarration(c:PoolClient,row:ProductionWorkspaceRecord,project?:OpenChatCutProject):Promise<WorkspaceNarration[]>{
 const context=(await c.query('SELECT b.policy,p.context_snapshot FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id JOIN public.review_packages p ON p.id=$2 WHERE e.id=$1',[row.episode_id,row.storyboard_package_id])).rows[0];
 const state=(await c.query(`SELECT n.*,t.status,t.last_result,a.id audio_track_id,a.source_artifact_id,a.relative_path,a.sha256,a.file_size,a.duration_seconds
 FROM local_identity.workspace_narrations n LEFT JOIN public.tasks t ON t.id=n.task_id
 LEFT JOIN public.audio_tracks a ON a.episode_id=n.episode_id AND (a.id=n.manual_audio_track_id OR (n.mode='tts' AND a.source_task_id=n.task_id AND a.track_kind='narration')) WHERE n.workspace_id=$1`,[row.id])).rows;
 const defaults=(await c.query('SELECT narration_defaults FROM local_identity.production_workspaces WHERE id=$1',[row.id])).rows[0]?.narration_defaults;
 const legacyTracks=project?.timelines.some(t=>t.items.some(i=>(i.loopControlAudio as {origin?:string}|undefined)?.origin==='legacy-frozen'))?(await c.query("SELECT a.*,t.input_snapshot FROM public.audio_tracks a LEFT JOIN public.tasks t ON t.id=a.source_task_id WHERE a.episode_id=$1 AND a.track_kind='narration'",[row.episode_id])).rows:[];
 return(await inputs(c,row)).map(({clip,d,hash})=>{const s=state.find(s=>s.shot_id===clip.shotId),current=s?.input_fingerprint===hash,track=current?s?.audio_track_id:null;
  const shot=context?.context_snapshot?.worker_result?.storyboard?.shots?.find((shot:{id:string})=>shot.id===clip.shotId),provider=context?.policy?.[shot?.shotType]?.executor?.provider,bounds=isVideoProvider(provider??'')?videoProviders[provider as keyof typeof videoProviders]:provider==='bailian'?{minDuration:2,maxDuration:15}:null;
  const fps=project?.timelines.find(t=>t.items.some(i=>i.id===clip.itemId))?.fps,duration=track&&fps?Math.ceil(Number(s.duration_seconds)*fps)/fps:null;
  const ids=new Set(row.bindings.filter(b=>b.shotId===clip.shotId).map(b=>b.itemId)),visuals=project?.timelines.flatMap(t=>t.items.filter(i=>ids.has(String(i.id))).map(i=>({start:Number(i.startFrame),end:Number(i.startFrame)+Number(i.durationInFrames),fps:t.fps,locked:!!(i.loopControlVideo as {durationLocked?:boolean}|undefined)?.durationLocked})))??[];
  const requiresCandidateAdoption=Number(row.native_edit_revision??0)>0||!!(track&&visuals.some(v=>v.locked)&&Math.max(...visuals.map(v=>v.end))-Math.min(...visuals.map(v=>v.start))!==Math.ceil(Number(s.duration_seconds)*visuals[0].fps));
  const nativeVoice=project?.timelines.flatMap(t=>t.items).find(i=>i.id===workspaceNarrationItemId(clip.shotId))??project?.timelines.flatMap(t=>t.items).find(i=>i.id===`workspace-narration-${s?.clip_id??clip.id}`),adopted=nativeVoice?.loopControlCandidate as {sourceId?:string;inputFingerprint?:string;durationPolicy?:string;startFrame?:number;durationInFrames?:number;shotWindow?:{startFrame:number;durationInFrames:number}}|undefined;
  // Adoption describes the current native main voice; the SQL pointer also retains historical decisions after replanning.
  const mainVoice=project?resolveWorkspaceMainVoice(project,clip.shotId).item:undefined,adoptedTrack=project?(mainVoice===nativeVoice&&typeof nativeVoice?.sourceAssetId==='string'&&nativeVoice.sourceAssetId.startsWith('audio-track-')?nativeVoice.sourceAssetId.slice('audio-track-'.length):null):s?.adopted_audio_track_id??null;
  const deliberate=!!(nativeVoice&&adopted?.sourceId===nativeVoice.sourceAssetId&&adopted?.inputFingerprint===hash&&['keep-target','use-candidate'].includes(adopted.durationPolicy??'')&&adopted.startFrame===nativeVoice.startFrame&&adopted.durationInFrames===nativeVoice.durationInFrames&&visuals.length&&adopted.shotWindow?.startFrame===Math.min(...visuals.map(v=>v.start))&&adopted.shotWindow?.durationInFrames===Math.max(...visuals.map(v=>v.end))-Math.min(...visuals.map(v=>v.start)));
  const legacyMeta=nativeVoice?.loopControlAudio as {origin?:string;text?:string}|undefined,inherited=!s&&legacyMeta?.origin==='legacy-frozen'?legacyTracks.find(a=>a.id===adoptedTrack&&a.relative_path===nativeVoice?.src):null;
  const conflict=!!(!deliberate&&track&&track===s?.adopted_audio_track_id&&nativeVoice?.sourceAssetId===`audio-track-${track}`&&visuals.length&&Math.max(...visuals.map(i=>i.end))-Math.min(...visuals.map(i=>i.start))!==Math.ceil(Number(s.duration_seconds)*visuals[0].fps));
  const windowWarning=s?.selection&&mainVoice&&visuals.length&&Number(mainVoice.durationInFrames)!==Math.max(...visuals.map(v=>v.end))-Math.min(...visuals.map(v=>v.start))?'实际口播与画面窗口时长不同，请调整画面或拆镜，并重新核对字幕。':null;
  return{windowWarning,selection:s?.selection??null,defaults:defaults??null,requiresCandidateAdoption,...(!s?.selection&&duration&&bounds?{videoWindow:{durationSeconds:duration,generationSeconds:Math.max(bounds.minDuration,Math.ceil(duration)),maximumSeconds:bounds.maxDuration}}:{}),clipId:clip.id,shotId:clip.shotId,mode:s?.mode??(inherited?'manual':'none'),text:d?.tts_text??inherited?.input_snapshot?.media?.narration?.text??legacyMeta?.text??clip.text,voice:d?.tts_voice??null,languageCode:d?.tts_language_code??null,speakingRate:d?.tts_speaking_rate?Number(d.tts_speaking_rate):null,override:!!d?.tts_override_voice,inputFingerprint:hash,confirmed:!!s&&s.confirmed_fingerprint===hash,taskId:s?.task_id??null,status:inherited?'completed':conflict?'duration_conflict':!current?'pending':s?.status??(s?.mode==='none'?'disabled':'pending'),error:conflict?'画面范围与完整口播时长不同，请明确调整画面或主声音轨。':s&&['failed','blocked'].includes(s.status)?s.last_result?.blockers?.[0]?.detail??s.last_result?.retry?.reason??null:null,audioTrackId:track??inherited?.id??null,artifactId:track?s.source_artifact_id:inherited?.source_artifact_id??null,relativePath:track?s.relative_path:inherited?.relative_path??null,sha256:track?s.sha256:inherited?.sha256??null,fileSize:track?Number(s.file_size):inherited?Number(inherited.file_size):null,durationSeconds:track?Number(s.duration_seconds):inherited?Number(inherited.duration_seconds):null,itemId:workspaceNarrationItemId(clip.shotId),adoptedAudioTrackId:adoptedTrack};});
}
export async function executeWorkspaceNarration(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,runtime:Pick<InputRuntime,'narrationReady'|'checkReferences'>,command:string,data:Record<string,unknown>){
 await requireWritableEpisodeStorage(c,root,row.episode_id);
 if(command==='saveWorkspaceNarrationDefaults'){
  const resolved=await resolveProductionSelection(c,data.selection,'speech');validateSpeechParameters(resolved.selection,data.voice,data.languageCode,data.speakingRate);
  await c.query('UPDATE local_identity.production_workspaces SET narration_defaults=$2 WHERE id=$1',[row.id,JSON.stringify({selection:resolved.selection,voice:data.voice,languageCode:data.languageCode,speakingRate:data.speakingRate})]);return;
 }
 if(command==='refreshWorkspaceNarration'){await adoptFirstWorkspaceNarration(c,root,row,project);return;}
 const clip=row.bindings.find(b=>b.id===data.clipId);if(!clip)throw new ConfigurationError(404,'镜头实例不存在。');
 if(command==='saveWorkspaceNarration'){
  if(!['tts','manual','none'].includes(String(data.mode))||typeof data.text!=='string'||data.text.length>100000||data.mode==='tts'&&!data.text.trim())throw new ConfigurationError(400,'口播配置无效。');
  if(data.voice!==undefined&&data.voice!==null&&(typeof data.voice!=='string'||!data.voice.trim()||data.voice.length>200)||data.speakingRate!==undefined&&data.speakingRate!==null&&(typeof data.speakingRate!=='number'||!Number.isFinite(data.speakingRate)||data.speakingRate<0.5||data.speakingRate>2))throw new ConfigurationError(400,'声音或语速无效。');
  if(data.mode==='manual'&&!(await c.query("SELECT 1 FROM public.audio_tracks WHERE episode_id=$1 AND id=$2 AND track_kind='narration'",[row.episode_id,data.audioTrackId??null])).rowCount)throw new ConfigurationError(409,'请选择已登记的本期人工口播音轨。');
  const selected=data.mode==='tts'?await resolveProductionSelection(c,data.selection,'speech'):null;
  if(selected){validateSpeechParameters(selected.selection,data.voice,data.languageCode,data.speakingRate);await c.query('SELECT local_identity.save_selected_workspace_narration($1,$2,$3,$4,$5,$6,$7)',[row.episode_id,row.storyboard_package_id,clip.shotId,data.text,data.voice,data.speakingRate,data.languageCode]);}
  else await c.query('SELECT local_identity.save_workspace_narration_draft($1,$2,$3,$4,$5,$6,$7)',[row.episode_id,row.storyboard_package_id,clip.shotId,data.mode==='manual'?'source':data.mode,data.text,data.voice??null,data.speakingRate??null]);
  if(data.mode==='manual')await c.query('SELECT local_identity.use_workspace_narration_track($1,$2,$3,$4)',[row.episode_id,row.storyboard_package_id,clip.shotId,data.audioTrackId]);
  if(data.mode==='none'){
   const items=project.timelines.flatMap(t=>t.items);if(items.some(i=>i.id===workspaceNarrationItemId(clip.shotId))){
    if(isOpenChatCutStudio(row.episode_id))throw new ConfigurationError(409,'请先保存并返回，再关闭口播。');
    for(const timeline of project.timelines)timeline.items=timeline.items.filter(i=>i.id!==workspaceNarrationItemId(clip.shotId));
    const mixed=applyWorkspaceAudioMix(project,{kind:'voice',workspaceId:row.id,shotId:clip.shotId,visualItemIds:row.bindings.filter(b=>b.shotId===clip.shotId).map(b=>b.itemId),mode:'none',gainDb:0,ambienceGainDb:null});await updateWorkspaceProject(c,root,row,mixed,row.bindings,'关闭镜头口播',{nativeEdit:true});
   }
  }
  const input=(await inputs(c,row)).find(i=>i.clip.shotId===clip.shotId)!;
  await c.query(`INSERT INTO local_identity.workspace_narrations(workspace_id,episode_id,clip_id,shot_id,mode,input_fingerprint,manual_audio_track_id,selection) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
   ON CONFLICT(workspace_id,shot_id) DO UPDATE SET mode=excluded.mode,input_fingerprint=excluded.input_fingerprint,confirmed_fingerprint=NULL,task_id=CASE WHEN workspace_narrations.input_fingerprint=excluded.input_fingerprint AND workspace_narrations.selection IS NOT DISTINCT FROM excluded.selection THEN workspace_narrations.task_id ELSE NULL END,manual_audio_track_id=excluded.manual_audio_track_id,selection=excluded.selection`,[row.id,row.episode_id,clip.id,clip.shotId,data.mode,input.hash,data.mode==='manual'?data.audioTrackId:null,selected?JSON.stringify(selected.selection):null]);
  if(selected){const updated=(await inputs(c,row)).find(i=>i.clip.shotId===clip.shotId)!;await c.query('UPDATE local_identity.workspace_narrations SET input_fingerprint=$3 WHERE workspace_id=$1 AND shot_id=$2',[row.id,clip.shotId,updated.hash]);}
  return;
 }
 const n=(await readWorkspaceNarration(c,row,project)).find(n=>n.shotId===clip.shotId)!;
 if(command==='confirmWorkspaceNarration'){
  if(!(await c.query('UPDATE local_identity.workspace_narrations SET confirmed_fingerprint=$3,input_fingerprint=$3,requested_project_sha256=$4,confirmed_match_fingerprint=$5,requested_native_edit_revision=$6 WHERE workspace_id=$1 AND shot_id=$2',[row.id,clip.shotId,n.inputFingerprint,row.project_sha256,fingerprint(clip.source),Number(row.native_edit_revision??0)])).rowCount)throw new ConfigurationError(409,'请先保存本镜口播设置。');return;
 }
 if(command==='adoptWorkspaceNarration'){
  if(data.inputFingerprint!==n.inputFingerprint||data.audioTrackId!==n.audioTrackId)throw new ConfigurationError(409,'口播输入或音轨已变化，请重新读取。');await adopt(c,root,row,project,n,true);return;
 }
 if(command!=='generateWorkspaceNarration')throw new ConfigurationError(400,'不支持的口播操作。');
 if(n.mode!=='tts'||!n.confirmed)throw new ConfigurationError(409,'请先保存并确认当前镜头匹配与口播。');
 if(data.retry!==undefined&&typeof data.retry!=='boolean')throw new ConfigurationError(400,'重试参数无效。');
 const authorized=(await c.query('SELECT p.* FROM local_identity.script_productions p WHERE p.episode_id=$1 AND p.script_revision_id=$2 AND p.enabled AND p.authorized_at IS NOT NULL',[row.episode_id,row.script_revision_id])).rows[0];
 if(!authorized)throw new ConfigurationError(409,'请先确认并授权本期制作计划。');
 if(n.selection){
  const active=await c.query(`SELECT 1 FROM local_identity.workspace_narration_requests r JOIN public.tasks t ON t.id=r.task_id LEFT JOIN local_identity.workspace_narration_submissions s ON s.task_id=t.id WHERE r.workspace_id=$1 AND r.shot_id=$2 AND ((t.status IN ('ready','running') AND r.input_fingerprint<>$3) OR (s.outcome IN ('started','received') AND t.status<>'completed'))`,[row.id,clip.shotId,n.inputFingerprint]);if(active.rowCount)throw new ConfigurationError(409,'上次口播仍在执行或提交结果未知；请先核对，不会重复发送。');
  const resolved=await resolveProductionSelection(c,n.selection,'speech');validateSpeechParameters(resolved.selection,n.voice,n.languageCode,n.speakingRate);
  if(typeof data.reservationCents!=='number'||!Number.isSafeInteger(data.reservationCents)||data.reservationCents<Math.max(1,n.text.length)||data.reservationCents>100000)throw new ConfigurationError(400,'请填写足够的本次口播费用预留（分）；按每字至少 1 分保守预留。');
  const budget=(await c.query("SELECT b.total_limit_cents,(SELECT coalesce(sum(r.reserved_cents),0) FROM public.paid_generation_reservations r WHERE r.account_id=e.account_id)+(SELECT coalesce(sum(t.budget_limit_cents),0) FROM public.tasks t JOIN public.episodes ep ON ep.id=t.episode_id WHERE ep.account_id=e.account_id AND t.task_type='generate_narration' AND t.status IN ('ready','running') AND NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations r WHERE r.task_id=t.id)) used FROM public.episodes e LEFT JOIN public.generation_account_budgets b ON b.account_id=e.account_id WHERE e.id=$1",[row.episode_id])).rows[0];
  if(!budget?.total_limit_cents||Number(budget.used)+data.reservationCents>budget.total_limit_cents)throw new ConfigurationError(409,'口播生成预算不足，请先允许账号生成额度。');
  if(!runtime.narrationReady)throw new ConfigurationError(503,'本地口播执行器未就绪。');await runtime.narrationReady();await runtime.checkReferences(c,[resolved.selection.connectionVersionId!]);
  const context=(await c.query('SELECT e.account_id,e.blueprint_version_id,e.series_version_id,b.policy,s.rules,s.series_id FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id LEFT JOIN public.series_versions s ON s.id=e.series_version_id WHERE e.id=$1',[row.episode_id])).rows[0];
  const snapshot={selectionVersion:1,selection:resolved.selection,connection:resolved.connection,execution:resolved.execution,inputFingerprint:n.inputFingerprint,authorizationHash:authorized.authorization_hash,reservationCents:data.reservationCents,context:{accountId:context.account_id,blueprintVersionId:context.blueprint_version_id,accountRules:creativeAccountRules(context.policy),seriesVersionId:context.series_version_id,seriesId:context.series_id,seriesRules:context.rules,text:n.text,voice:{name:n.voice,languageCode:n.languageCode,speakingRate:n.speakingRate}},target:{workspaceId:row.id,shotId:clip.shotId,clipId:clip.id,scriptRevisionId:row.script_revision_id,storyboardPackageId:row.storyboard_package_id,projectSha256:row.project_sha256,nativeEditRevision:Number(row.native_edit_revision??0),workspaceRevision:Number(row.revision)},costBasis:{reservationCents:data.reservationCents,kind:'owner_reservation',minimumCents:Math.max(1,n.text.length)}};
  const t=(await c.query('SELECT to_jsonb(local_identity.queue_selected_workspace_narration($1,$2,$3,$4)) result',[row.id,clip.shotId,JSON.stringify(snapshot),data.retry??false])).rows[0].result;
  await c.query('UPDATE local_identity.workspace_narrations SET task_id=$3,requested_project_sha256=$4,requested_native_edit_revision=$5 WHERE workspace_id=$1 AND shot_id=$2',[row.id,clip.shotId,t.id,row.project_sha256,Number(row.native_edit_revision??0)]);return;
 }
 if(data.retry!==true||!n.taskId||!(await c.query('SELECT 1 FROM local_identity.workspace_narration_requests WHERE task_id=$1 AND workspace_id=$2 AND input_fingerprint=$3',[n.taskId,row.id,n.inputFingerprint])).rowCount)throw new ConfigurationError(400,'请选择本次制作服务。');
 const e=(await c.query('SELECT b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[row.episode_id])).rows[0];
 if(authorized.plan?.executionFingerprint!==productionHash(e.policy))throw new ConfigurationError(409,'制作能力已变化，请重新确认本期授权。');
 const config=e.policy.narration;
 if(config?.execution_path!=='external'||config?.executor?.provider!=='volcengine_tts'||config.executor.adapter!=='volcengine_tts')throw new ConfigurationError(409,'当前口播能力为人工、关闭或不可执行。');
 const unresolved=await c.query(`SELECT 1 FROM local_identity.workspace_narration_requests r JOIN local_identity.workspace_narration_submissions s ON s.task_id=r.task_id JOIN public.tasks t ON t.id=r.task_id WHERE r.workspace_id=$1 AND r.shot_id=$2 AND s.outcome IN ('started','received') AND t.status<>'completed'`,[row.id,clip.shotId]);
 if(unresolved.rowCount)throw new ConfigurationError(409,'上次口播提交结果未核清，不会重复发送；请核对供应商记录。');
 if(!runtime.narrationReady)throw new ConfigurationError(503,'本地口播执行器未就绪。');await runtime.narrationReady();await runtime.checkReferences(c,[config.credential_ref]);
 await c.query('UPDATE local_identity.input_episodes SET narration_enabled=true WHERE episode_id=$1',[row.episode_id]);
 const t=(await c.query('SELECT to_jsonb(local_identity.generate_input_shot_tts($1,$2,$3,$4)) result',[row.episode_id,row.storyboard_package_id,clip.shotId,data.retry??false])).rows[0].result;
 await c.query('INSERT INTO local_identity.workspace_narration_requests(task_id,workspace_id,episode_id,clip_id,shot_id,input_fingerprint,authorization_hash) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[t.id,row.id,row.episode_id,clip.id,clip.shotId,n.inputFingerprint,authorized.authorization_hash]);
 await c.query('UPDATE local_identity.workspace_narrations SET task_id=$3,requested_project_sha256=$4,requested_native_edit_revision=$5 WHERE workspace_id=$1 AND shot_id=$2',[row.id,clip.shotId,t.id,row.project_sha256,Number(row.native_edit_revision??0)]);
}
/** Only the first ready voice of an untouched draft may be assembled automatically. */
export async function adoptFirstWorkspaceNarration(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,shotId?:string){
 for(const n of await readWorkspaceNarration(c,row,project)){
  if(shotId!==undefined&&n.shotId!==shotId||resolveWorkspaceMainVoice(project,n.shotId).item)continue;
  const s=(await c.query('SELECT requested_native_edit_revision,selection FROM local_identity.workspace_narrations WHERE workspace_id=$1 AND shot_id=$2',[row.id,n.shotId])).rows[0];
  if(s?.selection)continue;
  if(!n.requiresCandidateAdoption&&Number(row.native_edit_revision??0)===0&&n.confirmed&&n.audioTrackId&&!n.adoptedAudioTrackId&&Number(s?.requested_native_edit_revision)===Number(row.native_edit_revision??0)){await adopt(c,root,row,project,n);return true;}
 }
 return false;
}
async function adopt(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,n:WorkspaceNarration,nativeEdit=false){
 if(n.selection)validateSpeechParameters(n.selection,n.voice,n.languageCode,n.speakingRate);
 if(n.adoptedAudioTrackId===n.audioTrackId&&n.audioTrackId)return;
 if(Number(row.native_edit_revision??0)>0)throw new ConfigurationError(409,'工程已有人工编辑，请在剪辑工作台的口播版本中选择时长并采用。');
 if(n.adoptedAudioTrackId)throw new ConfigurationError(409,'已有口播的局部替换请在口播版本中明确时长并采用候选。');
 if(isOpenChatCutStudio(row.episode_id))throw new ConfigurationError(409,'请先保存并返回，再采用口播。');
 if(!n.audioTrackId||!n.relativePath||!n.sha256||!n.fileSize||!n.durationSeconds||n.mode==='none')throw new ConfigurationError(409,'当前输入还没有可用音轨。');
 await verifyEpisodeFile(c,root,row.episode_id,n.relativePath,n.sha256,n.fileSize);const observed=await probeMp3Artifact(await resolveEpisodeFileReference(c,await episodeStorageLocationAtRoot(c,root,row.episode_id),n.relativePath));
 if(Math.abs(observed-n.durationSeconds)>0.05)throw new ConfigurationError(409,'实际音轨时长与登记不一致。');
 const bindings=row.bindings.filter(b=>b.shotId===n.shotId),ids=new Set(bindings.map(b=>b.itemId));
 const timelines=project.timelines.filter(t=>t.items.some(i=>ids.has(String(i.id))));
 if(timelines.length!==1)throw new ConfigurationError(409,'镜头画面跨时间线或已删除，请在剪辑中明确处理。');
 const timeline=timelines[0],visuals=timeline.items.filter(i=>ids.has(String(i.id))),visual=visuals[0];
 const start=Math.min(...visuals.map(i=>Number(i.startFrame))),end=Math.max(...visuals.map(i=>Number(i.startFrame)+Number(i.durationInFrames)));

 const duration=Math.max(1,Math.ceil(observed*timeline.fps)),oldDuration=end-start;
 if(oldDuration!==duration&&visuals.some(i=>(i.loopControlVideo as {durationLocked?:boolean}|undefined)?.durationLocked))throw new ConfigurationError(409,'画面时长已锁定，请在口播版本中明确时长并采用候选。');
 if(visuals.length>1&&oldDuration!==duration)throw new ConfigurationError(409,'镜头的多个画面范围与完整口播时长不同，请明确调整画面范围；不会对每个范围重复套用整段口播。');
 if(n.adoptedAudioTrackId&&oldDuration!==duration)throw new ConfigurationError(409,'替换口播会改变镜头时长，请在剪辑中明确处理。');
 if(!n.adoptedAudioTrackId&&oldDuration!==duration){
  if(visual.kind==='video'){
   const source=await resolveWorkspaceSource(c,root,row.episode_id,String(visual.src));const video=await inspectMp4Artifact(await resolveEpisodeFileReference(c,await episodeStorageLocationAtRoot(c,root,row.episode_id),source.relative_path));
   if((Number(visual.srcInFrame??0)+duration)/timeline.fps>video.durationSeconds+0.025)throw new ConfigurationError(409,'已匹配画面短于实际口播，请补充画面或明确调整，系统不会循环或变速。');
  }else if(!['text','image'].includes(String(visual.kind)))throw new ConfigurationError(409,'当前画面类型不能按口播时长自动调整。');
  const end=Number(visual.startFrame)+oldDuration;for(const item of timeline.items)if(item.id!==visual.id&&Number(item.startFrame)>=end)item.startFrame=Number(item.startFrame)+duration-oldDuration;visual.durationInFrames=duration;
 }
 const assetId=`audio-track-${n.audioTrackId}`;
 if(!project.assets.some(a=>a.id===assetId))project.assets.push({id:assetId,name:n.shotId+' 口播',kind:'audio',src:n.relativePath,durationInFrames:duration});
 const item={id:n.itemId,track:'workspace-narration',kind:'audio',name:n.shotId+' 口播',src:n.relativePath,sourceAssetId:assetId,sourceRevision:n.inputFingerprint,sourceContentHash:n.sha256,startFrame:start,durationInFrames:duration,srcInFrame:0,volume:1};
 const previous=timeline.items.find(i=>i.id===n.itemId);if(previous)Object.assign(previous,item);else timeline.items.push(item);
 if(!timeline.trackOrder.includes('workspace-narration'))timeline.trackOrder.push('workspace-narration');timeline.tracks['workspace-narration']={kind:'audio',name:'主声音'};
 const mixed=applyWorkspaceAudioMix(project,{kind:'voice',workspaceId:row.id,shotId:n.shotId,visualItemIds:bindings.map(b=>b.itemId),mode:'tts',gainDb:0,ambienceGainDb:null});
 const updated=await updateWorkspaceProject(c,root,row,mixed,row.bindings,'采用实际口播时长',{nativeEdit});
 // Carry forward only requests based on the exact untouched draft, never ordinary editor saves.
 await c.query('UPDATE local_identity.workspace_narrations SET requested_project_sha256=$3 WHERE workspace_id=$1 AND requested_project_sha256=$2 AND adopted_audio_track_id IS NULL',[row.id,row.project_sha256,updated!.project.sha256]);
 await c.query('UPDATE local_identity.workspace_narrations SET adopted_audio_track_id=$3 WHERE workspace_id=$1 AND shot_id=$2',[row.id,n.shotId,n.audioTrackId]);
 await c.query(`INSERT INTO local_identity.workspace_candidate_decisions(workspace_id,candidate_id,decision,text_version,main_script_text,input_fingerprint,source_sha256,project_sha256) VALUES($1,$2,'adopted',$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,[row.id,n.audioTrackId,n.text,(await resolveWorkspaceShotLineage(c,row,n.shotId)).baseline_text,n.inputFingerprint,n.sha256,updated!.project.sha256]);
}

/** T04/T08 use measured main voice duration before requesting a paid picture candidate. */
export async function readWorkspaceNarrationTarget(c:PoolClient,root:string,workspaceId:string,clipId:string){
 const row=(await c.query('SELECT * FROM local_identity.production_workspaces WHERE id=$1',[workspaceId])).rows[0] as ProductionWorkspaceRecord|undefined;
 if(!row)throw new ConfigurationError(404,'工作空间不可见。');
 const clip=row.bindings.find(b=>b.id===clipId);if(!clip)throw new ConfigurationError(404,'画面引用不存在。');
 const n=(await readWorkspaceNarration(c,row)).find(n=>n.shotId===clip.shotId);
 if(!n?.audioTrackId||!n.relativePath||!n.sha256||!n.fileSize||!n.durationSeconds)throw new ConfigurationError(409,'请先准备当前镜头的实际主声音轨。');
 await verifyEpisodeFile(c,root,row.episode_id,n.relativePath,n.sha256,n.fileSize);
 const observed=await probeMp3Artifact(await resolveEpisodeFileReference(c,await episodeStorageLocationAtRoot(c,root,row.episode_id),n.relativePath));if(Math.abs(observed-n.durationSeconds)>0.05)throw new ConfigurationError(409,'主声音轨实际时长已变化。');
 return{audioTrackId:n.audioTrackId,artifactId:n.artifactId,sha256:n.sha256,durationSeconds:observed,inputFingerprint:n.inputFingerprint,itemId:n.itemId};
}

/** Registered capability facts validate the voice and locale together, including at adoption. */
export function validateSpeechParameters(selection:ProductionSelection,voice:unknown,language:unknown,rate:unknown){
 const choice=registeredAdapters.productionChoices().find(c=>c.capability==='speech'&&c.provider===selection.provider&&c.adapter===selection.adapter&&c.models.includes(selection.model??''));
 const bounds=choice?.constraints.speakingRate;
 if(selection.provider==='volcengine_tts'&&typeof voice==='string'&&/_(?:mars|moon)_bigtts$/.test(voice)&&selection.model!=='seed-tts-1.0')throw new ConfigurationError(400,'声音与所选语音模型不兼容，请重新选择。');
 if(typeof voice!=='string'||typeof language!=='string'||!choice?.voiceCatalog?.[language]?.includes(voice)||typeof rate!=='number'||!Number.isFinite(rate)||!bounds||rate<bounds.min||rate>bounds.max)throw new ConfigurationError(400,'声音、语言或语速与所选语音模型不兼容，请重新选择；输入已保留。');
}
