import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {definiteStoryboardFailure,latestStoryboardTask,type StoryboardBatchFailure,type StoryboardBatchItem,type StoryboardVideoDraft,type StoryboardVideoSettings} from '../storyboardBatch.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {workspaceCandidateTarget} from '../workspaceCandidates.js';
import {resolveWorkspaceMainVoice} from '../workspaceAudio.js';
import {defaultWanModelSettings} from '../wanVideoModels.js';
import {videoVisualInputLabels} from '../videoVisualInputs.js';
import {registeredAdapters} from '../worker/registeredAdapters.js';
import {canonicalFingerprint as digest,ConfigurationError} from './configurationCommands.js';
import type {InputRuntime} from './episodeCommands.js';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import {readWorkspaceNarration} from './workspaceNarration.js';
import {readWorkspaceTemplateInputs} from './workspaceTemplateInputs.js';
import {estimateWorkspaceVideoCall} from './workspaceVideoCallEstimate.js';
import {legacyVideoDefault} from './legacyVideoCompatibility.js';
import {queueWorkspaceVisualGeneration,readWorkspaceVisualCandidates,readWorkspaceVisualTasks} from './workspaceVisualCandidates.js';
import {resolveWorkspaceVideoRequest} from './workspaceVisualRequest.js';
import {registerConsumedWorkspaceCall} from './workspaceCallConfirmation.js';

export interface StoryboardVideoRequest {
 shotIds:string[];
 common?:StoryboardVideoSettings;
 drafts:StoryboardVideoDraft[];
 regenerateShotIds:string[];
 retryFailures?:StoryboardBatchFailure[];
}
export interface StoryboardVideoItem {
 review:StoryboardBatchItem;
 frozen?:{
  data:Record<string,unknown>;
  request:Awaited<ReturnType<typeof resolveWorkspaceVideoRequest>>;
  retryOfTaskId?:string;
  target:ReturnType<typeof workspaceCandidateTarget>&{width:number;height:number};
 };
}

