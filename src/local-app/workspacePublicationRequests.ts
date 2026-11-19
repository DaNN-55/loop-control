import type {Pool} from 'pg';
import type {OwnerSession} from './sessions.js';
import type {SecretStore} from './connectionPorts.js';
import type {PublicationRequestResult} from '../workspacePublication.js';
import {ownerTransaction,sessionTransaction} from './ownerTransaction.js';
import {ConfigurationError,canonicalFingerprint} from './configurationCommands.js';
import {ownedPublicationWorkspace,readWorkspacePublication,writeWorkspacePublication} from './workspacePublicationStore.js';
import {resolveEpisodeAssetRoot} from './accountAssetRoots.js';
import {resolveProductionSelection} from './productionSelection.js';
import {ownedConnectionVersion} from '../worker/localConnection.js';
import {buildPublicationContext} from './workspacePublicationContext.js';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import {createPublicationReader,publicationRequest,publicationContract,type PublicationReader} from './workspacePublicationProvider.js';
import {ScriptFormatProviderError} from './scriptFormatProvider.js';

const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
interface Row {id:string;status:PublicationRequestResult['status'];result:PublicationRequestResult|null;created_at:Date}
const resultOf=(row:Row):PublicationRequestResult=>row.result??{requestId:row.id,status:row.status,message:row.status==='dispatching'?'文案请求处理中；核对原请求不会重新发送。':'本次请求结果未知，未自动重发。请先在供应商侧核对。'};
export class LocalPublicationRequests {
 constructor(private pool:Pool,private store:SecretStore,private ready:()=>boolean,private reader:PublicationReader=createPublicationReader()){}
 async read(ownerId:string,episodeId:string){return ownerTransaction(this.pool,ownerId,false,async c=>{
  const w=await ownedPublicationWorkspace(c,episodeId);
  await c.query("UPDATE local_identity.workspace_publication_requests SET status='unknown',updated_at=clock_timestamp() WHERE workspace_id=$1 AND status='dispatching' AND created_at<clock_timestamp()-interval '90 seconds'",[w.id]);
  const row=(await c.query('SELECT * FROM local_identity.workspace_publication_requests WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[w.id])).rows[0] as Row|undefined;return row?resultOf(row):null;
 });}
 async command(session:OwnerSession,episodeId:string,body:Record<string,unknown>,mediaRoot:string){
  if(!['generate','undo','closeUnknown'].includes(String(body.command))||Object.keys(body).some(key=>!['command','data','idempotencyKey'].includes(key))||typeof body.idempotencyKey!=='string'||!uuid.test(body.idempotencyKey)||!body.data||typeof body.data!=='object'||Array.isArray(body.data))throw new ConfigurationError(400,'发布文案请求无效。');
  const data=body.data as Record<string,unknown>;
  if(!Number.isSafeInteger(data.expectedRevision)||Object.keys(data).some(key=>!['expectedRevision',...(body.command==='generate'?['selection']:body.command==='closeUnknown'?['requestId']:[])].includes(key)))throw new ConfigurationError(400,'发布文案请求字段无效。');
  const id=body.idempotencyKey,hash=canonicalFingerprint({version:publicationContract,episodeId,command:body.command,data});
  if(body.command==='closeUnknown')return sessionTransaction(this.pool,session,async c=>{
   const w=await ownedPublicationWorkspace(c,episodeId,true);
   if(typeof data.requestId!=='string'||!uuid.test(data.requestId))throw new ConfigurationError(400,'原请求标识无效。');
   const result:PublicationRequestResult={requestId:data.requestId,status:'failed',message:'已按用户核对结束未知请求；未重新发送。'};
   const updated=await c.query("UPDATE local_identity.workspace_publication_requests SET status='failed',result=$4,updated_at=clock_timestamp() WHERE id=$1 AND owner_id=$2 AND workspace_id=$3 AND status='unknown' RETURNING id",[data.requestId,session.id,w.id,result]);
   if(!updated.rowCount)throw new ConfigurationError(409,'原请求状态已变化，请重新核对。');return result;
  });
  if(body.command==='undo')return sessionTransaction(this.pool,session,async c=>{
   const w=await ownedPublicationWorkspace(c,episodeId,true),old=(await c.query('SELECT payload_hash,result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,id])).rows[0];
   if(old){if(old.payload_hash!==hash)throw new ConfigurationError(409,'操作标识已用于其他内容。');return old.result;}
   const current=await readWorkspacePublication(c,await resolveEpisodeAssetRoot(c,mediaRoot,episodeId),w);if(!current.previousText)throw new ConfigurationError(409,'没有可撤回的替换。');
   const saved=await writeWorkspacePublication(c,w,current,data.expectedRevision,{content:{...current.content,...current.previousText},cover:current.cover,previousText:null});
   await c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[session.id,id,hash,saved]);return saved;
  });
  const prepared=await sessionTransaction(this.pool,session,async c=>{
   const w=await ownedPublicationWorkspace(c,episodeId,true);
   const old=(await c.query('SELECT * FROM local_identity.workspace_publication_requests WHERE id=$1 AND owner_id=$2',[id,session.id])).rows[0] as Row&{payload_hash:string}|undefined;
   if(old){if(old.payload_hash!==hash)throw new ConfigurationError(409,'同一请求标识不能用于不同文案或模型。');return{old};}
   const unresolved=(await c.query("SELECT * FROM local_identity.workspace_publication_requests WHERE workspace_id=$1 AND status IN ('dispatching','unknown') ORDER BY created_at DESC LIMIT 1",[w.id])).rows[0] as Row|undefined;
   if(unresolved)return{old:unresolved};
   const root=await resolveEpisodeAssetRoot(c,mediaRoot,episodeId),current=await readWorkspacePublication(c,root,w);
   if(current.revision!==data.expectedRevision)throw new ConfigurationError(409,'发布资料已有更新，请重新读取后生成。');
   if(!this.ready()||this.store.mode!=='keychain')throw new ConfigurationError(503,'请先添加并验证大语言模型连接；仍可手写和下载视频。');
   const resolved=await resolveProductionSelection(c,data.selection,'language_model'),version=await ownedConnectionVersion(c,resolved.connection!.id);if(!version?.secret_ref)throw new ConfigurationError(409,'所选模型密钥尚未绑定。');
   const row=(await c.query('SELECT * FROM local_identity.production_workspaces WHERE id=$1',[w.id])).rows[0] as ProductionWorkspaceRecord;
   const input={context:await buildPublicationContext(c,root,row),current:{title:current.content.title,description:current.content.description,tags:current.content.tags},instruction:current.content.instruction,model:resolved.selection.model!,provider:resolved.selection.provider};
   const snapshot={version:publicationContract,selection:resolved.selection,...publicationRequest(input)};
   if(Buffer.byteLength(JSON.stringify(snapshot))>128*1024)throw new ConfigurationError(400,'实际内容与创作规则超过文案请求上限，请缩短补充要求。');
   await c.query("INSERT INTO local_identity.workspace_publication_requests(id,owner_id,workspace_id,episode_id,payload_hash,expected_revision,content_sha256,request_snapshot,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'dispatching')",[id,session.id,w.id,episodeId,hash,current.revision,w.content_sha256,snapshot]);
   return{input,secretRef:version.secret_ref,workspaceId:w.id,contentSha256:w.content_sha256,revision:current.revision};
  });
  if(prepared.old)return resultOf(prepared.old);
  let value:Awaited<ReturnType<PublicationReader>>|undefined,outcome:'failed'|'unknown'|undefined,message='';
  let secret:string;
  try{secret=await this.store.get(prepared.secretRef!);}catch{outcome='failed';message='本机模型密钥暂不可读，未发送请求。';}
  if(!outcome)try{await sessionTransaction(this.pool,session,async c=>{
   const w=await ownedPublicationWorkspace(c,episodeId,true),current=await readWorkspacePublication(c,await resolveEpisodeAssetRoot(c,mediaRoot,episodeId),w);
   if(w.id!==prepared.workspaceId||w.content_sha256!==prepared.contentSha256||current.revision!==prepared.revision)throw new ConfigurationError(409,'发送前视频或文案已有修改，未调用模型。');
   await resolveProductionSelection(c,data.selection,'language_model');
  });}catch{outcome='failed';message='发送前视频、文案或连接已变化，未调用模型。';}
  if(!outcome)try{value=await this.reader({...prepared.input!,secret:secret!});}catch(error){outcome=error instanceof ScriptFormatProviderError?error.outcome:'unknown';message=error instanceof ScriptFormatProviderError?error.message.replaceAll('拍法','发布文案'):'文案请求结果未知，未自动重发。';}
  return ownerTransaction(this.pool,session.id,false,async c=>{
   const w=await ownedPublicationWorkspace(c,episodeId,true),current=await readWorkspacePublication(c,await resolveEpisodeAssetRoot(c,mediaRoot,episodeId),w);
   let result:PublicationRequestResult;
   if(outcome)result={requestId:id,status:outcome,message};
   else if(w.id!==prepared.workspaceId||w.content_sha256!==prepared.contentSha256||current.revision!==prepared.revision)result={requestId:id,status:'stale',responseId:value!.responseId,message:'视频或发布资料已有修改，未覆盖新内容。请核对后重新生成。'};
   else{
    const saved=await writeWorkspacePublication(c,w,current,prepared.revision,{content:{...current.content,...value!.text},cover:current.cover,previousText:{title:current.content.title,description:current.content.description,tags:current.content.tags}});
    result={requestId:id,status:'completed',responseId:value!.responseId,message:'发布文案已生成，可直接修改或分别复制。',publication:saved};
   }
   await c.query('UPDATE local_identity.workspace_publication_requests SET status=$3,result=$4,updated_at=clock_timestamp() WHERE id=$1 AND owner_id=$2',[id,session.id,result.status,result]);return result;
  });
 }
}
