import type {Pool,PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {lstat,readdir,readFile,statfs} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {sessionTransaction} from './ownerTransaction.js';
import type {OwnerSession} from './sessions.js';
import {ConfigurationError} from './configurationCommands.js';
import {inspectMediaRoot,verifyMediaRootBinding,type MediaRootBinding,type MediaRootRuntime} from './mediaRootSettings.js';
import {assetPathWithin} from './mediaPaths.js';
import {resolveEpisodeStorageLocation,requireEpisodeStorageDirectory,resolveEpisodeStorageCollection} from './episodeStorageLocation.js';
import {episodeFileIO} from './episodeFiles.js';
import {hasActiveNativeStudio} from '../worker/openchatcutStudio.js';
import {inventory,identity,references,fingerprint,type File,type Root} from './storageInventory.js';

export interface StorageResource{kind:'program'|'runtime'|'state'|'model-cache'|'history'|'backup'|'secrets';path?:string}
interface PlanFile extends File{accountId:string;episodeId:string;targetRelativePath:string}
const overlap=(a:string,b:string)=>a===b||assetPathWithin(a,b)||assetPathWithin(b,a);
const rowPlan=(r:Record<string,unknown>)=>({id:r.id,status:r.status,manifest:r.manifest,manifestSha256:r.manifest_sha256,createdAt:r.created_at,progress:r.progress,error:r.error,updatedAt:r.updated_at});
export async function readMediaRootMigration(c:Pick<PoolClient,'query'>){
 if(!(await c.query("SELECT to_regclass('local_identity.media_root_migrations') IS NOT NULL present")).rows[0].present)return null;
 const row=(await c.query("SELECT * FROM local_identity.media_root_migrations WHERE status<>'planned' OR manifest->'sourceBinding'=local_identity.media_root_binding() ORDER BY (status IN ('copying','failed','committed')) DESC,created_at DESC,id DESC LIMIT 1")).rows[0];return row?rowPlan(row):null;
}

/** Plans never publish files, modify locations, persist deployment or wake production. */
export async function planMediaRootMigration(pool:Pool,session:OwnerSession,mediaRoot:string,path:unknown,key:string,runtime?:MediaRootRuntime){
 const requestHash=fingerprint({path}),client=await pool.connect(),held:string[]=[];
 try{
  return await sessionTransaction(pool,session,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[session.id+':media-root-plan:'+key]);
   const old=(await c.query('SELECT * FROM local_identity.media_root_migrations WHERE idempotency_key=$1',[key])).rows[0];
   if(old){const active=(await c.query("SELECT id FROM local_identity.media_root_migrations WHERE status IN ('copying','failed','committed') LIMIT 1")).rows[0];if(active&&active.id!==old.id)throw new ConfigurationError(409,'存在未完成的全局媒体根迁移，请恢复或回滚原计划。');if(old.request_sha256!==requestHash)throw new ConfigurationError(409,'同一操作标识不能用于不同位置。');return rowPlan(old);}
   const target=await inspectMediaRoot(path);
   const accounts=(await c.query('SELECT * FROM local_identity.media_root_scope_accounts()')).rows as {id:string;name:string;owned:boolean}[];
   if(accounts.some(a=>!a.owned))throw new ConfigurationError(409,'工作区包含当前所有者无法维护的账号，请先核对工作区归属。');
   // Never hold global while blocking on a session account lock (T12/T13/T14).
   for(const account of accounts){const lock='account-directory-migration:'+account.id;if(!(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[lock])).rows[0].locked)throw new ConfigurationError(409,'账号目录操作正在进行，请稍后重新盘点。');held.push(lock);}
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('global-media-root',0))");
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('account-asset-root-ownership',0))");
   if((await c.query("SELECT 1 FROM local_identity.media_root_migrations WHERE status IN ('copying','failed','committed')")).rowCount)throw new ConfigurationError(409,'存在未完成的全局媒体根迁移，请恢复或回滚原计划。');
   if(fingerprint((await c.query('SELECT * FROM local_identity.media_root_scope_accounts()')).rows)!==fingerprint(accounts))throw new ConfigurationError(409,'账号范围已变化，请重新盘点。');
   for(const account of accounts)await c.query('SELECT local_identity.lock_account_directory_migration($1)',[account.id]);
   const source=(await c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding as MediaRootBinding;
   if(!source||source.path!==mediaRoot)throw new ConfigurationError(409,'服务媒体根与登记位置不一致，请重启服务。');
   await verifyMediaRootBinding(source);
   const conflictingRoots=[source.path,...(runtime?.protectedRoots??[]),'/System','/Library','/usr','/bin','/sbin','/etc','/dev','/proc'].filter(p=>overlap(p,target.path));
   if(conflictingRoots.length)throw new ConfigurationError(400,'目标不能与源位置、平台运行目录、历史库或备份重叠。冲突路径：'+[...new Set(conflictingRoots)].map(p=>`${p}（${p===target.path?'与目标相同':assetPathWithin(target.path,p)?'位于目标目录内':'包含目标目录'}）`).join('；')+'。');
   const conflicts:string[]=[],blockers=(await c.query('SELECT local_identity.media_root_pending_operations() reasons')).rows[0].reasons as {kind:string;object_id:string;reason:string}[];
   for(const pending of await runtime?.pendingOperations?.()??[])blockers.push({...pending,object_id:'deployment'});
   for(const account of accounts)for(const r of (await c.query('SELECT local_identity.account_directory_busy($1) reasons',[account.id])).rows[0].reasons)blockers.push({kind:'production',object_id:account.id,reason:r.reason});
   const resources=runtime?.resources??[];
   // Existing deployment media can be nested under its program/runtime/state
   // parent. Only that already-authorized source is carved out; target admission
   // above still rejects every protected ancestor and descendant.
   const sourceResources=resources.filter(r=>!(r.path&&['program','runtime','state'].includes(r.kind)&&assetPathWithin(r.path,mediaRoot)));
   const retained:{path?:string;kind:string;reason:string}[]=resources.map(r=>({...r,reason:!sourceResources.includes(r)?'平台父位置保留；已授权媒体子树单独盘点。':'独立管理，保留原位置与配置。'}));
   const frozenDirectories:{taskId:string;episodeId:string;prefix:string;identity:{deviceId:string|null;inodeId:string|null};verified:boolean}[]=[];
   const directories:{accountId:string;episodeId?:string;containerId?:string;kind:string;source:Root;targetRelativePath:string}[]=[],files:PlanFile[]=[],episodes:{id:string;accountId:string;title:string;location:Awaited<ReturnType<typeof resolveEpisodeStorageLocation>>;collection:Awaited<ReturnType<typeof resolveEpisodeStorageCollection>>;lineage:unknown[]}[]=[],evidence:Record<string,unknown>={},refs:{accountId:string;episodeId:string;relativePath:string;physicalPath:string;sha256:string;fileSize:number}[]=[];
   const addDirectory=async(accountId:string,kind:string,p:string,extra:{episodeId?:string;containerId?:string}={})=>{if(!assetPathWithin(mediaRoot,p))throw new ConfigurationError(409,'生产目录不在已授权媒体根内。');const source=await identity(p);if(!directories.some(d=>d.source.path===p))directories.push({accountId,kind,source,targetRelativePath:relative(mediaRoot,p),...extra});};
   for(const account of accounts){
    const fileStart=files.length;
    const data=(await c.query('SELECT local_identity.account_directory_evidence($1) evidence',[account.id])).rows[0].evidence;evidence[account.id]=data;
    if(Buffer.byteLength(JSON.stringify(evidence))>32*1024*1024)throw new ConfigurationError(409,'业务证据超过 32 MiB 上限，原位置保持不变。');
    const accountRoot=(await c.query('SELECT * FROM local_identity.account_asset_directories WHERE account_id=$1',[account.id])).rows[0];
    if(accountRoot){await addDirectory(account.id,'account',accountRoot.actual_root);const actual=directories.find(d=>d.source.path===accountRoot.actual_root)!.source;if(actual.device!==accountRoot.device_id||actual.inode!==accountRoot.inode_id)throw new ConfigurationError(409,'账号目录身份已变化，请恢复原位置。');}
    for(const container of (await c.query('SELECT * FROM local_identity.account_storage_containers WHERE account_id=$1 ORDER BY id',[account.id])).rows){
     if(!accountRoot)throw new ConfigurationError(409,'系列目录缺少账号根登记。');const p=join(accountRoot.actual_root,container.directory_relative_path);await addDirectory(account.id,container.kind,p,{containerId:container.id});const actual=directories.find(d=>d.source.path===p)!.source;if(actual.device!==container.device_id||actual.inode!==container.inode_id)throw new ConfigurationError(409,'系列目录身份已变化，请恢复原位置。');
    }
    for(const episode of (await c.query('SELECT id,title FROM public.episodes WHERE account_id=$1 ORDER BY id',[account.id])).rows){
     const location=await resolveEpisodeStorageLocation(c,mediaRoot,episode.id);await requireEpisodeStorageDirectory(c,location);await addDirectory(account.id,'episode',location.directoryPath,{episodeId:episode.id});
     if(sourceResources.some(r=>r.path&&overlap(r.path,location.directoryPath)))throw new ConfigurationError(409,'生产目录与独立平台资源重叠，请先核对配置。');
     if(await hasActiveNativeStudio(location.assetRoot,episode.id,location.relativePath))blockers.push({kind:'studio',object_id:episode.id,reason:'Studio 正在编辑，请先保存并返回。'});
     episodes.push({id:episode.id,accountId:account.id,title:episode.title,location,collection:await resolveEpisodeStorageCollection(c,location),lineage:(await c.query('SELECT * FROM local_identity.episode_completed_storage_lineage($1)',[episode.id])).rows});
     for(const task of (data['public.tasks']??[]) as {id:string;episode_id:string;input_snapshot:{native_episode_relative_path?:string;native_episode_directory_identity?:{deviceId:string|null;inodeId:string|null}}}[]){
      if(task.episode_id!==episode.id||!task.input_snapshot.native_episode_relative_path)continue;
      const snapshot=task.input_snapshot,expected=snapshot.native_episode_directory_identity??{deviceId:null,inodeId:null};let verified=false;
      try{const io=await episodeFileIO(c,location.assetRoot,episode.id);await io.assertFrozenDirectory(snapshot.native_episode_relative_path!,expected);verified=true;}catch{conflicts.push('冻结生产单目录缺少完整身份迁移证明：'+task.id);}
      frozenDirectories.push({taskId:task.id,episodeId:episode.id,prefix:snapshot.native_episode_relative_path!,identity:expected,verified});
     }
     for(const file of await inventory(location.directoryPath,{onDirectory:p=>addDirectory(account.id,'episode-directory',p,{episodeId:episode.id})}))files.push({...file,accountId:account.id,episodeId:episode.id,targetRelativePath:relative(mediaRoot,join(location.directoryPath,file.relativePath))});
     if(files.length+directories.length>100000)throw new ConfigurationError(409,'全局盘点超过 100000 个文件及目录上限，原位置保持不变。');
    }
    const accountFiles=files.slice(fileStart),accountEpisodes=episodes.filter(e=>e.accountId===account.id),byEpisode=new Map(accountEpisodes.map(e=>[e.id,e])),byPath=new Map(accountFiles.map(f=>[join(f.sourceRoot,f.relativePath),f]));
    const resolved=new Map<string,{physicalPath:string;sha256:string;fileSize:number}>();
    const accountRefs=references(data);
    for(const file of accountFiles.filter(f=>f.relativePath.endsWith('.json')&&f.fileSize<=32*1024*1024)){try{accountRefs.push(...references({...JSON.parse(await readFile(join(file.sourceRoot,file.relativePath),'utf8')),episode_id:file.episodeId}));}catch(error){if(error instanceof ConfigurationError)throw error;}}
    if(accountRefs.length+refs.length>100000)throw new ConfigurationError(409,'文件引用超过 100000 条上限，请先整理范围。');
    for(const ref of accountRefs){
     const candidates=ref.episodeId?(byEpisode.has(ref.episodeId)?[byEpisode.get(ref.episodeId)!]:[]):accountEpisodes,matches=[];
     for(const ep of candidates){try{const key=ep.id+':'+ref.relativePath;let actual=resolved.get(key);if(!actual){const io=await episodeFileIO(c,ep.location.assetRoot,ep.id),physicalPath=await io.resolveReference(ref.relativePath);await io.assertValid();const file=byPath.get(physicalPath);if(!file)throw Error('Reference is outside the owned inventory');actual={physicalPath,sha256:file.sha256,fileSize:file.fileSize};resolved.set(key,actual);}matches.push({accountId:account.id,episodeId:ep.id,relativePath:ref.relativePath,...actual});}catch{}}
     if(matches.length!==1||ref.sha256&&matches[0]?.sha256!==ref.sha256||ref.fileSize!==undefined&&matches[0]?.fileSize!==ref.fileSize)conflicts.push('文件引用缺失、指纹变化或归属不明：'+ref.relativePath);else refs.push(matches[0]);
    }
   }
   for(const [index,ep] of episodes.entries())if(episodes.slice(index+1).some(other=>overlap(ep.location.directoryPath,other.location.directoryPath)))conflicts.push('不同生产单的实际目录重叠，无法安全区分范围。');
   const accountDirectories=directories.filter(d=>d.kind==='account');for(const [index,d] of accountDirectories.entries())if(accountDirectories.slice(index+1).some(other=>overlap(d.source.path,other.source.path)))conflicts.push('账号实际目录重叠，请先核对账号隔离。');
   // Inspect only unclaimed entries; never recurse a shared global legacy root.
   const known=new Set(directories.map(d=>d.source.path));
   for(const parent of [mediaRoot,...directories.filter(d=>['account','series','unassigned'].includes(d.kind)).map(d=>d.source.path)])for(const name of await readdir(parent)){
    const p=join(parent,name);if(known.has(p)||directories.some(d=>assetPathWithin(p,d.source.path))||sourceResources.some(r=>r.path&&(r.path===p||assetPathWithin(r.path,p))))continue;
    retained.push({path:p,kind:'unknown',reason:'未知、手动或保留源内容；不纳入复制，不自动删除。'});
   }
   const targetDirectories:string[]=[],targetFiles=await inventory(target.path,{onDirectory:async p=>{targetDirectories.push(p);}}),targetEntries=(await readdir(target.path)).sort(),totalBytes=files.reduce((n,f)=>n+f.fileSize,0),targetBytes=targetFiles.reduce((n,f)=>n+f.fileSize,0),capacity=await statfs(target.path,{bigint:true}),freeBytes=Number(capacity.bavail*capacity.bsize),reserveBytes=runtime?.minimumFreeBytes??0;
   if(!Number.isSafeInteger(totalBytes)||!Number.isSafeInteger(targetBytes)||!Number.isSafeInteger(freeBytes)||!Number.isSafeInteger(totalBytes+reserveBytes))throw new ConfigurationError(409,'盘点容量超过安全数值范围，原位置保持不变。');
   if(targetEntries.length)conflicts.push('目标目录已有内容，请保留现场并选择空目录。');
   if(freeBytes<totalBytes+reserveBytes)conflicts.push('目标空间不足，需包含完整复制和预留空间。');
   for(const account of accounts)if(fingerprint((await c.query('SELECT local_identity.account_directory_evidence($1) evidence',[account.id])).rows[0].evidence)!==fingerprint(evidence[account.id]))conflicts.push('盘点期间生产记录或引用变化，请重新盘点。');
   await verifyMediaRootBinding(source);await verifyMediaRootBinding(target);
   for(const directory of directories)if(fingerprint(await identity(directory.source.path))!==fingerprint(directory.source))throw new ConfigurationError(409,'盘点期间目录身份改变，请重新盘点。');
   for(const ep of episodes){const dirs:string[]=[],actual=(await inventory(ep.location.directoryPath,{onDirectory:async p=>{dirs.push(p);}})).map(f=>({...f,accountId:ep.accountId,episodeId:ep.id,targetRelativePath:relative(mediaRoot,join(ep.location.directoryPath,f.relativePath))}));if(fingerprint(actual)!==fingerprint(files.filter(f=>f.episodeId===ep.id))||fingerprint(dirs.sort())!==fingerprint(directories.filter(d=>d.episodeId===ep.id&&d.kind==='episode-directory').map(d=>d.source.path).sort()))conflicts.push('盘点期间生产文件或目录改变，请重新盘点：'+ep.id);}
   const finalTargetDirectories:string[]=[],finalTargetFiles=await inventory(target.path,{onDirectory:async p=>{finalTargetDirectories.push(p);}});
   if(fingerprint(finalTargetFiles)!==fingerprint(targetFiles)||fingerprint(finalTargetDirectories)!==fingerprint(targetDirectories)||fingerprint((await readdir(target.path)).sort())!==fingerprint(targetEntries))conflicts.push('目标内容在盘点期间变化，请保留现场并重新盘点。');
   const migrationStates=(await c.query('SELECT id,account_id,status,manifest FROM local_identity.account_directory_migrations ORDER BY id')).rows;
   const incompleteCopies=[];for(const migration of migrationStates.filter(m=>['planned','copying','failed'].includes(m.status)))for(const temp of migration.manifest.temporaryFiles??[]){let bytes=0,verified=false;try{const stat=await lstat(temp.path,{bigint:true});verified=stat.isFile()&&!stat.isSymbolicLink()&&String(stat.dev)===temp.device&&String(stat.ino)===temp.inode;bytes=Number(stat.size);}catch{}incompleteCopies.push({migrationId:migration.id,path:temp.path,bytes,verified});}
   const manifest={version:1,sourceBinding:source,targetBinding:target,accounts,directories,episodes,files,references:refs,frozenDirectories,evidence,evidenceSha256:fingerprint(evidence),migrationStates:migrationStates.map(({manifest,...row})=>({...row,kind:manifest.kind})),incompleteCopies,retained,resources,blockers,conflicts:[...new Set(conflicts)],totalBytes,fileCount:files.length,directoryCount:directories.length,target:{files:targetFiles,directories:targetDirectories,existingBytes:targetBytes,existingFileCount:targetFiles.length,incompleteCopies:[],incompleteBytes:0},space:{freeBytes,reserveBytes,remainingBytes:totalBytes,requiredBytes:totalBytes+reserveBytes},canExecute:!blockers.length&&!conflicts.length};
   if(Buffer.byteLength(JSON.stringify(manifest))>64*1024*1024)throw new ConfigurationError(409,'迁移计划超过 64 MiB 上限，请先整理范围；原位置保持不变。');
   const row=(await c.query('INSERT INTO local_identity.media_root_migrations(id,owner_id,idempotency_key,request_sha256,manifest) VALUES($1,$2,$3,$4,$5) RETURNING *',[randomUUID(),session.id,key,requestHash,JSON.stringify(manifest)])).rows[0];return rowPlan(row);
  },client);
 }catch(error){if(['ENOENT','EACCES','EPERM','EIO','EROFS','ENOSPC','EBUSY'].includes((error as NodeJS.ErrnoException).code??''))throw new ConfigurationError(409,'盘点目录、挂载、权限或空间已变化，请恢复原条件后重新盘点；当前位置保持不变。');throw error;
 }finally{for(const lock of held.reverse())await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lock]).catch(()=>{});client.release();}
}
