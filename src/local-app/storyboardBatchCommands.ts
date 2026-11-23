import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import type {StoryboardBatchFailure,StoryboardBatchReceipt,StoryboardBatchResult,StoryboardBatchReview,StoryboardSpeechDraft,StoryboardSpeechSettings,StoryboardVideoDraft,StoryboardVideoSettings} from '../storyboardBatch.js';
import {isOpenChatCutStudio} from '../worker/openchatcutStudio.js';
import {ConfigurationError,canonicalFingerprint} from './configurationCommands.js';
import {requireWritableEpisodeStorage} from './episodeStorageLocation.js';
import {assertLegacyExternalRequestsResolved} from './legacyDraftInputs.js';
import {registerConsumedWorkspaceCall} from './workspaceCallConfirmation.js';
import type {InputRuntime} from './episodeCommands.js';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import {queueStoryboardVideo,resolveStoryboardVideo,type StoryboardVideoItem,type StoryboardVideoRequest} from './storyboardBatchVideo.js';
import {resolveStoryboardSpeech,type StoryboardSpeechItem,type StoryboardSpeechRequest} from './storyboardBatchSpeech.js';

const batchCommand='confirmStoryboardBatch',speechCommand='generateWorkspaceNarration';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const digest=canonicalFingerprint;
const itemHash=(item:BatchItem)=>{const {change:_,...review}=item.review;return digest({review,frozen:item.frozen});};
type BatchRequest=(StoryboardSpeechRequest&{kind:'speech'})|(StoryboardVideoRequest&{kind:'video'});
type BatchItem=StoryboardSpeechItem|StoryboardVideoItem;
function resolveBatch(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,request:BatchRequest){
 return request.kind==='speech'?resolveStoryboardSpeech(c,root,row,project,request):resolveStoryboardVideo(c,root,row,project,request);
}
interface StoredBatch {
 request:BatchRequest;
 preparationRevisionId:string;
 // Compare only items actually sent to the user for approval and still selected.
 frozenHashes:Record<string,string>;
 submittedShotIds?:string[];
}
interface Approval {
 payload:StoredBatch;
 summary:StoryboardBatchResult;
 expires_at:Date;
 consumed_at:Date|null;
 script_revision_id:string;
}
function describeChange(kind:BatchRequest['kind'],previous:StoryboardBatchReview['items'][number],current:StoryboardBatchReview['items'][number]){
 if(current.reason)return current.reason;
 const changes:string[]=[];
 if(previous.text!==current.text||previous.source!==current.source)changes.push(kind==='speech'?'口播文案已变化':'视频提示词已变化');
 if(previous.targetSeconds!==current.targetSeconds||previous.providerSeconds!==current.providerSeconds)changes.push('主声或视频请求时长已变化');
 if(previous.summary?.inputs.join('|')!==current.summary?.inputs.join('|'))changes.push('视觉输入已变化');
 if(previous.summary?.connection!==current.summary?.connection||previous.summary?.provider!==current.summary?.provider||previous.summary?.model!==current.summary?.model)changes.push('连接或模型已变化');
 if(previous.summary?.parameters.slice(1).join('|')!==current.summary?.parameters.slice(1).join('|'))changes.push('制作设置已变化');
 if(previous.summary?.reservationCents!==current.summary?.reservationCents)changes.push('费用预留已变化');
 return changes.join(' · ')||'工程或费用依据已变化';
}
function invalid():never{throw new ConfigurationError(400,'批量生成镜头或输入无效，请重新选择。');}
function idList(input:unknown):string[]{
 if(!Array.isArray(input)||input.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(input).size!==input.length)invalid();
 return input;
}
function hasOnlyKeys(value:unknown,keys:string[]):value is Record<string,unknown>{
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
}
function requestData(data:Record<string,unknown>):BatchRequest{
 if(data.kind!=='speech'&&data.kind!=='video')return invalid();
 const shotIds=idList(data.shotIds),regenerateShotIds=data.regenerateShotIds===undefined?[]:idList(data.regenerateShotIds);
 if(!shotIds.length||regenerateShotIds.some(id=>!shotIds.includes(id)))return invalid();
 const retryFailures=data.retryFailures;
 if(retryFailures!==undefined&&(!Array.isArray(retryFailures)||regenerateShotIds.length||
  retryFailures.length!==shotIds.length||new Set(retryFailures.map(entry=>entry?.shotId)).size!==shotIds.length||
  retryFailures.some(entry=>!hasOnlyKeys(entry,['shotId','taskId'])||typeof entry.shotId!=='string'||!shotIds.includes(entry.shotId)||
   typeof entry.taskId!=='string'||!uuid.test(entry.taskId))))return invalid();
 const retry=retryFailures===undefined?{}:{retryFailures:retryFailures as StoryboardBatchFailure[]};
 const drafts=data.drafts??[];
 if(!Array.isArray(drafts))return invalid();
 const seen=new Set<string>();
 if(data.kind==='video'){
  const settings=['selection','durationSeconds','videoSettings','videoResolution','reservationCents','firstFrameFit','videoMode'];
  const keys=[...settings,'prompt','promptReferences','firstFrameMaterialRevisionId','visualInputs'];
  if(data.common!==undefined&&!hasOnlyKeys(data.common,settings))return invalid();
  for(const d of drafts){
   if(!hasOnlyKeys(d,['shotId','targetItemId','preparationRevisionId','inputs'])||typeof d.shotId!=='string'||!shotIds.includes(d.shotId)||seen.has(d.shotId)||
    typeof d.targetItemId!=='string'||d.targetItemId.length>200||typeof d.preparationRevisionId!=='string'||!uuid.test(d.preparationRevisionId)||
    !hasOnlyKeys(d.inputs,keys)||d.inputs.prompt!==undefined&&(typeof d.inputs.prompt!=='string'||d.inputs.prompt.length>10000))return invalid();
   seen.add(d.shotId);
  }
  return {kind:'video',shotIds,regenerateShotIds,...retry,drafts:drafts as StoryboardVideoDraft[],common:data.common as StoryboardVideoSettings|undefined};
 }
 for(const d of drafts){
  if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(key=>!['shotId','preparationRevisionId','inputFingerprint','text'].includes(key))||!shotIds.includes(d.shotId)||seen.has(d.shotId)||typeof d.preparationRevisionId!=='string'||typeof d.inputFingerprint!=='string'||!(/^[a-f0-9]{64}$/).test(d.inputFingerprint)||typeof d.text!=='string'||d.text.length>100000)return invalid();
  seen.add(d.shotId);
 }
 const common=data.common as StoryboardSpeechSettings|undefined;
 if(data.common!==undefined&&(!common||typeof common!=='object'||Array.isArray(common)||Object.keys(common).some(key=>!['selection','voice','languageCode','speakingRate'].includes(key))||typeof common.voice!=='string'||common.voice.length>200||typeof common.languageCode!=='string'||common.languageCode.length>30||typeof common.speakingRate!=='number'||!Number.isFinite(common.speakingRate)))return invalid();
 return {kind:'speech',shotIds,regenerateShotIds,...retry,drafts:drafts as StoryboardSpeechDraft[],common};
}

