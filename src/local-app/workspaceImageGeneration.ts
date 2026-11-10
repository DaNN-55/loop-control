import {resolveWorkspaceImageRequest} from './workspaceVisualRequest.js';
import {currentWorkspaceCallAuthorization} from './workspaceCallConfirmation.js';
import {requireVisualStorageLocation} from './workspaceVisualMedia.js';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {workspaceCandidateTarget} from '../workspaceCandidates.js';
import {ConfigurationError} from './configurationCommands.js';
import {productionHash} from './scriptProductionStore.js';
import type {InputRuntime} from './episodeCommands.js';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';

export async function queueWorkspaceImageCandidates(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,data:Record<string,unknown>,runtime:InputRuntime){
  await requireVisualStorageLocation(c,root,row.episode_id,runtime.minimumFreeBytes);
  const clip=row.bindings.find(b=>b.itemId===data.targetItemId),item=project.timelines.flatMap(t=>t.items).find(i=>i.id===data.targetItemId);
  if(!clip||!item||!['video','image','text'].includes(String(item.kind)))throw new ConfigurationError(409,'当前镜头画面已变化。');
  const {resolved,creativeContext:context,brief,references,actualPrompt,prompt,ids}=await resolveWorkspaceImageRequest(c,root,row.episode_id,data,'queue');
  const config={...resolved.execution,budget_cents:data.reservationCents,max_attempts:1},auth=await currentWorkspaceCallAuthorization(c,row);
  await runtime.checkReferences(c,[resolved.selection.connectionVersionId!],{purpose:'workspace-generation'});
  if(!runtime.mediaReady)throw new ConfigurationError(503,'图片 Worker 未配置。');
  await runtime.mediaReady({static_visual:config});
  const timeline=project.timelines.find(t=>t.items.includes(item))!,expected=workspaceCandidateTarget(item),id=randomUUID();
  const snapshot={...(resolved?{selectionVersion:1,selection:resolved.selection,connection:resolved.connection,context,actualPrompt,target:{targetItemId:item.id,shotId:clip.shotId,workspaceRevision:Number(row.revision),projectSha256:row.project_sha256,scriptRevisionId:row.script_revision_id},costBasis:{kind:'owner-reservation',reservationCents:data.reservationCents,model:resolved.selection.model,settings:data.settings}}:{}),...(data.retryOfTaskId?{retryOfTaskId:data.retryOfTaskId}:{}),kind:'image',usage:'still',execution:config,prompt:prompt.trim(),...(data.promptReferences!==undefined?{promptReferences:data.promptReferences}:{}),imageSettings:data.settings,imageBrief:brief,references,referenceMaterialRevisionIds:ids,durationSeconds:Number(item.durationInFrames)/timeline.fps,reservationCents:data.reservationCents,authorizationHash:auth.authorization_hash};
  await c.query('INSERT INTO local_identity.workspace_visual_candidates(id,workspace_id,episode_id,clip_id,shot_id,target_item_id,input_fingerprint,target_snapshot,request_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,row.id,row.episode_id,clip.id,clip.shotId,item.id,productionHash({expected,snapshot}),JSON.stringify(expected),JSON.stringify(snapshot)]);
  try{await c.query('SELECT local_identity.queue_workspace_images($1)',[id]);}catch(error){if((error as {code?:string}).code==='55000')throw new ConfigurationError(409,'已有图片任务正在进行或提交结果未知，请先核对已有任务。');throw error;}
}
