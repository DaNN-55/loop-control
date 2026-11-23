import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {lstat,readdir,readlink} from 'node:fs/promises';
import {join,relative} from 'node:path';
import type {Pool,PoolClient} from 'pg';
import {canonicalFingerprint as digest,ConfigurationError} from './configurationCommands.js';
import {ownerTransaction,sessionTransaction} from './ownerTransaction.js';
import type {OwnerSession} from './sessions.js';
import type {RecycleBatchItemResult,RecycleBatchPreview,RecycleBatchResult} from './recycleBatchTypes.js';
import {LocalEpisodeLifecycle} from './episodeLifecycle.js';
import {deletionFileFingerprint,verifyEpisodeDeletionTarget,type EpisodeDeletionTarget} from './episodeDeletionTargets.js';

interface FootprintFile{key:string;path:string;bytes:number;sha256:string;}
interface Inventory{files:FootprintFile[];links:{path:string;value:string}[];targets:EpisodeDeletionTarget[];protected:boolean;}
interface Entry{episode_id:string;revision:string;title:string;account_name:string;archived_before:string|null;recycled_at:string;size_bytes:string;inventory:Inventory;last_error:string|null;}
const missingEpisode='生产单不存在或无管理权限。';
const busyEpisode='生产单有在途任务、未确认结果、文件锁或状态已变化，请核对后重试。';
const alreadyRecycled='生产单已在回收站。';
const protectedFilesReason='含共享或未登记文件，保留供手动核对。';
const unavailableFiles='无法核对生产单文件，请检查存储位置和活动工程后重试。';
const invalidBatch='批量回收站请求格式无效。';
const oversizedEntry='单项超过容量上限，保留供手动核对。';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const fields:Record<string,string[]>={recycleEpisode:['episodeId'],restoreRecycledEpisode:['episodeId','revision'],saveRecycleLimit:['limitBytes','expectedRevision'],planRecyclePurge:['episodeId','revision'],purgeRecycledEpisode:['episodeId','revision','confirmation','expectedPath','expectedPaths','expectedRevision']};

type RecycleRevision={episodeId:string;revision:string};
type SweepResult=NonNullable<RecycleBatchResult['cleanup']>;
const isUuid=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value);

function batchIds(input:unknown,allowEmpty=false){
 if(!Array.isArray(input)||!allowEmpty&&!input.length||!input.every(isUuid))throw new ConfigurationError(400,invalidBatch);
 const ids=input.map(value=>value.toLowerCase());
 if(new Set(ids).size!==ids.length)throw new ConfigurationError(400,invalidBatch);
 return ids;
}
function revisionList(input:unknown,allowEmpty=false):RecycleRevision[]{
 if(!Array.isArray(input)||!allowEmpty&&!input.length||!input.every(item=>item&&typeof item==='object'&&Object.keys(item).length===2&&isUuid(item.episodeId)&&isUuid(item.revision)))throw new ConfigurationError(400,invalidBatch);
 const items=input.map(({episodeId,revision})=>({episodeId:episodeId.toLowerCase(),revision:revision.toLowerCase()}));
 batchIds(items.map(item=>item.episodeId),allowEmpty);
 return items;
}
function derivedKey(namespace:string,key:string,episodeId:string){
 const hex=createHash('sha256').update(namespace+':'+key+':'+episodeId).digest('hex');
 return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32);
}
const previewSecret=randomBytes(32);
function signPreview(session:OwnerSession,episodeIds:string[],cleanup:RecycleRevision[]){
 return createHmac('sha256',previewSecret).update(digest({ownerId:session.id,episodeIds,cleanup})).digest('hex');
}

