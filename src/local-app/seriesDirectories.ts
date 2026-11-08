import type {Pool,PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {access,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import type {OwnerSession} from './sessions.js';
import {sessionTransaction} from './ownerTransaction.js';
import {ConfigurationError} from './configurationCommands.js';
import {inspectMediaRoot,verifyMediaRootBinding,type MediaRootBinding} from './mediaRootSettings.js';
import {requireAccountAssetRoot} from './accountAssetRoots.js';
import {directoryName,prepareCreationDirectory,matchesCreationDirectory,removeCreationMarker,removeCreatedDirectory} from './creationIdentity.js';
import {safeRelative} from './localFiles.js';
type Client=Pick<PoolClient,'query'>;
type Kind='series'|'unassigned';
interface Intent{owner_id:string;idempotency_key:string;payload_hash:string;container_id:string;account_id:string;kind:Kind;directory_relative_path:string;account_root:string;account_device_id:string;account_inode_id:string;root_binding:MediaRootBinding;marker:string;device_id:string|null;inode_id:string|null;marker_device_id:string|null;marker_inode_id:string|null;cleanup_owned:boolean;result:Record<string,unknown>|null}
export interface StorageContainer{containerId:string|null;accountId:string;seriesId:string|null;kind:Kind;assetRoot:string|null;relativePath:string|null;directoryPath:string|null;deviceId:string|null;inodeId:string|null;status:'ready'|'legacy-unmanaged'|'unset'|'unavailable';reason?:string}
export async function ownedContainerAccount(c:Client,seriesId:string|null,accountId?:string){
 if(seriesId){const row=(await c.query('SELECT s.account_id FROM public.series s JOIN public.account_memberships m ON m.account_id=s.account_id AND m.user_id=local_identity.owner_id() AND m.role=\'owner\' WHERE s.id=$1',[seriesId])).rows[0];if(!row||accountId&&row.account_id!==accountId)throw new ConfigurationError(404,'系列不可见。');accountId=row.account_id;}
 if(!accountId||!(await c.query('SELECT local_identity.lock_owned_account_row($1) owned',[accountId])).rows[0].owned)throw new ConfigurationError(404,'账号不可见。');return accountId;
}
/** Persisted account-relative identity; lookup never creates a folder or business series. */
export async function resolveStorageContainer(c:Client,_mediaRoot:string,accountId:string,seriesId:string|null):Promise<StorageContainer>{
 await ownedContainerAccount(c,seriesId,accountId);
 const row=(await c.query('SELECT * FROM local_identity.account_storage_containers WHERE account_id=$1 AND series_id IS NOT DISTINCT FROM $2::uuid',[accountId,seriesId])).rows[0];
 const account=(await c.query('SELECT actual_root FROM local_identity.account_asset_directories WHERE account_id=$1',[accountId])).rows[0];
 const base={containerId:null,accountId,seriesId,kind:seriesId?'series' as const:'unassigned' as const,assetRoot:account?.actual_root??null,relativePath:null,directoryPath:null,deviceId:null,inodeId:null};
 if(!row)return{...base,status:seriesId?'legacy-unmanaged':'unset',reason:seriesId?'此系列尚未纳入统一目录。':'尚未创建未分系列目录。'};
 if(!safeRelative(row.directory_relative_path)||row.directory_relative_path.includes('/'))throw new ConfigurationError(409,'系列目录登记无效，请检查恢复记录。');
 return{...base,containerId:row.id,relativePath:row.directory_relative_path,directoryPath:account?join(account.actual_root,row.directory_relative_path):null,deviceId:row.device_id,inodeId:row.inode_id,status:'ready'};
}
export async function requireStorageContainer(c:Client,mediaRoot:string,location:StorageContainer,writable=false){
 if(!location.directoryPath||!location.deviceId)throw new ConfigurationError(409,location.reason??'系列目录尚未登记。');
 try{
  const root=await requireAccountAssetRoot(c,mediaRoot,location.accountId);
  if(root!==location.assetRoot)throw new ConfigurationError(409,'账号目录已变化，请重新读取系列位置。');
  const stat=await lstat(location.directoryPath,{bigint:true});
  if(!stat.isDirectory()||stat.isSymbolicLink()||String(stat.dev)!==location.deviceId||String(stat.ino)!==location.inodeId||await realpath(location.directoryPath)!==location.directoryPath)throw new ConfigurationError(409,'系列目录身份已变化，请恢复原目录或检查迁移记录。');
  await access(location.directoryPath,constants.R_OK|constants.X_OK|(writable?constants.W_OK:0));return location.directoryPath;
 }catch(e){if(e instanceof ConfigurationError)throw e;const code=(e as NodeJS.ErrnoException).code;if(code==='EACCES'||code==='EPERM')throw new ConfigurationError(403,'没有访问系列目录的权限，请恢复权限后重试。');throw new ConfigurationError(409,'系列目录缺失或存储盘未挂载，请恢复原位置后重试。');}
}
export async function readStorageContainer(c:Client,mediaRoot:string,accountId:string,seriesId:string|null){
 const location=await resolveStorageContainer(c,mediaRoot,accountId,seriesId);if(location.status!=='ready')return location;
 try{await requireStorageContainer(c,mediaRoot,location);return location;}catch(e){return{...location,status:'unavailable' as const,reason:(e as Error).message};}
}
/** Explicit creation only. Account migration session lock spans filesystem work and every intent transaction. */
export async function createStorageContainer(pool:Pool,session:OwnerSession,key:string,hash:string,data:Record<string,unknown>,mediaRoot:string,kind:Kind){
 const client=await pool.connect(),keyLock=session.id+':'+key,accountLock='account-directory-migration:'+String(data.accountId);
 const transaction=<T>(run:(c:PoolClient)=>Promise<T>)=>sessionTransaction(pool,session,run,client);
 let lockedAccount=false;
 try{
  await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[keyLock]);
  // Use the migration's exact first lock before locking the account row; no sticky extra connection.
  await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[accountLock]);lockedAccount=true;
  const intent=await transaction(async c=>{
   await ownedContainerAccount(c,null,String(data.accountId));
   const receipt=(await c.query('SELECT payload_hash,result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0];
   if(receipt){if(receipt.payload_hash!==hash)throw new ConfigurationError(409,'同一操作标识不能用于不同内容。');return{receipt:receipt.result};}
   let row=(await c.query('SELECT * FROM local_identity.container_creation_intents WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0] as Intent|undefined;
   if(row){if(row.payload_hash!==hash)throw new ConfigurationError(409,'同一操作标识不能用于不同内容。');return row;}
   if(kind==='unassigned'){
    row=(await c.query("SELECT * FROM local_identity.container_creation_intents WHERE account_id=$1 AND kind='unassigned'",[data.accountId])).rows[0] as Intent|undefined;if(row)return row;
   }
   const binding=(await c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding as MediaRootBinding;
   if(!binding||binding.path!==mediaRoot)throw new ConfigurationError(409,'服务媒体根与登记位置不一致，请重启服务。');await verifyMediaRootBinding(binding,1024*1024);
   const root=await requireAccountAssetRoot(c,mediaRoot,String(data.accountId)),identity=await inspectMediaRoot(root),id=randomUUID();
   return(await c.query('INSERT INTO local_identity.container_creation_intents(owner_id,idempotency_key,payload_hash,container_id,account_id,kind,directory_relative_path,account_root,account_device_id,account_inode_id,root_binding,marker) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',[session.id,key,hash,id,data.accountId,kind,directoryName(kind==='series'?String(data.name):'未分系列',id,kind==='series'?'系列':'未分系列'),root,identity.deviceId,identity.inodeId,binding,randomUUID()])).rows[0] as Intent;
  });
  if('receipt' in intent){await transaction(async c=>{const location=await resolveStorageContainer(c,mediaRoot,String(data.accountId),kind==='series'?String(intent.receipt.series_id):null);await requireStorageContainer(c,mediaRoot,location);});return intent.receipt;}
  const path=join(intent.account_root,intent.directory_relative_path),marker=JSON.stringify({containerId:intent.container_id,token:intent.marker});
  const update=(c:PoolClient,sql:string,values:unknown[]=[])=>c.query(sql,[intent.owner_id,intent.idempotency_key,...values]);
  const validateParent=async(c:PoolClient)=>{
   await verifyMediaRootBinding(intent.root_binding,intent.result?0:1024*1024);
   const current=(await c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding;
   if(JSON.stringify(current)!==JSON.stringify(intent.root_binding))throw new ConfigurationError(409,'媒体根已变化，请恢复创建时的位置。');
   const root=await requireAccountAssetRoot(c,mediaRoot,intent.account_id),actual=await inspectMediaRoot(root);
   if(root!==intent.account_root||actual.deviceId!==intent.account_device_id||actual.inodeId!==intent.account_inode_id)throw new ConfigurationError(409,'账号目录身份已变化，请恢复创建时的位置。');
  };
  if(intent.result){await transaction(async c=>{await requireStorageContainer(c,mediaRoot,await resolveStorageContainer(c,mediaRoot,intent.account_id,kind==='series'?intent.container_id:null));if(key!==intent.idempotency_key)await c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[session.id,key,hash,intent.result]);});return intent.result;}
  await transaction(validateParent);
  try{
   const actual=await prepareCreationDirectory(path,marker,intent,'创建中的系列目录或标记身份已变化，请保留现场后恢复。'),made=actual.made;
   await transaction(c=>update(c,'UPDATE local_identity.container_creation_intents SET device_id=$3,inode_id=$4,cleanup_owned=cleanup_owned OR $5,marker_device_id=$6,marker_inode_id=$7 WHERE owner_id=$1 AND idempotency_key=$2',[actual.deviceId,actual.inodeId,made,actual.markerDeviceId,actual.markerInodeId]));
   const result=await transaction(async c=>{
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('global-media-root',0))");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('account-asset-root-ownership',0))");
    await ownedContainerAccount(c,null,intent.account_id);await validateParent(c);
    const created=kind==='series'?(await c.query('SELECT to_jsonb(local_identity.create_series_at_id($1,$2,$3,$4)) result',[intent.container_id,intent.account_id,data.name,data.rules])).rows[0].result:{containerId:intent.container_id,accountId:intent.account_id,kind:'unassigned'};
    const verifyChild=async()=>{if(!await matchesCreationDirectory(path,marker,actual))throw new ConfigurationError(409,'创建中的系列目录或身份标记已变化，请保留现场后恢复。');};
    await validateParent(c);await verifyChild();
    await c.query('INSERT INTO local_identity.account_storage_containers(id,account_id,kind,series_id,directory_relative_path,device_id,inode_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[intent.container_id,intent.account_id,kind,kind==='series'?intent.container_id:null,intent.directory_relative_path,actual.deviceId,actual.inodeId]);
    // Revalidate after the final INSERT as well: a paused query can span an OS directory replacement.
    await validateParent(c);await verifyChild();
    await update(c,'UPDATE local_identity.container_creation_intents SET result=$3 WHERE owner_id=$1 AND idempotency_key=$2',[created]);
    await c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[session.id,key,hash,created]);return created;
   });
   try{await removeCreationMarker(path,marker,actual);}catch{/* Uncertain metadata remains; committed ownership is independent. */}
   return result;
  }catch(error){
   const saved=await transaction(async c=>(await update(c,'SELECT * FROM local_identity.container_creation_intents WHERE owner_id=$1 AND idempotency_key=$2')).rows[0] as Intent);
   if(!saved.result&&saved.device_id&&saved.cleanup_owned)try{await transaction(validateParent);if(await removeCreatedDirectory(path,marker,saved)){await transaction(c=>update(c,'UPDATE local_identity.container_creation_intents SET device_id=NULL,inode_id=NULL,marker_device_id=NULL,marker_inode_id=NULL,cleanup_owned=false WHERE owner_id=$1 AND idempotency_key=$2'));}}catch{/* Unknown/manual files and identity changes are never deletion authority. */}
   if(error instanceof ConfigurationError||(error as {code?:string}).code==='23505')throw error;throw new ConfigurationError(409,'系列目录创建未完成，请检查权限、挂载和空间后重试。');
  }
 }finally{if(lockedAccount)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[accountLock]).catch(()=>{});await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[keyLock]).catch(()=>{});client.release();}
}
