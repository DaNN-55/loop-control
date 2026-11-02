import type {Pool,PoolClient} from 'pg';
import {mkdir,statfs} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {sessionTransaction} from './ownerTransaction.js';
import type {OwnerSession} from './sessions.js';
import {ConfigurationError} from './configurationCommands.js';
import {verifyMediaRootBinding,type MediaRootBinding,type MediaRootRuntime} from './mediaRootSettings.js';
import {storageCopySession,inventory,identity,fingerprint,type File,type Root} from './storageInventory.js';
import type {EpisodeStorageLocation} from './episodeStorageLocation.js';
import {episodeFileIO} from './episodeFiles.js';
import {hasActiveNativeStudio} from '../worker/openchatcutStudio.js';

interface MigrationManifest{
 sourceBinding:MediaRootBinding;targetBinding:MediaRootBinding;accounts:{id:string;name:string;owned:boolean}[];
 directories:{accountId:string;episodeId?:string;containerId?:string;kind:string;source:Root;targetRelativePath:string}[];
 episodes:{id:string;accountId:string;location:EpisodeStorageLocation}[];
 files:(File&{accountId:string;episodeId:string;targetRelativePath:string})[];
 references:{accountId:string;episodeId:string;relativePath:string;physicalPath:string;sha256:string;fileSize:number}[];
 evidence:Record<string,unknown>;evidenceSha256:string;canExecute:boolean;totalBytes:number;space:{reserveBytes:number};
}
interface Progress{createdDirectories:Root[];temporaryFiles:Root[];copiedFiles:number;copiedBytes:number;activeFile?:string;activeFileBytes?:number}
interface MigrationRow{id:string;status:string;manifest:MigrationManifest;manifest_sha256:string;progress:Progress;publication?:unknown;error?:string}
type Client=Pick<PoolClient,'query'>;
const business=(e:Record<string,unknown>)=>Object.fromEntries(Object.entries(e).map(([a,value])=>[a,Object.fromEntries(Object.entries(value as Record<string,unknown>).filter(([key])=>!['account_asset_directories','account_directory_locations','local_identity.episode_asset_locations','local_identity.episode_storage_lineage'].includes(key)))]));
const initialProgress=():Progress=>({createdDirectories:[],temporaryFiles:[],copiedFiles:0,copiedBytes:0});
export const mediaRootExecutionResult=(r:MigrationRow)=>({id:r.id,status:r.status,manifest:r.manifest,manifestSha256:r.manifest_sha256,progress:r.progress,error:r.error,originalsRetained:true});
async function accountEvidence(c:Client,m:MigrationManifest){const value:Record<string,unknown>={};for(const a of m.accounts)value[a.id]=(await c.query('SELECT local_identity.account_directory_evidence($1) evidence',[a.id])).rows[0].evidence;return value;}
async function assertSource(c:Client,m:MigrationManifest,afterPublication=false){
 await verifyMediaRootBinding(m.sourceBinding);
 for(const d of m.directories)if(fingerprint(await identity(d.source.path))!==fingerprint(d.source))throw new ConfigurationError(409,'源目录身份已变化，请恢复原位置后继续或回滚。');
 for(const ep of m.episodes){
  if(await hasActiveNativeStudio(ep.location.assetRoot,ep.id,ep.location.relativePath))throw new ConfigurationError(409,'Studio 正在编辑，请先保存并返回。');
  const dirs:string[]=[],files=await inventory(ep.location.directoryPath,{onDirectory:async p=>{dirs.push(p);}}),expected=m.files.filter(f=>f.episodeId===ep.id).map(({accountId:_,episodeId:__,targetRelativePath:___,...f})=>f);
  if(fingerprint(files)!==fingerprint(expected)||fingerprint(dirs.sort())!==fingerprint(m.directories.filter(d=>d.episodeId===ep.id&&d.kind==='episode-directory').map(d=>d.source.path).sort()))throw new ConfigurationError(409,'源文件或空目录已变化，请回滚后重新盘点。');
 }
 const actual=await accountEvidence(c,m);if(afterPublication?fingerprint(business(actual))!==fingerprint(business(m.evidence)):fingerprint(actual)!==m.evidenceSha256)throw new ConfigurationError(409,'生产记录或引用已变化，未完成迁移。');
 if(!afterPublication){
  if(fingerprint((await c.query('SELECT * FROM local_identity.media_root_scope_accounts()')).rows)!==fingerprint(m.accounts))throw new ConfigurationError(409,'工作区账号范围已变化，请重新盘点。');
  if((await c.query('SELECT local_identity.media_root_pending_operations() reasons')).rows[0].reasons.length)throw new ConfigurationError(409,'存在待恢复创建、删除、备份或账号迁移，请先处理原操作。');
  for(const a of m.accounts)if((await c.query('SELECT local_identity.account_directory_busy($1) reasons',[a.id])).rows[0].reasons.length)throw new ConfigurationError(409,'存在待执行、运行、租约或未知付费提交，请先处理原任务。');
  for(const ref of m.references){const ep=m.episodes.find(e=>e.id===ref.episodeId)!;const io=await episodeFileIO(c,ep.location.assetRoot,ep.id);if(await io.resolveReference(ref.relativePath)!==ref.physicalPath)throw new ConfigurationError(409,'原文件引用的位置证明已变化。');await io.assertValid();}
 }
}
async function assertTarget(m:MigrationManifest,p:Progress,complete:boolean){
 await verifyMediaRootBinding(m.targetBinding);
 for(const d of p.createdDirectories)if(fingerprint(await identity(d.path))!==fingerprint(d))throw new ConfigurationError(409,'目标目录身份已变化，请保留现场后恢复。');
 const expected=new Map(m.files.map(f=>[f.targetRelativePath,f])),allowed=new Set(p.createdDirectories.map(d=>d.path)),dirs:string[]=[];
 const files=await inventory(m.targetBinding.path,{onDirectory:async path=>{dirs.push(path);if(!allowed.has(path))throw new ConfigurationError(409,'目标出现未知目录，保留现场，未切换位置。');}});
 for(const f of files){const wanted=expected.get(f.relativePath);if(!wanted||wanted.sha256!==f.sha256||wanted.fileSize!==f.fileSize)throw new ConfigurationError(409,'目标出现未知或冲突文件，保留现场，未切换位置。');}
 if(complete&&files.length!==m.files.length)throw new ConfigurationError(409,'目标文件尚未全部校验。');
 return files;
}
export async function executeMediaRootMigration(pool:Pool,session:OwnerSession,id:string,rollback:boolean,runtime?:MediaRootRuntime){
 if(!runtime)throw new ConfigurationError(503,'请通过正式本机服务迁移媒体根。');
 const original=(await sessionTransaction(pool,session,c=>c.query('SELECT * FROM local_identity.media_root_migrations WHERE id=$1',[id]))).rows[0] as MigrationRow|undefined;
 if(!original)throw new ConfigurationError(404,'迁移计划不可见。');
 if(['committed','completed'].includes(original.status)){
  if(rollback)throw new ConfigurationError(409,'已提交迁移不能回滚，请恢复本计划或重新盘点迁回。');
  if(original.status==='completed')return mediaRootExecutionResult(original);
  return runtime.resumeMigration!(id,original.manifest_sha256);
 }
 if(original.status==='rolled_back')return mediaRootExecutionResult(original);
 const m=original.manifest,p:Progress={...initialProgress(),...original.progress},held:string[]=[];
 let connectionError:Error|undefined;const onConnectionError=(error:Error)=>{connectionError=error;};
 let client:PoolClient|undefined,undo:((()=>Promise<void>)&{commit?:()=>Promise<void>})|undefined,committing=false;
 const transaction=<T>(run:(c:PoolClient)=>Promise<T>)=>sessionTransaction(pool,session,run,client);
 const persist=()=>transaction(c=>c.query("SELECT local_identity.update_media_root_execution($1,'copying',$2)",[id,JSON.stringify(p)]));
 try{await runtime.quiesce?.();}catch{throw new ConfigurationError(409,'本机操作仍在进行，请查看进度后重试。');}
 try{
  client=await pool.connect();client.on('error',onConnectionError);
  for(const account of m.accounts){const key='account-directory-migration:'+account.id;if(!(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked)throw new ConfigurationError(409,'账号目录操作正在进行，请稍后恢复。');held.push(key);}
  await transaction(async c=>{
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('global-media-root',0))");await c.query("SELECT pg_advisory_xact_lock(hashtextextended('account-asset-root-ownership',0))");
   for(const a of m.accounts)await c.query('SELECT local_identity.lock_account_directory_migration($1)',[a.id]);
   if(rollback){await c.query("SELECT local_identity.update_media_root_execution($1,'rolled_back',$2)",[id,JSON.stringify(p)]);return;}
   if(!m.canExecute)throw new ConfigurationError(409,'原计划存在冲突或阻塞，请重新盘点。');
   if((await c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding.path!==m.sourceBinding.path)throw new ConfigurationError(409,'当前媒体根与原计划不一致。');
   await assertSource(c,m);await verifyMediaRootBinding(m.targetBinding);
   await c.query("SELECT local_identity.update_media_root_execution($1,'copying',$2)",[id,JSON.stringify(p)]);
  });
  if(rollback)return mediaRootExecutionResult({...original,status:'rolled_back',progress:p});
  const copyTarget={path:m.targetBinding.path,device:m.targetBinding.deviceId,inode:m.targetBinding.inodeId};
  const required=new Set(m.directories.map(d=>join(m.targetBinding.path,d.targetRelativePath)));
  for(const f of m.files){let path=dirname(join(m.targetBinding.path,f.targetRelativePath));while(path!==m.targetBinding.path){required.add(path);path=dirname(path);}}
  for(const value of [...required]){let path=dirname(value);while(path!==m.targetBinding.path){required.add(path);path=dirname(path);}}
  for(const path of [...required].sort((a,b)=>a.length-b.length||a.localeCompare(b))){
   const recorded=p.createdDirectories.find(d=>d.path===path);if(recorded){if(fingerprint(await identity(path))!==fingerprint(recorded))throw new ConfigurationError(409,'迁移目标目录身份已变化。');continue;}
   await verifyMediaRootBinding(m.targetBinding);let created=false;try{await mkdir(path,{mode:0o700});created=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
   const actual=await identity(path);await verifyMediaRootBinding(m.targetBinding);if(actual.device!==copyTarget.device)throw new ConfigurationError(409,'迁移目标目录所在位置已变化。');if(!created)throw new ConfigurationError(409,'未登记目标目录已有内容，请保留现场。');p.createdDirectories.push(actual);await persist();
  }
  const copies=storageCopySession(copyTarget,id,{
   pending:()=>p.temporaryFiles,
   async record(temp){p.temporaryFiles.push(temp);await persist();},
  },{identity:'暂存文件身份变化，保留现场。',link:'暂存链接身份变化，保留现场。'});
  await copies.recover();
  p.temporaryFiles=[];const copied=await assertTarget(m,p,false),remaining=m.totalBytes-copied.reduce((n,f)=>n+f.fileSize,0),space=await statfs(m.targetBinding.path,{bigint:true});if(space.bavail*space.bsize<BigInt(remaining+m.space.reserveBytes))throw new ConfigurationError(409,'目标空间不足，请释放空间后恢复迁移。');
  p.copiedFiles=copied.length;p.copiedBytes=m.totalBytes-remaining;await persist();
  for(const file of m.files){
   const already=copied.some(f=>f.relativePath===file.targetRelativePath),baseBytes=p.copiedBytes;
   await copies.copy(file,undefined,async bytes=>{p.activeFile=file.targetRelativePath;p.activeFileBytes=bytes;p.copiedBytes=baseBytes+bytes;await persist();});
   if(!already){p.copiedFiles++;p.copiedBytes=baseBytes+file.fileSize;}delete p.activeFile;p.activeFileBytes=0;await persist();
  }
  p.temporaryFiles=[];await persist();await assertTarget(m,p,true);
  await transaction(async c=>{
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('global-media-root',0))");await c.query("SELECT pg_advisory_xact_lock(hashtextextended('account-asset-root-ownership',0))");for(const a of m.accounts)await c.query('SELECT local_identity.lock_account_directory_migration($1)',[a.id]);
   await assertSource(c,m);await assertTarget(m,p,true);
   const targets=[];for(const d of m.directories)targets.push({sourcePath:d.source.path,...await identity(join(m.targetBinding.path,d.targetRelativePath))});
   await c.query('SELECT local_identity.commit_media_root_migration($1,$2,$3)',[id,original.manifest_sha256,JSON.stringify(targets)]);
   await assertSource(c,m,true);await assertTarget(m,p,true);
   undo=await runtime.persist(m.targetBinding,{operation:'migration',planId:id,manifestSha256:original.manifest_sha256,storageOwnerId:session.id});
   committing=true;
  });
  // No old-pool client may survive activate -> previous.close -> pool.end.
  for(const key of held.splice(0).reverse())await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);client.removeListener('error',onConnectionError);client.release(connectionError);client=undefined;
  await runtime.activate(m.targetBinding,{planId:id,manifestSha256:original.manifest_sha256});
  await undo?.commit?.();
  return{...mediaRootExecutionResult({...original,status:'completed',progress:p}),path:m.targetBinding.path};
 }catch(error){
  if(committing){
   // COMMIT acknowledgement can be lost. The private journal and durable fence
   // remain authoritative until a fresh runtime connection proves publication.
   throw new ConfigurationError(503,'媒体根发布结果待恢复，请保留两处文件并继续同一计划或重启应用。');
  }
  await undo?.();
  await transaction(c=>c.query("SELECT local_identity.update_media_root_execution($1,'failed',$2,$3)",[id,JSON.stringify(p),error instanceof Error?error.message:'迁移失败，原位置保留。'])).catch(()=>{});
  if(error instanceof ConfigurationError)throw error;
  throw new ConfigurationError(409,'迁移目录、挂载、权限或空间已变化；原位置保留，请恢复或回滚本计划。');
 }finally{
  if(client){for(const key of held.reverse())await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]).catch(()=>{});client.removeListener('error',onConnectionError);client.release(connectionError);}
  runtime.releaseQuiescence?.();
 }
}
