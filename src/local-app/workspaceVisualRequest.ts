import {resolvePromptReferences} from '../promptReferences.js';
import type {PoolClient} from 'pg';
import {relative} from 'node:path';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {resolveProductionSelection} from './productionSelection.js';
import {resolveWorkspaceVideoInputs} from './resolveWorkspaceVideoInputs.js';
import {episodeFileIO,verifyEpisodeFile} from './episodeFiles.js';
import {inspectWorkspaceVisualFile} from './workspaceVisualMedia.js';
import {resolveWorkspaceSource} from './workspaceSources.js';
import {probeMp3Artifact} from '../worker/mediaTools.js';
import {resolveWorkspaceMainVoice} from '../workspaceAudio.js';
import {workspaceVisualVoiceIdentity} from '../workspaceVisualCandidates.js';
import {creativeAccountRules,creativeMediaPrompt} from '../creativeAccountRules.js';
import {emptyImageBrief,isImageBrief,isImageGenerationSettings,imageBriefPrompt,imageRequestPrompt} from '../imageGeneration.js';
import {defaultWanModelSettings,wanProviderDuration,wanVideoSettingsError} from '../wanVideoModels.js';
import {isWanGenerationSettings} from '../videoGenerationSettings.js';
import {isVideoProvider,videoProviders,minimaxVideoResolution} from '../worker/videoProviderCatalog.js';
import {ConfigurationError} from './configurationCommands.js';

// Confirmation retains its existing acceptance rules and measured image metadata.
// Queueing re-reads the facts and applies the existing stricter execution checks.
type Phase='confirmation'|'queue';
async function visualContext(c:PoolClient,episodeId:string){
 const context=(await c.query('SELECT e.account_id,e.blueprint_version_id,e.series_version_id,b.policy,s.rules FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id LEFT JOIN public.series_versions s ON s.id=e.series_version_id WHERE e.id=$1',[episodeId])).rows[0];
 const creativeContext={accountId:context.account_id,blueprintVersionId:context.blueprint_version_id,accountRules:creativeAccountRules(context.policy),seriesVersionId:context.series_version_id,seriesRules:context.rules??null};
 return{context,creativeContext};
}

