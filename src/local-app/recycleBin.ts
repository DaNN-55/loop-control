import {createHash,randomUUID} from 'node:crypto';
import {lstat,readdir,readlink} from 'node:fs/promises';
import {join,relative} from 'node:path';
import type {Pool,PoolClient} from 'pg';
import {canonical,ConfigurationError} from './configurationCommands.js';
import {ownerTransaction,sessionTransaction} from './ownerTransaction.js';
import type {OwnerSession} from './sessions.js';
import {LocalEpisodeLifecycle} from './episodeLifecycle.js';
import {deletionFileFingerprint,verifyEpisodeDeletionTarget,type EpisodeDeletionTarget} from './episodeDeletionTargets.js';

interface FootprintFile{key:string;path:string;bytes:number;sha256:string;}
interface Inventory{files:FootprintFile[];links:{path:string;value:string}[];targets:EpisodeDeletionTarget[];protected:boolean;}
interface Entry{episode_id:string;revision:string;title:string;account_name:string;archived_before:string|null;recycled_at:string;size_bytes:string;inventory:Inventory;last_error:string|null;}
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const fields:Record<string,string[]>={recycleEpisode:['episodeId'],restoreRecycledEpisode:['episodeId','revision'],saveRecycleLimit:['limitBytes','expectedRevision'],planRecyclePurge:['episodeId','revision'],purgeRecycledEpisode:['episodeId','revision','confirmation','expectedPath','expectedPaths','expectedRevision']};

