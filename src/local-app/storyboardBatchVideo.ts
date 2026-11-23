import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {StoryboardBatchItem,StoryboardVideoDraft,StoryboardVideoSettings} from '../storyboardBatch.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {workspaceCandidateTarget} from '../workspaceCandidates.js';
import {resolveWorkspaceMainVoice} from '../workspaceAudio.js';
import {defaultWanModelSettings} from '../wanVideoModels.js';
import {videoVisualInputLabels} from '../videoVisualInputs.js';
import {canonicalFingerprint as digest,ConfigurationError} from './configurationCommands.js';
import type {InputRuntime} from './episodeCommands.js';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import {readWorkspaceNarration} from './workspaceNarration.js';
import {readWorkspaceTemplateInputs} from './workspaceTemplateInputs.js';
import {estimateWorkspaceVideoCall} from './workspaceVideoCallEstimate.js';
import {legacyVideoDefault} from './legacyVideoCompatibility.js';
import {queueWorkspaceVisualGeneration,readWorkspaceVisualCandidates,readWorkspaceVisualTasks} from './workspaceVisualCandidates.js';
import {resolveWorkspaceVideoRequest} from './workspaceVisualRequest.js';

export interface StoryboardVideoRequest {
 shotIds:string[];
 common?:StoryboardVideoSettings;
 drafts:StoryboardVideoDraft[];
 regenerateShotIds:string[];
}
export interface StoryboardVideoItem {
 review:StoryboardBatchItem;
 frozen?:{
  data:Record<string,unknown>;
  request:Awaited<ReturnType<typeof resolveWorkspaceVideoRequest>>;
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
  const base={shotId,text:prompt,source:draft?'draft':'confirmed'} as const;
  const skip=(reason:string):StoryboardVideoItem=>({review:{...base,state:'skipped',reason}});
  if(!clip||!timeline||!item||!['video','image','text'].includes(String(item.kind)))return skip('镜头已移除');
  const shotTasks=tasks.filter(task=>task.shotId===shotId&&task.kind==='video');
  if(shotTasks.some(task=>task.status==='running'||task.status==='ready'&&(!task.invalidated||!!task.requestState||!!task.publicationAttempt)))return skip('已有视频任务进行中');
  if(shotTasks.some(task=>!task.retryTaskId&&(task.submissionUnknown||task.publicationAttempt||task.canResume||['started','received'].includes(task.submissionOutcome??'')&&task.status!=='completed')))return skip('视频回执未知，请先在右侧核对原任务');

  const voice=narration.find(n=>n.shotId===shotId);
  const voiceMode=voice?.requestedMode??(voice?.enabled===false?'none':clip.voiceInput?.mode==='source'?'source':voice?.mode==='manual'?'manual':voice?.enabled||voice?.mode==='tts'?'tts':'none');
  const activeVoice=resolveWorkspaceMainVoice(project,shotId).item;
  if((voiceMode==='tts'||voiceMode==='manual')&&(!activeVoice||activeVoice.id===`workspace-source-shot-${shotId}`))return skip('先采用口播');
  if(!prompt.trim())return skip('缺少视频提示词');

  const sharedSelection=request.common&&Object.hasOwn(request.common,'selection')?request.common.selection:defaultSelection;
  const selection=draft?.selection??sharedSelection;
  if(!selection)return skip('请先选择视频生成连接与模型');
  const provider=selection.provider;
  const sharedSettingsApply=!request.common?.selection||request.common.selection.provider===provider&&request.common.selection.model===selection.model;
  const commonWan=sharedSettingsApply?request.common?.videoSettings:undefined;
  const customWan=draft?.videoSettings;
  const wantWan=customWan!==undefined||provider==='bailian'&&commonWan!==undefined;
  if([customWan,...(provider==='bailian'?[commonWan]:[])].some(settings=>settings!==undefined&&(!settings||typeof settings!=='object'||Array.isArray(settings))))return skip('视频参数无效或不适用于当前模型。');
  const videoSettings=wantWan?(provider==='bailian'?{...defaultWanModelSettings(selection.model??''),...commonWan,...customWan}:customWan):undefined;
  const advanced=draft?.videoMode&&draft.videoMode!=='first-frame';
  const materialId=draft?.firstFrameMaterialRevisionId??chosenImages.find(image=>image.target_item_id===item.id)?.material_revision_id??(clip.source?.kind==='image'?clip.source.materialRevisionId:clip.image?.materialRevisionId)??(template?.visual?.material?.type==='image'?template.visual.material.id:undefined);
  if(!advanced&&!materialId)return skip('缺少首帧图片');
  const data={
   targetItemId:item.id,prompt,selection,
   ...(draft?.promptReferences!==undefined?{promptReferences:draft.promptReferences}:{}),
   ...(advanced?{videoMode:draft.videoMode,visualInputs:draft.visualInputs??[]}:{firstFrameMaterialRevisionId:materialId}),
   ...(draft?.firstFrameFit!==undefined?{firstFrameFit:draft.firstFrameFit}:{}),
   durationSeconds:draft?.durationSeconds??request.common?.durationSeconds??Number(item.durationInFrames)/timeline.fps,
   ...(videoSettings!==undefined?{videoSettings}:{}),
   ...(draft?.videoResolution!==undefined||provider==='minimax'&&sharedSettingsApply&&request.common?.videoResolution!==undefined?{videoResolution:draft?.videoResolution??request.common?.videoResolution}:{}),
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
   const state=reason&&!request.regenerateShotIds.includes(shotId)?'regenerate':'ready';
   const {selection,connection,choice}=resolved.resolved;
   const parameters=[`镜头 ${Number(targetSeconds.toFixed(2))} 秒`,`服务请求 ${providerSeconds} 秒`,visual.mode.label];
   if(videoResolution)parameters.push(videoResolution);
   if(videoSettings&&typeof videoSettings==='object'&&'resolution' in videoSettings)parameters.push(String(videoSettings.resolution));
   const inputs=visual.frozen.map((input,index)=>visual.mode.characterOrder?`character${index+1} · ${input.name}`:visual.advanced?`${videoVisualInputLabels[input.role]} · ${input.name}`:input.name);
   return{
    review:{...base,text:actualPrompt,state,...(reason&&state==='regenerate'?{reason}:{}),targetSeconds,providerSeconds,summary:{
     kind:'视频生成',target:shotId,provider:selection.provider,model:selection.model??choice.label,
     connection:connection?`${connection.name} · v${connection.version}`:'本地',parameters,inputs,prompt:actualPrompt,reservationCents,estimate,
    }},
    ...(state==='ready'?{frozen:{data:{...data,selection,reservationCents},request:resolved,target:{...workspaceCandidateTarget(item),width:timeline.width,height:timeline.height}}}:{}),
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
 const payload={...frozen.data,batchId};
 const contextHash=digest(frozen),authorizationHash=digest({approvalId,batchId,contextHash});
 await c.query(`INSERT INTO local_identity.workspace_call_confirmations(id,owner_id,workspace_id,episode_id,script_revision_id,project_sha256,workspace_revision,command,payload,context_hash,authorization_hash,summary,consumed_at,consumed_transaction)
  VALUES($1,local_identity.owner_id(),$2,$3,$4,$5,$6,'requestWorkspaceVisualCandidate',$7,$8,$9,$10,clock_timestamp(),txid_current())`,[approvalId,row.id,row.episode_id,row.script_revision_id,row.project_sha256,row.revision,JSON.stringify(payload),contextHash,authorizationHash,JSON.stringify(item.review.summary)]);
 await c.query("SELECT set_config('loop.workspace_call_confirmation',$1,true)",[approvalId]);
 const {taskId}=await queueWorkspaceVisualGeneration(c,root,row,project,payload,runtime,'candidate',{batchId,request:frozen.request});
 return {shotId:item.review.shotId,taskId,reservationCents:Number(frozen.data.reservationCents)};
}
