import{createHash}from'node:crypto';
import{join}from'node:path';
import type{Pool,PoolClient}from'pg';
import{canonical,ConfigurationError}from'./configurationCommands.js';
import{ownerTransaction,sessionTransaction}from'./ownerTransaction.js';
import type{OwnerSession}from'./sessions.js';
import{readMediaDeployment,resolveLocalAssetRoot}from'./mediaDeployment.js';
import{episodeDeletionTargets,verifyEpisodeDeletionTarget,type EpisodeDeletionTarget}from'./episodeDeletionTargets.js';
import{stageLocalEpisodeDirectoryForDeletion,restoreStagedLocalEpisodeDirectory,finalizeStagedLocalEpisodeDirectory}from'../worker/episodeDeletion.js';
const uuid=/^[0-9a-f-]{36}$/;
const fingerprint=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
interface DeletionResult{episodeId:string;title:string;path:string;stagingPath:string;cleanupKey:string;cleanupPending:boolean;localRemoved?:boolean;summary:unknown;cleanupRoot:string;paths?:string[];stagingPaths?:string[];cleanupTargets?:EpisodeDeletionTarget[];}
export class LocalEpisodeLifecycle{
 constructor(private pool:Pool,private mediaRoot:string,private beforeDelete:(id:string)=>Promise<void>=async()=>{}){}
 async pending(session:OwnerSession){return ownerTransaction(this.pool,session.id,true,async c=>(await c.query("SELECT result FROM local_identity.command_receipts WHERE owner_id=$1 AND result->>'cleanupPending'='true' AND result ? 'cleanupRoot'",[session.id])).rows.map(r=>this.publicResult(r.result)));}
 private publicResult(result:DeletionResult){const{cleanupRoot:_root,cleanupTargets:_targets,...visible}=result;return visible;}
 private async episode(c:PoolClient,id:unknown,cleanup=false){
  if(typeof id!=='string'||!uuid.test(id))throw new ConfigurationError(400,'生产单标识无效。');
  if(!(await c.query(cleanup?'SELECT local_identity.lock_owned_episode_cleanup($1) owned':'SELECT local_identity.lock_owned_input_episode($1) owned',[id])).rows[0]?.owned)throw new ConfigurationError(404,'本地生产单不可见。');
  const e=(await c.query('SELECT e.*,b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[id])).rows[0];const root=await resolveLocalAssetRoot(c,this.mediaRoot,e.policy.asset_root);return{e,root};
 }
 private async plan(c:PoolClient,id:unknown){
  const{e,root}=await this.episode(c,id,true);let targets:EpisodeDeletionTarget[];
  try{targets=await episodeDeletionTargets(this.mediaRoot,root,e.id,await readMediaDeployment(c,this.mediaRoot));}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'无法确认删除目录。');}
  const path=join(root,'episodes',e.id),stagingPath=join(root,'episodes','.deletion-staging',e.id),paths=targets.map(t=>t.path),stagingPaths=targets.map(t=>t.stagingPath);
  return{e,root,targets,visible:{episodeId:e.id,title:e.title,path,stagingPath,paths,stagingPaths,confirmation:e.title.trim()||'DELETE',archived:Boolean(e.archived_at),isTest:e.is_test,revision:fingerprint({id:e.id,title:e.title,archivedAt:e.archived_at?new Date(e.archived_at).toISOString():null,updatedAt:new Date(e.updated_at).toISOString(),stage:e.stage,targets})}};
 }

