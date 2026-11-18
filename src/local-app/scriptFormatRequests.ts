import type {Pool,PoolClient} from 'pg';
import {scriptFormatMaxCharacters,scriptFormatContractVersion,type ScriptFormatResult} from '../scriptFormat.js';
import {workspaceScriptInput} from './workspaceScriptInput.js';
import {ownerTransaction,sessionTransaction} from './ownerTransaction.js';
import type {OwnerSession} from './sessions.js';
import {ConfigurationError,canonicalFingerprint} from './configurationCommands.js';
import {ownedConnectionVersion} from '../worker/localConnection.js';
import type {SecretStore} from './connectionPorts.js';
import {resolveProductionSelection} from './productionSelection.js';
import {createScriptFormatReader,scriptFormatRequest,ScriptFormatProviderError,type ScriptFormatReader} from './scriptFormatProvider.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
interface Row {id:string;payload_hash:string;status:string;result:ScriptFormatResult|null}
interface Input {episodeId:string;expectedScriptRevisionId:string|null;text:string;selection:unknown}
const resultOf=(row:Row):ScriptFormatResult=>row.result??{requestId:row.id,status:row.status==='unknown'?'unknown':'pending',message:row.status==='unknown'?'模型请求结果未知，未自动重发。请核对本次请求。':'本次识别已提交，尚未取得结果；核对不会重复调用。'};
async function writable(c:PoolClient,owner:string,data:Input){
 const episode=(await c.query("SELECT e.main_script_revision_id,e.stage,e.archived_at FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id AND m.user_id=$2 AND m.role='owner' JOIN local_identity.input_episodes i ON i.episode_id=e.id AND i.owner_id=$2 WHERE e.id=$1 AND NOT local_identity.is_historical_episode(e.id) AND NOT EXISTS(SELECT 1 FROM local_identity.episode_recycle_bin r WHERE r.episode_id=e.id)",[data.episodeId,owner])).rows[0];
 if(!episode)throw new ConfigurationError(404,'当前生产单不可见。');
 if(episode.main_script_revision_id!==data.expectedScriptRevisionId||episode.archived_at||episode.stage==='production_completed')throw new ConfigurationError(409,'脚本基准或生产单状态已变化，请重新打开核对。');
}
/** A durable dispatch marker precedes the only HTTP send. Unknown attempts are never resent. */
export class LocalScriptFormatRequests {
 constructor(private pool:Pool,private store:SecretStore,private ready:()=>boolean,private reader:ScriptFormatReader=createScriptFormatReader()){}
 async command(session:OwnerSession,body:Record<string,unknown>):Promise<ScriptFormatResult>{
  if(body.command!=='recognize'||typeof body.idempotencyKey!=='string'||!uuid.test(body.idempotencyKey)||Object.keys(body).some(k=>!['command','idempotencyKey','data'].includes(k))||!body.data||typeof body.data!=='object'||Array.isArray(body.data))throw new ConfigurationError(400,'脚本格式识别请求无效。');
  const d=body.data as unknown as Input;
  if(Object.keys(d).some(k=>!['episodeId','expectedScriptRevisionId','text','selection'].includes(k))||typeof d.episodeId!=='string'||!uuid.test(d.episodeId)||d.expectedScriptRevisionId!==null&&(typeof d.expectedScriptRevisionId!=='string'||!uuid.test(d.expectedScriptRevisionId))||typeof d.text!=='string'||!d.text.trim()||Array.from(d.text).length>scriptFormatMaxCharacters)throw new ConfigurationError(400,'请提供有效脚本和当前基准；模型识别最多支持 20000 字符。');
  const diagnostic=workspaceScriptInput(d.text).error;
  if(!diagnostic)throw new ConfigurationError(409,'当前脚本已通过本地识别，无需调用大语言模型。');
  const hash=canonicalFingerprint({version:scriptFormatContractVersion,data:d}),id=body.idempotencyKey;
  const prepared=await sessionTransaction(this.pool,session,async c=>{
   await writable(c,session.id,d);
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['script-format-id:'+session.id+':'+id]);
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['script-format:'+session.id+':'+hash]);
   const old=(await c.query('SELECT * FROM local_identity.script_format_requests WHERE owner_id=$1 AND id=$2',[session.id,id])).rows[0] as Row|undefined;
   if(old){if(old.payload_hash!==hash)throw new ConfigurationError(409,'同一识别标识不能用于不同脚本或模型。');return{row:old};}
   // Reopening an unchanged source recovers its prior suggestion or unknown call.
   const existing=(await c.query("SELECT * FROM local_identity.script_format_requests WHERE owner_id=$1 AND episode_id=$2 AND payload_hash=$3 AND status<>'failed' ORDER BY created_at DESC LIMIT 1",[session.id,d.episodeId,hash])).rows[0] as Row|undefined;
   if(existing)return{row:existing};
   if(!this.ready()||this.store.mode!=='keychain')throw new ConfigurationError(503,'本机大语言模型服务尚未就绪。');
   const resolved=await resolveProductionSelection(c,d.selection,'language_model');
   const version=await ownedConnectionVersion(c,resolved.connection!.id);
   if(!version?.secret_ref)throw new ConfigurationError(409,'大语言模型密钥尚未绑定。');
   const snapshot={version:scriptFormatContractVersion,selection:resolved.selection,...scriptFormatRequest({source:d.text,diagnostic,model:resolved.selection.model!,provider:resolved.selection.provider})};
   await c.query('INSERT INTO local_identity.script_format_requests(owner_id,id,episode_id,script_revision_id,connection_version_id,model,payload_hash,source_text,diagnostic,request_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[session.id,id,d.episodeId,d.expectedScriptRevisionId,version.id,resolved.selection.model,hash,d.text,diagnostic,snapshot]);
   return{secretRef:version.secret_ref,model:resolved.selection.model!,provider:resolved.selection.provider};
  });
  if(prepared.row)return resultOf(prepared.row);
  const finish=async(status:'completed'|'failed'|'unknown',result:ScriptFormatResult)=>ownerTransaction(this.pool,session.id,false,async c=>{
   const updated=await c.query("UPDATE local_identity.script_format_requests SET status=$3,result=$4,updated_at=clock_timestamp() WHERE owner_id=$1 AND id=$2 AND status IN ('prepared','dispatching')",[session.id,id,status,result]);
   if(!updated.rowCount)throw new ConfigurationError(409,'识别所属生产单已变化，请保留原稿后核对。');
   return result;
  });
  let secret:string;
  try{secret=await this.store.get(prepared.secretRef);}catch{return finish('failed',{requestId:id,status:'failed',message:'本机密钥暂不可读，未发送模型请求。'});}
  try{await sessionTransaction(this.pool,session,async c=>{
   await writable(c,session.id,d);await resolveProductionSelection(c,d.selection,'language_model');
   const dispatched=await c.query("UPDATE local_identity.script_format_requests SET status='dispatching',updated_at=clock_timestamp() WHERE owner_id=$1 AND id=$2 AND status='prepared'",[session.id,id]);
   if(!dispatched.rowCount)throw new ConfigurationError(409,'本次请求状态已变化，未重复发送。');
  });}catch(error){await finish('failed',{requestId:id,status:'failed',message:'发送前脚本或连接状态已变化，未调用模型。'});throw error;}
  let value:Awaited<ReturnType<ScriptFormatReader>>;
  try{value=await this.reader({source:d.text,diagnostic,secret,model:prepared.model,provider:prepared.provider});}
  catch(error){const outcome=error instanceof ScriptFormatProviderError?error.outcome:'unknown';return finish(outcome,{requestId:id,status:outcome,message:error instanceof ScriptFormatProviderError?error.message:'模型请求结果未知，未自动重发。'});}
  const {responseId,usage,...recognition}=value;
  const result=await finish('completed',{requestId:id,status:'completed',recognition,responseId,usage});
  await ownerTransaction(this.pool,session.id,true,c=>writable(c,session.id,d));
  return result;
 }
}
