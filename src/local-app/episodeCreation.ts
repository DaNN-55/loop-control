import type {Pool,PoolClient} from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import type {OwnerSession} from './sessions.js';
import {sessionTransaction} from './ownerTransaction.js';
import {ConfigurationError} from './configurationCommands.js';
import {inspectMediaRoot,verifyMediaRootBinding,type MediaRootBinding} from './mediaRootSettings.js';
import {requireAccountAssetRoot} from './accountAssetRoots.js';
import {directoryName,prepareCreationDirectory,matchesCreationDirectory,removeCreationMarker,removeCreatedDirectory} from './creationIdentity.js';
import {resolveStorageContainer,requireStorageContainer,createStorageContainer} from './seriesDirectories.js';
import {resolveEpisodeStorageLocation,requireEpisodeStorageDirectory} from './episodeStorageLocation.js';
interface Intent{owner_id:string;idempotency_key:string;payload_hash:string;payload:{title:string;isTest:boolean};episode_id:string;account_id:string;blueprint_version_id:string;series_version_id:string|null;container_id:string;storage_series_id:string|null;directory_relative_path:string;account_root:string;account_device_id:string;account_inode_id:string;container_relative_path:string;container_device_id:string;container_inode_id:string;root_binding:MediaRootBinding;marker:string;device_id:string|null;inode_id:string|null;marker_device_id:string|null;marker_inode_id:string|null;cleanup_owned:boolean;result:Record<string,unknown>|null}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Same Owner create command; durable reservation precedes filesystem mutation. */
export async function createEpisodeDirectory(pool:Pool,session:OwnerSession,key:string,hash:string,data:Record<string,unknown>,mediaRoot:string,preflight:(c:PoolClient,account:string,policy:Record<string,unknown>)=>Promise<void>){
 if(data.isTest!==undefined&&typeof data.isTest!=='boolean')throw new ConfigurationError(400,'测试生产单标记无效。');
 if(typeof data.accountId!=='string'||!uuid.test(data.accountId)||typeof data.title!=='string'||data.title.length>200||data.seriesVersionId!=null&&(typeof data.seriesVersionId!=='string'||!uuid.test(data.seriesVersionId)))throw new ConfigurationError(400,'生产单账号、标题或系列版本无效。');
 const title=data.title.trim();
 const select=async(c:PoolClient)=>{
  if(!(await c.query('SELECT local_identity.lock_owned_account_row($1) owned',[data.accountId])).rows[0]?.owned)throw new ConfigurationError(404,'账号不可见。');
  const a=(await c.query("SELECT a.*,b.policy FROM public.accounts a JOIN public.account_blueprint_versions b ON b.id=a.current_blueprint_version_id AND b.account_id=a.id AND b.is_active AND b.archived_at IS NULL WHERE a.id=$1 AND a.archived_at IS NULL",[data.accountId])).rows[0];if(!a)throw new ConfigurationError(404,'账号不可见。');
  let seriesId:string|null=null;
  if(data.seriesVersionId){const version=(await c.query('SELECT series_id FROM public.series_versions WHERE id=$1 AND account_id=$2',[data.seriesVersionId,a.id])).rows[0];if(!version)throw new ConfigurationError(400,'系列版本不属于此账号。');seriesId=version.series_id;}
  const root=await requireAccountAssetRoot(c,mediaRoot,a.id);
  // Legacy logical claims are readable, but cannot authorize a new physical layout.
  if(!(await c.query('SELECT 1 FROM local_identity.account_asset_directories WHERE account_id=$1 AND actual_root=$2',[a.id,root])).rowCount)throw new ConfigurationError(409,'账号目录尚未纳管，请先完成目录恢复或迁移。');
  await preflight(c,a.id,{...a.policy,asset_root:root});return{a,seriesId,root};
 };
 // Prepare the explicit unassigned container before holding any session/account lock.
 // No nested pool acquisition while holding the durable creation connection.
 const prepare=await sessionTransaction(pool,session,async c=>{
  const old=(await c.query('SELECT payload_hash FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2 UNION ALL SELECT payload_hash FROM local_identity.episode_creation_intents WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows;
  if(old.length){if(old.some(row=>row.payload_hash!==hash))throw new ConfigurationError(409,'同一操作标识不能用于不同内容。');return false;}
  const selected=await select(c);return selected.seriesId===null;
 });
 if(prepare){const bytes=createHash('sha256').update(session.id+':episode-unassigned:'+key).digest('hex').slice(0,32);const containerKey=`${bytes.slice(0,8)}-${bytes.slice(8,12)}-${bytes.slice(12,16)}-${bytes.slice(16,20)}-${bytes.slice(20)}`;await createStorageContainer(pool,session,containerKey,hash,{accountId:data.accountId},mediaRoot,'unassigned');}
 const client=await pool.connect(),keyLock=session.id+':'+key,accountLock='account-directory-migration:'+data.accountId;
 const transaction=<T>(run:(c:PoolClient)=>Promise<T>)=>sessionTransaction(pool,session,run,client);let accountLocked=false;
 try{
  await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[keyLock]);
  await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[accountLock]);accountLocked=true;
  const intent=await transaction(async c=>{
   const receipt=(await c.query('SELECT payload_hash,result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0];
   if(receipt){if(receipt.payload_hash!==hash)throw new ConfigurationError(409,'同一操作标识不能用于不同内容。');await requireEpisodeStorageDirectory(c,await resolveEpisodeStorageLocation(c,mediaRoot,String(receipt.result.id)));return{receipt:receipt.result};}
   const existing=(await c.query('SELECT * FROM local_identity.episode_creation_intents WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0] as Intent|undefined;if(existing){if(existing.payload_hash!==hash)throw new ConfigurationError(409,'同一操作标识不能用于不同内容。');return existing;}
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('global-media-root',0))");
   const {a,root,seriesId}=await select(c),container=await resolveStorageContainer(c,mediaRoot,a.id,seriesId);await requireStorageContainer(c,mediaRoot,container,true);
   const binding=(await c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding as MediaRootBinding;if(!binding||binding.path!==mediaRoot)throw new ConfigurationError(409,'服务媒体根与登记位置不一致，请重启服务。');await verifyMediaRootBinding(binding,1024*1024);
   const actual=await inspectMediaRoot(root),id=randomUUID(),relativePath=container.relativePath+'/'+directoryName(title,id,'生产单');
   return(await c.query('INSERT INTO local_identity.episode_creation_intents(owner_id,idempotency_key,payload_hash,payload,episode_id,account_id,blueprint_version_id,series_version_id,container_id,storage_series_id,directory_relative_path,account_root,account_device_id,account_inode_id,container_relative_path,container_device_id,container_inode_id,root_binding,marker) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *',[session.id,key,hash,data,id,a.id,a.current_blueprint_version_id,data.seriesVersionId??null,container.containerId,seriesId,relativePath,root,actual.deviceId,actual.inodeId,container.relativePath,container.deviceId,container.inodeId,binding,randomUUID()])).rows[0] as Intent;
  });
  if('receipt'in intent)return intent.receipt;
  if(intent.result){await transaction(async c=>{await requireEpisodeStorageDirectory(c,await resolveEpisodeStorageLocation(c,mediaRoot,intent.episode_id));});return intent.result;}
  const path=join(intent.account_root,intent.directory_relative_path),marker=JSON.stringify({episodeId:intent.episode_id,token:intent.marker});
  const update=(c:PoolClient,sql:string,values:unknown[]=[])=>c.query(sql,[session.id,key,...values]);
  const validateParent=async(c:PoolClient)=>{
   await verifyMediaRootBinding(intent.root_binding,1024*1024);
   const binding=(await c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding;if(JSON.stringify(binding)!==JSON.stringify(intent.root_binding))throw new ConfigurationError(409,'媒体根已变化，请恢复创建时的位置。');
   const root=await requireAccountAssetRoot(c,mediaRoot,intent.account_id),actual=await inspectMediaRoot(root);
   if(root!==intent.account_root||actual.deviceId!==intent.account_device_id||actual.inodeId!==intent.account_inode_id)throw new ConfigurationError(409,'账号目录身份已变化，请恢复创建时的位置。');
   const container=await resolveStorageContainer(c,mediaRoot,intent.account_id,intent.storage_series_id);await requireStorageContainer(c,mediaRoot,container,true);
   if(container.containerId!==intent.container_id||container.relativePath!==intent.container_relative_path||container.deviceId!==intent.container_device_id||container.inodeId!==intent.container_inode_id)throw new ConfigurationError(409,'收纳目录身份已变化，请恢复创建时的位置。');
   await preflight(c,intent.account_id,{asset_root:root});
  };
  await transaction(validateParent);
  try{
   const actual=await prepareCreationDirectory(path,marker,intent,'创建中的生产单目录或标记身份已变化，请保留现场后恢复。'),made=actual.made;
   await transaction(c=>update(c,'UPDATE local_identity.episode_creation_intents SET device_id=$3,inode_id=$4,marker_device_id=$5,marker_inode_id=$6,cleanup_owned=cleanup_owned OR $7 WHERE owner_id=$1 AND idempotency_key=$2',[actual.deviceId,actual.inodeId,actual.markerDeviceId,actual.markerInodeId,made]));
   const verifyChild=async()=>{if(!await matchesCreationDirectory(path,marker,actual))throw new ConfigurationError(409,'创建中的生产单目录或身份标记已变化，请保留现场后恢复。');};
   const result=await transaction(async c=>{
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('global-media-root',0))");await c.query("SELECT pg_advisory_xact_lock(hashtextextended('account-asset-root-ownership',0))");
    await validateParent(c);await verifyChild();
    const created=(await c.query('SELECT to_jsonb(local_identity.create_episode_from_intent($1)) result',[key])).rows[0].result;
    await validateParent(c);await verifyChild();
    await update(c,'UPDATE local_identity.episode_creation_intents SET result=$3 WHERE owner_id=$1 AND idempotency_key=$2',[created]);
    await c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[session.id,key,hash,created]);
    // Final receipt triggers may pause across a filesystem change as well.
    await validateParent(c);await verifyChild();return created;
   });
   try{await transaction(validateParent);await removeCreationMarker(path,marker,actual);}catch{/* Committed ownership does not depend on marker cleanup. */}
   return result;
  }catch(error){
   const saved=await transaction(async c=>(await update(c,'SELECT * FROM local_identity.episode_creation_intents WHERE owner_id=$1 AND idempotency_key=$2')).rows[0] as Intent);
   if(!saved.result&&saved.device_id&&saved.cleanup_owned)try{await transaction(validateParent);if(await removeCreatedDirectory(path,marker,saved)){await transaction(c=>update(c,'UPDATE local_identity.episode_creation_intents SET device_id=NULL,inode_id=NULL,marker_device_id=NULL,marker_inode_id=NULL,cleanup_owned=false WHERE owner_id=$1 AND idempotency_key=$2'));}}catch{/* Unknown files, replaced identities and inherited directories remain untouched. */}
   if(error instanceof ConfigurationError)throw error;throw new ConfigurationError(409,'生产单目录创建未完成，请检查权限、挂载和空间后重试。');
  }
 }finally{if(accountLocked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[accountLock]).catch(()=>{});await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[keyLock]).catch(()=>{});client.release();}
}
