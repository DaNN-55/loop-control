import {mergeScriptStudioAttachments,validateScriptStudioAttachmentRefs,scriptStudioAttachmentMaxFiles,type ScriptStudioAttachmentRef} from '../scriptStudioAttachments.js';
import {supportsLanguageModelAttachment} from '../languageModels.js';
import {resolveScriptStudioAttachments} from './scriptStudioAttachments.js';
import {listStudioConversations,createStudioConversation,assertNoUnresolvedStudioRequest,assertStudioConversation} from './scriptStudioSessions.js';
import {isRetiredScriptStudioMode} from '../scriptStudioLegacy.js';
import type {Pool,PoolClient} from 'pg';
import {scriptStudioDefaultReasoning,validateScriptStudioReasoning,type ScriptStudioReasoningEffort} from '../scriptStudioReasoning.js';
import {scriptStudioContractVersion,scriptStudioMaxCharacters,validateStudioDuration,type ScriptStudioResult,type ScriptStudioChatMode,type ScriptStudioPlan} from '../scriptStudio.js';
import {ownerTransaction,sessionTransaction} from './ownerTransaction.js';
import type {OwnerSession} from './sessions.js';
import {ConfigurationError,canonicalFingerprint} from './configurationCommands.js';
import {ownedConnectionVersion} from '../worker/localConnection.js';
import type {SecretStore} from './connectionPorts.js';
import {resolveProductionSelection} from './productionSelection.js';
import {createScriptStudioReader,scriptStudioDiscussionContract,scriptStudioRequestSnapshot,scriptStudioValidationInstruction,createScriptStudioDiscussionReader,ScriptStudioValidationError,type ScriptStudioDiscussionReader,type ScriptStudioReader} from './scriptStudioProvider.js';
import {ScriptFormatProviderError} from './scriptFormatProvider.js';
import {editScriptStudioShot,deleteScriptStudioShot} from '../scriptStudioEdit.js';
import {readStudioConversation} from './scriptStudioConversation.js';
import {scriptStudioDirectionContract} from '../scriptStudioDirection.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
interface Input {episodeId:string;expectedScriptRevisionId:string|null;text:string;targetDuration:number|null;mode:ScriptStudioChatMode;instruction:string;previousRequestId?:string;selection:unknown;reasoningEffort?:ScriptStudioReasoningEffort;conversationId?:string;attachments?:ScriptStudioAttachmentRef[]}
interface Row {id:string;payload_hash:string;status:string;result:ScriptStudioResult|null}
const resultOf=(r:Row):ScriptStudioResult=>r.result??{requestId:r.id,status:r.status==='unknown'?'unknown':'pending',message:'本次拍法请求已提交；核对不会重复调用模型。'};
async function writable(c:PoolClient,owner:string,d:Pick<Input,'episodeId'|'expectedScriptRevisionId'>){
 const e=(await c.query("SELECT e.main_script_revision_id,e.stage,e.archived_at FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id AND m.user_id=$2 AND m.role='owner' JOIN local_identity.input_episodes i ON i.episode_id=e.id AND i.owner_id=$2 WHERE e.id=$1 AND NOT local_identity.is_historical_episode(e.id) AND NOT EXISTS(SELECT 1 FROM local_identity.episode_recycle_bin r WHERE r.episode_id=e.id)",[d.episodeId,owner])).rows[0];
 if(!e)throw new ConfigurationError(404,'当前生产单不可见。');if(e.main_script_revision_id!==d.expectedScriptRevisionId||e.archived_at||e.stage==='production_completed')throw new ConfigurationError(409,'脚本基准或生产单状态已变化，请重新打开核对。');
}
/** Dispatch is durable before transport; completed/unknown attempts are recovered without retry. */
export class LocalScriptStudioRequests {
 constructor(private pool:Pool,private store:SecretStore,private ready:()=>boolean,private reader:ScriptStudioReader=createScriptStudioReader(),private discuss:ScriptStudioDiscussionReader=createScriptStudioDiscussionReader()){}
 private async editShot(session:OwnerSession,body:Record<string,unknown>):Promise<ScriptStudioResult>{
  const d=body.data as Record<string,unknown>,deleting=body.command==='deleteShot';
  if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(body).some(k=>!['command','idempotencyKey','data'].includes(k))||typeof body.idempotencyKey!=='string'||!uuid.test(body.idempotencyKey)||Object.keys(d).some(k=>!['episodeId','expectedScriptRevisionId','text','targetDuration','previousRequestId','conversationId','index',...(deleting?[]:['fields'])].includes(k))||typeof d.episodeId!=='string'||!uuid.test(d.episodeId)||d.expectedScriptRevisionId!==null&&(typeof d.expectedScriptRevisionId!=='string'||!uuid.test(d.expectedScriptRevisionId))||typeof d.text!=='string'||!d.text.trim()||Array.from(d.text).length>scriptStudioMaxCharacters||typeof d.previousRequestId!=='string'||!uuid.test(d.previousRequestId)||d.conversationId!==undefined&&(typeof d.conversationId!=='string'||!uuid.test(d.conversationId)))throw new ConfigurationError(400,'镜头修改请求无效。');
  try{validateStudioDuration(d.targetDuration);}catch(error){throw new ConfigurationError(400,(error as Error).message);}
  const input={episodeId:d.episodeId,expectedScriptRevisionId:d.expectedScriptRevisionId as string|null},id=body.idempotencyKey,hash=canonicalFingerprint({version:scriptStudioContractVersion,command:deleting?'deleteShot':'editShot',data:d});
  return sessionTransaction(this.pool,session,async c=>{
   await writable(c,session.id,input);await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['script-studio-id:'+session.id+':'+id]);
   const old=(await c.query('SELECT * FROM local_identity.script_format_requests WHERE owner_id=$1 AND id=$2',[session.id,id])).rows[0] as Row|undefined;
   if(old){if(old.payload_hash!==hash)throw new ConfigurationError(409,'同一修改标识不能用于不同内容。');return resultOf(old);}
   const context=await readStudioConversation(c,session.id,{episodeId:d.episodeId as string,expectedScriptRevisionId:d.expectedScriptRevisionId as string|null,text:d.text as string,targetDuration:d.targetDuration as number|null,...(d.conversationId?{conversationId:d.conversationId as string}:{})},d.previousRequestId as string);
   if(context.latest?.status!=='completed'||!context.result?.plan)throw new ConfigurationError(409,'要修改的拍法尚未完成。');
   const parent=(await c.query('SELECT * FROM local_identity.script_format_requests WHERE owner_id=$1 AND id=$2 AND episode_id=$3',[session.id,context.result.requestId,d.episodeId])).rows[0];
   if(!parent||parent.status!=='completed'||parent.script_revision_id!==d.expectedScriptRevisionId||parent.source_text!==d.text||parent.request_snapshot?.version!==scriptStudioContractVersion||parent.request_snapshot?.data?.targetDuration!==d.targetDuration||!parent.result?.plan)throw new ConfigurationError(409,'要修改的拍法与当前原文、时长或基准不一致。');
   let plan:ScriptStudioPlan;try{plan=deleting?deleteScriptStudioShot(parent.result.plan,d.text as string,d.targetDuration as number|null,d.index):editScriptStudioShot(parent.result.plan,d.text as string,d.targetDuration as number|null,d.index,d.fields);}catch(error){throw new ConfigurationError(400,(error as Error).message);}
   const oldModified=new Set(context.result.modifiedShotIndexes??[]),index=d.index as number;
   const modifiedShotIndexes=deleting?plan.shots.flatMap((shot,i)=>{const before=i>=index?i+1:i;return oldModified.has(before)||JSON.stringify(shot)!==JSON.stringify(parent.result.plan.shots[before])?[i]:[];}):[...new Set([...oldModified,index])].sort((a,b)=>a-b);
   const result:ScriptStudioResult={requestId:id,status:'completed',plan,modifiedShotIndexes,...(context.attachments?.length?{attachments:context.attachments}:{}),message:deleting?'镜头已删除，仍需采用。':'手动修改已保存，仍需采用。'},snapshot={version:scriptStudioContractVersion,data:{targetDuration:d.targetDuration,mode:plan.changes.length?'revision':'optimize',instruction:plan.changes.length?(deleting?'手动删除镜头，保持总时长':'手动修改镜头文字'):parent.request_snapshot.data.instruction,previousRequestId:d.previousRequestId,...(d.conversationId?{conversationId:d.conversationId}:{})},selection:parent.request_snapshot.selection,...(deleting?{manualDelete:{index:d.index}}:{manualEdit:{index:d.index,fields:d.fields}})};
   if(Buffer.byteLength(JSON.stringify(snapshot))>128*1024)throw new ConfigurationError(400,'镜头修改内容超过上限，请缩短后保存。');
   await c.query("INSERT INTO local_identity.script_format_requests(owner_id,id,episode_id,script_revision_id,connection_version_id,model,payload_hash,source_text,diagnostic,request_snapshot,status,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'completed',$11)",[session.id,id,d.episodeId,d.expectedScriptRevisionId,parent.connection_version_id,parent.model,hash,d.text,'手动修订拍法',snapshot,result]);
   return result;
  });
 }
 async conversation(session:OwnerSession,body:Record<string,unknown>){
  const d=body.data as Input;
  if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!['episodeId','expectedScriptRevisionId','text','targetDuration','conversationId'].includes(k))||typeof d.episodeId!=='string'||!uuid.test(d.episodeId)||d.expectedScriptRevisionId!==null&&(typeof d.expectedScriptRevisionId!=='string'||!uuid.test(d.expectedScriptRevisionId))||typeof d.text!=='string'||!d.text.trim()||Array.from(d.text).length>scriptStudioMaxCharacters)throw new ConfigurationError(400,'对话查询无效。');
  if(d.conversationId!==undefined&&(typeof d.conversationId!=='string'||!uuid.test(d.conversationId)))throw new ConfigurationError(400,'对话标识无效。');
  try{validateStudioDuration(d.targetDuration);}catch(error){throw new ConfigurationError(400,(error as Error).message);}
  return sessionTransaction(this.pool,session,async c=>{await writable(c,session.id,d);const {conversation:_,...value}=await readStudioConversation(c,session.id,d);return value;});
 }
 async sessions(session:OwnerSession,body:Record<string,unknown>){
  const d=body.data as Input,creating=body.command==='newConversation';
  if(!['conversations','newConversation'].includes(String(body.command))||Object.keys(body).some(k=>!['command','data',...(creating?['idempotencyKey']:[])].includes(k))||!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!['episodeId','expectedScriptRevisionId','text','targetDuration'].includes(k))||typeof d.episodeId!=='string'||!uuid.test(d.episodeId)||d.expectedScriptRevisionId!==null&&(typeof d.expectedScriptRevisionId!=='string'||!uuid.test(d.expectedScriptRevisionId))||typeof d.text!=='string'||!d.text.trim()||Array.from(d.text).length>scriptStudioMaxCharacters||creating&&(typeof body.idempotencyKey!=='string'||!uuid.test(body.idempotencyKey)))throw new ConfigurationError(400,'对话范围或标识无效。');
  try{validateStudioDuration(d.targetDuration);}catch(error){throw new ConfigurationError(400,(error as Error).message);}
  return sessionTransaction(this.pool,session,async c=>{await writable(c,session.id,d);return creating?createStudioConversation(c,session.id,d,body.idempotencyKey as string):{conversations:await listStudioConversations(c,session.id,d)};});
 }
 async command(session:OwnerSession,body:Record<string,unknown>,mediaRoot?:string):Promise<ScriptStudioResult>{
  if(body.command==='editShot'||body.command==='deleteShot')return this.editShot(session,body);
  if(body.command!=='optimize'||typeof body.idempotencyKey!=='string'||!uuid.test(body.idempotencyKey)||Object.keys(body).some(k=>!['command','idempotencyKey','data'].includes(k))||!body.data||typeof body.data!=='object'||Array.isArray(body.data))throw new ConfigurationError(400,'拍法请求无效。');
  if(isRetiredScriptStudioMode((body.data as {mode?:unknown}).mode))throw new ConfigurationError(410,'独立改编功能已退役，请通过对话调整拍法。');
  const d={...body.data} as unknown as Input;
  if(Object.keys(d).some(k=>!['episodeId','expectedScriptRevisionId','text','targetDuration','mode','instruction','previousRequestId','selection','reasoningEffort','conversationId','attachments'].includes(k))||typeof d.episodeId!=='string'||!uuid.test(d.episodeId)||d.expectedScriptRevisionId!==null&&(typeof d.expectedScriptRevisionId!=='string'||!uuid.test(d.expectedScriptRevisionId))||typeof d.text!=='string'||!d.text.trim()||Array.from(d.text).length>scriptStudioMaxCharacters||d.conversationId!==undefined&&(typeof d.conversationId!=='string'||!uuid.test(d.conversationId))||!['optimize','discuss'].includes(d.mode)||typeof d.instruction!=='string'||d.instruction.length>4000||d.previousRequestId!==undefined&&(typeof d.previousRequestId!=='string'||!uuid.test(d.previousRequestId)))throw new ConfigurationError(400,'原文、当前基准或修改要求无效；最多支持 20000 字符。');
  try{validateStudioDuration(d.targetDuration);}catch(error){throw new ConfigurationError(400,(error as Error).message);}
  if(d.attachments!==undefined){try{d.attachments=validateScriptStudioAttachmentRefs(d.attachments);if(d.attachments.length>scriptStudioAttachmentMaxFiles)throw Error('每条消息最多附加4个附件。');if(!d.attachments.length)delete d.attachments;}catch(error){throw new ConfigurationError(400,(error as Error).message);}}
  if(d.mode==='discuss'&&!d.instruction.trim()&&!d.attachments?.length)throw new ConfigurationError(400,'请输入想讨论的问题。');
  if(d.reasoningEffort!==undefined){try{const selection=d.selection as {provider:string;model:string};validateScriptStudioReasoning(selection?.provider,selection?.model,d.reasoningEffort);}catch(error){throw new ConfigurationError(400,(error as Error).message);}if(d.reasoningEffort==='none')delete d.reasoningEffort;}
  const selected=d.selection as {provider:string;model:string};if(d.reasoningEffort===undefined&&selected?.provider&&selected?.model){const defaultEffort=scriptStudioDefaultReasoning(selected.provider,selected.model);if(defaultEffort!=='none')d.reasoningEffort=defaultEffort;}
  // Earlier discussion hashes are recover-only; fresh intents must use the unrestricted prompt.
  const wireVersion=d.mode==='discuss'?scriptStudioDiscussionContract:scriptStudioDirectionContract,hash=canonicalFingerprint({version:scriptStudioContractVersion,wireVersion,data:d}),id=body.idempotencyKey;
  const priorHashes=[...new Set([canonicalFingerprint({version:scriptStudioContractVersion,wireVersion:scriptStudioDirectionContract,data:d}),canonicalFingerprint({version:scriptStudioContractVersion,data:d})])].filter(value=>value!==hash);
  const prepared=await sessionTransaction(this.pool,session,async c=>{
   await writable(c,session.id,d);await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['script-studio-id:'+session.id+':'+id]);await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['script-studio:'+session.id+':'+hash]);
   const old=(await c.query('SELECT * FROM local_identity.script_format_requests WHERE owner_id=$1 AND id=$2',[session.id,id])).rows[0] as Row|undefined;
   if(old){if(old.payload_hash!==hash&&!priorHashes.includes(old.payload_hash))throw new ConfigurationError(409,'同一拍法标识不能用于不同原文、时长或模型。');return{row:old};}
   const existing=(await c.query("SELECT * FROM local_identity.script_format_requests WHERE owner_id=$1 AND episode_id=$2 AND ((payload_hash=$3 AND status<>'failed') OR (payload_hash=ANY($4::text[]) AND status IN ('prepared','dispatching','unknown'))) ORDER BY created_at DESC LIMIT 1",[session.id,d.episodeId,hash,priorHashes])).rows[0] as Row|undefined;if(existing)return{row:existing};
   await assertStudioConversation(c,session.id,d);await assertNoUnresolvedStudioRequest(c,session.id,d);
   const saved=d.conversationId?await readStudioConversation(c,session.id,d):null;
   const parent=saved?.latest?.status==='failed'?saved.turns.filter(turn=>turn.status==='completed').at(-1)?.requestId:saved?.latestRequestId;
   if(d.conversationId&&parent!==d.previousRequestId)throw new ConfigurationError(409,'对话已有更新，请重新读取后继续。');
   const context=d.previousRequestId?await readStudioConversation(c,session.id,d,d.previousRequestId):null;
   if(context&&context.latest?.status!=='completed')throw new ConfigurationError(409,'前次对话尚未完成，请先核对。');
   const previousPlan=context?.result?.plan;
   if(!this.ready()||this.store.mode!=='keychain')throw new ConfigurationError(503,'本机大语言模型服务尚未就绪。');
   const resolved=await resolveProductionSelection(c,d.selection,'language_model'),version=await ownedConnectionVersion(c,resolved.connection!.id);if(!version?.secret_ref)throw new ConfigurationError(409,'大语言模型密钥尚未绑定。');
   let refs:ScriptStudioAttachmentRef[];try{refs=mergeScriptStudioAttachments(context?.attachments??[],d.attachments??[]);}catch(error){throw new ConfigurationError(400,(error as Error).message);}
   if(refs.some(ref=>!supportsLanguageModelAttachment(resolved.selection.provider,resolved.selection.model!,ref.mimeType)))throw new ConfigurationError(400,'当前模型不支持此类附件，请选择支持的模型或新开不含该附件的对话。');
   if(refs.length&&!mediaRoot)throw new ConfigurationError(503,'附件读取服务尚未就绪。');
   const resolvedAttachments=refs.length?await resolveScriptStudioAttachments(c,mediaRoot!,session.id,d.episodeId,refs):{attachments:[],inputs:[]};
   const input={source:d.text,targetDuration:d.targetDuration,...(resolvedAttachments.inputs.length?{attachments:resolvedAttachments.inputs}:{}),mode:d.mode==='discuss'?'optimize' as const:d.mode,...(d.reasoningEffort?{reasoningEffort:d.reasoningEffort}:{}),instruction:d.instruction,previousPlan,...(context?.conversation.length?{conversation:context.conversation}:{}),model:resolved.selection.model!,provider:resolved.selection.provider},snapshot={version:scriptStudioContractVersion,wireVersion,data:{targetDuration:d.targetDuration,mode:d.mode,instruction:scriptStudioValidationInstruction(input),turnInstruction:d.instruction,...(d.reasoningEffort?{reasoningEffort:d.reasoningEffort}:{}),previousRequestId:d.previousRequestId??null,...(d.conversationId?{conversationId:d.conversationId}:{}),...(d.attachments?.length?{attachments:d.attachments}:{})},selection:resolved.selection,...scriptStudioRequestSnapshot(input,d.mode==='discuss')};
   if(Buffer.byteLength(JSON.stringify(snapshot))>128*1024)throw new ConfigurationError(400,'原文与拍法上下文超过模型请求上限，请缩短修改要求。');
   await c.query('INSERT INTO local_identity.script_format_requests(owner_id,id,episode_id,script_revision_id,connection_version_id,model,payload_hash,source_text,diagnostic,request_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[session.id,id,d.episodeId,d.expectedScriptRevisionId,version.id,resolved.selection.model,hash,d.text,'拍法设计：'+d.mode,snapshot]);
   return{secretRef:version.secret_ref,input,attachments:resolvedAttachments.attachments};
  });
  if(prepared.row)return resultOf(prepared.row);
  const finish=async(status:'completed'|'failed'|'unknown',result:ScriptStudioResult)=>ownerTransaction(this.pool,session.id,false,async c=>{const updated=await c.query("UPDATE local_identity.script_format_requests SET status=$3,result=$4,updated_at=clock_timestamp() WHERE owner_id=$1 AND id=$2 AND status IN ('prepared','dispatching')",[session.id,id,status,result]);if(!updated.rowCount)throw new ConfigurationError(409,'拍法所属生产单已变化，请保留原文后核对。');return result;});
  let secret:string;try{secret=await this.store.get(prepared.secretRef);}catch{return finish('failed',{requestId:id,status:'failed',message:'本机密钥暂不可读，未发送模型请求。'});}
  try{await sessionTransaction(this.pool,session,async c=>{await writable(c,session.id,d);await resolveProductionSelection(c,d.selection,'language_model');const sent=await c.query("UPDATE local_identity.script_format_requests SET status='dispatching',updated_at=clock_timestamp() WHERE owner_id=$1 AND id=$2 AND status='prepared'",[session.id,id]);if(!sent.rowCount)throw new ConfigurationError(409,'请求状态已变化，未重复发送。');});}catch(error){await finish('failed',{requestId:id,status:'failed',message:'发送前脚本或连接状态已变化，未调用模型。'});throw error;}
  let value:Awaited<ReturnType<ScriptStudioReader>>|Awaited<ReturnType<ScriptStudioDiscussionReader>>;try{value=d.mode==='discuss'?await this.discuss({...prepared.input,secret}):await this.reader({...prepared.input,secret});}catch(error){const status=error instanceof ScriptFormatProviderError?error.outcome:'unknown';return finish(status,{requestId:id,status,message:error instanceof ScriptFormatProviderError?error.message:'拍法请求结果未知，未自动重发。',...(error instanceof ScriptStudioValidationError?{diagnostic:error.diagnostic,responseId:error.diagnostic.responseId,usage:error.diagnostic.usage}:{})});}
  const result=await finish('completed',{requestId:id,status:'completed',...value,...(prepared.attachments.length?{attachments:prepared.attachments}:{})});await ownerTransaction(this.pool,session.id,true,c=>writable(c,session.id,d));return result;
 }
}
