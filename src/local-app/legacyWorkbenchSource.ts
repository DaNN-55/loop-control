import type {PoolClient} from 'pg';
import {isDeepStrictEqual} from 'node:util';
import {ConfigurationError,canonicalFingerprint} from './configurationCommands.js';
import {verifyEpisodeFile} from './episodeFiles.js';
import {reviewRenderFromSnapshot,shotPreparationContractFromSnapshot} from '../worker/history/reviewRenderV1.js';
import {parseShotWorkbenchClipSegments,shotWorkbenchReviewRender,type ShotWorkbenchStudioInput} from '../worker/shotWorkbenchStudio.js';
import {defaultReviewRenderComposition,reviewRenderCompositionFromJson,reviewRenderCompositionToJson} from '../reviews/reviewComposition.js';
import {applyScriptRenderSettings,scriptRenderHint} from '../worker/scriptRenderSettings.js';
import type {HistoricalDatabaseV1 as Database} from '../lib/history/databaseV1.types.js';
import type {ResolvedProductionPlan} from '../reviews/productionPlan.js';


type Row<K extends keyof Database['public']['Tables']>=Database['public']['Tables'][K]['Row'];
export interface LegacyWorkbenchRecord {
 version:'legacy-shot-workbench/v1';episodeId:string;scriptRevisionId:string|null;
 board:Row<'review_packages'>;drafts:Array<Row<'shot_preparation_drafts'>&{preparation_input_fingerprint:string|null;current_audio_track_id:string|null;current_video_artifact_id:string|null;current_video_task_id:string|null;script_narration_gain_db:number|null;script_bgm_gain_db:number|null;script_sfx_gain_db:number|null}>;tasks:Array<Row<'tasks'>&{invalidated_at:string|null}>;
 materials:Row<'production_material_revisions'>[];tracks:Row<'audio_tracks'>[];artifacts:Row<'artifacts'>[];
 script:Row<'production_material_revisions'>|null;selections:Row<'storyboard_audio_selections'>[];
 approvals:Row<'approvals'>[];materialApprovals:Array<{id:string;material_revision_id:string;approved_by:string;approved_at:string}>;series:Row<'series_versions'>|null;
 plan:{plan:ResolvedProductionPlan;script_revision_id:string;script_sha256:string}|null;
}

/** Saved rows are evidence, not file authority or permission to resume old execution. */
export async function readLegacyWorkbenchSource(c:PoolClient,episodeId:string,lock=false){
 const record=(await c.query('SELECT local_identity.read_legacy_workbench_source($1,$2) value',[episodeId,lock])).rows[0].value;
 if(!record)return null;
 return{record:record as LegacyWorkbenchRecord,sha256:canonicalFingerprint(record)};
}
export function legacyWorkbenchSummary(source:NonNullable<Awaited<ReturnType<typeof readLegacyWorkbenchSource>>>){
 return{version:source.record.version,sha256:source.sha256,sourceVerification:'not_checked' as const,scriptRevisionId:source.record.scriptRevisionId,reviewPackageId:source.record.board.id,shots:source.record.drafts.map(d=>({shotId:d.shot_id,confirmationStatus:d.confirmation_status,materialRevisionId:d.selected_material_revision_id,audioTrackId:d.current_audio_track_id}))};
}

/** The two import modes share original script/board identity and physical file checks. */
export async function verifyLegacyWorkbenchBasis(c:PoolClient,root:string,source:NonNullable<Awaited<ReturnType<typeof readLegacyWorkbenchSource>>>){
 const s=source.record;
 if(!s.approvals.length||!s.script||s.script.material_type!=='script')throw new ConfigurationError(409,'原脚本或分镜批准来源不完整。');
 await verifyEpisodeFile(c,root,s.episodeId,s.script.storage_path,s.script.sha256,Number(s.script.file_size));
 const boardFile=s.artifacts.find(a=>a.id===s.board.artifact_id);
 if(!boardFile)throw new ConfigurationError(409,'原分镜缺少同单文件登记。');
 const bytes=await verifyEpisodeFile(c,root,s.episodeId,boardFile.relative_path,boardFile.sha256,Number(boardFile.file_size));
 let board;try{board=JSON.parse(bytes.toString('utf8'));}catch{throw new ConfigurationError(409,'原分镜文件格式无效。');}
 const context=s.board.context_snapshot as {worker_result?:{storyboard?:unknown};storyboard?:unknown}|null;
 if(!isDeepStrictEqual(board,context?.worker_result?.storyboard??context?.storyboard)||board?.version!=='storyboard/v1'||!Array.isArray(board.shots)||!board.shots.length||board.shots.some((shot:{id:unknown;scriptSegment:unknown})=>typeof shot.id!=='string'||typeof shot.scriptSegment!=='string')||new Set(board.shots.map((shot:{id:string})=>shot.id)).size!==board.shots.length)throw new ConfigurationError(409,'原分镜文件与冻结记录不一致。');
 return{board,boardFile};
}

