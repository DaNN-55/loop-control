import {validateWorkspaceVoiceInput,type WorkspaceVoiceInput} from '../workspaceVoiceInput.js';
import {registerWorkspaceVisualCandidate} from './workspaceVisualCandidates.js';
import {readWorkspaceProject,type ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import {defaultShotComposition} from '../shotComposition.js';
import {validateWorkspaceVisualDraft,workspaceVisualDraftInstances,type WorkspaceVisualDraft} from '../workspaceVisualDraft.js';
import {validateWorkspaceRenderPreferences,type WorkspaceRenderPreferences} from '../workspaceRenderPreferences.js';
import {validateProductionDefaults} from '../reviews/productionScript.js';
import {defaultReviewRenderComposition,reviewRenderCompositionFromJson,reviewRenderCompositionToJson} from '../reviews/reviewComposition.js';
import type {PoolClient} from 'pg';
import type {ProductionWorkspace,LegacyDraftInputs} from '../productionWorkspace.js';
import {ConfigurationError} from './configurationCommands.js';
import {readLegacyWorkbenchSource,verifyLegacyWorkbenchBasis,type LegacyWorkbenchRecord} from './legacyWorkbenchSource.js';
import {probeMp3Artifact} from '../worker/mediaTools.js';
import {episodeFileIO} from './episodeFiles.js';
import {verifyEpisodeFile} from './episodeFiles.js';
import {registeredWorkspaceAudio} from './registeredWorkspaceAudio.js';
import {parseShotWorkbenchClipSegments} from '../worker/shotWorkbenchStudio.js';
import {normalizeShotCaptionContract} from '../shotCaptions.js';

type Source=NonNullable<Awaited<ReturnType<typeof readLegacyWorkbenchSource>>>;
function unavailable(error:unknown){if(error instanceof ConfigurationError&&[404,409].includes(error.status)||['ENOENT','ENOTDIR','EACCES','EPERM','EIO'].includes((error as NodeJS.ErrnoException)?.code??''))return;throw error;}
export async function verifyLegacyDraftInputs(c:PoolClient,root:string,source:Source){
 const {board}=await verifyLegacyWorkbenchBasis(c,root,source),s=source.record;
 if(s.drafts.length!==board.shots.length||new Set(s.drafts.map(d=>d.shot_id)).size!==s.drafts.length)throw new ConfigurationError(409,'原镜头草稿不完整，请保留原版核对。');
 if(s.drafts.every(d=>d.confirmation_status==='confirmed'))throw new ConfigurationError(409,'原镜头均已确认，请从原工作版本接续。');
 for(const d of s.drafts){
  if(!board.shots.some((shot:{id:string})=>shot.id===d.shot_id)||!['pending','skipped','confirmed'].includes(d.confirmation_status)||!['none','source','tts'].includes(d.audio_mode))throw new ConfigurationError(409,'原草稿状态或镜头映射无法核验。');
  if(d.selected_material_revision_id&&!s.materials.some(m=>m.id===d.selected_material_revision_id)||d.current_audio_track_id&&!s.tracks.some(t=>t.id===d.current_audio_track_id))throw new ConfigurationError(409,'原草稿绑定不是同单登记来源。');
  parseShotWorkbenchClipSegments(d.clip_segments??[]);
  const captions=d.caption_contract as {version?:string}|null|undefined;
  if(captions&&captions.version!=='shot-captions/v1')throw new ConfigurationError(409,'原字幕草稿协议尚未接入。');
 }
 for(const selection of s.selections)if(selection.material_revision_id&&!s.materials.some(m=>m.id===selection.material_revision_id)||selection.target_kind==='shot'&&!board.shots.some((shot:{id:string})=>shot.id===selection.target_id)||selection.target_kind==='episode'&&selection.target_id!==s.episodeId)throw new ConfigurationError(409,'原声音选择不是同单镜头或登记来源。');
 return board;
}
/** Convert pending layout/ranges once; the original source record remains intact. */
export function legacyDraftVisualInputs(source:Source,board:{shots:Array<{id:string;durationSeconds?:number}>}){
 const visuals=new Map<string,WorkspaceVisualDraft>();
 for(const draft of source.record.drafts){
  if(draft.confirmation_status==='confirmed')continue;
  const shot=board.shots.find(s=>s.id===draft.shot_id)!;
  let segments=parseShotWorkbenchClipSegments(draft.clip_segments??[]);
  if(!segments.length){const start=Number(draft.clip_start_seconds??0);segments=[{startSeconds:start,endSeconds:Number(draft.clip_end_seconds??start+Number(shot.durationSeconds??3))}];}
  const value={version:'workspace-visual-draft/v1' as const,segments,composition:draft.composition??defaultShotComposition('full',segments.length)};
  try{validateWorkspaceVisualDraft(value);}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'原画面草稿无法接入。');}visuals.set(draft.shot_id,value);
 }
 return visuals;
}
/** Normalize the unconfirmed choice once; original rows and track bytes remain evidence. */
export function legacyDraftVoiceInputs(source:Source,visuals:ReadonlyMap<string,WorkspaceVisualDraft>){
 const voices=new Map<string,WorkspaceVoiceInput>();
 for(const draft of source.record.drafts){
  if(draft.confirmation_status==='confirmed'||draft.audio_mode!=='source')continue;
  const material=source.record.materials.find(m=>m.id===draft.selected_material_revision_id&&m.material_type==='video'),track=source.record.tracks.find(t=>t.id===draft.current_audio_track_id&&t.track_kind==='source');
  const input:WorkspaceVoiceInput={version:'workspace-voice-input/v1',mode:'source',visual:material?{materialRevisionId:material.id,sha256:material.sha256}:null,audioTrack:track?{id:track.id,sha256:track.sha256}:null,visualDraft:visuals.get(draft.shot_id)!};
  try{validateWorkspaceVoiceInput(input);}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'原声输入无法接入。');}voices.set(draft.shot_id,input);
 }
 return voices;
}
/** Convert old presentation columns once; old authorization and unrelated plans stay evidence. */
export function legacyDraftRenderPreferences(source:Source){
 const s=source.record,rules=s.series?.rules as Record<string,unknown>|undefined;
 const original=rules?.openchatcut_composition;
 const composition=reviewRenderCompositionFromJson({...reviewRenderCompositionToJson(defaultReviewRenderComposition),...(original&&typeof original==='object'&&!Array.isArray(original)?original:{})});
 if(!composition)throw new ConfigurationError(409,'原字幕呈现设置无法核验。');
 const plan=s.plan,matching=plan&&plan.script_revision_id===s.scriptRevisionId&&plan.script_sha256===s.script?.sha256;
 const issues:LegacyDraftInputs['issues']=plan&&!matching?[{shotId:'episode',kind:'saved_plan_uses_other_script'}]:[];
 let style=composition.captionStyle;
 try{if(matching){if(plan.plan.version!==2||plan.plan.script?.version!==2)throw Error('原计划版本尚未接入。');style=validateProductionDefaults(plan.plan.settings).captionStyle??style;}}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'原字幕样式无效。');}
 const preferences=new Map<string,WorkspaceRenderPreferences>();
 for(const draft of s.drafts){
  if(draft.confirmation_status==='confirmed')continue;
  const value:WorkspaceRenderPreferences={version:'workspace-render-preferences/v1',voiceGainDb:draft.script_narration_gain_db??0,bgmGainDb:draft.script_bgm_gain_db??-12,sfxGainDb:draft.script_sfx_gain_db??-6,bgmDucking:draft.bgm_ducking_level??'off',transition:draft.transition_mode??'cut',captionStyle:style};
  try{validateWorkspaceRenderPreferences(value);}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'原混音呈现设置无效。');}preferences.set(draft.shot_id,value);
 }
 return{preferences,issues};
}