export async function resolveWorkspaceImageRequest(c:PoolClient,root:string,episodeId:string,data:Record<string,unknown>,phase:Phase){
 if(phase==='queue'&&(typeof data.prompt!=='string'||!data.prompt.trim()||data.prompt.length>1200||!isImageGenerationSettings(data.settings)||!Number.isSafeInteger(data.reservationCents)||Number(data.reservationCents)<1||Number(data.reservationCents)>100000))throw new ConfigurationError(400,'请填写图片提示词、有效生成设置和本次费用预留。');
 const {context,creativeContext}=await visualContext(c,episodeId),resolved=await resolveProductionSelection(c,data.selection,'image');
 const prompt=String(data.prompt??'');
 if(!prompt.trim())throw new ConfigurationError(400,'请填写本次调用内容。');
 const settings=data.settings as {size?:string;quality?:string;count?:number}|undefined,constraints=resolved.choice.constraints;
 if(!settings||!constraints.sizes?.includes(String(settings.size))||!constraints.qualities?.includes(String(settings.quality))||!constraints.counts?.includes(Number(settings.count)))throw new ConfigurationError(400,phase==='confirmation'?'图片生成设置不可用。':'图片设置或参考图与所选模型不兼容。');
 const ids=data.referenceMaterialRevisionIds;
 if(!Array.isArray(ids)||ids.length>16)throw new ConfigurationError(400,phase==='confirmation'?'参考图参数无效。':'参考图无效或超过 16 张。');
 if(new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))throw new ConfigurationError(400,phase==='confirmation'?'参考素材标识无效或重复。':'参考图无效或超过 16 张。');
 const brief=data.imageBrief??emptyImageBrief;
 if(!isImageBrief(brief,ids))throw new ConfigurationError(400,phase==='confirmation'?'参考图用途或构图设置无效。':'参考用途或构图设置无效，请重新确认。');
 if(phase==='queue'){
  if(Object.keys(settings).some(key=>!['size','quality','count'].includes(key)))throw new ConfigurationError(400,'图片设置包含不支持的参数。');
  if(ids.length>(constraints.referenceImages?.max??0))throw new ConfigurationError(400,'图片设置或参考图与所选模型不兼容。');
 }
 const materials=[];let referenceBytes=0;
 const fileIO=phase==='confirmation'?await episodeFileIO(c,root,episodeId):undefined;
 for(const id of ids){
  const material=(await c.query("SELECT id,source_path,storage_path,mime_type,sha256,file_size FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type='image'",[id,episodeId])).rows[0];
  if(!material)throw new ConfigurationError(phase==='confirmation'?409:400,phase==='confirmation'?'参考图或首帧已变化，请重新选择本期图片。':'参考图须为本期 PNG、JPEG 或 WebP，每张不超过 20 MB。');
  referenceBytes+=Number(material.file_size);
  if(!['image/png','image/jpeg','image/webp'].includes(material.mime_type)||Number(material.file_size)>20*1024*1024)throw new ConfigurationError(400,phase==='confirmation'?'参考图须为本期 PNG、JPEG 或 WebP，每张不超过 20 MB，总计不超过 40 MB。':'参考图须为本期 PNG、JPEG 或 WebP，每张不超过 20 MB。');
  if(referenceBytes>40*1024*1024)throw new ConfigurationError(400,phase==='confirmation'?'参考图须为本期 PNG、JPEG 或 WebP，每张不超过 20 MB，总计不超过 40 MB。':'参考图总大小不能超过 40 MB。');
  await verifyEpisodeFile(c,root,episodeId,material.storage_path,material.sha256,Number(material.file_size));
  if(fileIO){const measured=await inspectWorkspaceVisualFile(root,relative(root,await fileIO.resolveReference(material.storage_path)),'image');material.width=measured.width;material.height=measured.height;}
  materials.push(material);
 }
 let referencePrompt:string;try{referencePrompt=resolvePromptReferences(prompt,data.promptReferences,materials.map(m=>({materialRevisionId:m.id,kind:'image',name:m.source_path})));}catch(error){throw new ConfigurationError(400,(error as Error).message);}
 const actualPrompt=imageRequestPrompt(referencePrompt,brief,ids,creativeContext.accountRules,creativeContext.seriesRules);
 if(phase==='queue'&&actualPrompt.length>(constraints.prompt?.maxLength??1200))throw new ConfigurationError(400,'图片提示词与账号、系列规则合并后过长，请精简后提交。');
 const references=materials.map(material=>({artifactType:'static_visual',relativePath:material.storage_path,sha256:material.sha256,fileSize:Number(material.file_size),mimeType:material.mime_type,materialRevisionId:material.id}));
 return{context,creativeContext,resolved,brief,materials,references,actualPrompt,prompt,ids,displayPrompt:[prompt,imageBriefPrompt(brief,ids)].filter(Boolean).join('\n\n')};
}

export async function workspaceVisualMainVoice(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,shotId:string){
 const route=resolveWorkspaceMainVoice(project,shotId),item=route.item;
 if(!item)return{mode:'none',windowDurationSeconds:null,identity:workspaceVisualVoiceIdentity(project,shotId),source:null};
 if(typeof item.src!=='string'||item.edits||!(Number(item.playbackRate??1)>0))throw new ConfigurationError(409,'当前实际主声音窗口无法用于画面生成，请先明确其使用区间。');
 const source=await resolveWorkspaceSource(c,root,row.episode_id,item.src),timeline=project.timelines.find(t=>t.items.includes(item))!,duration=Number(item.durationInFrames)/timeline.fps,observed=await probeMp3Artifact(await (await episodeFileIO(c,root,row.episode_id)).resolveReference(item.src));if(Number(item.srcInFrame??0)/timeline.fps+duration*Number(item.playbackRate??1)>observed+0.05)throw new ConfigurationError(409,'实际主声音轨短于当前使用窗口。');
 return{mode:item.id===`workspace-source-shot-${shotId}`?'source':'tts',windowDurationSeconds:duration,identity:workspaceVisualVoiceIdentity(project,shotId),source:{id:source.id,relativePath:item.src,sha256:source.sha256,fileSize:Number(source.file_size),srcInFrame:Number(item.srcInFrame??0),playbackRate:Number(item.playbackRate??1),coverage:route.coverage}};
}

