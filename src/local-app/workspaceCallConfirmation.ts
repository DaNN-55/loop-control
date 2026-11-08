import {imageQualityLabels} from '../imageGeneration.js';
import {resolveWorkspaceVideoInputs} from './resolveWorkspaceVideoInputs.js';
import {soundIntentQuery} from '../soundIntent.js';
import {videoVisualInputLabels} from '../videoVisualInputs.js';
import {relative} from 'node:path';
import {episodeFileIO,verifyEpisodeFile} from './episodeFiles.js';
import {inspectWorkspaceVisualFile} from './workspaceVisualMedia.js';
import {creativeAccountRules,creativeMediaPrompt} from '../creativeAccountRules.js';
import {estimateWorkspaceCall} from './workspaceCallEstimate.js';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import {productionWorkspaceFields} from '../productionWorkspace.js';
import {requiresWorkspaceCall,type WorkspaceCallSummary,type WorkspaceCallProposal} from '../workspaceCall.js';
import {resolveProductionSelection} from './productionSelection.js';
import {readWorkspaceNarration} from './workspaceNarration.js';
import {readWorkspaceVisualTasks,workspaceVisualMainVoice} from './workspaceVisualCandidates.js';
import {isImageBrief,imageBriefPrompt,imageRequestPrompt,emptyImageBrief} from '../imageGeneration.js';
import {wanProviderDuration} from '../wanVideoModels.js';
import {productionHash} from './scriptProductionStore.js';
import {ConfigurationError,canonical} from './configurationCommands.js';