/** Reuse the original declared contract, never manufacture confirmation or media. */
export async function verifyLegacyWorkbenchSource(c:PoolClient,root:string,source:NonNullable<Awaited<ReturnType<typeof readLegacyWorkbenchSource>>>,confirmedOnly=false){
 const s=source.record;
 function fail(message:string):never{throw new ConfigurationError(409,message);}
 function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))fail('原工作版本缺少可核验的声明。');return value as Record<string,unknown>;}
 if(!s.approvals.length)fail('原分镜缺少原批准记录，未接入旧绑定。');
 const file=async(f:{relative_path?:unknown;storage_path?:unknown;sha256:unknown;file_size:unknown}|undefined|null)=>{
  if(!f)fail('原绑定缺少文件登记，未接入旧工作版本。');
  const path=f.relative_path??f.storage_path;if(typeof path!=='string'||typeof f.sha256!=='string'||!Number.isSafeInteger(Number(f.file_size))||Number(f.file_size)<=0)fail('原绑定的文件声明无效。');
  try{return await verifyEpisodeFile(c,root,s.episodeId,path,f.sha256,Number(f.file_size));}catch{fail('原工作版本的文件缺失或指纹已变化。');}
 };
 const verifyTrack=async(track:Row<'audio_tracks'>)=>{
  const artifact=s.artifacts.find(a=>a.id===track.source_artifact_id),task=s.tasks.find(t=>t.id===track.source_task_id);
  if(!artifact||artifact.relative_path!==track.relative_path||artifact.sha256!==track.sha256||Number(artifact.file_size)!==Number(track.file_size)||artifact.producer_task_id!==track.source_task_id||track.source_task_id&&(!task||task.status!=='completed'||task.invalidated_at))fail('原音轨缺少准确且有效的完成产物。');
  await file(track);
 };
 const {board,boardFile}=await verifyLegacyWorkbenchBasis(c,root,source);
 if(board.shots.length!==s.drafts.length)fail('原镜头草稿不完整，请按原版本核对。');
 const drafts:ShotWorkbenchStudioInput['drafts']=[];
 const soundEvidence:Array<{shotId:string;member:NonNullable<ReturnType<typeof reviewRenderFromSnapshot>>['members'][number]}>=[];
 const selectedShots=confirmedOnly?board.shots.filter((shot:{id:string})=>s.drafts.some(d=>d.shot_id===shot.id&&d.confirmation_status==='confirmed')):board.shots;
 if(!selectedShots.length)fail('原来源没有可保留的确认镜头。');
 for(const shot of selectedShots){
  const d=s.drafts.find(d=>d.shot_id===shot.id);
  if(!d||d.confirmation_status!=='confirmed'||!d.preparation_input_fingerprint||d.current_preview_input_fingerprint!==d.preparation_input_fingerprint)fail('原镜头尚未按当前输入确认，未伪造原确认。');
  const task=s.tasks.find(t=>t.id===d.current_preview_task_id);
  if(!task||task.status!=='completed'||task.invalidated_at)fail('原镜头预览尚未完成、已失效或结果未知，不会重新请求。');
  const snapshot=object(task.input_snapshot);
  let frozen,contract;
  try{frozen=reviewRenderFromSnapshot(snapshot);contract=shotPreparationContractFromSnapshot(d.preparation_contract);}catch{fail('原镜头缺少可核验的版本化准备契约。');}
  const confirmed=frozen?.confirmedShots?.filter(v=>v.shotId===shot.id);
  const original=confirmed?.[0];
  if(frozen?.preRenderReviewPackageId!==s.board.id||confirmed?.length!==1||!original||original.inputFingerprint!==d.preparation_input_fingerprint||!isDeepStrictEqual(original.preparationContract,contract)||original.audioMode!==d.audio_mode||original.audioTrackId!==(d.audio_mode==='tts'?d.current_audio_track_id:null)||original.subtitleText!==d.subtitle_text||original.subtitlesEnabled!==d.subtitles_enabled)fail('原预览确认与现存草稿不同，未猜测采用版本。');
  soundEvidence.push(...frozen.members.filter(m=>m.memberKind==='soundtrack').map(member=>({shotId:d.shot_id,member})));
  const inputs=snapshot.input_artifacts??[];if(!Array.isArray(inputs))fail('原预览输入文件声明无效。');
  for(const input of inputs){const f=object(input);await file({relative_path:f.relativePath,sha256:f.sha256,file_size:f.fileSize});}
  const outputs=(await c.query('SELECT * FROM public.artifacts WHERE producer_task_id=$1 AND episode_id=$2 ORDER BY id',[task.id,s.episodeId])).rows;
  if(!outputs.length)fail('原预览结果缺失，未接入旧工作版本。');for(const f of outputs)await file(f);
  const material=s.materials.find(m=>m.id===d.selected_material_revision_id),members=frozen!.members.filter(m=>m.memberKey===`shot:${shot.id}`&&m.memberKind==='shot_media');
  if(!material||material.material_type!=='video'||members.length!==1||members[0].sourceMaterialRevisionId!==material.id||members[0].relativePath!==material.storage_path||members[0].sha256!==material.sha256||!isDeepStrictEqual(members[0].clipSegments,parseShotWorkbenchClipSegments(d.clip_segments))||contract!.sourceMaterialRevisionId!==material.id)fail('原视频绑定缺少准确同单来源，未建立替代素材。');
  await file(material);
  if(d.audio_mode==='tts'){
   const track=s.tracks.find(t=>t.id===d.current_audio_track_id),voices=frozen!.members.filter(m=>m.memberKey===`narration:${shot.id}`&&m.memberKind==='narration');
   if(!track||voices.length!==1||voices[0].audioTrackId!==track.id||voices[0].relativePath!==track.relative_path||voices[0].sha256!==track.sha256||track.cue_id!==shot.id)fail('原口播音轨与冻结来源不一致。');
   if(voices[0].taskId!==undefined&&voices[0].taskId!==track.source_task_id)fail('原口播任务身份与冻结来源不一致。');await verifyTrack(track);
  }
  drafts.push({audioMode:d.audio_mode,audioTrackId:d.audio_mode==='none'?null:d.current_audio_track_id??null,clipSegments:parseShotWorkbenchClipSegments(d.clip_segments),composition:contract!.composition,confirmationStatus:'confirmed' as const,inputFingerprint:d.preparation_input_fingerprint,materialRevisionId:material.id,preparationContract:contract!,shotId:d.shot_id,subtitleText:d.subtitle_text,subtitlesEnabled:d.subtitles_enabled,ttsText:d.tts_text??null,videoArtifactId:d.current_video_artifact_id??null,videoTaskId:d.current_video_task_id??null});
 }
 const soundtrackMembers=[];
 const usedSounds=new Set<typeof soundEvidence[number]>();
 for(const selected of s.selections){
  if(!selected.material_revision_id&&!selected.cue_id)continue;
  const key=selected.material_revision_id?'bgm:episode':`${selected.audio_kind}:${selected.target_id}`;
  const expectedShots=selected.target_kind==='episode'?drafts.map(d=>d.shotId):drafts.filter(d=>d.shotId===selected.target_id).map(d=>d.shotId);
  if(!expectedShots.length){
   if(confirmedOnly&&board.shots.some((shot:{id:string})=>shot.id===selected.target_id))continue;
   fail('原声音选择缺少准确的确认镜头。');
  }
  const evidence=expectedShots.map(shotId=>{
   const matches=soundEvidence.filter(e=>e.shotId===shotId&&e.member.memberKey===key&&e.member.audioKind===selected.audio_kind);
   if(matches.length!==1)fail('原确认缺少唯一声音来源，未采用新的候选。');usedSounds.add(matches[0]);return matches[0].member;
  });
  const frozen=evidence[0];
  if(!frozen||evidence.some(m=>m.audioTrackId!==frozen.audioTrackId||m.taskId!==frozen.taskId||m.relativePath!==frozen.relativePath||m.sha256!==frozen.sha256))fail('各镜头原确认的声音版本不同，请明确选择原版本。');
  if(selected.material_revision_id){
   const material=s.materials.find(m=>m.id===selected.material_revision_id);
   if(selected.audio_kind!=='bgm'||!material||material.material_type!=='audio'||material.material_purpose!=='background_music'||!s.materialApprovals.some(a=>a.material_revision_id===material.id)||frozen.audioTrackId!==undefined||frozen.relativePath!==material.storage_path||frozen.sha256!==material.sha256)fail('原配乐选择缺少准确的同单许可来源。');
   await file(material);soundtrackMembers.push({memberKey:'bgm:episode',memberKind:'soundtrack' as const,audioKind:'bgm' as const,relativePath:material.storage_path,sha256:material.sha256,startSeconds:0,durationSeconds:board.shots.reduce((sum:number,shot:{durationSeconds:number})=>sum+Number(shot.durationSeconds),0)});continue;
  }
  const cue=board.audioCues?.find((cue:{id:string;kind:string})=>cue.id===selected.cue_id&&cue.kind===selected.audio_kind);
  const track=s.tracks.find(t=>t.id===frozen.audioTrackId&&t.source_review_package_id===s.board.id&&t.cue_id===selected.cue_id&&t.track_kind===selected.audio_kind&&t.source_task_id===frozen.taskId&&t.relative_path===frozen.relativePath&&t.sha256===frozen.sha256);
  if(!cue||!track)fail('原配乐或音效的冻结版本缺失，不会采用新结果或重新生成。');await verifyTrack(track);
  soundtrackMembers.push({memberKey:`${selected.audio_kind}:${selected.target_id}`,memberKind:'soundtrack' as const,audioKind:cue.kind,taskId:track.source_task_id,audioTrackId:track.id,relativePath:track.relative_path,sha256:track.sha256,startSeconds:Number(track.start_seconds??cue.startSeconds??0),durationSeconds:Number(track.duration_seconds)});
 }
 if(usedSounds.size!==soundEvidence.length)fail('原确认仍有未映射的声音，不会静默丢弃原采用。');
 const composition=reviewRenderCompositionFromJson({...reviewRenderCompositionToJson(defaultReviewRenderComposition),...(s.series&&object(s.series.rules).openchatcut_composition?object(object(s.series.rules).openchatcut_composition):{})});
 if(!composition)fail('原系列合成规则无法核验。');
 let render=shotWorkbenchReviewRender(s.episodeId,boardFile!.relative_path,{allowedFrames:composition!.allowedFrames??2,frameRate:composition!.frameRate??30,storyboard:{...board,shots:selectedShots},drafts,materials:s.materials.map(m=>({id:m.id,relativePath:m.storage_path,sha256:m.sha256})),audioTracks:s.tracks.filter(t=>drafts.some(d=>d.audioMode==='tts'&&d.audioTrackId===t.id)).map(t=>({id:t.id,cueId:t.cue_id!,relativePath:t.relative_path,sha256:t.sha256,startSeconds:Number(t.start_seconds),durationSeconds:Number(t.duration_seconds)})),soundtrackMembers});
 if(!composition)fail('原系列合成规则无法核验。');render.adjustments={...composition!,reason:'从原镜头绑定接入'};
 const plan=s.plan?.plan as ResolvedProductionPlan|undefined;if(plan)render=applyScriptRenderSettings(render,scriptRenderHint(plan.settings,plan.segments));
 return render;
}