export async function resolveWorkspaceVideoRequest(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,data:Record<string,unknown>,phase:Phase){
 const {context,creativeContext}=await visualContext(c,row.episode_id),resolved=await resolveProductionSelection(c,data.selection,'video');
 if(resolved.choice.mode!=='generation')throw new ConfigurationError(400,phase==='confirmation'?'请选择生成服务。':'请选择视频生成服务；素材检索请使用检索入口。');
 if(phase==='queue'&&(typeof data.prompt!=='string'||!data.prompt.trim()||data.prompt.length>1500))throw new ConfigurationError(400,'首帧或动作描述无效。');
 const prompt=String(data.prompt??'');if(!prompt.trim())throw new ConfigurationError(400,'请填写本次调用内容。');
 const provider=resolved.selection.provider,videoSettings=provider==='bailian'?(data.videoSettings??defaultWanModelSettings(resolved.selection.model!)):undefined;
 if(phase==='queue'){
  const config=resolved.execution;
  if(!config.credential_ref||!(provider==='bailian'&&config.executor.adapter==='wan_video'||isVideoProvider(provider)&&config.executor.adapter===videoProviders[provider].adapter))throw new ConfigurationError(409,'请为当前镜头选择既有视频连接。');
  if(data.videoSettings!==undefined&&(provider!=='bailian'||!isWanGenerationSettings(data.videoSettings)||Object.keys(data.videoSettings).some(key=>!['resolution','audio','promptExtend','shotType','watermark','negativePrompt','seed'].includes(key))))throw new ConfigurationError(400,'视频参数无效或不适用于当前模型。');
  if(provider==='bailian'){const problem=wanVideoSettingsError(resolved.selection.model!,videoSettings);if(problem)throw new ConfigurationError(400,problem);}
  if(data.firstFrameFit!==undefined&&!['contain','cover'].includes(String(data.firstFrameFit)))throw new ConfigurationError(400,'首帧构图无效。');
 }
 let videoResolution:string|undefined;
 try{if(provider==='minimax')videoResolution=minimaxVideoResolution(resolved.selection.model!,data.videoResolution??'768P');else if(data.videoResolution!==undefined)throw Error('所选模型不支持 MiniMax 分辨率设置。');}catch(error){throw new ConfigurationError(400,error instanceof Error?error.message:'视频分辨率无效。');}
 const clip=row.bindings.find(binding=>binding.itemId===data.targetItemId||binding.id===data.clipId);if(!clip)throw new ConfigurationError(409,'当前镜头已变化。');
 const mainVoice=await workspaceVisualMainVoice(c,root,row,project,clip.shotId),targetSeconds=mainVoice.windowDurationSeconds??Number(data.durationSeconds),bounds=resolved.choice.constraints.durationSeconds!,min=bounds?.min??2;
 const providerSeconds=provider==='bailian'?wanProviderDuration(resolved.selection.model!,targetSeconds,mainVoice.windowDurationSeconds!==null)??NaN:mainVoice.windowDurationSeconds!==null?Math.max(min,Math.ceil(targetSeconds)):targetSeconds;
 if(phase==='confirmation'&&(!providerSeconds||!Number.isFinite(targetSeconds)||targetSeconds<=0))throw new ConfigurationError(400,'视频生成时长无效。');
 if(phase==='queue'){
  if(mainVoice.windowDurationSeconds!==null&&targetSeconds>bounds.max)throw new ConfigurationError(409,`当前实际主声时长超过所选服务上限 ${bounds.max} 秒，请明确拆分镜头；不会截断口播。`);
  if(!Number.isInteger(providerSeconds)||providerSeconds<bounds.min||providerSeconds>bounds.max)throw new ConfigurationError(409,`当前画面时长不在所选服务 ${bounds.min}～${bounds.max} 秒范围，请明确拆分或调整；不会变速或循环。`);
  if(!Number.isSafeInteger(data.reservationCents)||Number(data.reservationCents)<1||Number(data.reservationCents)>100000)throw new ConfigurationError(400,'请填写本次费用预留。');
 }
 const visual=await resolveWorkspaceVideoInputs(c,root,row.episode_id,data,resolved);
 let referencePrompt:string;try{referencePrompt=resolvePromptReferences(prompt,data.promptReferences,visual.frozen.map(input=>({materialRevisionId:input.materialRevisionId,kind:input.role==='referenceVideos'?'video':'image',name:input.name,role:input.role})),{provider,characterOrder:visual.mode.characterOrder,referenceMode:visual.mode.id==='references'});}catch(error){throw new ConfigurationError(400,(error as Error).message);}
 const actualPrompt=creativeMediaPrompt(referencePrompt,creativeContext.accountRules,creativeContext.seriesRules);
 if(phase==='queue'&&actualPrompt.length>(resolved.choice.constraints.prompt?.maxLength??1500))throw new ConfigurationError(400,'动作描述与账号、系列规则合并后过长，请精简后提交。');
 return{context,creativeContext,resolved,visual,mainVoice,targetSeconds,providerSeconds,actualPrompt,videoSettings,videoResolution,prompt};
}