export async function resolveStoryboardVideo(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,request:StoryboardVideoRequest):Promise<StoryboardVideoItem[]>{
 const narration=await readWorkspaceNarration(c,row,project);
 const tasks=await readWorkspaceVisualTasks(c,row);
 const candidates=await readWorkspaceVisualCandidates(c,row,project,root);
 const templates=await readWorkspaceTemplateInputs(c,root,row);
 const chosenImages=(await c.query(`SELECT s.target_item_id,v.material_revision_id FROM local_identity.workspace_visual_image_choices s
  JOIN local_identity.workspace_visual_candidates v ON v.id=s.candidate_id WHERE s.workspace_id=$1`,[row.id])).rows;
 const {policy}=(await c.query(`SELECT b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1`,[row.episode_id])).rows[0];
 const legacy=legacyVideoDefault(policy);
 const defaultSelection=legacy?.credential_ref&&legacy.executor?{capability:'video',provider:legacy.executor.provider,adapter:legacy.executor.adapter,model:legacy.executor.model,connectionVersionId:legacy.credential_ref}:undefined;
 return Promise.all(request.shotIds.map(async shotId=>{
  const clip=row.bindings.find(binding=>binding.shotId===shotId);
  const timeline=project.timelines.find(t=>t.items.some(item=>item.id===clip?.itemId));
  const item=timeline?.items.find(item=>item.id===clip?.itemId);
  const template=templates?.shots.find(shot=>shot.shotId===shotId);
  const draft=request.drafts.find(d=>d.shotId===shotId&&d.targetItemId===clip?.itemId&&d.preparationRevisionId===row.preparation_revision_id)?.inputs;
  const prompt=draft?.prompt?.trim()?draft.prompt:template?.videoPrompt??'';
  const base={shotId,text:prompt,source:draft?.prompt?.trim()&&prompt!==(template?.videoPrompt??'')?'draft':'confirmed'} as const;
  const skip=(reason:string):StoryboardVideoItem=>({review:{...base,state:'skipped',reason}});
  if(!clip||!timeline||!item||!['video','image','text'].includes(String(item.kind)))return skip('镜头已移除');
  const shotTasks=tasks.filter(task=>task.shotId===shotId&&task.kind==='video');
  const unknownReason='视频回执未知，请先在右侧核对原任务';
  if(shotTasks.some(task=>!task.retryTaskId&&task.publicationAttempt!=null))return skip(unknownReason);
  if(shotTasks.some(task=>task.status==='running'||task.status==='ready'&&(!task.invalidated||!!task.requestState&&task.requestState!=='queued')))return skip('已有视频任务进行中');
  if(shotTasks.some(task=>!task.retryTaskId&&(task.submissionUnknown||task.canResume||['started','received'].includes(task.submissionOutcome??'')&&task.status!=='completed')))return skip(unknownReason);
  const latest=latestStoryboardTask(shotTasks);
  if(!request.retryFailures&&latest?.submissionOutcome==='terminal_failed')return skip('已有明确失败的视频任务，请使用重试失败视频');
  const prior=request.retryFailures?latest:undefined;
  if(request.retryFailures&&(!definiteStoryboardFailure(prior)||prior?.taskId!==request.retryFailures.find(failure=>failure.shotId===shotId)?.taskId||
   prior?.targetItemId!==item.id))return skip('原任务已变化或无明确失败记录');
  const previous=prior?.generation;

  const voice=narration.find(n=>n.shotId===shotId);
  const voiceMode=voice?.requestedMode??(voice?.enabled===false?'none':clip.voiceInput?.mode==='source'?'source':voice?.mode==='manual'?'manual':voice?.enabled||voice?.mode==='tts'?'tts':'none');
  const activeVoice=resolveWorkspaceMainVoice(project,shotId).item;
  if((voiceMode==='tts'||voiceMode==='manual')&&(!activeVoice||activeVoice.id===`workspace-source-shot-${shotId}`))return skip('先采用口播');
  if(!prompt.trim())return skip('缺少视频提示词');

  const sharedSelection=request.common&&Object.hasOwn(request.common,'selection')?request.common.selection:previous?.selection??defaultSelection;
  const selection=draft&&Object.hasOwn(draft,'selection')?draft.selection:sharedSelection;
  if(!selection)return skip('请先选择视频生成连接与模型');
  const provider=selection.provider;
  const sharedSettingsApply=!request.common?.selection||request.common.selection.provider===provider&&request.common.selection.model===selection.model;
  const sameModel=previous?.selection?.provider===provider&&previous?.selection?.model===selection.model;
  const commonWan=(sharedSettingsApply?request.common?.videoSettings:undefined)??(sameModel?previous?.videoSettings:undefined);
  const customWan=draft?.videoSettings;
  const wantWan=customWan!==undefined||provider==='bailian'&&commonWan!==undefined;
  if([customWan,...(provider==='bailian'?[commonWan]:[])].some(settings=>settings!==undefined&&(!settings||typeof settings!=='object'||Array.isArray(settings))))return skip('视频参数无效或不适用于当前模型。');
  const videoSettings=wantWan?(provider==='bailian'?{...defaultWanModelSettings(selection.model??''),...commonWan,...customWan}:customWan):undefined;
  const modes=registeredAdapters.productionChoices().find(choice=>choice.capability==='video'&&choice.provider===selection.provider&&choice.adapter===selection.adapter)?.videoGenerationModes?.[selection.model??''];
  const mode=draft?.videoMode??(draft?.firstFrameMaterialRevisionId===undefined?modes?.find(mode=>mode.id===request.common?.videoMode)?.id:undefined);
  const advanced=mode!==undefined&&mode!=='first-frame';
  const materialId=draft?.firstFrameMaterialRevisionId??chosenImages.find(image=>image.target_item_id===item.id)?.material_revision_id??(clip.source?.kind==='image'?clip.source.materialRevisionId:clip.image?.materialRevisionId)??(template?.visual?.material?.type==='image'?template.visual.material.id:undefined);
  if(!advanced&&!materialId)return skip('缺少首帧图片');
  const visualInputs=draft?.visualInputs??(materialId?[{role:mode==='references'?'referenceImages':'firstFrame',materialRevisionId:materialId}]:[]);
  const fit=!advanced||visualInputs.some(input=>input.role==='firstFrame')?draft?.firstFrameFit??request.common?.firstFrameFit:undefined;
  const resolution=draft?.videoResolution??(sharedSettingsApply?request.common?.videoResolution:undefined)??(sameModel?previous?.videoResolution:undefined);
  const data={
   targetItemId:item.id,prompt,selection,
   ...(draft?.promptReferences!==undefined?{promptReferences:draft.promptReferences}:{}),
   ...(advanced?{videoMode:mode,visualInputs}:{firstFrameMaterialRevisionId:materialId}),
   ...(fit!==undefined?{firstFrameFit:fit}:{}),
   durationSeconds:draft?.durationSeconds??request.common?.durationSeconds??(sameModel?previous?.durationSeconds:undefined)??Number(item.durationInFrames)/timeline.fps,
   ...(videoSettings!==undefined?{videoSettings}:{}),
   ...(draft?.videoResolution!==undefined||provider==='minimax'&&resolution!==undefined?{videoResolution:resolution}:{}),
   reservationCents:draft?.reservationCents??template?.videoReservationCents??request.common?.reservationCents,
  };
  if(typeof data.durationSeconds!=='number'||!Number.isFinite(data.durationSeconds))return skip('视频生成时长无效。');
  try{
   const resolved=await resolveWorkspaceVideoRequest(c,root,row,project,data,'batch');
   const {visual,targetSeconds,providerSeconds,actualPrompt,videoResolution,videoSettings}=resolved;
   const {estimate}=await estimateWorkspaceVideoCall(c,resolved);
   const reservationCents=data.reservationCents??estimate.suggestedCents;
   if(!Number.isSafeInteger(reservationCents)||reservationCents<estimate.minimumCents||reservationCents>estimate.maximumCents)return skip(`本次费用预留须为 ¥${(estimate.minimumCents/100).toFixed(2)}～¥${(estimate.maximumCents/100).toFixed(2)}。`);
   const existing=item.kind==='video'&&typeof item.src==='string'||row.bindings.some(b=>b.shotId===shotId&&b.source?.kind==='video');
   const pending=candidates.some(candidate=>candidate.shotId===shotId&&candidate.kind==='video'&&candidate.status==='available');
   const reason=existing?'已有可用视频':pending?'已有未采用视频候选':undefined;
   const state=reason&&!request.retryFailures&&!request.regenerateShotIds.includes(shotId)?'regenerate':'ready';
   const {selection,connection,choice}=resolved.resolved;
   const parameters=[`镜头 ${Number(targetSeconds.toFixed(2))} 秒`,`服务请求 ${providerSeconds} 秒`,visual.mode.label];
   if(fit)parameters.push(fit==='cover'?'首帧居中裁切':'完整保留首帧');
   if(videoResolution)parameters.push(videoResolution);
   if(videoSettings&&typeof videoSettings==='object'&&'resolution' in videoSettings)parameters.push(String(videoSettings.resolution));
   const inputs=visual.frozen.map((input,index)=>visual.mode.characterOrder?`character${index+1} · ${input.name}`:visual.advanced?`${videoVisualInputLabels[input.role]} · ${input.name}`:input.name);
   return{
    review:{...base,text:actualPrompt,state,...(reason&&state==='regenerate'?{reason}:{}),targetSeconds,providerSeconds,summary:{
     kind:'视频生成',target:shotId,provider:selection.provider,model:selection.model??choice.label,
     connection:connection?`${connection.name} · v${connection.version}`:'本地',parameters,inputs,prompt:actualPrompt,reservationCents,estimate,
    }},
    ...(state==='ready'?{frozen:{data:{...data,selection,reservationCents},request:resolved,...(prior?{retryOfTaskId:prior.taskId}:{}),target:{...workspaceCandidateTarget(item),width:timeline.width,height:timeline.height}}}:{}),
   };
  }catch(error){
   if(error instanceof ConfigurationError&&error.status<500)return skip(error.message);
   if((error as NodeJS.ErrnoException).code==='ENOENT')return skip('本镜头的首帧、参考素材或主声文件已缺失。');
   throw error;
  }
 }));
}

export async function queueStoryboardVideo(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,runtime:InputRuntime,batchId:string,item:StoryboardVideoItem){
 const frozen=item.frozen!,approvalId=randomUUID();
 const payload={...frozen.data,batchId,...(frozen.retryOfTaskId?{batchRetryOfTaskId:frozen.retryOfTaskId}:{})};
 const contextHash=digest(frozen),authorizationHash=digest({approvalId,batchId,contextHash});
 await registerConsumedWorkspaceCall(c,row,{id:approvalId,command:'requestWorkspaceVisualCandidate',payload,contextHash,authorizationHash,summary:item.review.summary!});
 const {taskId}=await queueWorkspaceVisualGeneration(c,root,row,project,payload,runtime,'candidate',{batchId,retryOfTaskId:frozen.retryOfTaskId,request:frozen.request});
 return {shotId:item.review.shotId,taskId,reservationCents:Number(frozen.data.reservationCents)};
}
