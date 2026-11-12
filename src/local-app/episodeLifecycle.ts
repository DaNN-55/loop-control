import {resolveEpisodeAssetRoot,requireAccountAssetRoot} from './accountAssetRoots.js';
import type{Pool,PoolClient}from'pg';
import{canonicalFingerprint as fingerprint,ConfigurationError}from'./configurationCommands.js';
import {historyBlobTargets,finishHistoryBlob,type HistoryBlobTarget} from './historyEpisodeDeletion.js';
import {tokenHash} from './sessions.js';
import{ownerTransaction,sessionTransaction}from'./ownerTransaction.js';
import type{OwnerSession}from'./sessions.js';
import{readMediaDeployment}from'./mediaDeployment.js';
import{episodeDeletionTargets,verifyEpisodeDeletionTarget,inventoryEpisodeDeletion,type EpisodeDeletionTarget}from'./episodeDeletionTargets.js';
import {resolveEpisodeStorageLocation} from './episodeStorageLocation.js';
import {verifyMediaRootBinding} from './mediaRootSettings.js';
import {hasActiveNativeStudio} from '../worker/openchatcutStudio.js';
import {relative} from 'node:path';
import {stageConfirmedEpisodeFiles,restoreConfirmedEpisodeFiles,finalizeConfirmedEpisodeFiles} from '../worker/episodeDeletion.js';
const uuid=/^[0-9a-f-]{36}$/;
interface DeletionResult{recycleInventory?:unknown;episodeId:string;title:string;path:string;stagingPath:string;cleanupKey:string;cleanupPending:boolean;localRemoved?:boolean;summary:unknown;cleanupRoot:string;paths?:string[];stagingPaths?:string[];cleanupTargets?:EpisodeDeletionTarget[];historyCleanupTargets?:HistoryBlobTarget[];historyScanRoots?:string[];historyRemovedPaths?:string[];message?:string;}
export function publicDeletionResult(result:DeletionResult){const{recycleInventory:_inventory,cleanupRoot:_root,cleanupTargets:_targets,historyCleanupTargets:_history,historyScanRoots:_scan,historyRemovedPaths:_removed,message,...visible}=result;return{...visible,...(result.cleanupPending&&message?{message}:{}),...(result.cleanupPending&&(!result.cleanupTargets||result.cleanupTargets.some(target=>!target.files))?{message:'旧回执没有可验证的精确文件清单；暂存与未知文件保留。'}:{})};}
export class LocalEpisodeLifecycle{
 constructor(private pool:Pool,private mediaRoot:string,private beforeDelete:(id:string)=>Promise<void>=async()=>{},private historyRoot?:string){}
 async pending(session:OwnerSession){return ownerTransaction(this.pool,session.id,true,async c=>{
  const committed=(await c.query("SELECT result FROM local_identity.command_receipts WHERE owner_id=$1 AND result->>'cleanupPending'='true' AND result ? 'cleanupRoot'",[session.id])).rows.map(r=>publicDeletionResult(r.result));
  const prepared=(await c.query("SELECT * FROM local_identity.episode_deletion_intents WHERE owner_id=$1 AND state='prepared'",[session.id])).rows.map(intent=>this.preparedResult(intent));return[...prepared,...committed];
 });}
 private preparedResult(intent:{idempotency_key:string;episode_id:string;manifest:{title?:string;path?:string;targets:EpisodeDeletionTarget[]};last_error?:string}){return{cleanupKey:intent.idempotency_key,episodeId:intent.episode_id,title:intent.manifest.title??intent.episode_id,path:intent.manifest.path??intent.manifest.targets[0]?.path??'',stagingPaths:intent.manifest.targets.flatMap(target=>target.files?.map(file=>file.stagingPath)??[]),phase:'prepared',cleanupPending:true,message:intent.last_error??'删除尚未提交，可恢复已暂存的文件。'};}
 private async retry(session:OwnerSession,key:string){
  const connection=await this.pool.connect();let lock:string|undefined;
  try{
   const read=()=>sessionTransaction(this.pool,session,async c=>({receipt:(await c.query('SELECT result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0],intent:(await c.query('SELECT * FROM local_identity.episode_deletion_intents WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0]}),connection);
   let current=await read();if(current.receipt)return await this.finish(session,key,connection);if(!current.intent)throw new ConfigurationError(404,'删除恢复记录不可见。');
   lock='episode-delete:'+current.intent.episode_id;await connection.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[lock]);current=await read();if(current.receipt)return await this.finish(session,key,connection);
   if(!current.intent||!['prepared','rolled_back'].includes(current.intent.state))throw new ConfigurationError(409,'删除提交状态尚未确认，请保留文件并重试。');
   if(current.intent.state==='prepared')try{
    for(const target of [...current.intent.manifest.targets as EpisodeDeletionTarget[]].reverse())await restoreConfirmedEpisodeFiles(target);
    await sessionTransaction(this.pool,session,c=>c.query('SELECT local_identity.reserve_episode_deletion_intent($1,false)',[key]),connection);
   }catch(error){const message='文件恢复尚未完成：'+(error instanceof Error?error.message:'请恢复原位置后重试。');await sessionTransaction(this.pool,session,c=>c.query('SELECT local_identity.record_owned_deletion_cleanup_error($1,$2)',[key,message]),connection);return{...this.preparedResult(current.intent),message};}
   return{...this.preparedResult(current.intent),cleanupPending:false,recovered:true,message:'未提交的删除已恢复，请重新检查范围后确认。'};
  }finally{if(lock)await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lock]).catch(()=>{});connection.release();}
 }
 private async episode(c:PoolClient,id:unknown,cleanup=false){
  if(typeof id!=='string'||!uuid.test(id))throw new ConfigurationError(400,'生产单标识无效。');
  if(!(await c.query(cleanup?'SELECT local_identity.lock_owned_episode_cleanup($1) owned':'SELECT local_identity.lock_owned_input_episode($1) owned',[id])).rows[0]?.owned)throw new ConfigurationError(404,'本地生产单不可见。');
  const e=(await c.query('SELECT e.*,b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[id])).rows[0];const root=await resolveEpisodeAssetRoot(c,this.mediaRoot,e.id);return{e,root};
 }
 private async plan(c:PoolClient,id:unknown){
  const{e,root}=await this.episode(c,id,true);let targets:EpisodeDeletionTarget[];
  await this.verifyStorageRoot(c,e.account_id,root);
  const location=await resolveEpisodeStorageLocation(c,this.mediaRoot,e.id);
  try{targets=[];for(const target of await episodeDeletionTargets(this.mediaRoot,root,e.id,await readMediaDeployment(c,this.mediaRoot),location))targets.push(await inventoryEpisodeDeletion(c,target,e.id));}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'无法确认删除目录。');}
  const path=location.directoryPath,stagingPath=path,paths=targets.map(t=>t.path),stagingPaths=targets.flatMap(t=>t.files?.map(f=>f.stagingPath)??[]),files=targets.flatMap(t=>t.files??[]).map(({path,bytes,authority})=>({path,bytes,authority})),preserved=targets.flatMap(t=>t.preserved??[]).map(({path,reason})=>({path,reason}));
  return{e,root,targets,visible:{episodeId:e.id,title:e.title,path,stagingPath,paths,stagingPaths,files,preserved,confirmation:e.title.trim()||'DELETE',archived:Boolean(e.archived_at),isTest:e.is_test,revision:fingerprint({id:e.id,title:e.title,archivedAt:e.archived_at?new Date(e.archived_at).toISOString():null,updatedAt:new Date(e.updated_at).toISOString(),stage:e.stage,targets})}};
 }
 async recycleSnapshot(c:PoolClient,id:string){const p=await this.plan(c,id);await this.assertNativeClosed(p.targets,id);return p;}
 private async verifyStorageRoot(c:PoolClient,accountId:string,root:string){
    if((await c.query("SELECT 1 FROM local_identity.account_directory_migrations WHERE account_id=$1 AND status='copying'",[accountId])).rowCount)throw new ConfigurationError(409,'账号资料正在迁移，请先完成、恢复或回滚原操作。');
  const binding=(await c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding;if(binding){if(binding.path!==this.mediaRoot)throw new ConfigurationError(409,'服务媒体根与登记位置不一致，请重启本机服务。');await verifyMediaRootBinding(binding);}
  const account=(await c.query('SELECT actual_root FROM local_identity.account_asset_directories WHERE account_id=$1',[accountId])).rows[0];if(account?.actual_root===root)await requireAccountAssetRoot(c,this.mediaRoot,accountId);
 }
 private async assertNativeClosed(targets:EpisodeDeletionTarget[],episodeId:string){
  for(const target of targets)if(await hasActiveNativeStudio(target.root,episodeId,relative(target.root,target.path)))throw new ConfigurationError(409,'原生工程仍有活动进程，请先关闭原工程后重新检查删除范围。');
 }


 async execute(session:OwnerSession,body:Record<string,unknown>){
  if(body.command!=='deleteEpisode')return this.executeCommand(session,body);
  const connection=await this.pool.connect(),lock='episode-delete:'+String((body.data as Record<string,unknown>|undefined)?.episodeId);
  try{await connection.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[lock]);return await this.executeCommand(session,body,connection);}
  finally{await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lock]);connection.release();}
 }
 private async prepareDeletion(session:OwnerSession,key:string,hash:string,data:Record<string,unknown>,connection?:PoolClient){
  const prior=await sessionTransaction(this.pool,session,async c=>{
   const receipt=(await c.query('SELECT payload_hash,result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0];
   if(receipt){if(receipt.payload_hash!==hash)throw new ConfigurationError(409,'同一操作标识不能用于不同内容。');return{receipt:true};}
   const existing=(await c.query('SELECT payload_hash,manifest FROM local_identity.episode_deletion_intents WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0];
   if(existing&&existing.payload_hash!==hash)throw new ConfigurationError(409,'同一操作标识不能用于不同内容。');return existing;
  },connection);
  if(prior?.receipt)return;
  if(prior){for(const target of [...prior.manifest.targets as EpisodeDeletionTarget[]].reverse())try{await restoreConfirmedEpisodeFiles(target);}catch{throw new ConfigurationError(409,'原删除操作尚待恢复；文件身份或原位置已变化，未覆盖任何文件。');}
   await sessionTransaction(this.pool,session,c=>c.query('SELECT local_identity.reserve_episode_deletion_intent($1,false)',[key]),connection);
  }
  await sessionTransaction(this.pool,session,async c=>{
   const reserved=(await c.query("SELECT idempotency_key FROM local_identity.episode_deletion_intents WHERE episode_id=$1 AND state='prepared'",[data.episodeId])).rows[0];if(reserved&&reserved.idempotency_key!==key)throw new ConfigurationError(409,'生产单已有未完成的删除操作，请重试原操作。');
   let targets:EpisodeDeletionTarget[],revision:string;
    const p=await this.plan(c,data.episodeId);this.confirmDeletion(p,data);
    if((await c.query('SELECT local_identity.episode_deletion_has_dependencies($1) busy',[p.e.id])).rows[0].busy)throw new ConfigurationError(409,'其他生产单仍引用本单素材、任务或审核记录，请先解除依赖。');
    if((await c.query('SELECT local_identity.episode_deletion_submission_unknown($1) busy',[p.e.id])).rows[0].busy)throw new ConfigurationError(409,'供应商提交结果尚未确认，请先恢复或核对已有请求。');
    try{if(!(await c.query('SELECT local_identity.lock_owned_episode_deletion($1) owned',[p.e.id])).rows[0]?.owned)throw Error();}catch{throw new ConfigurationError(409,'生产单有运行任务、资产锁或并发操作，暂时不能删除。');}
    await this.beforeDelete(p.e.id);await this.assertNativeClosed(p.targets,p.e.id);targets=p.targets;revision=p.visible.revision;
   if(!prior)await c.query('INSERT INTO local_identity.episode_deletion_intents(owner_id,idempotency_key,payload_hash,episode_id,manifest) VALUES($1,$2,$3,$4,$5)',[session.id,key,hash,data.episodeId,{targets,revision,title:data.confirmation,path:data.expectedPath,accountId:(await c.query('SELECT account_id FROM public.episodes WHERE id=$1',[data.episodeId])).rows[0]?.account_id??null}]);
   else await c.query('SELECT local_identity.reserve_episode_deletion_intent($1,true)',[key]);
  },connection);
 }
 private confirmDeletion(p:Awaited<ReturnType<LocalEpisodeLifecycle['plan']>>,data:Record<string,unknown>){
  if(!p.e.archived_at)throw new ConfigurationError(409,'请先归档生产单，再永久删除。');
  if(data.confirmation!==p.visible.confirmation||data.expectedPath!==p.visible.path||data.expectedRevision!==p.visible.revision||data.expectedPaths!==undefined&&JSON.stringify(data.expectedPaths)!==JSON.stringify(p.visible.paths)||p.targets.length>1&&data.expectedPaths===undefined)throw new ConfigurationError(409,'删除确认或目录版本不匹配，请重新查看。');
 }
 private async executeCommand(session:OwnerSession,body:Record<string,unknown>,connection?:PoolClient){
  const command=String(body.command),key=body.idempotencyKey,data=body.data as Record<string,unknown>;
  const fields:Record<string,string[]>={renameEpisode:['episodeId','title'],planDeletion:['episodeId'],archiveEpisode:['episodeId','archived'],deleteEpisode:['episodeId','confirmation','expectedPath','expectedPaths','expectedRevision'],retryDeletionCleanup:['deletionKey']};
  if(!fields[command]||typeof key!=='string'||!uuid.test(key)||!data||typeof data!=='object'||Array.isArray(data)||Object.keys(body).some(k=>!['command','idempotencyKey','data'].includes(k))||Object.keys(data).some(k=>!fields[command].includes(k)))throw new ConfigurationError(400,'生命周期命令无效。');
  if(command==='retryDeletionCleanup'){if(typeof data.deletionKey!=='string'||!uuid.test(data.deletionKey))throw new ConfigurationError(400,'清理标识无效。');return this.retry(session,data.deletionKey);}
  const hash=fingerprint({endpoint:'episode-lifecycle',...body});const staged:EpisodeDeletionTarget[]=[];
  if(command==='deleteEpisode')await this.prepareDeletion(session,key,hash,data,connection);
  let result;
  try{result=await sessionTransaction(this.pool,session,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[session.id+':'+key]);
   const old=(await c.query('SELECT payload_hash,result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0];
   if(old){if(old.payload_hash!==hash)throw new ConfigurationError(409,'同一操作标识不能用于不同内容。');if(command!=='planDeletion')return old.result;}
   if(command==='planDeletion')return(await this.plan(c,data.episodeId)).visible;
   let value;
   if(command==='renameEpisode'){if(typeof data.title!=='string'||!data.title.trim()||data.title.length>200)throw new ConfigurationError(400,'生产单标题无效。');await this.episode(c,data.episodeId);value=(await c.query('SELECT to_jsonb(public.update_episode_title($1,$2)) result',[data.episodeId,data.title.trim()])).rows[0].result;}
   else if(command==='archiveEpisode'){
    if(typeof data.archived!=='boolean')throw new ConfigurationError(400,'归档状态无效。');
    if(typeof data.episodeId!=='string'||!uuid.test(data.episodeId))throw new ConfigurationError(400,'生产单标识无效。');
    if(!(await c.query('SELECT local_identity.lock_owned_episode_cleanup($1) owned',[data.episodeId])).rows[0]?.owned)throw new ConfigurationError(404,'生产单不存在、无管理权限或属于只读历史资料。');
  if((await c.query('SELECT local_identity.is_recycled_episode($1) recycled',[data.episodeId])).rows[0].recycled)throw new ConfigurationError(409,'生产单已移入回收站，请先恢复。');

    if((await c.query("SELECT 1 FROM local_identity.account_directory_migrations m JOIN public.episodes e ON e.account_id=m.account_id WHERE e.id=$1 AND m.status='copying'",[data.episodeId])).rowCount)throw new ConfigurationError(409,'账号资料正在迁移，请先完成、恢复或回滚原操作。');
    value=(await c.query('SELECT to_jsonb(local_identity.archive_owned_input_episode($1,$2)) result',[data.episodeId,data.archived])).rows[0].result;
   }

   else{
    try{await c.query('SELECT local_identity.lock_history_deletion_inventory($1)',[tokenHash(session.token)]);}catch{throw new ConfigurationError(409,'当前有并发操作，请稍后重新检查删除范围。');}
    const p=await this.plan(c,data.episodeId);this.confirmDeletion(p,data);
    if((await c.query('SELECT local_identity.episode_deletion_has_dependencies($1) busy',[p.e.id])).rows[0].busy)throw new ConfigurationError(409,'其他生产单仍引用本单素材、任务或审核记录，请先解除依赖。');
    if((await c.query('SELECT local_identity.episode_deletion_submission_unknown($1) busy',[p.e.id])).rows[0].busy)throw new ConfigurationError(409,'供应商提交结果尚未确认，请先恢复或核对已有请求。');
    try{if(!(await c.query('SELECT local_identity.lock_owned_episode_deletion($1) owned',[p.e.id])).rows[0]?.owned)throw Error();}catch{throw new ConfigurationError(409,'生产单有运行任务、资产锁或并发操作，暂时不能删除。');}
    await this.beforeDelete(p.e.id);
    await this.assertNativeClosed(p.targets,p.e.id);
    try{for(const target of p.targets){staged.push(target);await stageConfirmedEpisodeFiles(target);}}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'删除目录边界校验失败。');}
    const recycleInventory=(await c.query('SELECT inventory FROM local_identity.episode_recycle_bin WHERE episode_id=$1',[p.e.id])).rows[0]?.inventory;
    const summary=(await c.query('SELECT local_identity.delete_owned_input_episode($1) result',[p.e.id])).rows[0].result;
    value={episodeId:p.e.id,title:p.e.title,path:p.visible.path,stagingPath:p.visible.stagingPath,cleanupKey:key,cleanupPending:true,summary,cleanupRoot:p.root,paths:p.visible.paths,stagingPaths:p.visible.stagingPaths,cleanupTargets:p.targets,...(recycleInventory?{recycleInventory}:{})} satisfies DeletionResult;
   }
   await c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[session.id,key,hash,value]);if(command==='deleteEpisode')await c.query("SELECT local_identity.advance_episode_deletion_intent($1,'committed')",[key]);return value;
  },connection);}catch(error){if(staged.length){
   let committed;try{committed=await ownerTransaction(this.pool,session.id,true,async c=>(await c.query('SELECT result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2 AND payload_hash=$3',[session.id,key,hash])).rows[0]?.result?.cleanupKey===key,connection);}catch{throw new ConfigurationError(503,'删除事务状态暂未确认；目录保留在删除暂存区，请重试原操作。');}
   if(committed)return this.finish(session,key,connection);
   let restoreFailed=false;for(const target of [...staged].reverse())try{await restoreConfirmedEpisodeFiles(target);}catch{restoreFailed=true;}if(restoreFailed)throw new ConfigurationError(500,'删除事务失败，部分文件仍保留在删除暂存位置；请恢复外部盘并重试原操作。');
  }
  if(command==='deleteEpisode')await sessionTransaction(this.pool,session,c=>c.query('SELECT local_identity.reserve_episode_deletion_intent($1,false)',[key]),connection);
  throw error;}
  if(command==='deleteEpisode')return this.finish(session,key,connection);return result;
 }
 private async finish(session:OwnerSession,key:string,connection?:PoolClient){
  const result=await sessionTransaction(this.pool,session,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[session.id+':'+key]);const row=(await c.query('SELECT result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0];const r=row?.result as DeletionResult|undefined;
   if(!r?.cleanupRoot||r.cleanupKey!==key)throw new ConfigurationError(404,'删除清理记录不可见。');if(!r.cleanupPending)return publicDeletionResult(r);
   try{
    if(r.cleanupTargets){const failures:string[]=[];for(const target of r.cleanupTargets)try{await verifyEpisodeDeletionTarget(target,'staged');if(target.files)await finalizeConfirmedEpisodeFiles(target);else throw Error('旧回执没有精确文件清单，原范围保留。');}catch(error){failures.push(error instanceof Error?error.message:'文件清理尚未完成。');}if(failures.length)throw Error(failures.join('；'));}
    else throw Error('旧回执没有可验证的精确文件清单；暂存文件保留，请核对列出的位置。');
    if(r.historyCleanupTargets?.length){
     await c.query('SELECT local_identity.lock_history_deletion_inventory($1)',[tokenHash(session.token)]);
     const scanned=await historyBlobTargets(this.historyRoot,{episodeId:r.episodeId,title:r.title,revision:'',live:null,records:[],files:[],blobs:r.historyCleanupTargets.map(t=>({sha256:t.sha,bytes:t.bytes}))},r.historyScanRoots??[this.mediaRoot],r.historyRemovedPaths??[]);
     const retained=new Set(scanned.retainedShas);
     for(const target of r.historyCleanupTargets)if(retained.has(target.sha)||!await finishHistoryBlob(c,target,session))await c.query('SELECT local_identity.retain_history_cleanup_file($1,$2,$3)',[key,target.sha,tokenHash(session.token)]);
    }
    const completed=(await c.query('SELECT local_identity.complete_owned_deletion_cleanup($1) result',[key])).rows[0].result;await c.query("SELECT local_identity.advance_episode_deletion_intent($1,'completed')",[key]);return publicDeletionResult(completed);
   }catch(error){return{...publicDeletionResult(r),cleanupPending:true,message:error instanceof Error?error.message:'文件清理尚未确认，请检查原删除范围后重试。'};}
  },connection);
  if(!result.cleanupPending||!result.message)return result;
  // Persist after the attempt transaction ends: a database error may have
  // aborted it. Recheck the owned receipt under the same lock in a fresh one.
  return sessionTransaction(this.pool,session,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[session.id+':'+key]);
   const persisted=(await c.query('SELECT local_identity.record_owned_deletion_cleanup_error($1,$2) result',[key,result.message])).rows[0].result as DeletionResult;
   return publicDeletionResult(persisted);
  },connection);
 }
}