 async execute(session:OwnerSession,body:Record<string,unknown>){
  const command=String(body.command),key=body.idempotencyKey,data=body.data as Record<string,unknown>;
  const fields:Record<string,string[]>={renameEpisode:['episodeId','title'],planDeletion:['episodeId'],archiveEpisode:['episodeId','archived'],deleteEpisode:['episodeId','confirmation','expectedPath','expectedPaths','expectedRevision'],retryDeletionCleanup:['deletionKey']};
  if(!fields[command]||typeof key!=='string'||!uuid.test(key)||!data||typeof data!=='object'||Array.isArray(data)||Object.keys(body).some(k=>!['command','idempotencyKey','data'].includes(k))||Object.keys(data).some(k=>!fields[command].includes(k)))throw new ConfigurationError(400,'生命周期命令无效。');
  if(command==='retryDeletionCleanup'){if(typeof data.deletionKey!=='string'||!uuid.test(data.deletionKey))throw new ConfigurationError(400,'清理标识无效。');return this.finish(session,data.deletionKey);}
  const hash=fingerprint({endpoint:'episode-lifecycle',...body});const staged:EpisodeDeletionTarget[]=[];
  let result;
  try{result=await sessionTransaction(this.pool,session,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[session.id+':'+key]);
   const old=(await c.query('SELECT payload_hash,result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0];
   if(old){if(old.payload_hash!==hash)throw new ConfigurationError(409,'同一操作标识不能用于不同内容。');if(command!=='planDeletion')return old.result;}
   if(command==='planDeletion')return(await this.plan(c,data.episodeId)).visible;
   let value;
   if(command==='renameEpisode'){if(typeof data.title!=='string'||!data.title.trim()||data.title.length>200)throw new ConfigurationError(400,'生产单标题无效。');await this.episode(c,data.episodeId);value=(await c.query('SELECT to_jsonb(public.update_episode_title($1,$2)) result',[data.episodeId,data.title.trim()])).rows[0].result;}
   else if(command==='archiveEpisode'){if(typeof data.archived!=='boolean')throw new ConfigurationError(400,'归档状态无效。');await this.episode(c,data.episodeId);value=(await c.query('SELECT to_jsonb(local_identity.archive_owned_input_episode($1,$2)) result',[data.episodeId,data.archived])).rows[0].result;}
   else{
    const p=await this.plan(c,data.episodeId);if(!p.e.archived_at)throw new ConfigurationError(409,'请先归档生产单，再永久删除。');
    if(data.confirmation!==p.visible.confirmation||data.expectedPath!==p.visible.path||data.expectedRevision!==p.visible.revision||data.expectedPaths!==undefined&&JSON.stringify(data.expectedPaths)!==JSON.stringify(p.visible.paths)||p.targets.length>1&&data.expectedPaths===undefined)throw new ConfigurationError(409,'删除确认或目录版本不匹配，请重新查看。');
    try{if(!(await c.query('SELECT local_identity.lock_owned_episode_deletion($1) owned',[p.e.id])).rows[0]?.owned)throw Error();}catch{throw new ConfigurationError(409,'生产单有运行任务、资产锁或并发操作，暂时不能删除。');}
    await this.beforeDelete(p.e.id);
    try{for(const target of p.targets){await verifyEpisodeDeletionTarget(target,'original');const local=await stageLocalEpisodeDirectoryForDeletion(target.root,p.e.id);if(local.existed)staged.push(target);}}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'删除目录边界校验失败。');}
    const summary=(await c.query('SELECT local_identity.delete_owned_input_episode($1) result',[p.e.id])).rows[0].result;
    value={episodeId:p.e.id,title:p.e.title,path:p.visible.path,stagingPath:p.visible.stagingPath,cleanupKey:key,cleanupPending:true,summary,cleanupRoot:p.root,paths:p.visible.paths,stagingPaths:p.visible.stagingPaths,cleanupTargets:p.targets} satisfies DeletionResult;
   }
   await c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[session.id,key,hash,value]);return value;
  });}catch(error){if(staged.length){
   let committed;try{committed=await ownerTransaction(this.pool,session.id,true,async c=>(await c.query('SELECT result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2 AND payload_hash=$3',[session.id,key,hash])).rows[0]?.result?.cleanupKey===key);}catch{throw new ConfigurationError(503,'删除事务状态暂未确认；目录保留在删除暂存区，请重试原操作。');}
   if(committed)return this.finish(session,key);
   let restoreFailed=false;for(const target of [...staged].reverse())try{await verifyEpisodeDeletionTarget(target,'staged');await restoreStagedLocalEpisodeDirectory(target.root,String(data.episodeId));}catch{restoreFailed=true;}if(restoreFailed)throw new ConfigurationError(500,'删除事务失败，部分目录仍保留在删除暂存区；请恢复外部盘并重试原操作。');
  }throw error;}
  if(command==='deleteEpisode')return this.finish(session,key);return result;
 }
 private async finish(session:OwnerSession,key:string){
  return sessionTransaction(this.pool,session,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[session.id+':'+key]);const row=(await c.query('SELECT result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0];const r=row?.result as DeletionResult|undefined;
   if(!r?.cleanupRoot||r.cleanupKey!==key)throw new ConfigurationError(404,'删除清理记录不可见。');if(!r.cleanupPending)return this.publicResult(r);
   try{
    if(r.cleanupTargets){let failed=false;for(const target of r.cleanupTargets)try{await verifyEpisodeDeletionTarget(target,'staged');await finalizeStagedLocalEpisodeDirectory(target.root,r.episodeId);}catch{failed=true;}if(failed)throw Error('Some directories need retry');}
    else{const root=await resolveLocalAssetRoot(c,this.mediaRoot,r.cleanupRoot);await finalizeStagedLocalEpisodeDirectory(root,r.episodeId);}
    const completed=(await c.query('SELECT local_identity.complete_owned_deletion_cleanup($1) result',[key])).rows[0].result;return this.publicResult(completed);
   }catch{return{...this.publicResult(r),cleanupPending:true,message:'数据库删除已完成；部分目录清理或完成登记尚未确认，请连接外部盘后重试。'};}
  });
 }
}
