import type {ResolvedProductionPlan,ResolvedProductionSegment} from '../reviews/productionPlan.js';
import type {ScriptProductionRecord} from './scriptProductionStore.js';
export interface ContinuationDraft {
 shot_id:string;review_package_id:string;audio_mode:string;audio_status:string;video_status:string;
 tts_text:string|null;tts_voice:string|null;tts_speaking_rate:number|null;tts_actual_duration_seconds:number|null;
 selected_material_revision_id:string|null;clip_segments:unknown;composition:unknown;
 current_preview_input_fingerprint:string|null;preparation_input_fingerprint:string|null;confirmation_status:string;
 current_audio_track_id:string|null;acoustic_alignment?:{status:string};caption_confirmed?:boolean;subtitles_enabled:boolean;
 preview_status?:string;
}
export interface ContinuationTask {id:string;status:string;provider:string;input_snapshot:Record<string,unknown>;task_type:string;invalidated_at?:string|null;created_at?:string}
export interface ContinuationSnapshot {
 episode:{id:string;stage:string;policy:Record<string,unknown>;workspace_enabled?:boolean;tts_voice?:string};
 record:ScriptProductionRecord;review?:{id:string;artifact_path:string;shots?:Array<{id:string;productionMethod:string}>};drafts:ContinuationDraft[];
 tasks:ContinuationTask[];videoMaterials:Record<string,{id:string;duration?:number}>;
}
export interface ProductionAction {command:string;data:Record<string,unknown>;identity:unknown}
export type ProductionDecision={wait:string}|{action:ProductionAction};
const action=(command:string,data:Record<string,unknown>,identity:unknown=data):ProductionDecision=>({action:{command,data,identity}});
function shotTask(tasks:ContinuationTask[],shotId:string){return tasks.filter(t=>!t.invalidated_at&&['generate_a_roll','generate_b_roll'].includes(t.task_type)&&(t.input_snapshot.shot as {id?:string})?.id===shotId).sort((a,b)=>(b.created_at??'').localeCompare(a.created_at??''))[0];}
function generationDuration(segment:ResolvedProductionSegment,draft:ContinuationDraft,provider:string){
 const n=segment.settings.duration??Math.ceil(Number(draft.tts_actual_duration_seconds??5));
 return Math.max(provider==='kling'?3:provider==='bailian'?2:4,n);
}
export function nextScriptProductionAction(state:ContinuationSnapshot):ProductionDecision {
 const {episode:e,record,review,drafts,tasks,videoMaterials}=state,plan:ResolvedProductionPlan=record.plan;
 if(e.workspace_enabled)return{wait:'使用四步制作工作台继续'};
 if(!record.enabled)return{wait:'自动继续已暂停'};
 if(plan.issues.length)return{wait:plan.issues.join('；')};
 if(e.stage==='waiting_input')return{wait:'等待确认主脚本并开始制作'};
 if(e.stage==='visual_approved')return action('planStoryboard',{episodeId:e.id});
 if(e.stage==='qc_review')return{wait:'等待整片 QC 审核'};
 if(e.stage==='qc_passed'){
  const final=tasks.find(t=>t.task_type==='generate_final_render'&&!t.invalidated_at);
  if(final?.status!=='completed')return{wait:'等待最终成片完成'};
  if(plan.cover.status!=='bound')return{wait:'最终成片已完成，等待上传并绑定封面素材'};
  return action('prepareScriptPublish',{episodeId:e.id},{episodeId:e.id,final:final.id,cover:plan.cover.material?.sha256});
 }
 if(e.stage!=='storyboard_approved')return{wait:['visual_review','storyboard_review'].includes(e.stage)?'等待当前审核确认':'等待当前任务完成'};
 if(!review)return{wait:'当前分镜审核包缺失'};
 const base={episodeId:e.id,reviewPackageId:review.id};
 if(!record.progress['settings:'+review.id])return action('applyScriptSettings',base);
 for(const segment of plan.segments){
  const d=drafts.find(d=>d.shot_id===segment.id);if(!d)return{wait:segment.id+'：等待本期镜头设置'};
  const data={...base,shotId:segment.id};
  if(d.audio_mode==='tts'&&d.audio_status!=='ready'){
   if(d.audio_status==='failed')return{wait:segment.id+'：配音失败，请核对原任务'};
   const tts=tasks.find(t=>t.task_type==='generate_narration'&&!t.invalidated_at&&(t.input_snapshot.shot_preparation as {shot_id?:string})?.shot_id===segment.id);
   if(tts&&['failed','blocked'].includes(tts.status))return{wait:segment.id+'：配音失败，请核对原任务'};
   if(tts&&['ready','running'].includes(tts.status))continue;
   return action('generateTts',data,{...data,text:d.tts_text,voice:d.tts_voice,rate:d.tts_speaking_rate});
  }
  if(segment.sfx.status==='bound'&&d.audio_mode==='tts'&&(segment.settings.sfxStart??0)+(segment.settings.sfxDuration??1)>Number(d.tts_actual_duration_seconds)+0.05)return{wait:segment.id+'：音效区间超出实际口播，请修改镜头设置后确认'};
  const cfg=e.policy[segment.shotType] as {executor?:{provider?:string};budget_cents?:number};
  const provider=cfg?.executor?.provider??'';
  if(!d.selected_material_revision_id){
   const task=shotTask(tasks,segment.id);
   if(task&&['ready','running'].includes(task.status))continue;
   if(task&&['failed','blocked'].includes(task.status))return{wait:segment.id+'：视频任务未完成，请恢复原任务或明确重做'};
   if(task?.status==='completed'){
    const material=videoMaterials[task.id];if(!material)return{wait:segment.id+'：等待原片登记'};
    return action('bindScriptVideo',{...data,materialRevisionId:material.id},{...data,materialRevisionId:material.id});
   }
   if(segment.firstFrame.status!=='bound'||!segment.firstFrame.material)return{wait:segment.id+'：首帧未绑定'};
   if(!['bailian','volcengine','minimax','kling'].includes(provider))return{wait:segment.id+'：请选择已接入的视频 API 执行配置'};
   const duration=generationDuration(segment,d,provider);
   if(duration>15)return{wait:segment.id+'：配音超过单镜头上限，请拆分分镜后确认'};
   if(segment.settings.duration&&Number(d.tts_actual_duration_seconds)>duration+0.05)return{wait:segment.id+'：指定视频时长短于配音，请调整并重新确认'};
   const request={...data,firstFrameId:segment.firstFrame.material.id,prompt:review.shots?.find(s=>s.id===segment.id)?.productionMethod??segment.videoPrompt,durationSeconds:duration};
   if(provider==='bailian')return action('generateWan',request);
   const reservation=segment.settings.videoReservationCents??cfg.budget_cents;
   if(!Number.isSafeInteger(reservation)||Number(reservation)<1)return{wait:segment.id+'：请设置视频费用预留（分/镜头）或系列默认值'};
   return action('generateOfficialVideo',{...request,reservationCents:reservation});
  }
  if(d.video_status!=='ready'){
   if(d.video_status==='failed')return{wait:segment.id+'：片段制作失败，请处理原任务'};
   const pending=tasks.some(t=>t.task_type.startsWith('generate_')&&['ready','running'].includes(t.status)&&((t.input_snapshot.shot_preparation as {shot_id?:string})?.shot_id===segment.id||(t.input_snapshot.shot as {id?:string})?.id===segment.id));
   if(pending)continue;
   return action('generateClip',data,{...data,material:d.selected_material_revision_id,segments:d.clip_segments,composition:d.composition});
  }
  if(d.audio_mode==='source'&&d.audio_status!=='ready'){
   if(d.audio_status==='failed')return{wait:segment.id+'：原声提取失败，请处理原任务'};
   if(tasks.some(t=>t.task_type==='extract_embedded_audio'&&['ready','running'].includes(t.status)&&(t.input_snapshot.shot_preparation as {shot_id?:string})?.shot_id===segment.id))continue;
   return action('generateSourceAudio',data,{...data,material:d.selected_material_revision_id,segments:d.clip_segments});
  }
  if(d.subtitles_enabled&&d.audio_mode!=='none'){
   if(d.acoustic_alignment?.status!=='completed'){
    if(tasks.some(t=>t.task_type==='align_shot_captions'&&['ready','running'].includes(t.status)&&(t.input_snapshot.shot_preparation as {shot_id?:string})?.shot_id===segment.id))continue;
    if(d.acoustic_alignment?.status==='needs_review'||d.acoustic_alignment?.status==='failed')return{wait:segment.id+'：字幕对齐需要人工处理'};
    return action('requestAlignment',{...data,localOnly:true},{...data,audio:d.current_audio_track_id,text:d.tts_text});
   }
   if(!d.caption_confirmed)return{wait:segment.id+'：等待音频正文核对'};
  }
  if(d.current_preview_input_fingerprint!==d.preparation_input_fingerprint||!d.current_preview_input_fingerprint){
   if(d.preview_status==='failed')return{wait:segment.id+'：同步预览失败，请处理原任务'};
   return action('generateSyncPreview',data,{...data,input:d.preparation_input_fingerprint});
  }
  if(d.confirmation_status!=='confirmed')return{wait:segment.id+'：等待同步预览确认'};
 }
 if(plan.segments.every(s=>drafts.some(d=>d.shot_id===s.id&&d.selected_material_revision_id&&d.video_status==='ready'&&d.audio_status==='ready'&&d.confirmation_status==='confirmed'&&d.current_preview_input_fingerprint===d.preparation_input_fingerprint))){
  if(plan.segments.some(s=>s.settings.transition==='studio'))return{wait:'镜头已确认，等待在 Studio 中编辑并生成审核视频'};
  return action('renderScriptReview',{...base,projectRelativePath:review.artifact_path},{...base,inputs:drafts.map(d=>[d.shot_id,d.preparation_input_fingerprint])});
 }
 return{wait:'等待当前镜头任务完成'};
}