/** Membership is reversible; only the existing exact-deletion pipeline removes bytes. */
export class LocalRecycleBin{
 constructor(private pool:Pool,private lifecycle:LocalEpisodeLifecycle){}
 private async inventory(targets:EpisodeDeletionTarget[]):Promise<Inventory>{
  const files:FootprintFile[]=[],links:{path:string;value:string}[]=[];let protectedFiles=targets.some(t=>!!t.preserved?.length);
  try{
   for(const [index,target] of targets.entries()){
    await verifyEpisodeDeletionTarget(target,'original');
    if(!target.identity)continue;
    const visit=async(path:string):Promise<void>=>{
     const stat=await lstat(path,{bigint:true});
     if(stat.isSymbolicLink()){protectedFiles=true;links.push({path:index+':'+relative(target.path,path),value:await readlink(path)});return;}
     if(stat.isDirectory()){for(const name of(await readdir(path)).sort())await visit(join(path,name));const after=await lstat(path,{bigint:true});if(stat.dev!==after.dev||stat.ino!==after.ino||stat.mtimeNs!==after.mtimeNs)throw new ConfigurationError(409,'文件目录正在变化，请稍后重试。');return;}
     if(!stat.isFile()){protectedFiles=true;return;}
     const file=await deletionFileFingerprint(path,stat.nlink);
     if(!Number.isSafeInteger(file.bytes))throw new ConfigurationError(409,'文件大小超出可确认范围。');
     if(stat.nlink>1n)protectedFiles=true;
     files.push({key:file.identity.dev+':'+file.identity.ino,path:index+':'+relative(target.path,path),bytes:file.bytes,sha256:file.sha256});
    };
    await visit(target.path);await verifyEpisodeDeletionTarget(target,'original');
   }
  }catch(error){
   if(error instanceof ConfigurationError)throw error;
   throw new ConfigurationError(409,unavailableFiles);
  }
  return{files,links,targets,protected:protectedFiles};
 }
 private bytes(inventories:Inventory[]){const files=new Map<string,number>();for(const inventory of inventories)for(const file of inventory.files)files.set(file.key,file.bytes);return [...files.values()].reduce((sum,n)=>sum+n,0);}
 private async entries(c:PoolClient){return(await c.query(`SELECT r.*,e.title,a.name account_name FROM local_identity.episode_recycle_bin r JOIN public.episodes e ON e.id=r.episode_id JOIN public.accounts a ON a.id=e.account_id WHERE r.owner_id=local_identity.owner_id() ORDER BY r.recycled_at,r.episode_id`)).rows as Entry[];}
 private async protection(c:PoolClient,entry:Entry){
  if(entry.inventory.protected)return protectedFilesReason;
  if((await c.query('SELECT local_identity.episode_deletion_has_dependencies($1) busy',[entry.episode_id])).rows[0].busy)return '其他生产单仍有引用，暂不自动清理。';
  try{for(const target of entry.inventory.targets)await verifyEpisodeDeletionTarget(target,'original');}catch{return '存储位置离线或已变化，请恢复原位置。';}
  return '';
 }
 private async capacity(c:PoolClient,ownerId:string){
  const entries=await this.entries(c);
  const settings=(await c.query('SELECT limit_bytes,revision FROM local_identity.recycle_bin_settings WHERE owner_id=$1',[ownerId])).rows[0];
  const pending=(await c.query("SELECT result FROM local_identity.command_receipts WHERE owner_id=$1 AND result->>'cleanupPending'='true' AND result ? 'recycleInventory'",[ownerId])).rows.map(r=>r.result.recycleInventory as Inventory);
  return {entries,pending,limitBytes:Number(settings?.limit_bytes??5_000_000_000),settingsRevision:Number(settings?.revision??1)};
 }
 async read(session:OwnerSession){return ownerTransaction(this.pool,session.id,true,async c=>{
  const {entries,pending,limitBytes,settingsRevision}=await this.capacity(c,session.id);
  const usedBytes=this.bytes([...entries.map(e=>e.inventory),...pending]);
  const items=[];for(const entry of entries)items.push({episodeId:entry.episode_id,revision:entry.revision,title:entry.title,accountName:entry.account_name,recycledAt:entry.recycled_at,archivedBefore:!!entry.archived_before,sizeBytes:Number(entry.size_bytes),protection:await this.protection(c,entry)||entry.last_error||''});
  return{items,limitBytes,settingsRevision,usedBytes,pendingBytes:this.bytes(pending),overLimit:usedBytes>limitBytes};
 });}
 private async entry(c:PoolClient,id:unknown,revision?:unknown){
  if(typeof id!=='string'||!uuid.test(id))throw new ConfigurationError(400,'生产单标识无效。');
  if(!(await c.query('SELECT local_identity.lock_owned_episode_cleanup($1) owned',[id])).rows[0]?.owned)throw new ConfigurationError(404,'回收站记录不存在或无管理权限。');
  const entry=(await c.query(`SELECT r.*,e.title FROM local_identity.episode_recycle_bin r JOIN public.episodes e ON e.id=r.episode_id WHERE r.owner_id=local_identity.owner_id() AND r.episode_id=$1`,[id])).rows[0] as Entry|undefined;
  if(!entry)throw new ConfigurationError(404,'回收站记录不存在或无管理权限。');
  if(revision!==undefined&&revision!==entry.revision)throw new ConfigurationError(409,'回收站记录已变化，请刷新后重试。');return entry;
 }
 private async unchanged(c:PoolClient,entry:Entry){
  const p=await this.lifecycle.recycleSnapshot(c,entry.episode_id),current=await this.inventory(p.targets);
  const relocated=p.targets.some((target,index)=>target.path!==entry.inventory.targets[index]?.path);
  const logical=(v:Inventory)=>({files:v.files.map(({key,path,bytes,sha256})=>({path,bytes,sha256,...(!relocated?{key}:{})})).sort((a,b)=>a.path.localeCompare(b.path)),links:v.links??[]});
  if(digest(logical(current))!==digest(logical(entry.inventory)))throw new ConfigurationError(409,'文件内容或位置已变化，未覆盖或删除任何文件；请核对原位置。');
  return {...p,protected:current.protected};
 }
 private async withOwnerLock<T>(session:OwnerSession,run:(connection:PoolClient)=>Promise<T>){
  const connection=await this.pool.connect(),lock='recycle-bin:'+session.id;
  try{
   await connection.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[lock]);
   return await run(connection);
  }finally{
   await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lock]).catch(()=>{});
   connection.release();
  }
 }

 private async previewRecycle(session:OwnerSession,episodeIds:string[],retainEpisodeIds:string[],connection:PoolClient):Promise<RecycleBatchPreview>{
  const {entries,pending,limitBytes}=await ownerTransaction(this.pool,session.id,true,c=>this.capacity(c,session.id),connection);
  const items:RecycleBatchPreview['items']=[],added:Inventory[]=[];
  for(const episodeId of episodeIds){
   try{
    const outcome=await sessionTransaction(this.pool,session,async c=>{
     const {status}=(await c.query('SELECT local_identity.recycle_episode_eligibility($1) status',[episodeId])).rows[0];
     if(status==='missing')return {status:'skipped',reason:missingEpisode} as const;
     if(status==='recycled')return {status:'skipped',reason:alreadyRecycled} as const;
     if(status!=='ready')return {status:'failed',reason:busyEpisode} as const;
     return {inventory:await this.inventory((await this.lifecycle.recycleSnapshot(c,episodeId)).targets)};
    },connection);
    if(outcome.inventory){
     added.push(outcome.inventory);
     items.push({episodeId,status:'ready',sizeBytes:this.bytes([outcome.inventory])});
    }else items.push({episodeId,status:outcome.status,reason:outcome.reason});
   }catch(error){
    if(!(error instanceof ConfigurationError)||error.status>=500)throw error;
    items.push({episodeId,status:'failed',reason:unavailableFiles});
   }
  }

  const currentBytes=this.bytes([...entries.map(entry=>entry.inventory),...pending]);
  const remaining=new Map(entries.map(entry=>[entry.episode_id,entry.inventory]));
  const combinedBytes=()=>this.bytes([...remaining.values(),...pending,...added]);
  const afterMoveBytes=combinedBytes();
  let projectedBytes=afterMoveBytes;
  const candidates:RecycleBatchPreview['candidates']=[],retained:RecycleBatchPreview['retained']=[];
  const selected=new Set([...episodeIds,...retainEpisodeIds]);
  for(const entry of entries){
   // Without an accepted move there is no sweep, even if the bin is already over its limit.
   if(!added.length||projectedBytes<=limitBytes)break;
   const episodeId=entry.episode_id,title=entry.title,sizeBytes=Number(entry.size_bytes);
   if(selected.has(episodeId))continue;
   let reason=sizeBytes>limitBytes?oversizedEntry:'';
   if(!reason){
    try{await sessionTransaction(this.pool,session,c=>this.cleanupPlan(c,entry),connection);}
    catch(error){
     if(!(error instanceof ConfigurationError)||error.status>=500)throw error;
     reason=error.message;
    }
   }
   if(reason){retained.push({episodeId,title,reason});continue;}
   candidates.push({episodeId,revision:entry.revision,title,sizeBytes});
   remaining.delete(episodeId);
   projectedBytes=combinedBytes();
  }
  const previewKey=signPreview(session,items.filter(item=>item.status==='ready').map(item=>item.episodeId),candidates.map(({episodeId,revision})=>({episodeId,revision})));
  return {items,candidates,retained,previewKey,currentBytes,afterMoveBytes,projectedBytes,limitBytes,pendingBytes:this.bytes(pending)};
 }

 private async cleanupPlan(c:PoolClient,entry:Entry){
  const protection=await this.protection(c,entry);
  if(protection)throw new ConfigurationError(409,protection);
  if((await c.query(`SELECT local_identity.episode_deletion_submission_unknown($1) OR EXISTS(
    SELECT 1 FROM local_identity.episode_deletion_intents WHERE episode_id=$1 AND state='prepared'
  ) busy`,[entry.episode_id])).rows[0].busy)throw new ConfigurationError(409,busyEpisode);
  try{
   if(!(await c.query('SELECT local_identity.lock_owned_episode_deletion($1) owned',[entry.episode_id])).rows[0]?.owned)throw new ConfigurationError(409,busyEpisode);
  }catch(error){
   if(error instanceof ConfigurationError||['55000','55P03'].includes((error as {code?:string}).code??''))throw new ConfigurationError(409,busyEpisode);
   throw error;
  }
  const verified=await this.unchanged(c,entry).catch(error=>{
   if(!(error instanceof ConfigurationError)||error.status>=500)throw error;
   throw new ConfigurationError(409,unavailableFiles);
  });
  if(verified.protected)throw new ConfigurationError(409,protectedFilesReason);
  return verified.visible;
 }

 async execute(session:OwnerSession,body:Record<string,unknown>){
  const {command}=body;
  if(command==='previewBatchRecycle'||command==='batchRecycleEpisodes'){
   const data=body.data as Record<string,unknown>;
   const preview=command==='previewBatchRecycle';
   if(!data||Object.keys(body).some(field=>!['command','data','idempotencyKey'].includes(field))||Object.keys(data).some(field=>!(preview?['episodeIds','retainEpisodeIds']:['episodeIds','cleanup','previewKey']).includes(field)))throw new ConfigurationError(400,invalidBatch);
   const episodeIds=batchIds(data.episodeIds);
   if(preview){
    const retainEpisodeIds=data.retainEpisodeIds===undefined?[]:batchIds(data.retainEpisodeIds,true);
    return this.withOwnerLock(session,connection=>this.previewRecycle(session,episodeIds,retainEpisodeIds,connection));
   }
   const cleanup=revisionList(data.cleanup,true),{idempotencyKey}=body,{previewKey}=data;
   if(!isUuid(idempotencyKey)||typeof previewKey!=='string'||!/^[0-9a-f]{64}$/.test(previewKey))throw new ConfigurationError(400,invalidBatch);
   return this.withOwnerLock(session,connection=>this.runBatch(session,body,idempotencyKey,episodeIds.map(episodeId=>({episodeId})),connection,{entries:cleanup,previewKey}));
  }
  if(command==='batchRestoreRecycledEpisodes'){
   const data=body.data as Record<string,unknown>,key=body.idempotencyKey;
   if(!data||!isUuid(key)||Object.keys(body).some(field=>!['command','data','idempotencyKey'].includes(field))||Object.keys(data).some(field=>field!=='items'))throw new ConfigurationError(400,invalidBatch);
   const items=revisionList(data.items);
   return this.withOwnerLock(session,connection=>this.runBatch(session,body,key,items,connection));
  }
  return this.withOwnerLock(session,connection=>this.executeSingle(session,body,connection));
 }

 private async runBatch(session:OwnerSession,body:Record<string,unknown>,key:string,selection:{episodeId:string;revision?:string}[],connection:PoolClient,cleanup?:{entries:RecycleRevision[];previewKey:string}):Promise<RecycleBatchResult>{
  const hash=digest({endpoint:'recycle-bin',...body});
  const old=await this.commandReceipt(session,key,hash,connection);
  if(old)return old.result;
  if(cleanup){
   const expected=signPreview(session,selection.map(item=>item.episodeId),cleanup.entries);
   if(!timingSafeEqual(Buffer.from(cleanup.previewKey,'hex'),Buffer.from(expected,'hex')))throw new ConfigurationError(409,'容量预览已变化，请重新预览。');
  }
  const command=cleanup?'recycleEpisode':'restoreRecycledEpisode';
  const items:RecycleBatchItemResult[]=[];
  for(const data of selection){
   try{
    await this.executeSingle(session,{command,data,idempotencyKey:derivedKey(command,key,data.episodeId)},connection,true);
    items.push({episodeId:data.episodeId,status:'success'});
   }catch(error){
    if(!(error instanceof ConfigurationError)||![404,409].includes(error.status))throw error;
    items.push({episodeId:data.episodeId,status:error.status===404||error.message===alreadyRecycled?'skipped':'failed',reason:error.status===404?missingEpisode:error.message});
   }
  }
  const result:RecycleBatchResult={items};
  if(cleanup){
   const allowed=new Map(cleanup.entries.map(item=>[item.episodeId,item.revision]));
   const protectedIds=new Set(selection.map(item=>item.episodeId));
   const mutates=items.some(item=>item.status==='success');
   result.cleanup=await this.sweep(session,protectedIds,mutates?allowed:new Map(),key);
  }
  await this.receipt(session,key,hash,result,connection);
  return result;
 }

 private async commandReceipt(session:OwnerSession,key:string,hash:string,connection:PoolClient){
  const old=await sessionTransaction(this.pool,session,async c=>(await c.query('SELECT payload_hash,result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0],connection);
  if(old&&old.payload_hash!==hash)throw new ConfigurationError(409,'同一操作标识不能用于不同内容。');
  return old;
 }

 private async executeSingle(session:OwnerSession,body:Record<string,unknown>,connection:PoolClient,deferSweep=false){
  const command=String(body.command),key=body.idempotencyKey,data=body.data as Record<string,unknown>;
  if(!Object.hasOwn(fields,command)||typeof key!=='string'||!uuid.test(key)||!data||typeof data!=='object'||Array.isArray(data)||Object.keys(body).some(k=>!['command','data','idempotencyKey'].includes(k))||Object.keys(data).some(k=>!fields[command].includes(k)))throw new ConfigurationError(400,'回收站请求格式无效。');
  if(['restoreRecycledEpisode','planRecyclePurge','purgeRecycledEpisode'].includes(command)&&(typeof data.revision!=='string'||!uuid.test(data.revision)))throw new ConfigurationError(400,'回收站版本标识无效。');
  const hash=digest({endpoint:'recycle-bin',...body});
  let episodeLock:string|undefined;
  try{
   if(['recycleEpisode','restoreRecycledEpisode'].includes(command)){
    if(typeof data.episodeId!=='string'||!uuid.test(data.episodeId))throw new ConfigurationError(400,'生产单标识无效。');
    episodeLock='episode-delete:'+data.episodeId;await connection.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[episodeLock]);
   }
   const old=await this.commandReceipt(session,key,hash,connection);
   if(old)return old.result;
   if(command==='planRecyclePurge')return await sessionTransaction(this.pool,session,async c=>{const entry=await this.entry(c,data.episodeId,data.revision);return(await this.unchanged(c,entry)).visible;},connection);
   if(command==='purgeRecycledEpisode'){
    const deletionKey=createHash('sha256').update('recycle-purge:'+key).digest('hex');
    const stableKey=deletionKey.slice(0,8)+'-'+deletionKey.slice(8,12)+'-4'+deletionKey.slice(13,16)+'-a'+deletionKey.slice(17,20)+'-'+deletionKey.slice(20,32);
    const committed=await sessionTransaction(this.pool,session,async c=>(await c.query('SELECT result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,stableKey])).rows[0],connection);
    if(committed){
     const {revision:_revision,...deletion}=data;
     const result=await this.lifecycle.execute(session,{command:'deleteEpisode',idempotencyKey:stableKey,data:deletion});
     await this.receipt(session,key,hash,result,connection);return result;
    }
    await sessionTransaction(this.pool,session,async c=>{const entry=await this.entry(c,data.episodeId,data.revision);await this.unchanged(c,entry);},connection);
    const {revision:_revision,...deletion}=data;
    const result=await this.lifecycle.execute(session,{command:'deleteEpisode',idempotencyKey:stableKey,data:deletion});
    await this.receipt(session,key,hash,result,connection);return result;
   }
   const value=await sessionTransaction(this.pool,session,async c=>{
    let result:unknown;
    if(command==='recycleEpisode'){
     if(deferSweep){
      const {status}=(await c.query('SELECT local_identity.recycle_episode_eligibility($1) status',[data.episodeId])).rows[0];
      if(status==='missing')throw new ConfigurationError(404,missingEpisode);
      if(status==='recycled')throw new ConfigurationError(409,alreadyRecycled);
      if(status!=='ready')throw new ConfigurationError(409,busyEpisode);
     }
     const p=await this.lifecycle.recycleSnapshot(c,String(data.episodeId)),inventory=await this.inventory(p.targets),sizeBytes=this.bytes([inventory]);
     const revision=(await c.query('SELECT local_identity.recycle_owned_episode($1,$2,$3) revision',[data.episodeId,inventory,sizeBytes])).rows[0].revision;
     result={episodeId:data.episodeId,revision,sizeBytes,recycled:true};
    }else if(command==='restoreRecycledEpisode'){
     const entry=await this.entry(c,data.episodeId,data.revision);await this.unchanged(c,entry);
     await c.query('SELECT local_identity.restore_recycled_episode($1,$2)',[data.episodeId,data.revision]);result={episodeId:data.episodeId,restored:true};
    }else{
     if(!Number.isSafeInteger(data.limitBytes)||Number(data.limitBytes)<100_000_000||Number(data.limitBytes)>1_000_000_000_000||!Number.isSafeInteger(data.expectedRevision))throw new ConfigurationError(400,'回收站上限须为 0.1 至 1000 GB。');
     const revision=(await c.query('SELECT local_identity.save_recycle_limit($1,$2) revision',[data.limitBytes,data.expectedRevision])).rows[0].revision;result={limitBytes:data.limitBytes,settingsRevision:Number(revision)};
    }
    await c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[session.id,key,hash,result]);return result;
   },connection);
   if(episodeLock){await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[episodeLock]);episodeLock=undefined;}
   // A read or application upgrade never sweeps. Only a newly accepted explicit mutation does.
   if(!deferSweep&&(command==='recycleEpisode'||command==='saveRecycleLimit'))await this.sweep(session,new Set(command==='recycleEpisode'?[String(data.episodeId)]:[]));
   return value;
  }catch(error){
   const code=(error as {code?:string}).code;
   if(['55000','55P03'].includes(code??''))throw new ConfigurationError(409,busyEpisode);
   if(code==='42501')throw new ConfigurationError(404,missingEpisode);throw error;
  }finally{if(episodeLock)await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[episodeLock]).catch(()=>{});}
 }
 private async receipt(session:OwnerSession,key:string,hash:string,result:unknown,connection:PoolClient){await sessionTransaction(this.pool,session,c=>c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[session.id,key,hash,result]),connection);}
 private async sweep(session:OwnerSession,protectedIds:ReadonlySet<string>,allowed?:ReadonlyMap<string,string>,batchKey?:string):Promise<SweepResult>{
  let summary=await this.read(session);
  const items:SweepResult['items']=[];
  for(const item of summary.items){
   if(!summary.overLimit)break;
   if(protectedIds.has(item.episodeId)||item.sizeBytes>summary.limitBytes||allowed&&!allowed.has(item.episodeId))continue;
   const {episodeId,title}=item;
   if(allowed&&allowed.get(episodeId)!==item.revision){
    items.push({episodeId,title,status:'skipped',reason:'回收站记录已变化，请刷新后重试。'});
    continue;
   }
   try{
    const p=await sessionTransaction(this.pool,session,async c=>this.cleanupPlan(c,await this.entry(c,episodeId,item.revision)));
    const deleted=await this.lifecycle.execute(session,{command:'deleteEpisode',idempotencyKey:batchKey?derivedKey('recycle-sweep',batchKey,episodeId):randomUUID(),data:{episodeId,confirmation:p.confirmation,expectedPath:p.path,expectedPaths:p.paths,expectedRevision:p.revision}});
    items.push({episodeId,title,status:'success',...(deleted.cleanupPending?{reason:'记录已清理，文件仍待释放。'}:{})});
   }catch(error){
    const reason=error instanceof Error?error.message:'清理未完成，请重试。';
    await sessionTransaction(this.pool,session,c=>c.query('SELECT local_identity.note_recycle_error($1,$2,$3)',[episodeId,item.revision,reason]));
    items.push({episodeId,title,status:'failed',reason:error instanceof ConfigurationError?'文件或生产单状态已变化，请在回收站核对。':'清理未完成，请重试。'});
   }
   summary=await this.read(session);
  }
  return {items,usedBytes:summary.usedBytes,limitBytes:summary.limitBytes,pendingBytes:summary.pendingBytes};
 }
}