export async function installLegacyDraftInputs(c:PoolClient,root:string,initial:ProductionWorkspace,source:Source,board:{shots:Array<{id:string;durationSeconds?:number}>;audioCues?:Array<{id:string;kind:string;startSeconds?:number;durationSeconds?:number}>},visuals:ReadonlyMap<string,WorkspaceVisualDraft>,execute:(command:string,data:Record<string,unknown>)=>Promise<ProductionWorkspace>){
 let state=initial;const issues:LegacyDraftInputs['issues']=[];
 const send=async(command:string,data:Record<string,unknown>)=>state=await execute(command,{workspaceId:state.id,expectedRevision:state.revision,...data});
 for(const draft of source.record.drafts){
  if(draft.confirmation_status==='confirmed')continue;
  const clips=state.clips.filter(b=>b.shotId===draft.shot_id),clip=clips[0];if(!clip)throw new ConfigurationError(409,'当前制作基准缺少原草稿镜头。');
  const material=source.record.materials.find(m=>m.id===draft.selected_material_revision_id);
  if(material){
   try{await verifyEpisodeFile(c,root,state.episodeId,material.storage_path,material.sha256,Number(material.file_size));}
   catch(error){unavailable(error);issues.push({shotId:draft.shot_id,kind:'visual_source_unavailable'});}
   if(!issues.some(i=>i.shotId===draft.shot_id&&i.kind==='visual_source_unavailable')){
    const row=(await c.query('SELECT * FROM local_identity.production_workspaces WHERE id=$1',[state.id])).rows[0] as ProductionWorkspaceRecord,project=await readWorkspaceProject(c,root,row),fps=project.timelines.find(t=>t.id===project.activeTimelineId)!.fps,instances=workspaceVisualDraftInstances(visuals.get(draft.shot_id)!,fps);
    if(instances.length!==clips.length)throw new ConfigurationError(409,'当前画面槽位与原草稿不一致。');
    for(const [index,target] of clips.entries())try{const instance=instances[index];await registerWorkspaceVisualCandidate(c,root,row,project,{targetItemId:target.itemId,materialRevisionId:material.id,usage:material.material_type==='image'?'still':'video',durationSeconds:instance.durationInFrames/fps},{durationInFrames:instance.durationInFrames,...(material.material_type==='video'?{sourceRange:instance.sourceRange}:{})});}catch(error){unavailable(error);issues.push({shotId:draft.shot_id,kind:'visual_range_unavailable'});}
   }
  }
  let voice:Awaited<ReturnType<typeof registeredWorkspaceAudio>>|null=null;
  if(draft.audio_mode==='tts'&&draft.current_audio_track_id){
   try{voice=await registeredWorkspaceAudio(c,root,state.episodeId,draft.current_audio_track_id,'narration');}catch(error){unavailable(error);issues.push({shotId:draft.shot_id,kind:'voice_source_unavailable'});}
  }
  await send('saveWorkspaceNarration',{clipId:clip.id,mode:voice?'manual':'none',text:draft.tts_text??clip.text,voice:draft.tts_voice??null,speakingRate:draft.tts_speaking_rate==null?null:Number(draft.tts_speaking_rate),...(voice?{audioTrackId:voice.track.id}:{})});
  const captions=normalizeShotCaptionContract(draft.caption_contract,{text:draft.subtitle_text,enabled:draft.subtitles_enabled,audioMode:draft.audio_mode});
  // Old unconfirmed cues remain in the source record; no timing/text approval is imported.
  const mode=captions.contentMode;captions.contentMode='independent';captions.text=draft.subtitle_text;captions.cues=[];
  await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:captions});
  if(mode==='follow_tts'){
   await send('saveWorkspaceNarrationCaptions',{clipId:clip.id,contentMode:'follow_tts',text:draft.subtitle_text});
   if(!draft.subtitles_enabled)await send('setWorkspaceCaptionsEnabled',{clipId:clip.id,enabled:false});
  }
 }
 for(const selection of source.record.selections){
  const cue=board.audioCues?.find(c=>c.id===selection.cue_id&&c.kind===selection.audio_kind),shotId=selection.target_kind==='shot'?selection.target_id:null;
  const window=shotId?Number(board.shots.find(s=>s.id===shotId)?.durationSeconds??3):board.shots.reduce((sum,s)=>sum+Number(s.durationSeconds??3),0);
  const offset=shotId?Math.max(0,Number(cue?.startSeconds??0)-board.shots.slice(0,board.shots.findIndex(s=>s.id===shotId)).reduce((sum,s)=>sum+Number(s.durationSeconds??3),0)):0;
  const common={kind:selection.audio_kind,description:selection.audio_kind==='bgm'?'原配乐候选':'原音效候选',anchor:shotId?'shot':'absolute',...(shotId?{shotId}:{}),offsetSeconds:offset};
  if(selection.material_revision_id){
   const material=source.record.materials.find(m=>m.id===selection.material_revision_id)!;let duration:number;
   try{await verifyEpisodeFile(c,root,state.episodeId,material.storage_path,material.sha256,Number(material.file_size));duration=await probeMp3Artifact(await(await episodeFileIO(c,root,state.episodeId)).resolveReference(material.storage_path));}catch(error){unavailable(error);issues.push({shotId:shotId??'episode',kind:'sound_source_unavailable'});continue;}
   await send('prepareWorkspaceAudio',{...common,materialRevisionId:material.id,durationSeconds:Math.min(duration,window)});
  }else if(selection.cue_id&&cue){
   const tracks=source.record.tracks.filter(t=>t.source_review_package_id===source.record.board.id&&t.cue_id===cue.id&&t.track_kind===selection.audio_kind);
   for(const track of tracks){let registered:Awaited<ReturnType<typeof registeredWorkspaceAudio>>;
    try{registered=await registeredWorkspaceAudio(c,root,state.episodeId,track.id,selection.audio_kind==='bgm'?'bgm':'sfx');}catch(error){unavailable(error);issues.push({shotId:shotId??'episode',kind:'sound_source_unavailable'});continue;}
    await send('prepareWorkspaceAudio',{...common,audioTrackId:track.id,durationSeconds:Math.min(registered.duration,Number(cue.durationSeconds??window))});
   }
  }else if(selection.cue_id)issues.push({shotId:shotId??'episode',kind:'sound_selection_unavailable'});
 }
 return{workspace:state,issues};
}