/** Membership is reversible; only the existing exact-deletion pipeline removes bytes. */
export class LocalRecycleBin{
 constructor(private pool:Pool,private lifecycle:LocalEpisodeLifecycle){}
 private async inventory(targets:EpisodeDeletionTarget[]):Promise<Inventory>{
  const files:FootprintFile[]=[],links:{path:string;value:string}[]=[];let protectedFiles=targets.some(t=>!!t.preserved?.length);
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
  return{files,links,targets,protected:protectedFiles};
 }
 private bytes(inventories:Inventory[]){const files=new Map<string,number>();for(const inventory of inventories)for(const file of inventory.files)files.set(file.key,file.bytes);return [...files.values()].reduce((sum,n)=>sum+n,0);}
 private async entries(c:PoolClient){return(await c.query(`SELECT r.*,e.title,a.name account_name FROM local_identity.episode_recycle_bin r JOIN public.episodes e ON e.id=r.episode_id JOIN public.accounts a ON a.id=e.account_id WHERE r.owner_id=local_identity.owner_id() ORDER BY r.recycled_at,r.episode_id`)).rows as Entry[];}
 private async protection(c:PoolClient,entry:Entry){
  if(entry.inventory.protected)return '含共享或未登记文件，保留供手动核对。';
  if((await c.query('SELECT local_identity.episode_deletion_has_dependencies($1) busy',[entry.episode_id])).rows[0].busy)return '其他生产单仍有引用，暂不自动清理。';
  try{for(const target of entry.inventory.targets)await verifyEpisodeDeletionTarget(target,'original');}catch{return '存储位置离线或已变化，请恢复原位置。';}
  return '';
 }
 async read(session:OwnerSession){return ownerTransaction(this.pool,session.id,true,async c=>{
  const entries=await this.entries(c),settings=(await c.query('SELECT limit_bytes,revision FROM local_identity.recycle_bin_settings WHERE owner_id=$1',[session.id])).rows[0];
  const pending=(await c.query("SELECT result FROM local_identity.command_receipts WHERE owner_id=$1 AND result->>'cleanupPending'='true' AND result ? 'recycleInventory'",[session.id])).rows.map(r=>r.result.recycleInventory as Inventory);
  const limitBytes=Number(settings?.limit_bytes??5_000_000_000),usedBytes=this.bytes([...entries.map(e=>e.inventory),...pending]);
  const items=[];for(const entry of entries)items.push({episodeId:entry.episode_id,revision:entry.revision,title:entry.title,accountName:entry.account_name,recycledAt:entry.recycled_at,archivedBefore:!!entry.archived_before,sizeBytes:Number(entry.size_bytes),protection:await this.protection(c,entry)||entry.last_error||''});
  return{items,limitBytes,settingsRevision:Number(settings?.revision??1),usedBytes,pendingBytes:this.bytes(pending),overLimit:usedBytes>limitBytes};
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
  return p;
 }
 async execute(session:OwnerSession,body:Record<string,unknown>){
  const command=String(body.command),key=body.idempotencyKey,data=body.data as Record<string,unknown>;
  if(!fields[command]||typeof key!=='string'||!uuid.test(key)||!data||typeof data!=='object'||Array.isArray(data)||Object.keys(body).some(k=>!['command','data','idempotencyKey'].includes(k))||Object.keys(data).some(k=>!fields[command].includes(k)))throw new ConfigurationError(400,'回收站请求格式无效。');
  if(['restoreRecycledEpisode','planRecyclePurge','purgeRecycledEpisode'].includes(command)&&(typeof data.revision!=='string'||!uuid.test(data.revision)))throw new ConfigurationError(400,'回收站版本标识无效。');
  const hash=digest({endpoint:'recycle-bin',...body}),connection=await this.pool.connect(),ownerLock='recycle-bin:'+session.id;
  let episodeLock:string|undefined;
  try{
   await connection.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[ownerLock]);
   if(['recycleEpisode','restoreRecycledEpisode'].includes(command)){
    if(typeof data.episodeId!=='string'||!uuid.test(data.episodeId))throw new ConfigurationError(400,'生产单标识无效。');
    episodeLock='episode-delete:'+data.episodeId;await connection.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[episodeLock]);
   }
   const old=await sessionTransaction(this.pool,session,async c=>(await c.query('SELECT payload_hash,result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0],connection);
   if(old){if(old.payload_hash!==hash)throw new ConfigurationError(409,'同一操作标识不能用于不同内容。');return old.result;}
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
   if(command==='recycleEpisode'||command==='saveRecycleLimit')await this.sweep(session,command==='recycleEpisode'?String(data.episodeId):undefined);
   return value;
  }catch(error){
   const code=(error as {code?:string}).code;
   if(['55000','55P03'].includes(code??''))throw new ConfigurationError(409,'生产单有在途任务、未确认结果、文件锁或状态已变化，请核对后重试。');
   if(code==='42501')throw new ConfigurationError(404,'生产单不存在或无管理权限。');throw error;
  }finally{if(episodeLock)await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[episodeLock]).catch(()=>{});await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[ownerLock]).catch(()=>{});connection.release();}
 }
 private async receipt(session:OwnerSession,key:string,hash:string,result:unknown,connection:PoolClient){await sessionTransaction(this.pool,session,c=>c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[session.id,key,hash,result]),connection);}
 private async sweep(session:OwnerSession,newest?:string){
  let summary=await this.read(session);if(!summary.overLimit)return;
  for(const item of summary.items){
   if(item.episodeId===newest||item.sizeBytes>summary.limitBytes)continue;
   try{
    const p=await sessionTransaction(this.pool,session,async c=>{const entry=await this.entry(c,item.episodeId,item.revision);const protection=await this.protection(c,entry);if(protection)throw new ConfigurationError(409,protection);return(await this.unchanged(c,entry)).visible;});
    await this.lifecycle.execute(session,{command:'deleteEpisode',idempotencyKey:randomUUID(),data:{episodeId:item.episodeId,confirmation:p.confirmation,expectedPath:p.path,expectedPaths:p.paths,expectedRevision:p.revision}});
   }catch(error){await sessionTransaction(this.pool,session,c=>c.query('SELECT local_identity.note_recycle_error($1,$2,$3)',[item.episodeId,item.revision,error instanceof Error?error.message:'清理未完成，请重试。']));}
   summary=await this.read(session);if(!summary.overLimit)break;
  }
 }
}
