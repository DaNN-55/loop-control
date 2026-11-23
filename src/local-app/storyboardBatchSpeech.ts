import type {PoolClient} from 'pg';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import type {StoryboardBatchItem,StoryboardSpeechDraft,StoryboardSpeechSettings} from '../storyboardBatch.js';
import {resolveWorkspaceMainVoice} from '../workspaceAudio.js';
import {creativeAccountRules} from '../creativeAccountRules.js';
import {ConfigurationError} from './configurationCommands.js';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import {resolveProductionSelection} from './productionSelection.js';
import {productionHash} from './scriptProductionStore.js';
import {estimateWorkspaceCall} from './workspaceCallEstimate.js';
import {readWorkspaceNarration,validateSpeechParameters} from './workspaceNarration.js';
import {readWorkspaceNarrationTasks} from './workspaceGenerationTasks.js';
import {readWorkspaceCandidates} from './workspaceCandidates.js';
import {readWorkspaceTemplateInputs} from './workspaceTemplateInputs.js';

export interface StoryboardSpeechRequest {
 shotIds:string[];
 common?:StoryboardSpeechSettings;
 drafts:StoryboardSpeechDraft[];
 regenerateShotIds:string[];
}
export interface StoryboardSpeechItem {
 review:StoryboardBatchItem;
 frozen?:{
  batchId?:string;
  baselineInputFingerprint:string;
  selectionVersion:1;
  selection:Awaited<ReturnType<typeof resolveProductionSelection>>['selection'];
  connection:Awaited<ReturnType<typeof resolveProductionSelection>>['connection'];
  execution:Awaited<ReturnType<typeof resolveProductionSelection>>['execution'];
  inputFingerprint:string;
  reservationCents:number;
  context:{accountId:string;blueprintVersionId:string;accountRules:ReturnType<typeof creativeAccountRules>;seriesVersionId:string;seriesId:string;seriesRules:unknown;text:string;voice:{name:string;languageCode:string;speakingRate:number}};
  target:{workspaceId:string;shotId:string;clipId:string;scriptRevisionId:string;preparationRevisionId:string;projectSha256:string;nativeEditRevision:number;workspaceRevision:number};
  costBasis:{reservationCents:number;kind:'owner_reservation';minimumCents:number};
 };
}