interface Recovery {relative_path:string;sha256:string;file_size:number|string}
async function legacyEvidence(c:PoolClient,root:string,episodeId:string,recovery:Recovery){
 const bytes=await verifyEpisodeFile(c,root,episodeId,recovery.relative_path,recovery.sha256,Number(recovery.file_size));
 let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw new ConfigurationError(409,'原接入来源文件格式无效。');}
 const source=value.source;if(source?.version!=='legacy-shot-workbench/v1')return null;
 if(source.record?.version!=='legacy-shot-workbench/v1'||source.record.episodeId!==episodeId||!Array.isArray(source.record.drafts)||!Array.isArray(source.record.tasks))throw new ConfigurationError(409,'原接入来源协议不完整。');
 return source as {version:string;sha256:string;record:LegacyWorkbenchRecord;importMode?:string;issues?:LegacyDraftInputs['issues']};
}
export async function readLegacyDraftInputs(c:PoolClient,root:string,episodeId:string,recovery:Recovery|undefined):Promise<LegacyDraftInputs|undefined>{
 if(!recovery)return undefined;const source=await legacyEvidence(c,root,episodeId,recovery);if(source?.importMode!=='draft-inputs/v1')return undefined;
 return{version:'legacy-draft-inputs/v1',sourceSha256:source.sha256,issues:source.issues??[],shots:source.record.drafts.map(d=>({shotId:d.shot_id,confirmationStatus:d.confirmation_status,audioMode:d.audio_mode,materialRevisionId:d.selected_material_revision_id??null,audioTrackId:d.current_audio_track_id??null,subtitleText:d.subtitle_text,ttsText:d.tts_text??null,ranges:parseShotWorkbenchClipSegments(d.clip_segments??[]),composition:d.composition??null}))};
}

