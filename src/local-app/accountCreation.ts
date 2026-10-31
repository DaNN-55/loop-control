import type {Pool,PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import type {OwnerSession} from './sessions.js';
import {sessionTransaction} from './ownerTransaction.js';
import {ConfigurationError} from './configurationCommands.js';
import {verifyMediaRootBinding,type MediaRootBinding} from './mediaRootSettings.js';
import {requireAccountAssetRoot,setAccountAssetDirectory} from './accountAssetRoots.js';
interface Intent {account_id:string;path:string;root_binding:MediaRootBinding;marker:string;device_id:string|null;inode_id:string|null;marker_device_id:string|null;marker_inode_id:string|null;cleanup_owned:boolean;payload_hash:string;result:Record<string,unknown>|null}
import {directoryName,prepareCreationDirectory,matchesCreationDirectory,removeCreationMarker,removeCreatedDirectory} from './creationIdentity.js';
export async function createAccountDirectory(pool:Pool,session:OwnerSession,key:string,hash:string,data:Record<string,unknown>,mediaRoot:string,checkReferences?:(c:PoolClient,refs:string[])=>Promise<void>,refs:string[]=[]){
 const lock=await pool.connect(),lockKey=session.id+':'+key;
 const transaction=<T>(run:(c:PoolClient)=>Promise<T>)=>sessionTransaction(pool,session,run,lock);
 try{
  await lock.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[lockKey]);
  const intent=await transaction(async c=>{
   const row=(await c.query('SELECT * FROM local_identity.account_creation_intents WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0] as Intent|undefined;
   if(row){if(row.payload_hash!==hash)throw new ConfigurationError(409,'同一操作标识不能用于不同内容。');return row;}
   const receipt=(await c.query('SELECT payload_hash,result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0];
   if(receipt){if(receipt.payload_hash!==hash)throw new ConfigurationError(409,'同一操作标识不能用于不同内容。');return{legacyReceipt:receipt.result};}
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('global-media-root',0))");
   const binding=(await c.query('SELECT local_identity.media_root_binding() binding,local_identity.media_root_owner() owner')).rows[0];
   if(!binding.binding||binding.owner!==session.id)throw new ConfigurationError(403,'仅已绑定的工作区所有者可创建账号，请先初始化本机存储。');
   if(binding.binding.path!==mediaRoot)throw new ConfigurationError(409,'服务媒体根与登记位置不一致，请重启服务。');
   await verifyMediaRootBinding(binding.binding,1024*1024);
   const id=randomUUID(),path=join(mediaRoot,directoryName(String(data.name),id));
   return(await c.query('INSERT INTO local_identity.account_creation_intents(owner_id,idempotency_key,payload_hash,account_id,path,root_binding,marker) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[session.id,key,hash,id,path,binding.binding,randomUUID()])).rows[0] as Intent;
  });
  if('legacyReceipt' in intent)return intent.legacyReceipt;
  const marker=JSON.stringify({accountId:intent.account_id,token:intent.marker});
  if(intent.result){await transaction(c=>requireAccountAssetRoot(c,mediaRoot,intent.account_id));return intent.result;}
  await verifyMediaRootBinding(intent.root_binding,1024*1024);
  try{
   const actual=await prepareCreationDirectory(intent.path,marker,intent,'创建中的目录身份已变化，请保留现场后恢复。'),made=actual.made;
   // Save inode independently before the business commit; restart resumes this exact folder.
   await transaction(c=>c.query('UPDATE local_identity.account_creation_intents SET device_id=$3,inode_id=$4,cleanup_owned=cleanup_owned OR $5,marker_device_id=$6,marker_inode_id=$7 WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key,actual.deviceId,actual.inodeId,made,actual.markerDeviceId,actual.markerInodeId]));
   const result=await transaction(async c=>{
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('global-media-root',0))");
    await verifyMediaRootBinding(intent.root_binding,1024*1024);
    const current=(await c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding;
    if(JSON.stringify(current)!==JSON.stringify(intent.root_binding))throw new ConfigurationError(409,'媒体根已变化，请恢复创建时的位置。');
    if(refs.length)await checkReferences!(c,refs);
    const created=(await c.query('SELECT to_jsonb(local_identity.create_account_at_id($1,$2,$3,$4,$5)) result',[intent.account_id,data.name,data.slug,data.timezone,refs.length?{}:data.policy])).rows[0].result;
    if(refs.length)await c.query('SELECT public.update_current_blueprint($1,$2)',[intent.account_id,data.policy]);
    if(!await matchesCreationDirectory(intent.path,marker,actual))throw new ConfigurationError(409,'创建中的目录或身份标记已变化，请保留现场后恢复。');
    await setAccountAssetDirectory(c,mediaRoot,intent.account_id,intent.path);
    await requireAccountAssetRoot(c,mediaRoot,intent.account_id);
    const registered=(await c.query('SELECT device_id,inode_id FROM local_identity.account_asset_directories WHERE account_id=$1',[intent.account_id])).rows[0];
    if(registered.device_id!==actual.deviceId||registered.inode_id!==actual.inodeId)throw new ConfigurationError(409,'创建目录身份已变化，账号尚未提交。');
    await c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[session.id,key,hash,created]);
    await c.query('UPDATE local_identity.account_creation_intents SET result=$3 WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key,created]);return created;
   });
   // Keep receipt recovery independent of cleanup. Only remove our verified marker.
   try{await removeCreationMarker(intent.path,marker,actual);}catch{/* Committed ownership remains valid; retain uncertain metadata. */}
   return result;
  }catch(error){
   // Never remove unknown/nonempty/replaced folders. Failed intent remains retryable.
   const saved=await transaction(async c=>(await c.query('SELECT * FROM local_identity.account_creation_intents WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0] as Intent);
   if(!saved.result&&saved.device_id&&saved.cleanup_owned)try{if(await removeCreatedDirectory(saved.path,marker,saved)){await transaction(c=>c.query('UPDATE local_identity.account_creation_intents SET device_id=NULL,inode_id=NULL,marker_device_id=NULL,marker_inode_id=NULL,cleanup_owned=false WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key]));}}catch{/* Retain uncertain files for recovery. */}
   if(error instanceof ConfigurationError)throw error;
   if((error as {code?:string}).code==='23505')throw error;
   throw new ConfigurationError(409,'账号目录创建未完成，请检查权限、挂载和磁盘空间后重试。');
  }
 }finally{await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lockKey]).catch(()=>{});lock.release();}
}