async function saveReview(c:PoolClient,row:ProductionWorkspaceRecord,request:BatchRequest,items:BatchItem[],changed=false):Promise<StoryboardBatchReview>{
 const id=randomUUID();
 const payload:StoredBatch={request,preparationRevisionId:row.preparation_revision_id,frozenHashes:Object.fromEntries(items.flatMap(item=>item.frozen?[[item.review.shotId,itemHash(item)]]:[]))};
 const expires=(await c.query("SELECT clock_timestamp()+interval '10 minutes' expires")).rows[0].expires as Date;
 const summary:StoryboardBatchReview={confirmationId:id,expiresAt:expires.toISOString(),status:'review',kind:request.kind,items:items.map(item=>item.review),...(request.retryFailures?{retry:true as const}:{}),...(changed?{changed:true as const}:{})};
 await c.query(`INSERT INTO local_identity.workspace_call_confirmations(id,owner_id,workspace_id,episode_id,script_revision_id,project_sha256,workspace_revision,command,payload,context_hash,authorization_hash,summary,expires_at)
  VALUES($1,local_identity.owner_id(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,row.id,row.episode_id,row.script_revision_id,row.project_sha256,row.revision,batchCommand,JSON.stringify(payload),digest(payload),digest({id,payload}),JSON.stringify(summary),expires]);
 return summary;
}

async function queueSpeech(c:PoolClient,row:ProductionWorkspaceRecord,batchId:string,item:StoryboardSpeechItem){
 const frozen={...item.frozen!,batchId};
 const approvalId=randomUUID(),authorizationHash=digest({approvalId,frozen});
 await registerConsumedWorkspaceCall(c,row,{id:approvalId,command:speechCommand,payload:{clipId:frozen.target.clipId,batchInput:frozen},contextHash:digest(frozen),authorizationHash,summary:item.review.summary!});
 const {task_id:taskId}=(await c.query('SELECT (local_identity.queue_selected_workspace_narration($1,$2,$3,true)).id task_id',[row.id,item.review.shotId,JSON.stringify({...frozen,authorizationHash})])).rows[0];
 return {shotId:item.review.shotId,taskId:taskId as string,reservationCents:frozen.reservationCents};
}

/** Owner command owns the episode and workspace locks and commits the complete receipt with all task writes. */
export async function executeStoryboardBatch(c:PoolClient,root:string,row:ProductionWorkspaceRecord,runtime:InputRuntime,command:string,data:Record<string,unknown>,loadProject:()=>Promise<OpenChatCutProject>):Promise<StoryboardBatchResult>{
 const currentBasis=async()=>(await c.query(`SELECT e.main_script_revision_id=$2 AND p.script_revision_id=$2
  AND local_identity.preparation_source_current(p.id) current FROM public.episodes e
  JOIN local_identity.production_preparation_revisions p ON p.episode_id=e.id AND p.id=$3 WHERE e.id=$1`,[row.episode_id,row.script_revision_id,row.preparation_revision_id])).rows[0]?.current===true;
 const currentProject=async()=>{
  if(isOpenChatCutStudio(row.episode_id))throw new ConfigurationError(409,'请先返回分镜台，使用当前制作基准进行批量生成。');
  await requireWritableEpisodeStorage(c,root,row.episode_id);
  await assertLegacyExternalRequestsResolved(c,root,row);
  return loadProject();
 };
 if(command==='prepareStoryboardBatch'){
  if(!await currentBasis())throw new ConfigurationError(409,'制作基准已变化，请重新核对当前分镜。');
  const request=requestData(data);
  if(request.shotIds.some(shotId=>!row.bindings.some(clip=>clip.shotId===shotId)))return invalid();
  return saveReview(c,row,request,await resolveBatch(c,root,row,await currentProject(),request));
 }
 const id=data.confirmationId,selected=idList(data.shotIds);
 if(typeof id!=='string'||!uuid.test(id)||!selected.length)return invalid();
 const approval=(await c.query('SELECT payload,summary,expires_at,consumed_at,script_revision_id FROM local_identity.workspace_call_confirmations WHERE id=$1 AND workspace_id=$2 AND owner_id=local_identity.owner_id() AND command=$3 FOR UPDATE',[id,row.id,batchCommand])).rows[0] as Approval|undefined;
 if(!approval)throw new ConfigurationError(409,'批量核对已失效，请重新核对。');
 const picked=new Set(selected),shotIds=approval.payload.request.shotIds.filter(shotId=>picked.has(shotId));
 if(shotIds.length!==selected.length||shotIds.some(shotId=>!Object.hasOwn(approval.payload.frozenHashes,shotId)))return invalid();
 if(approval.consumed_at){
  if(digest(shotIds)!==digest(approval.payload.submittedShotIds))throw new ConfigurationError(409,'原确认已处理，请读取原回执。');
  return approval.summary;
 }
 if(new Date(approval.expires_at).getTime()<=Date.now())throw new ConfigurationError(409,'批量核对已过期，请重新核对。');
 const kind=approval.payload.request.kind;
 const consume=async(result:StoryboardBatchResult)=>{
  await c.query('UPDATE local_identity.workspace_call_confirmations SET payload=$2,summary=$3,consumed_at=clock_timestamp(),consumed_transaction=txid_current() WHERE id=$1',[id,JSON.stringify({...approval.payload,submittedShotIds:shotIds}),JSON.stringify(result)]);
  return result;
 };
 if(!await currentBasis()){
  const previous=approval.summary as StoryboardBatchReview;
  return consume({...previous,changed:true,items:previous.items.map(item=>item.state==='skipped'?item:{
   ...item,state:'skipped',reason:'制作基准已变化。请更新分镜后重新核对。',change:undefined,
  })});
 }
 const project=await currentProject();
 const current=await resolveBatch(c,root,row,project,{...approval.payload.request,shotIds});
 const basisChanged=approval.payload.preparationRevisionId!==row.preparation_revision_id||approval.script_revision_id!==row.script_revision_id;
 const changed=current.some(item=>!item.frozen||itemHash(item)!==approval.payload.frozenHashes[item.review.shotId])||basisChanged;
 let result:StoryboardBatchResult;
 if(changed){
  const previous=approval.summary as StoryboardBatchReview;
  const items=previous.items.map(item=>{
   const next=current.find(candidate=>candidate.review.shotId===item.shotId);
   if(!next)return {review:item.state==='ready'?{...item,state:'skipped' as const,reason:'本次已取消选择'}:item};
   if(!basisChanged&&itemHash(next)===approval.payload.frozenHashes[item.shotId])return next;
   return {...next,review:{...next.review,change:basisChanged?'制作基准已变化':describeChange(kind,item,next.review)}};
  });
  // The presentation annotation is excluded from the frozen input digest.
  result=await saveReview(c,row,{...approval.payload.request,shotIds:previous.items.map(item=>item.shotId)},items,true);
 }else{
  const items:StoryboardBatchReceipt['items']=[];
  if(kind==='speech'){
   const speechItems=current as StoryboardSpeechItem[];
   if(!runtime.narrationReady)throw new ConfigurationError(503,'本地口播执行器未就绪。');
   await runtime.narrationReady();
   await runtime.checkReferences(c,[...new Set(speechItems.map(item=>item.frozen!.selection.connectionVersionId!))],{purpose:'workspace-generation'});
   for(const item of speechItems)items.push(await queueSpeech(c,row,id,item));
  }else{
   for(const item of current as StoryboardVideoItem[])items.push(await queueStoryboardVideo(c,root,row,project,runtime,id,item));
  }
  result={status:'submitted',kind,confirmationId:id,episodeId:row.episode_id,items};
 }
 return consume(result);
}