/** Resolve all selected shots against the same locked workspace view. */
export async function resolveStoryboardSpeech(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,request:StoryboardSpeechRequest):Promise<StoryboardSpeechItem[]>{
 const narration=await readWorkspaceNarration(c,row,project);
 const tasks=await readWorkspaceNarrationTasks(c,row);
 const candidates=await readWorkspaceCandidates(c,row,project,narration);
 const templates=await readWorkspaceTemplateInputs(c,root,row);
 const context=(await c.query(`SELECT e.account_id,e.blueprint_version_id,e.series_version_id,e.tts_voice,e.tts_language_code,e.tts_speaking_rate,b.policy,s.rules,s.series_id
  FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id LEFT JOIN public.series_versions s ON s.id=e.series_version_id WHERE e.id=$1`,[row.episode_id])).rows[0];
 const priorDefault=narration.find(n=>n.defaults)?.defaults;
 const legacy=context.policy.narration;
 const legacySelection=legacy?.credential_ref&&legacy?.executor?{capability:'speech',provider:legacy.executor.provider,adapter:legacy.executor.adapter,model:legacy.executor.model,connectionVersionId:legacy.credential_ref}:null;
 const resolvedSelections=new Map<string,Promise<Awaited<ReturnType<typeof resolveProductionSelection>>>>();
 return await Promise.all(request.shotIds.map(async shotId=>{
  const n=narration.find(n=>n.shotId===shotId),clip=row.bindings.find(b=>b.shotId===shotId);
  const browserDraft=request.drafts.find(d=>d.shotId===shotId);
  const draft=browserDraft&&browserDraft.preparationRevisionId===row.preparation_revision_id&&browserDraft.inputFingerprint===n?.inputFingerprint&&browserDraft.text.trim()?browserDraft:undefined;
  const text=draft?.text??(n?.confirmed?n.text:clip?.text??'');
  const source=draft?'draft':'confirmed';
  const characters=Array.from(text).length;
  const base={shotId,text,source,characters} as const;
  const skip=(reason:string):StoryboardSpeechItem=>({review:{...base,state:'skipped',reason}});
  if(!n||!clip)return skip('镜头已移除');
  const adopted=resolveWorkspaceMainVoice(project,shotId);
  const mode=n.requestedMode??(adopted.item?.id===`workspace-source-shot-${shotId}`||clip.voiceInput?.mode==='source'?'source':n.mode==='manual'?'manual':n.enabled===false?'none':'tts');
  if(mode==='source')return skip('使用视频原声');
  if(mode==='manual')return skip('使用上传口播');
  if(n.requestedMode==='none')return skip('已设为无口播');
  if(!text.trim())return skip('缺少口播文案');
  if(mode==='none'||n.enabled===false)return skip('已设为无口播');
  const shotTasks=tasks.filter(task=>task.shotId===shotId);
  if(shotTasks.some(task=>task.status==='ready'||task.status==='running'))return skip('已有口播任务进行中');
  if(shotTasks.some(task=>!task.retryTaskId&&(task.submissionUnknown||task.publicationAttempt)))return skip('口播回执未知，请先在右侧核对原任务');

  const batch=request.common,template=templates?.shots.find(shot=>shot.shotId===shotId)?.narrationOverrides;
  const selection=n.selection??batch?.selection??priorDefault?.selection??legacySelection;
  const voice=n.override&&n.voice?n.voice:template?.voice??batch?.voice??priorDefault?.voice??templates?.narration.voice??n.voice??context.tts_voice??'';
  const languageCode=n.override&&n.languageCode?n.languageCode:template?.languageCode??batch?.languageCode??priorDefault?.languageCode??templates?.narration.languageCode??n.languageCode??context.tts_language_code??'zh-CN';
  const speakingRate=n.override&&n.speakingRate?n.speakingRate:template?.speakingRate??batch?.speakingRate??priorDefault?.speakingRate??templates?.narration.speakingRate??n.speakingRate??Number(context.tts_speaking_rate??1);

  let resolved:Awaited<ReturnType<typeof resolveProductionSelection>>;
  try{
   const key=productionHash(selection??null);
   let pending=resolvedSelections.get(key);
   if(!pending){pending=resolveProductionSelection(c,selection,'speech');resolvedSelections.set(key,pending);}
   resolved=await pending;
   validateSpeechParameters(resolved.selection,voice,languageCode,speakingRate);
   if(resolved.choice.mode!=='generation'||!resolved.connection)throw new ConfigurationError(400,'请选择可执行的语音连接与模型。');
  }catch(error){if(error instanceof ConfigurationError)return skip(error.message);throw error;}

  const estimate=estimateWorkspaceCall({kind:'speech',provider:resolved.selection.provider,model:resolved.selection.model,text});
  if(estimate.suggestedCents>estimate.maximumCents||estimate.minimumCents>estimate.maximumCents)return skip('口播文案超过单次费用预留上限');
  const reservationCents=estimate.suggestedCents;
  const existing=!!n.adoptedAudioTrackId||!!n.retainedAudioTrackId||candidates.some(candidate=>candidate.shotId===shotId&&candidate.status==='available');
  const summary={kind:'口播生成' as const,target:shotId,provider:resolved.selection.provider,model:resolved.selection.model??resolved.choice.label,connection:`${resolved.connection.name} · v${resolved.connection.version}`,parameters:[`${characters} 字`,`音色：${voice}`,`语言：${languageCode}`,`语速：${speakingRate}`],inputs:[],prompt:text,reservationCents,estimate};
  if(existing&&!request.regenerateShotIds.includes(shotId))return {review:{...base,state:'regenerate',reason:'已有可用口播或待采用候选',summary}};
  return {review:{...base,state:'ready',summary},frozen:{
   baselineInputFingerprint:n.inputFingerprint,selectionVersion:1,selection:resolved.selection,connection:resolved.connection,execution:resolved.execution,
   inputFingerprint:productionHash({basis:row.preparation_revision_id,shotId,text,selection:resolved.selection,voice,languageCode,speakingRate}),reservationCents,
   context:{accountId:context.account_id,blueprintVersionId:context.blueprint_version_id,accountRules:creativeAccountRules(context.policy),seriesVersionId:context.series_version_id,seriesId:context.series_id,seriesRules:context.rules,text,voice:{name:voice,languageCode,speakingRate}},
   target:{workspaceId:row.id,shotId,clipId:clip.id,scriptRevisionId:row.script_revision_id,preparationRevisionId:row.preparation_revision_id,projectSha256:row.project_sha256,nativeEditRevision:Number(row.native_edit_revision??0),workspaceRevision:Number(row.revision)},
   costBasis:{reservationCents,kind:'owner_reservation',minimumCents:estimate.minimumCents},
  }};
 }));
}