/** Resolve the same selection and native voice window used by the queue. No Provider is invoked. */
async function describe(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,command:string,payload:Record<string,unknown>){
 if(JSON.stringify(payload).length>16384||!requiresWorkspaceCall(command,payload)||!Object.hasOwn(productionWorkspaceFields,command)||Object.keys(payload).some(k=>!productionWorkspaceFields[command].includes(k))||payload.episodeId!==row.episode_id||payload.workspaceId!==row.id||payload.expectedRevision!==Number(row.revision))throw new ConfigurationError(400,'本次调用参数无效，请重新填写。');
 const context=(await c.query('SELECT e.account_id,e.blueprint_version_id,e.series_version_id,b.policy,s.rules FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id LEFT JOIN public.series_versions s ON s.id=e.series_version_id WHERE e.id=$1',[row.episode_id])).rows[0];
 let imageBrief=emptyImageBrief;
 let videoInputs:Awaited<ReturnType<typeof resolveWorkspaceVideoInputs>>|undefined;
 const speech=command==='generateWorkspaceNarration',sound=command==='prepareWorkspaceAudio',image=command==='requestWorkspaceImageCandidates';
 let selection=payload.selection,prompt=String(payload.prompt??''),target=row.bindings.find(b=>b.itemId===payload.targetItemId||b.id===payload.clipId)?.shotId??String(payload.shotId??'整期'),amount=payload.reservationCents===undefined?undefined:Number(payload.reservationCents),providerDuration:number|undefined,parameters:string[]=[],ids:unknown[]=[],narration:unknown=null,previous:Record<string,any>|null=null;
 if(speech){const n=(await readWorkspaceNarration(c,row,project)).find(n=>n.clipId===payload.clipId);if(!n||n.mode!=='tts'||!n.confirmed)throw new ConfigurationError(409,'请先保存并确认当前口播。');narration=n;selection=n.selection;prompt=n.text;target=n.shotId;parameters=[`${n.text.length} 字`,`音色：${n.voice??'默认'}`,`语速：${n.speakingRate??1}`];}
 if(sound){
  if(payload.preparationId){const p=(await c.query('SELECT p.*,t.input_snapshot FROM local_identity.workspace_audio_preparations p JOIN public.tasks t ON t.id=p.task_id WHERE p.id=$1 AND p.workspace_id=$2',[payload.preparationId,row.id])).rows[0];if(!p||p.kind==='source')throw new ConfigurationError(409,'原在线音效请求不可用。');previous=p;selection=p.request_snapshot?.selection??p.input_snapshot?.production_selection;prompt=p.query;target=p.shot_id??'整期';parameters=[`${p.duration_seconds} 秒`,p.description];}
  else{prompt=String(payload.query||soundIntentQuery(String(payload.intent??'')));parameters=[`${Number(payload.durationSeconds)} 秒`,String(payload.description??''),...(payload.candidateCount?[`${payload.candidateCount} 条候选`]:[]),...(payload.intent?[`音效意图：${payload.intent}`]:[])];}
  amount=0;
 }
 let retryOfTaskId:string|undefined;
 if(image&&Object.hasOwn(payload,'retryOfTaskId')){
  const tasks=await readWorkspaceVisualTasks(c,row);
  const original=tasks.find(t=>t.taskId===payload.retryOfTaskId&&t.kind==='image'&&t.targetItemId===payload.targetItemId);
  if(!original?.submissionUnknown||original.submissionOutcome==='received'||original.retryTaskId||original.publicationAttempt!=null)throw new ConfigurationError(409,'原图片任务已变化，请刷新后核对。');
  retryOfTaskId=original.taskId;
 }
 const resolved=sound&&previous?{selection:previous.request_snapshot.selection,connection:previous.request_snapshot.connection,choice:{label:'Freesound 检索',mode:'search',constraints:{} as Awaited<ReturnType<typeof resolveProductionSelection>>['choice']['constraints']}}:await resolveProductionSelection(c,selection,image?'image':speech?'speech':sound?'music_sound':'video');
 if(!sound&&resolved.choice.mode!=='generation')throw new ConfigurationError(400,'请选择生成服务。');
 if(!prompt.trim())throw new ConfigurationError(400,'请填写本次调用内容。');
 if(image){const settings=payload.settings as {size?:string;quality?:string;count?:number}|undefined;if(!settings||!resolved.choice.constraints.sizes?.includes(String(settings.size))||!resolved.choice.constraints.qualities?.includes(String(settings.quality))||!resolved.choice.constraints.counts?.includes(Number(settings.count)))throw new ConfigurationError(400,'图片生成设置不可用。');parameters=[`${settings.count} 张`,String(settings.size).replace('x',' × '),`质量：${(imageQualityLabels as Record<string,string>)[String(settings.quality)]??settings.quality}`];if(!Array.isArray(payload.referenceMaterialRevisionIds)||payload.referenceMaterialRevisionIds.length>16)throw new ConfigurationError(400,'参考图参数无效。');ids=payload.referenceMaterialRevisionIds;const brief=payload.imageBrief??emptyImageBrief;if(!isImageBrief(brief,ids))throw new ConfigurationError(400,'参考图用途或构图设置无效。');imageBrief=brief;prompt=[prompt,imageBriefPrompt(brief,ids as string[])].filter(Boolean).join('\n\n');}
 else if(!speech&&!sound){const clip=row.bindings.find(b=>b.itemId===payload.targetItemId||b.id===payload.clipId);if(!clip)throw new ConfigurationError(409,'当前镜头已变化。');const voice=await workspaceVisualMainVoice(c,root,row,project,clip.shotId);if(command==='generateWorkspaceImage'&&voice.windowDurationSeconds===null){const n=(await readWorkspaceNarration(c,row,project)).find(n=>n.shotId===clip.shotId);if(n&&!n.selection&&!n.requiresCandidateAdoption&&Number(row.native_edit_revision??0)===0&&n.confirmed&&n.audioTrackId&&!n.adoptedAudioTrackId)throw new ConfigurationError(409,'请先刷新并装配已有口播，再确认实际时长与本次视频调用。');}const duration=voice.windowDurationSeconds??Number(payload.durationSeconds),min=resolved.choice.constraints.durationSeconds?.min??2,providerSeconds=resolved.selection.provider==='bailian'?wanProviderDuration(resolved.selection.model!,duration,voice.windowDurationSeconds!==null):voice.windowDurationSeconds!==null?Math.max(min,Math.ceil(duration)):duration;if(!providerSeconds||!Number.isFinite(duration)||duration<=0)throw new ConfigurationError(400,'视频生成时长无效。');providerDuration=providerSeconds;parameters=[`镜头 ${duration} 秒`,`服务请求 ${providerSeconds} 秒`];videoInputs=await resolveWorkspaceVideoInputs(c,root,row.episode_id,payload,resolved as Awaited<ReturnType<typeof resolveProductionSelection>>);
 if(videoInputs.advanced)parameters.push(videoInputs.mode.label);
 if(videoInputs.referenceVideoSeconds)parameters.push(`参考视频 ${videoInputs.referenceVideoSeconds.toFixed(2)} 秒`);
 narration=voice;}
 if(new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))throw new ConfigurationError(400,'参考素材标识无效或重复。');
 const materials=[];let referenceBytes=0;const fileIO=image?await episodeFileIO(c,root,row.episode_id):undefined;
 for(const id of ids){const m=(await c.query("SELECT id,source_path,storage_path,mime_type,sha256,file_size FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type='image'",[id,row.episode_id])).rows[0];if(!m)throw new ConfigurationError(409,'参考图或首帧已变化，请重新选择本期图片。');if(image){
  referenceBytes+=Number(m.file_size);if(!['image/png','image/jpeg','image/webp'].includes(m.mime_type)||Number(m.file_size)>20*1024*1024||referenceBytes>40*1024*1024)throw new ConfigurationError(400,'参考图须为本期 PNG、JPEG 或 WebP，每张不超过 20 MB，总计不超过 40 MB。');
  await verifyEpisodeFile(c,root,row.episode_id,m.storage_path,m.sha256,Number(m.file_size));
  const measured=await inspectWorkspaceVisualFile(root,relative(root,await fileIO!.resolveReference(m.storage_path)),'image');m.width=measured.width;m.height=measured.height;
 }materials.push(m);}
 const requestPrompt=image
  ? imageRequestPrompt(String(payload.prompt),imageBrief,ids as string[],creativeAccountRules(context.policy),context.rules)
  : !speech&&!sound ? creativeMediaPrompt(prompt,creativeAccountRules(context.policy),context.rules) : prompt;
 // MiniMax's actual endpoint is selected by the credential region. The version's
 // legacy endpoint may still be international; use the same non-secret intent
 // metadata as the connection catalogue, without opening the credential.
 const region=resolved.selection.provider==='minimax'&&resolved.connection?(await c.query("SELECT metadata->>'region' region FROM local_identity.connection_intents WHERE version_id=$1 AND owner_id=local_identity.owner_id() AND applied_at IS NOT NULL AND metadata->>'provider'='minimax' AND metadata->>'command' IN ('create','rotate') ORDER BY created_at DESC LIMIT 1",[resolved.connection.id])).rows[0]?.region??'international':undefined;
 const estimate=estimateWorkspaceCall({kind:image?'image':speech?'speech':sound?'sound':'video',provider:resolved.selection.provider,model:resolved.selection.model,seconds:providerDuration,referenceVideoSeconds:videoInputs?.referenceVideoSeconds,referenceVideoDurations:videoInputs?.referenceVideoDurations,videoImageCount:videoInputs?.frozen.filter(input=>input.role!=='referenceVideos').length,text:requestPrompt,settings:payload.settings as {size:string;quality:string;count:number}|undefined,referenceImages:image?materials.map(m=>({width:m.width,height:m.height})):undefined,videoSettings:payload.videoSettings as Parameters<typeof estimateWorkspaceCall>[0]['videoSettings'],region});
 amount??=estimate.suggestedCents;
 if(typeof payload.reservationCents!=='undefined'&&typeof payload.reservationCents!=='number'||!Number.isSafeInteger(amount)||amount<estimate.minimumCents||amount>estimate.maximumCents)throw new ConfigurationError(400,`本次费用预留须为 ¥${(estimate.minimumCents/100).toFixed(2)}～¥${(estimate.maximumCents/100).toFixed(2)}。`);
 const summary:WorkspaceCallSummary={kind:image?'图片生成':speech?'口播生成':sound?'在线音效':'视频生成',target,provider:resolved.selection.provider,model:resolved.selection.model??resolved.choice.label,connection:resolved.connection?`${resolved.connection.name} · v${resolved.connection.version}`:'本地',parameters,inputs:videoInputs?videoInputs.frozen.map((input,index)=>videoInputs!.mode.characterOrder?`character${index+1} · ${input.name}`:videoInputs!.advanced?`${videoVisualInputLabels[input.role]} · ${input.name}`:input.name):materials.map(m=>m.source_path.split('/').pop()??m.source_path),prompt,reservationCents:amount,estimate,...(retryOfTaskId?{retryOfTaskId}:{})};
 return{summary,contextHash:productionHash(canonical({context,resolved,narration,materials,videoInputs,previous,region,...(!speech&&!sound?{requestPrompt}:{})}))};
}
export async function prepareWorkspaceCall(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,command:unknown,payload:unknown):Promise<WorkspaceCallProposal>{
 if(typeof command!=='string'||!payload||typeof payload!=='object'||Array.isArray(payload))throw new ConfigurationError(400,'本次调用参数无效。');
 const input={...payload as Record<string,unknown>},description=await describe(c,root,row,project,command,input),id=randomUUID();
 if(command!=='prepareWorkspaceAudio')input.reservationCents=description.summary.reservationCents;
 const owner=(await c.query('SELECT local_identity.owner_id() id')).rows[0].id;
 const result=(await c.query('INSERT INTO local_identity.workspace_call_confirmations(id,owner_id,workspace_id,episode_id,script_revision_id,project_sha256,workspace_revision,command,payload,context_hash,authorization_hash,summary) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING expires_at',[id,owner,row.id,row.episode_id,row.script_revision_id,row.project_sha256,Number(row.revision),command,JSON.stringify(input),description.contextHash,productionHash({id,owner,workspace:row.id,input,contextHash:description.contextHash}),JSON.stringify(description.summary)])).rows[0];
 return{confirmationId:id,expiresAt:new Date(result.expires_at).toISOString(),summary:description.summary};
}
export async function consumeWorkspaceCall(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,id:unknown,reservationCents?:unknown){
 if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw new ConfigurationError(400,'请重新确认本次调用。');
 const approval=(await c.query('SELECT * FROM local_identity.workspace_call_confirmations WHERE id=$1 AND workspace_id=$2 AND owner_id=local_identity.owner_id() FOR UPDATE',[id,row.id])).rows[0];
 if(!approval||approval.consumed_at||new Date(approval.expires_at).getTime()<=Date.now()||approval.project_sha256!==row.project_sha256||approval.script_revision_id!==row.script_revision_id||Number(approval.workspace_revision)!==Number(row.revision))throw new ConfigurationError(409,'本次确认已过期、已使用或工程已变化，请重新确认。');
 const current=await describe(c,root,row,project,approval.command,approval.payload);
 if(current.contextHash!==approval.context_hash||productionHash(current.summary)!==productionHash(approval.summary))throw new ConfigurationError(409,'连接、输入或费用依据已变化，请重新确认本次调用。');
 const amount=reservationCents===undefined?current.summary.reservationCents:reservationCents,limits=current.summary.estimate!;
 if(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<limits.minimumCents||amount>limits.maximumCents)throw new ConfigurationError(400,`本次费用预留须为 ¥${(limits.minimumCents/100).toFixed(2)}～¥${(limits.maximumCents/100).toFixed(2)}。`);
 if(approval.command!=='prepareWorkspaceAudio')approval.payload.reservationCents=amount;current.summary.reservationCents=amount;
 const authorizationHash=productionHash({id,owner:approval.owner_id,workspace:row.id,input:approval.payload,contextHash:current.contextHash});
 await c.query('UPDATE local_identity.workspace_call_confirmations SET payload=$2,summary=$3,authorization_hash=$4,consumed_at=clock_timestamp(),consumed_transaction=txid_current() WHERE id=$1',[id,JSON.stringify(approval.payload),JSON.stringify(current.summary),authorizationHash]);
 await c.query("SELECT set_config('loop.workspace_call_confirmation',$1,true)",[id]);
 return{command:approval.command as string,payload:approval.payload as Record<string,unknown>};
}
export async function currentWorkspaceCallAuthorization(c:PoolClient,row:ProductionWorkspaceRecord){
 const hash=(await c.query('SELECT local_identity.current_workspace_call_hash($1) hash',[row.id])).rows[0]?.hash;
 if(!hash)throw new ConfigurationError(409,'请先确认本次调用与费用预留。');
 return{authorization_hash:hash};
}