/** Migration must not make an unresolved old Provider request eligible for another send. */
export async function assertLegacyExternalRequestsResolved(c:PoolClient,root:string,row:{id:string;episode_id:string}){
 const recovery=(await c.query('SELECT relative_path,sha256,file_size FROM local_identity.workspace_legacy_recoveries WHERE workspace_id=$1',[row.id])).rows[0];if(!recovery)return;
 const source=await legacyEvidence(c,root,row.episode_id,recovery);if(!source)return;
 const types=['generate_narration','generate_soundtrack','generate_static_visual','generate_shot_video','generate_a_roll','generate_b_roll'];
 const ids=source.record.tasks.filter(t=>types.includes(t.task_type)).map(t=>t.id);if(!ids.length)return;
 const tasks=(await c.query('SELECT t.status,t.last_result,local_identity.provider_dispatch_observation(t.id) observation FROM public.tasks t WHERE t.episode_id=$1 AND t.id=ANY($2::uuid[])',[row.episode_id,ids])).rows;
 for(const task of tasks){
  if(task.status==='completed')continue;
  const result=task.last_result,unknown=[...(Array.isArray(result?.blockers)?result.blockers:[]),...(Array.isArray(result?.preflight?.checks)?result.preflight.checks:[])].some(v=>['provider_outcome_unknown','provider_result_unknown','submission_unknown'].includes(v?.code??v?.check));
  if(task.status==='running'||unknown||task.observation&&!['preparing','reserved','rejected'].includes(task.observation.phase))throw new ConfigurationError(409,'原外部请求仍在执行或结果未知，请先核对；不会重新发送。');
 }
}
