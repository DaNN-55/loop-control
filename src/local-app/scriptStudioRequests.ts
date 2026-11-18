import type {Pool,PoolClient} from 'pg';
import {scriptStudioContractVersion,scriptStudioMaxCharacters,validateStudioDuration,type ScriptStudioResult,type ScriptStudioMode,type ScriptStudioPlan} from '../scriptStudio.js';
import {ownerTransaction,sessionTransaction} from './ownerTransaction.js';
import type {OwnerSession} from './sessions.js';
import {ConfigurationError,canonicalFingerprint} from './configurationCommands.js';
import {ownedConnectionVersion} from '../worker/localConnection.js';
import type {SecretStore} from './connectionPorts.js';
import {resolveProductionSelection} from './productionSelection.js';
import {createScriptStudioReader,scriptStudioRequest,ScriptStudioValidationError,type ScriptStudioReader} from './scriptStudioProvider.js';
import {ScriptFormatProviderError} from './scriptFormatProvider.js';
import {scriptStudioDirectionContract} from '../scriptStudioDirection.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
interface Input {episodeId:string;expectedScriptRevisionId:string|null;text:string;targetDuration:number|null;mode:ScriptStudioMode;instruction:string;previousRequestId?:string;selection:unknown}
interface Row {id:string;payload_hash:string;status:string;result:ScriptStudioResult|null}
const resultOf=(r:Row):ScriptStudioResult=>r.result??{requestId:r.id,status:r.status==='unknown'?'unknown':'pending',message:'本次拍法请求已提交；核对不会重复调用模型。'};
async function writable(c:PoolClient,owner:string,d:Input){
 const e=(await c.query("SELECT e.main_script_revision_id,e.stage,e.archived_at FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id AND m.user_id=$2 AND m.role='owner' JOIN local_identity.input_episodes i ON i.episode_id=e.id AND i.owner_id=$2 WHERE e.id=$1 AND NOT local_identity.is_historical_episode(e.id) AND NOT EXISTS(SELECT 1 FROM local_identity.episode_recycle_bin r WHERE r.episode_id=e.id)",[d.episodeId,owner])).rows[0];
 if(!e)throw new ConfigurationError(404,'当前生产单不可见。');if(e.main_script_revision_id!==d.expectedScriptRevisionId||e.archived_at||e.stage==='production_completed')throw new ConfigurationError(409,'脚本基准或生产单状态已变化，请重新打开核对。');
}
/** Dispatch is durable before transport; completed/unknown attempts are recovered without retry. */
export class LocalScriptStudioRequests {
 constructor(private pool:Pool,private store:SecretStore,private ready:()=>boolean,private reader:ScriptStudioReader=createScriptStudioReader()){}
 async command(session:OwnerSession,body:Record<string,unknown>):Promise<ScriptStudioResult>{
  if(body.command!=='optimize'||typeof body.idempotencyKey!=='string'||!uuid.test(body.idempotencyKey)||Object.keys(body).some(k=>!['command','idempotencyKey','data'].includes(k))||!body.data||typeof body.data!=='object'||Array.isArray(body.data))throw new ConfigurationError(400,'拍法请求无效。');
  const d=body.data as unknown as Input;
  if(Object.keys(d).some(k=>!['episodeId','expectedScriptRevisionId','text','targetDuration','mode','instruction','previousRequestId','selection'].includes(k))||typeof d.episodeId!=='string'||!uuid.test(d.episodeId)||d.expectedScriptRevisionId!==null&&(typeof d.expectedScriptRevisionId!=='string'||!uuid.test(d.expectedScriptRevisionId))||typeof d.text!=='string'||!d.text.trim()||Array.from(d.text).length>scriptStudioMaxCharacters||!['optimize','adapt'].includes(d.mode)||typeof d.instruction!=='string'||d.instruction.length>4000||d.previousRequestId!==undefined&&(typeof d.previousRequestId!=='string'||!uuid.test(d.previousRequestId)))throw new ConfigurationError(400,'原文、当前基准或修改要求无效；最多支持 20000 字符。');
  try{validateStudioDuration(d.targetDuration);}catch(error){throw new ConfigurationError(400,(error as Error).message);}
  const hash=canonicalFingerprint({version:scriptStudioContractVersion,wireVersion:scriptStudioDirectionContract,data:d}),legacyHash=canonicalFingerprint({version:scriptStudioContractVersion,data:d}),id=body.idempotencyKey;
  const prepared=await sessionTransaction(this.pool,session,async c=>{
   await writable(c,session.id,d);await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['script-studio-id:'+session.id+':'+id]);await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['script-studio:'+session.id+':'+hash]);
   const old=(await c.query('SELECT * FROM local_identity.script_format_requests WHERE owner_id=$1 AND id=$2',[session.id,id])).rows[0] as Row|undefined;
   if(old){if(old.payload_hash!==hash&&old.payload_hash!==legacyHash)throw new ConfigurationError(409,'同一拍法标识不能用于不同原文、时长或模型。');return{row:old};}
   const existing=(await c.query("SELECT * FROM local_identity.script_format_requests WHERE owner_id=$1 AND episode_id=$2 AND ((payload_hash=$3 AND status<>'failed') OR (payload_hash=$4 AND status IN ('prepared','dispatching','unknown'))) ORDER BY created_at DESC LIMIT 1",[session.id,d.episodeId,hash,legacyHash])).rows[0] as Row|undefined;if(existing)return{row:existing};
   let previousPlan:ScriptStudioPlan|undefined;
   if(d.previousRequestId){const p=(await c.query('SELECT * FROM local_identity.script_format_requests WHERE owner_id=$1 AND id=$2 AND episode_id=$3',[session.id,d.previousRequestId,d.episodeId])).rows[0];if(!p||p.status!=='completed'||p.script_revision_id!==d.expectedScriptRevisionId||p.source_text!==d.text||p.request_snapshot?.version!==scriptStudioContractVersion||p.request_snapshot?.data?.targetDuration!==d.targetDuration||!p.result?.plan)throw new ConfigurationError(409,'要修改的方案与当前原文或时长不一致。');previousPlan=p.result.plan;}
   if(!this.ready()||this.store.mode!=='keychain')throw new ConfigurationError(503,'本机大语言模型服务尚未就绪。');
   const resolved=await resolveProductionSelection(c,d.selection,'language_model'),version=await ownedConnectionVersion(c,resolved.connection!.id);if(!version?.secret_ref)throw new ConfigurationError(409,'大语言模型密钥尚未绑定。');
   const input={source:d.text,targetDuration:d.targetDuration,mode:d.mode,instruction:d.instruction,previousPlan,model:resolved.selection.model!,provider:resolved.selection.provider},snapshot={version:scriptStudioContractVersion,wireVersion:scriptStudioDirectionContract,data:{targetDuration:d.targetDuration,mode:d.mode,instruction:d.instruction,previousRequestId:d.previousRequestId??null},selection:resolved.selection,...scriptStudioRequest(input)};
   if(Buffer.byteLength(JSON.stringify(snapshot))>128*1024)throw new ConfigurationError(400,'原文与拍法上下文超过模型请求上限，请缩短修改要求。');
   await c.query('INSERT INTO local_identity.script_format_requests(owner_id,id,episode_id,script_revision_id,connection_version_id,model,payload_hash,source_text,diagnostic,request_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[session.id,id,d.episodeId,d.expectedScriptRevisionId,version.id,resolved.selection.model,hash,d.text,'拍法设计：'+d.mode,snapshot]);
   return{secretRef:version.secret_ref,input};
  });
  if(prepared.row)return resultOf(prepared.row);
  const finish=async(status:'completed'|'failed'|'unknown',result:ScriptStudioResult)=>ownerTransaction(this.pool,session.id,false,async c=>{const updated=await c.query("UPDATE local_identity.script_format_requests SET status=$3,result=$4,updated_at=clock_timestamp() WHERE owner_id=$1 AND id=$2 AND status IN ('prepared','dispatching')",[session.id,id,status,result]);if(!updated.rowCount)throw new ConfigurationError(409,'拍法所属生产单已变化，请保留原文后核对。');return result;});
  let secret:string;try{secret=await this.store.get(prepared.secretRef);}catch{return finish('failed',{requestId:id,status:'failed',message:'本机密钥暂不可读，未发送模型请求。'});}
  try{await sessionTransaction(this.pool,session,async c=>{await writable(c,session.id,d);await resolveProductionSelection(c,d.selection,'language_model');const sent=await c.query("UPDATE local_identity.script_format_requests SET status='dispatching',updated_at=clock_timestamp() WHERE owner_id=$1 AND id=$2 AND status='prepared'",[session.id,id]);if(!sent.rowCount)throw new ConfigurationError(409,'请求状态已变化，未重复发送。');});}catch(error){await finish('failed',{requestId:id,status:'failed',message:'发送前脚本或连接状态已变化，未调用模型。'});throw error;}
  let value:Awaited<ReturnType<ScriptStudioReader>>;try{value=await this.reader({...prepared.input,secret});}catch(error){const status=error instanceof ScriptFormatProviderError?error.outcome:'unknown';return finish(status,{requestId:id,status,message:error instanceof ScriptFormatProviderError?error.message:'拍法请求结果未知，未自动重发。',...(error instanceof ScriptStudioValidationError?{diagnostic:error.diagnostic,responseId:error.diagnostic.responseId,usage:error.diagnostic.usage}:{})});}
  const result=await finish('completed',{requestId:id,status:'completed',...value});await ownerTransaction(this.pool,session.id,true,c=>writable(c,session.id,d));return result;
 }
}
