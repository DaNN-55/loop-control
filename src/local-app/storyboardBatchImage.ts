import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {defaultImageSize,emptyImageBrief} from '../imageGeneration.js';
import {definiteStoryboardFailure,latestStoryboardTask,type StoryboardBatchFailure,type StoryboardBatchItem,type StoryboardImageDraft,type StoryboardImageSettings} from '../storyboardBatch.js';
import {workspaceCandidateTarget} from '../workspaceCandidates.js';
import {workspaceTaskPresentation} from '../workspaceTaskPresentation.js';
import {ConfigurationError,canonicalFingerprint} from './configurationCommands.js';
import type {InputRuntime} from './episodeCommands.js';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import {describeWorkspaceCall,registerConsumedWorkspaceCall} from './workspaceCallConfirmation.js';
import {queueWorkspaceImageCandidates} from './workspaceImageGeneration.js';
import {readWorkspaceTemplateInputs} from './workspaceTemplateInputs.js';
import {readWorkspaceVisualCandidates,readWorkspaceVisualTasks} from './workspaceVisualCandidates.js';

const command='requestWorkspaceImageCandidates';
export interface StoryboardImageRequest {
 shotIds:string[];
 common?:StoryboardImageSettings;
 drafts:StoryboardImageDraft[];
 regenerateShotIds:string[];
 retryFailures?:StoryboardBatchFailure[];
}
export interface StoryboardImageItem {
 review:StoryboardBatchItem;
 frozen?:{
  data:Record<string,unknown>;
  contextHash:string;
  target:ReturnType<typeof workspaceCandidateTarget>;
  retryTaskId?:string;
 };
}

export async function resolveStoryboardImage(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,request:StoryboardImageRequest):Promise<StoryboardImageItem[]>{
 const templates=await readWorkspaceTemplateInputs(c,root,row);
 const tasks=await readWorkspaceVisualTasks(c,row);
 const candidates=await readWorkspaceVisualCandidates(c,row,project,root);
 const resolveShot=async(shotId:string):Promise<StoryboardImageItem>=>{
  const clip=row.bindings.find(binding=>binding.shotId===shotId);
  const timeline=project.timelines.find(t=>t.items.some(item=>item.id===clip?.itemId));
  const item=timeline?.items.find(item=>item.id===clip?.itemId);
  const confirmed=templates?.shots.find(shot=>shot.shotId===shotId)?.imagePrompt??'';
  const draft=request.drafts.find(d=>d.shotId===shotId&&d.targetItemId===clip?.itemId&&d.preparationRevisionId===row.preparation_revision_id);
  const text=draft?.prompt??confirmed;
  const base={shotId,text,source:text!==confirmed?'draft' as const:'confirmed' as const};
  const skip=(reason:string):StoryboardImageItem=>({review:{...base,state:'skipped',reason}});
  if(!item||!timeline||!['video','image','text'].includes(String(item.kind)))return skip('镜头已移除');
  if(!text.trim())return skip('请填写这个镜头的图片提示词');
  const prior=tasks.filter(t=>t.targetItemId===item.id&&t.kind==='image'&&!t.retryTaskId);
  if(prior.some(t=>{const state=workspaceTaskPresentation(t);return state.unknown||state.held;}))return skip('图片回执待核对，请先查看原任务');
  if(prior.some(t=>workspaceTaskPresentation(t).active))return skip('已有图片任务正在进行');
  const retryTaskId=request.retryFailures?.find(failure=>failure.shotId===shotId)?.taskId;
  if(request.retryFailures){
   const latest=latestStoryboardTask(prior);
   if(!latest||latest.taskId!==retryTaskId||!definiteStoryboardFailure(latest))return skip('原图片任务已变化，请重新核对');
  }
  const existing=candidates.find(candidate=>candidate.targetItemId===item.id&&candidate.kind==='image'&&candidate.status==='available');
  const reason=existing?'已有未采用的图片候选':item.kind==='image'?'已有可用图片':'';
  const data={episodeId:row.episode_id,workspaceId:row.id,expectedRevision:Number(row.revision),targetItemId:item.id,
   prompt:text.trim(),selection:draft?.selection!==undefined?draft.selection:request.common?.selection,
   settings:{size:defaultImageSize(timeline.width,timeline.height),quality:'auto',count:1,...request.common?.settings,...draft?.settings},
   imageBrief:{...emptyImageBrief,...draft?.imageBrief},referenceMaterialRevisionIds:draft?.referenceMaterialRevisionIds??[],
   ...(draft?.promptReferences?.length?{promptReferences:draft.promptReferences}:{}),
  };
  try{
   const {summary,contextHash}=await describeWorkspaceCall(c,root,row,project,command,data);
   const review={...base,text:summary.prompt,summary};
   if(reason&&!retryTaskId&&!request.regenerateShotIds.includes(shotId))return {review:{...review,state:'regenerate' as const,reason}};
   return {review:{...review,state:'ready' as const},frozen:{data:{...data,reservationCents:summary.reservationCents},contextHash,target:workspaceCandidateTarget(item),...(retryTaskId?{retryTaskId}:{})}};
  }catch(error){
   if(error instanceof ConfigurationError&&error.status<500)return skip(error.message);
   if((error as NodeJS.ErrnoException).code==='ENOENT')return skip('本镜头的参考图文件已缺失。');
   throw error;
  }
 };
 const items:StoryboardImageItem[]=[];
 for(const shotId of request.shotIds)items.push(await resolveShot(shotId));
 return items;
}

export async function queueStoryboardImage(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,runtime:InputRuntime,batchId:string,item:StoryboardImageItem){
 const {data,contextHash,retryTaskId}=item.frozen!;
 const id=randomUUID(),authorizationHash=canonicalFingerprint({id,batchId,data,contextHash});
 await registerConsumedWorkspaceCall(c,row,{id,command,payload:{...data,batchId,...(retryTaskId?{batchRetryOfTaskId:retryTaskId}:{})},contextHash,authorizationHash,summary:item.review.summary!});
 const taskId=await queueWorkspaceImageCandidates(c,root,row,project,data,runtime,batchId);
 return {shotId:item.review.shotId,taskId,reservationCents:item.review.summary!.reservationCents};
}
