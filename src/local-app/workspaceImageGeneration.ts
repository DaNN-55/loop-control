import {currentWorkspaceCallAuthorization} from './workspaceCallConfirmation.js';
import {requireVisualStorageLocation} from './workspaceVisualMedia.js';
import {creativeAccountRules} from '../creativeAccountRules.js';
import {resolveProductionSelection} from './productionSelection.js';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {workspaceCandidateTarget} from '../workspaceCandidates.js';
import {isImageGenerationSettings,isImageBrief,imageRequestPrompt,emptyImageBrief} from '../imageGeneration.js';
import {ConfigurationError} from './configurationCommands.js';
import {productionHash} from './scriptProductionStore.js';
import {verifyEpisodeFile} from './episodeFiles.js';
import type {InputRuntime} from './episodeCommands.js';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';

export async function queueWorkspaceImageCandidates(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,data:Record<string,unknown>,runtime:InputRuntime){
  await requireVisualStorageLocation(c,root,row.episode_id,runtime.minimumFreeBytes);
  const clip=row.bindings.find(b=>b.itemId===data.targetItemId),item=project.timelines.flatMap(t=>t.items).find(i=>i.id===data.targetItemId);
  if(!clip||!item||!['video','image','text'].includes(String(item.kind)))throw new ConfigurationError(409,'当前镜头画面已变化。');
  if(typeof data.prompt!=='string'||!data.prompt.trim()||data.prompt.length>1200||!isImageGenerationSettings(data.settings)||!Number.isSafeInteger(data.reservationCents)||Number(data.reservationCents)<1||Number(data.reservationCents)>100000)throw new ConfigurationError(400,'请填写图片提示词、有效生成设置和本次费用预留。');
  const ids=data.referenceMaterialRevisionIds;
  if(!Array.isArray(ids)||ids.length>16||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))throw new ConfigurationError(400,'参考图无效或超过 16 张。');
  const brief=data.imageBrief??emptyImageBrief;
  if(!isImageBrief(brief,ids))throw new ConfigurationError(400,'参考用途或构图设置无效，请重新确认。');
  const e=(await c.query('SELECT e.account_id,e.blueprint_version_id,e.series_version_id,b.policy,s.rules series_rules FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id LEFT JOIN public.series_versions s ON s.id=e.series_version_id WHERE e.id=$1',[row.episode_id])).rows[0];
  if(Object.keys(data.settings).some(key=>!['size','quality','count'].includes(key)))throw new ConfigurationError(400,'图片设置包含不支持的参数。');
  const resolved=await resolveProductionSelection(c,data.selection,'image');
  const config={...resolved.execution,budget_cents:data.reservationCents,max_attempts:1};
  const auth=await currentWorkspaceCallAuthorization(c,row);
  if(resolved){const constraints=resolved.choice.constraints,settings=data.settings;if(!constraints.sizes?.includes(settings.size)||!constraints.qualities?.includes(settings.quality)||!constraints.counts?.includes(settings.count)||ids.length>(constraints.referenceImages?.max??0))throw new ConfigurationError(400,'图片设置或参考图与所选模型不兼容。');}
  const references=[];let totalBytes=0;
  for(const id of ids){
    const m=(await c.query("SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type='image'",[id,row.episode_id])).rows[0];
    if(!m||!['image/png','image/jpeg','image/webp'].includes(m.mime_type)||Number(m.file_size)>20*1024*1024)throw new ConfigurationError(400,'参考图须为本期 PNG、JPEG 或 WebP，每张不超过 20 MB。');
    totalBytes+=Number(m.file_size);if(totalBytes>40*1024*1024)throw new ConfigurationError(400,'参考图总大小不能超过 40 MB。');
    await verifyEpisodeFile(c,root,row.episode_id,m.storage_path,m.sha256,Number(m.file_size));
    references.push({artifactType:'static_visual',relativePath:m.storage_path,sha256:m.sha256,fileSize:Number(m.file_size),mimeType:m.mime_type,materialRevisionId:m.id});
  }
  await runtime.checkReferences(c,[resolved.selection.connectionVersionId!]);
  if(!runtime.mediaReady)throw new ConfigurationError(503,'图片 Worker 未配置。');
  await runtime.mediaReady({static_visual:config});
  const timeline=project.timelines.find(t=>t.items.includes(item))!,expected=workspaceCandidateTarget(item),id=randomUUID();
  const creative=creativeAccountRules(e.policy);
  const context={accountId:e.account_id,blueprintVersionId:e.blueprint_version_id,accountRules:creative,seriesVersionId:e.series_version_id,seriesRules:e.series_rules??null};
  const actualPrompt=imageRequestPrompt(data.prompt,brief,ids,creative,context.seriesRules);
  if(resolved&&actualPrompt.length>(resolved.choice.constraints.prompt?.maxLength??1200))throw new ConfigurationError(400,'图片提示词与账号、系列规则合并后过长，请精简后提交。');
  const snapshot={...(resolved?{selectionVersion:1,selection:resolved.selection,connection:resolved.connection,context,actualPrompt,target:{targetItemId:item.id,shotId:clip.shotId,workspaceRevision:Number(row.revision),projectSha256:row.project_sha256,scriptRevisionId:row.script_revision_id},costBasis:{kind:'owner-reservation',reservationCents:data.reservationCents,model:resolved.selection.model,settings:data.settings}}:{}),kind:'image',usage:'still',execution:config,prompt:data.prompt.trim(),imageSettings:data.settings,imageBrief:brief,references,referenceMaterialRevisionIds:ids,durationSeconds:Number(item.durationInFrames)/timeline.fps,reservationCents:data.reservationCents,authorizationHash:auth.authorization_hash};
  await c.query('INSERT INTO local_identity.workspace_visual_candidates(id,workspace_id,episode_id,clip_id,shot_id,target_item_id,input_fingerprint,target_snapshot,request_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,row.id,row.episode_id,clip.id,clip.shotId,item.id,productionHash({expected,snapshot}),JSON.stringify(expected),JSON.stringify(snapshot)]);
  try{await c.query('SELECT local_identity.queue_workspace_images($1)',[id]);}catch(error){if((error as {code?:string}).code==='55000')throw new ConfigurationError(409,'已有图片任务正在进行或提交结果未知，请先核对已有任务。');throw error;}
}
