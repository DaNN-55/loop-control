import type {Pool,PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {lstat,readdir,realpath,mkdir,unlink,readFile,statfs} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {sessionTransaction} from './ownerTransaction.js';
import type {OwnerSession} from './sessions.js';
import {ConfigurationError} from './configurationCommands.js';
import {readMediaDeployment,resolveLocalAssetRoot} from './mediaDeployment.js';
import {mappedAssetPath} from './mediaPaths.js';
import {hasActiveNativeStudio} from '../worker/openchatcutStudio.js';
import {validateAccountAssetLocation,accountAssetRootsOverlap as overlaps} from './accountAssetRoots.js';
import {directoryName} from './creationIdentity.js';
import {resolveEpisodeStorageLocation,requireEpisodeStorageDirectory,resolveEpisodeStorageCollection} from './episodeStorageLocation.js';
import {verifyMediaRootBinding,type MediaRootBinding} from './mediaRootSettings.js';
import {episodeFileIO} from './episodeFiles.js';
import {resolveStorageContainer,requireStorageContainer} from './seriesDirectories.js';
import {copyStorageFile,identity,fileDigest,inventory,references,fingerprint,type File,type Root,type Reference} from './storageInventory.js';
type Client=Pick<PoolClient,'query'>;
interface Manifest{targetRoot:string;targetIdentity:Root;sources:Root[];logicalRoots:string[];episodes:{id:string;title:string}[];files:File[];references:Reference[];evidenceSha256:string;conflicts:string[];totalBytes:number}
async function allInventory(roots:{path:string}[]){const files:File[]=[];for(const root of roots){files.push(...await inventory(root.path));if(files.length>100000)throw new ConfigurationError(409,'迁移文件总数超过本次上限，请先整理目录。');}return files;}
function verifyReferences(files:File[],refs:Reference[]){const byPath=new Map(files.map(f=>[f.relativePath,f]));for(const ref of refs){const f=byPath.get(ref.relativePath);if(!f||ref.sha256&&ref.sha256!==f.sha256||ref.fileSize!==undefined&&ref.fileSize!==f.fileSize)throw new ConfigurationError(409,'文件引用校验失败：'+ref.relativePath);}}
async function lock(c:Client,account:string){if(!(await c.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked",['account-directory-migration:'+account])).rows[0].locked)throw new ConfigurationError(409,'账号迁移正在执行，请稍后读取结果。');await c.query("SELECT pg_advisory_xact_lock(hashtextextended('account-asset-root-ownership',0))");await c.query('SELECT local_identity.lock_account_directory_migration($1)',[account]);}
async function blockers(c:Client,account:string,episodes:{id:string}[],roots:string[]){const result=(await c.query('SELECT local_identity.account_directory_busy($1) reasons',[account])).rows[0].reasons as {reason:string}[];
 for(const episode of episodes){const prefix=(await c.query('SELECT directory_relative_path FROM local_identity.episode_storage_location($1)',[episode.id])).rows[0].directory_relative_path;if((await Promise.all(roots.map(root=>hasActiveNativeStudio(root,episode.id,prefix)))).some(Boolean))result.push({reason:'Studio 正在编辑，请先保存并返回。'});}return result.map(r=>r.reason);}
async function evidence(c:Client,account:string){return(await c.query('SELECT local_identity.account_directory_evidence($1) evidence',[account])).rows[0].evidence;}
async function plan(c:Client,mediaRoot:string,account:string,path:unknown):Promise<Manifest>{
 if((await c.query('SELECT 1 FROM local_identity.episode_asset_locations WHERE account_id=$1 AND layout_version=2 LIMIT 1',[account])).rowCount)throw new ConfigurationError(409,'此入口不支持已登记生产单的整根迁移，请保留当前位置。');
 const valid=await validateAccountAssetLocation(c,mediaRoot,path),targetIdentity=await identity(valid.path),deployment=await readMediaDeployment(c,mediaRoot);
 const episodes=(await c.query('SELECT id,title FROM public.episodes WHERE account_id=$1 ORDER BY id',[account])).rows as {id:string;title:string}[];
 const logicalRoots=(await c.query("SELECT actual_root root FROM local_identity.account_asset_directories WHERE account_id=$1 UNION SELECT asset_root FROM local_identity.episode_asset_locations WHERE account_id=$1 UNION SELECT policy->>'asset_root' FROM public.account_blueprint_versions WHERE account_id=$1 AND coalesce(policy->>'asset_root','')<>'' UNION SELECT source_root FROM local_identity.account_directory_locations WHERE account_id=$1",[account])).rows.map(r=>r.root) as string[];
 const mappedRoots:string[]=[];for(const root of logicalRoots)mappedRoots.push(await resolveLocalAssetRoot(c,mediaRoot,root));const roots=[...new Set(mappedRoots)].sort();
 if(roots.length>128)throw new ConfigurationError(409,'历史目录过多，请先核对目录归属。');
 if(!roots.length)throw new ConfigurationError(409,'账号没有可盘点的当前或历史目录。');
 for(const root of roots)if(['openchatcut','.loop-control','.deletion-staging'].includes(relative(mediaRoot,root).split('/')[0]))throw new ConfigurationError(409,'历史目录指向平台位置，请先核对归属，不能迁入账号目录。');
 for(const root of roots)if(overlaps(root,valid.path))throw new ConfigurationError(409,'迁移目标不能与任何当前或历史源目录重叠。');
 const claims=(await c.query('SELECT * FROM local_identity.account_asset_root_claims()')).rows;
 for(const claim of claims){if(claim.account_id===account)continue;const root=mappedAssetPath(mediaRoot,claim.asset_root,deployment);if(roots.some(source=>overlaps(source,root))||overlaps(valid.path,root))throw new ConfigurationError(409,'源或目标目录与其他账号重叠，无法明确归属。');}
 const conflicts=await blockers(c,account,episodes,roots);if((await readdir(valid.path)).length)conflicts.push('目标目录已有内容，请选择空目录。');
 const sources=await Promise.all(roots.map(identity)),files=await allInventory(sources),byPath=new Map<string,File>();
 for(const f of files){const old=byPath.get(f.relativePath);if(old&&(old.sha256!==f.sha256||old.fileSize!==f.fileSize))conflicts.push('历史目录存在同名不同内容文件：'+f.relativePath);byPath.set(f.relativePath,f);}
 const data=await evidence(c,account),refs=references(data);for(const file of files.filter(f=>f.relativePath.endsWith('.json')&&f.fileSize<=32*1024*1024)){let document;try{document=JSON.parse(await readFile(join(file.sourceRoot,file.relativePath),'utf8'));}catch{continue;}refs.push(...references(document));}try{verifyReferences(files,refs);}catch(e){conflicts.push((e as Error).message);}
 return{targetRoot:valid.path,targetIdentity,sources,logicalRoots,episodes,files,references:refs,evidenceSha256:fingerprint(data),conflicts:[...new Set(conflicts)],totalBytes:[...byPath.values()].reduce((n,f)=>n+f.fileSize,0)};
}
export async function planAccountDirectoryMigration(c:Client,mediaRoot:string,account:string,path:unknown){await lock(c,account);const manifest=await plan(c,mediaRoot,account,path),id=randomUUID();await c.query("INSERT INTO local_identity.account_directory_migrations(id,account_id,status,manifest) VALUES($1,$2,'planned',$3)",[id,account,manifest]);return{id,status:'planned',...manifest};}
export async function readAccountDirectoryMigrations(c:Client,account:string){return(await c.query('SELECT id,status,manifest,error,created_at,updated_at FROM local_identity.account_directory_migrations WHERE account_id=$1 ORDER BY created_at DESC LIMIT 20',[account])).rows.map(row=>({id:row.id,status:row.status,...row.manifest,error:row.error,updatedAt:row.updated_at}));}
export async function executeAccountDirectoryMigration(pool:Pool,session:OwnerSession,mediaRoot:string,account:string,id:string,rollback:boolean,signal?:AbortSignal){
 const kind=await sessionTransaction(pool,session,async c=>(await c.query('SELECT manifest->>\'kind\' kind FROM local_identity.account_directory_migrations WHERE id=$1 AND account_id=$2',[id,account])).rows[0]?.kind);
 if(kind==='adoption'||kind==='move')return executeStorageAdoption(pool,session,mediaRoot,account,id,rollback,signal);
 // Persist the resumable state before copying. A process exit leaves this receipt.
 await sessionTransaction(pool,session,async c=>{await lock(c,account);const row=(await c.query('SELECT status,manifest FROM local_identity.account_directory_migrations WHERE id=$1 AND account_id=$2',[id,account])).rows[0];if(!row)throw new ConfigurationError(404,'迁移记录不可见。');if(row.status==='completed'){if(rollback)throw new ConfigurationError(409,'已完成迁移请重新盘点迁回，原目录不会自动覆盖。');return;}
 if(rollback){await c.query("UPDATE local_identity.account_directory_migrations SET status='rolled_back',error=NULL,updated_at=clock_timestamp() WHERE id=$1",[id]);return;}
 if(row.status==='rolled_back')throw new ConfigurationError(409,'此迁移已回滚，请重新盘点。');if(row.manifest.conflicts.length)throw new ConfigurationError(409,'盘点存在冲突，请处理后重新盘点。');
 if((await c.query("SELECT 1 FROM local_identity.account_directory_migrations WHERE account_id=$1 AND status='copying' AND id<>$2",[account,id])).rowCount)throw new ConfigurationError(409,'请先恢复或回滚已有迁移。');
 await c.query("UPDATE local_identity.account_directory_migrations SET status='copying',error=NULL,updated_at=clock_timestamp() WHERE id=$1",[id]);});
 if(rollback)return{id,status:'rolled_back',originalsRetained:true};
 try{return await sessionTransaction(pool,session,async c=>{await lock(c,account);const row=(await c.query('SELECT status,manifest FROM local_identity.account_directory_migrations WHERE id=$1 AND account_id=$2',[id,account])).rows[0];if(row.status==='completed')return{id,status:'completed',...row.manifest,originalsRetained:true};if(row.status!=='copying')throw new ConfigurationError(409,'迁移状态已变化。');const m=row.manifest as Manifest;
 if((await blockers(c,account,m.episodes,m.sources.map(s=>s.path))).length)throw new ConfigurationError(409,'存在活动任务、未知提交或 Studio，请先完成处理。');
 if(fingerprint(await evidence(c,account))!==m.evidenceSha256)throw new ConfigurationError(409,'生产记录或引用已变化，请回滚并重新盘点。');
 const claims=(await c.query('SELECT * FROM local_identity.account_asset_root_claims()')).rows,deployment=await readMediaDeployment(c,mediaRoot);
 for(const claim of claims)if(claim.account_id!==account){const other=mappedAssetPath(mediaRoot,claim.asset_root,deployment);if(overlaps(m.targetRoot,other)||m.sources.some(source=>overlaps(source.path,other)))throw new ConfigurationError(409,'源或目标目录已被其他账号占用。');}
 const valid=await validateAccountAssetLocation(c,mediaRoot,m.targetRoot);if(valid.device!==m.targetIdentity.device||valid.inode!==m.targetIdentity.inode)throw new ConfigurationError(409,'目标目录所在位置已变化，请恢复挂载。');
 for(const source of m.sources)if(fingerprint(await identity(source.path))!==fingerprint(source))throw new ConfigurationError(409,'源目录所在位置已变化，请恢复挂载。');
 // Reinventory before copy and immediately before cutover catches external writes.
 const current=await allInventory(m.sources);if(fingerprint(current)!==fingerprint(m.files))throw new ConfigurationError(409,'源文件已变化，请回滚并重新盘点。');
 const expected=new Map(m.files.map(f=>[f.relativePath,f]));
 // Only this receipt's partial outputs are disposable; all complete copies remain.
 for(const f of expected.values()){const temp=join(m.targetRoot,f.relativePath+'.migration-'+id);try{const stat=await lstat(temp);if(!stat.isFile()||await realpath(temp)!==temp)throw new ConfigurationError(409,'迁移暂存文件身份无效。');if(stat.nlink!==1){const published=await lstat(join(m.targetRoot,f.relativePath));if(stat.nlink!==2||!published.isFile()||published.dev!==stat.dev||published.ino!==stat.ino||await realpath(join(m.targetRoot,f.relativePath))!==join(m.targetRoot,f.relativePath))throw new ConfigurationError(409,'迁移暂存文件身份无效。');}await unlink(temp);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
for(const actual of await inventory(m.targetRoot)){const f=expected.get(actual.relativePath);if(!f||f.sha256!==actual.sha256||f.fileSize!==actual.fileSize)throw new ConfigurationError(409,'目标存在冲突文件，请保留副本并重新盘点。');}
 const capacity=await statfs(m.targetRoot,{bigint:true}),remaining=[...expected.values()].reduce((bytes,file)=>bytes+BigInt(file.fileSize),0n)-(await inventory(m.targetRoot)).reduce((bytes,file)=>bytes+BigInt(file.fileSize),0n);if(capacity.bavail*capacity.bsize<remaining)throw new ConfigurationError(409,'目标磁盘空间不足，请释放空间后恢复迁移。');
 for(const file of m.files){if(signal?.aborted)throw new ConfigurationError(409,'复制已中断，可恢复迁移；原位置仍有效。');await copyStorageFile(m.targetIdentity,file,id,signal);}
 const copied=await inventory(m.targetRoot),copiedByPath=new Map(copied.map(f=>[f.relativePath,f]));verifyReferences(copied,m.references);for(const f of expected.values()){const dest=copiedByPath.get(f.relativePath);if(!dest||dest.sha256!==f.sha256||dest.fileSize!==f.fileSize)throw new ConfigurationError(409,'复制结果校验失败：'+f.relativePath);}
 if(fingerprint(await allInventory(m.sources))!==fingerprint(m.files)||fingerprint(await evidence(c,account))!==m.evidenceSha256)throw new ConfigurationError(409,'复制期间源文件或引用已变化，未切换目录。');
 if(fingerprint(await identity(m.targetRoot))!==fingerprint(m.targetIdentity))throw new ConfigurationError(409,'切换前目标挂载已变化。');
 if(signal?.aborted)throw new ConfigurationError(409,'复制已中断，可恢复迁移；原位置仍有效。');
 // Ownership claims are held globally until the same commit publishes all mappings.
 for(const root of new Set([...m.logicalRoots,...m.sources.map(s=>s.path)]))await c.query('INSERT INTO local_identity.account_directory_locations(account_id,source_root,actual_root,migration_id) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,source_root) DO UPDATE SET actual_root=excluded.actual_root,migration_id=excluded.migration_id',[account,root,m.targetRoot,id]);
 await c.query('UPDATE local_identity.account_directory_locations SET actual_root=$2,migration_id=$3 WHERE account_id=$1',[account,m.targetRoot,id]);
 await c.query('INSERT INTO local_identity.account_asset_directories(account_id,actual_root,device_id,inode_id) VALUES($1,$2,$3,$4) ON CONFLICT(account_id) DO UPDATE SET actual_root=excluded.actual_root,device_id=excluded.device_id,inode_id=excluded.inode_id,updated_at=clock_timestamp()',[account,m.targetRoot,m.targetIdentity.device,m.targetIdentity.inode]);
 await c.query("UPDATE local_identity.account_directory_migrations SET status='completed',error=NULL,updated_at=clock_timestamp() WHERE id=$1",[id]);return{id,status:'completed',...m,originalsRetained:true};
 });}catch(error){const code=(error as NodeJS.ErrnoException).code;if(['EEXIST','ENOSPC','ENOENT','EIO','EACCES','EPERM','EROFS'].includes(code??''))error=new ConfigurationError(409,code==='EEXIST'?'复制目标出现同名文件，请保留副本并重新盘点；原位置仍有效。':code==='ENOSPC'?'目标磁盘空间不足，请释放空间后恢复迁移；原位置仍有效。':'迁移目录不可访问，请恢复挂载或读写权限后恢复迁移；原位置仍有效。');await sessionTransaction(pool,session,async c=>{await c.query("UPDATE local_identity.account_directory_migrations SET status='failed',error=$3,updated_at=clock_timestamp() WHERE id=$1 AND account_id=$2 AND status='copying'",[id,account,error instanceof Error?error.message:'迁移失败，原位置仍有效。']);});throw error;}
}

interface AdoptionSource{root:Root;prefix:string;directory:Root}
interface AdoptionEpisode{id:string;title:string;seriesId:string|null;seriesName:string|null;targetPrefix:string;managed:boolean;sources:AdoptionSource[]}
interface AdoptionContainer{id:string;seriesId:string|null;name:string;prefix:string;identity:Root|null}
interface AdoptionManifest{kind:'adoption'|'move';sourceContainerId?:string;targetContainerId?:string;targetRoot:string;targetIdentity:Root|null;rootBinding:MediaRootBinding;sources:Root[];episodes:AdoptionEpisode[];containers:AdoptionContainer[];files:File[];references:Reference[];evidenceSha256:string;businessEvidenceSha256:string;conflicts:string[];totalBytes:number;retained:string[];createdDirectories:Root[];temporaryFiles:{path:string;device:string;inode:string}[]}
function frozenAdoptionEvidence(value:unknown){return Object.fromEntries(Object.entries(value as Record<string,unknown>).filter(([key])=>!['account_asset_directories','local_identity.episode_asset_locations','local_identity.episode_storage_lineage'].includes(key)));}
async function adoptionBlockers(c:Client,account:string){
 const result=(await c.query('SELECT local_identity.account_directory_busy($1) reasons',[account])).rows[0].reasons as {reason:string}[];
 const reserved=(await c.query("SELECT EXISTS(SELECT 1 FROM local_identity.account_creation_intents WHERE account_id=$1 AND result IS NULL) OR EXISTS(SELECT 1 FROM local_identity.container_creation_intents WHERE account_id=$1 AND result IS NULL) OR EXISTS(SELECT 1 FROM local_identity.episode_creation_intents WHERE account_id=$1 AND result IS NULL) OR EXISTS(SELECT 1 FROM local_identity.episode_deletion_intents i WHERE i.state IN ('prepared','committed') AND (i.manifest->>'accountId'=$1::text OR i.episode_id IN (SELECT id FROM public.episodes WHERE account_id=$1))) busy",[account])).rows[0];
 if(reserved.busy)result.push({reason:'存在未完成的创建或删除操作，请先恢复原操作。'});
 return result.map(r=>r.reason);
}
async function scopedInventory(episodes:AdoptionEpisode[]){
 const files:File[]=[];
 for(const episode of episodes)if(!episode.managed)for(const source of episode.sources){
  const listed=await inventory(source.directory.path);
  files.push(...listed.map(file=>({...file,sourceRoot:source.root.path,relativePath:source.prefix+'/'+file.relativePath,targetRelativePath:episode.targetPrefix+'/'+file.relativePath})));
  if(files.length>100000)throw new ConfigurationError(409,'文件超过本次纳管上限，请拆分账号处理。');
 }return files;
}
async function adoptionReferenceConflicts(c:Client,mediaRoot:string,episodes:AdoptionEpisode[],files:File[],refs:Reference[]){
 const conflicts:string[]=[],managed=new Map<string,Awaited<ReturnType<typeof episodeFileIO>>>();
 for(const episode of episodes){
  const location=await resolveEpisodeStorageLocation(c,mediaRoot,episode.id),io=await episodeFileIO(c,location.assetRoot,episode.id);
  if(episode.managed&&location.relativePath!==episode.targetPrefix)throw new ConfigurationError(409,'已纳管生产单位置改变，请重新盘点。');
  if((await resolveEpisodeStorageCollection(c,location)).status!=='registered')continue;
  if(await hasActiveNativeStudio(location.assetRoot,episode.id,location.relativePath))conflicts.push('Studio 正在编辑，请先保存并返回。');
  managed.set(episode.id,io);
 }
 for(const ref of refs){
  const owned=episodes.filter(e=>!ref.episodeId||e.id===ref.episodeId),matches=files.filter(f=>f.relativePath===ref.relativePath&&owned.some(e=>f.targetRelativePath?.startsWith(e.targetPrefix+'/')));
  const fingerprints:{sha256:string;fileSize:number}[]=[...matches];
  for(const episode of owned.filter(e=>managed.has(e.id))){const io=managed.get(episode.id)!;let path:string;try{path=await io.resolveReference(ref.relativePath);}catch{continue;}await io.assertValid();fingerprints.push(await fileDigest(io.assetRoot,relative(io.assetRoot,path)));}
  if(!fingerprints.length)conflicts.push('文件引用缺失或不属于已确认旧源：'+ref.relativePath);
  else if(fingerprints.some(f=>ref.sha256&&f.sha256!==ref.sha256||ref.fileSize!==undefined&&f.fileSize!==ref.fileSize)||new Set(fingerprints.map(f=>f.sha256+':'+f.fileSize)).size!==1)conflicts.push('文件引用指纹不一致：'+ref.relativePath);
 }
 return conflicts;
}
/** Explicit read-only plan. Stable business IDs and output names are persisted
 * before any mkdir, so metadata renames and process restarts cannot redirect it. */
export async function planLegacyStorageAdoption(c:Client,mediaRoot:string,account:string){
 await lock(c,account);
 if((await c.query("SELECT 1 FROM local_identity.account_directory_migrations WHERE account_id=$1 AND status IN ('planned','copying','failed')",[account])).rowCount)throw new ConfigurationError(409,'请先恢复或回滚已有目录计划。');
 const a=(await c.query('SELECT name FROM public.accounts WHERE id=$1',[account])).rows[0];
 const binding=(await c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding as MediaRootBinding;
 await verifyMediaRootBinding(binding);
 const registered=(await c.query('SELECT * FROM local_identity.account_asset_directories WHERE account_id=$1',[account])).rows[0];
 const targetRoot=registered?.actual_root??join(mediaRoot,directoryName(a.name,account));
 let targetIdentity:Root|null=null;
 try{targetIdentity=await identity(targetRoot);if(!registered)throw new ConfigurationError(409,'未登记的目标目录已有内容或身份，请保留现场并选择受控恢复。');if(targetIdentity.device!==registered.device_id||targetIdentity.inode!==registered.inode_id)throw new ConfigurationError(409,'账号目录身份已变化，请先恢复原位置。');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const conflicts=await adoptionBlockers(c,account),deployment=await readMediaDeployment(c,mediaRoot);
 const roots=new Set<string>();
 for(const row of (await c.query("SELECT asset_root root FROM local_identity.episode_asset_locations WHERE account_id=$1 UNION SELECT policy->>'asset_root' FROM public.account_blueprint_versions WHERE account_id=$1 AND coalesce(policy->>'asset_root','')<>'' UNION SELECT source_root FROM local_identity.account_directory_locations WHERE account_id=$1",[account])).rows){
  const logicalRoot=String(row.root).replace(/\/+$/,''),root=logicalRoot===mediaRoot||deployment.some(alias=>alias.replace(/\/+$/,'')===logicalRoot)?mediaRoot:await resolveLocalAssetRoot(c,mediaRoot,row.root);roots.add(root);
 }
 const episodes:AdoptionEpisode[]=[],containers:AdoptionContainer[]=[];
 const desired=[...(await c.query('SELECT id,name FROM public.series WHERE account_id=$1 ORDER BY id',[account])).rows,{id:null,name:'未分系列'}];
 for(const series of desired){const current=(await c.query('SELECT * FROM local_identity.account_storage_containers WHERE account_id=$1 AND series_id IS NOT DISTINCT FROM $2::uuid',[account,series.id])).rows[0],id=current?.id??randomUUID(),prefix=current?.directory_relative_path??directoryName(series.name,id,series.id?'系列':'未分系列');const actual=current?await identity(join(targetRoot,prefix)):null;if(current&&(actual!.device!==current.device_id||actual!.inode!==current.inode_id))throw new ConfigurationError(409,'收纳目录身份已变化，请先恢复原位置。');containers.push({id,seriesId:series.id,name:series.name,prefix,identity:actual});}

 const rows=(await c.query('SELECT e.id,e.title,s.id series_id,s.name series_name FROM public.episodes e LEFT JOIN public.series_versions v ON v.id=e.series_version_id LEFT JOIN public.series s ON s.id=v.series_id AND s.account_id=e.account_id WHERE e.account_id=$1 ORDER BY e.id',[account])).rows;
 for(const row of rows){
  const location=await resolveEpisodeStorageLocation(c,mediaRoot,row.id);await requireEpisodeStorageDirectory(c,location);roots.add(location.assetRoot);
  if((await resolveEpisodeStorageCollection(c,location)).status==='registered'){episodes.push({id:row.id,title:row.title,seriesId:location.storageSeriesId,seriesName:row.series_name,targetPrefix:location.relativePath,managed:true,sources:[]});continue;}
  // An unmanaged SQL110 NULL is not proof of unassigned physical collection.
  const seriesId=location.storageSeriesId??row.series_id??null;
  let container=containers.find(v=>v.seriesId===seriesId);
  if(!container){
   const current=(await c.query('SELECT * FROM local_identity.account_storage_containers WHERE account_id=$1 AND series_id IS NOT DISTINCT FROM $2::uuid',[account,seriesId])).rows[0];
   const id=current?.id??randomUUID(),name=row.series_name??'未分系列',prefix=current?.directory_relative_path??directoryName(name,id,seriesId?'系列':'未分系列');
   const actual=current?await identity(join(targetRoot,prefix)):null;
   if(current&&(actual!.device!==current.device_id||actual!.inode!==current.inode_id))throw new ConfigurationError(409,'收纳目录身份已变化，请先恢复原位置。');
   container={id,seriesId,name,prefix,identity:actual};containers.push(container);
  }
  const sources:AdoptionSource[]=[];
  for(const root of [...roots].sort())for(const prefix of [...new Set([location.relativePath,'episodes/'+row.id])]){
   try{const directory=await identity(join(root,prefix));const parent=await identity(root);sources.push({root:parent,prefix,directory});if(await hasActiveNativeStudio(root,row.id,prefix))conflicts.push('Studio 正在编辑，请先保存并返回。');}
   catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  if(!sources.length)conflicts.push('生产单没有可核验的旧源：'+row.id);
  episodes.push({id:row.id,title:row.title,seriesId,seriesName:row.series_name??null,targetPrefix:container.prefix+'/'+directoryName(row.title,row.id,'生产单'),managed:false,sources});
 }
 const files=await scopedInventory(episodes),destinations=new Map<string,File>();
 for(const file of files){const old=destinations.get(file.targetRelativePath!);if(old&&(old.sha256!==file.sha256||old.fileSize!==file.fileSize))conflicts.push('多个旧源存在同名不同内容文件：'+file.relativePath);else destinations.set(file.targetRelativePath!,file);}
 for(const episode of episodes.filter(e=>!e.managed)){
  if(episode.sources.some(s=>overlaps(s.directory.path,join(targetRoot,episode.targetPrefix))))conflicts.push('源生产单目录与目标重叠：'+episode.id);
  try{await lstat(join(targetRoot,episode.targetPrefix));conflicts.push('目标生产单目录已存在，请保留现场核对：'+episode.targetPrefix);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 }
 for(const claim of (await c.query('SELECT * FROM local_identity.account_asset_root_claims()')).rows)if(claim.account_id!==account){let other;try{other=mappedAssetPath(mediaRoot,claim.asset_root,deployment);}catch{other=claim.asset_root;}if(overlaps(targetRoot,other)||episodes.some(e=>e.sources.some(s=>overlaps(s.directory.path,other))))conflicts.push('源范围或目标与其他账号重叠。');}
 const data=await evidence(c,account),refs=references(data);
 // Each logical reference must resolve to the same suffix in an owned source.
 conflicts.push(...await adoptionReferenceConflicts(c,mediaRoot,episodes,files,refs));
 const manifest:AdoptionManifest={kind:'adoption',targetRoot,targetIdentity,rootBinding:binding,sources:[...new Map(episodes.flatMap(e=>e.sources).map(s=>[s.root.path,s.root])).values()],episodes,containers,files,references:refs,evidenceSha256:fingerprint(data),businessEvidenceSha256:fingerprint(frozenAdoptionEvidence(data)),conflicts:[...new Set(conflicts)],totalBytes:[...destinations.values()].reduce((n,f)=>n+f.fileSize,0),retained:[...roots].map(root=>root+'：旧源、未知及共享内容保留，不自动删除'),createdDirectories:[],temporaryFiles:[]};
 const id=randomUUID();await c.query("INSERT INTO local_identity.account_directory_migrations(id,account_id,status,manifest) VALUES($1,$2,'planned',$3)",[id,account,manifest]);return{id,status:'planned',...manifest};
}
/** Same durable migration coordinator, scoped to one registered production order.
 * Every move gets a fresh target instance; retained sources are never overwritten. */
export async function planEpisodeCollectionMove(c:Client,mediaRoot:string,episodeId:string,seriesId:string|null){
 const episode=(await c.query('SELECT e.id,e.account_id,e.title FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id AND m.user_id=local_identity.owner_id() AND m.role=\'owner\' WHERE e.id=$1',[episodeId])).rows[0];
 if(!episode)throw new ConfigurationError(404,'生产单不可见。');
 const account=episode.account_id;await lock(c,account);
 if((await c.query("SELECT 1 FROM local_identity.account_directory_migrations WHERE account_id=$1 AND status IN ('planned','copying','failed')",[account])).rowCount)throw new ConfigurationError(409,'请先恢复或回滚已有目录计划。');
 const location=await resolveEpisodeStorageLocation(c,mediaRoot,episodeId);await requireEpisodeStorageDirectory(c,location);
 const sourceCollection=await resolveEpisodeStorageCollection(c,location);if(sourceCollection.status!=='registered')throw new ConfigurationError(409,'请先在账号中盘点旧资料纳管，再调整收纳。');
 if(sourceCollection.container.seriesId===seriesId)throw new ConfigurationError(409,'生产单已在此收纳位置。');
 const container=await resolveStorageContainer(c,mediaRoot,account,seriesId);await requireStorageContainer(c,mediaRoot,container);
 const binding=(await c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding as MediaRootBinding;await verifyMediaRootBinding(binding);
 const targetRoot=location.assetRoot,targetIdentity=await identity(targetRoot),id=randomUUID(),source=sourceCollection.container;
 const targetPrefix=container.relativePath+'/'+directoryName(episode.title,episodeId+'--'+id,'生产单');
 const sourceDirectory=await identity(location.directoryPath),episodes:AdoptionEpisode[]=[{id:episodeId,title:episode.title,seriesId,seriesName:seriesId?(await c.query('SELECT name FROM public.series WHERE id=$1',[seriesId])).rows[0].name:null,targetPrefix,managed:false,sources:[{root:targetIdentity,prefix:location.relativePath,directory:sourceDirectory}]}];
 const containers:AdoptionContainer[]=[{id:source.id,seriesId:source.seriesId,name:'原收纳',prefix:source.relativePath,identity:await identity(join(targetRoot,source.relativePath))},{id:container.containerId!,seriesId,name:'目标收纳',prefix:container.relativePath!,identity:await identity(container.directoryPath!)}];
 const files=await scopedInventory(episodes),data=await evidence(c,account),refs=references(data).filter(ref=>ref.episodeId===episodeId);
 for(const file of files.filter(f=>f.relativePath.endsWith('.json')&&f.fileSize<=32*1024*1024)){let document;try{document=JSON.parse(await readFile(join(file.sourceRoot,file.relativePath),'utf8'));}catch{continue;}refs.push(...references(document).map(ref=>({...ref,episodeId})));}
 const conflicts=await adoptionBlockers(c,account);conflicts.push(...await adoptionReferenceConflicts(c,mediaRoot,episodes,files,refs));
 try{await lstat(join(targetRoot,targetPrefix));conflicts.push('目标生产单目录已存在，请保留现场后重新盘点。');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const manifest:AdoptionManifest={kind:'move',sourceContainerId:source.id,targetContainerId:container.containerId!,targetRoot,targetIdentity,rootBinding:binding,sources:[targetIdentity],episodes,containers,files,references:refs,evidenceSha256:fingerprint(data),businessEvidenceSha256:fingerprint(frozenAdoptionEvidence(data)),conflicts:[...new Set(conflicts)],totalBytes:files.reduce((sum,file)=>sum+file.fileSize,0),retained:[location.directoryPath+'：原文件保留，不自动删除'],createdDirectories:[],temporaryFiles:[]};
 await c.query("INSERT INTO local_identity.account_directory_migrations(id,account_id,status,manifest) VALUES($1,$2,'planned',$3)",[id,account,manifest]);return{id,status:'planned',...manifest};
}
async function executeStorageAdoption(pool:Pool,session:OwnerSession,mediaRoot:string,account:string,id:string,rollback:boolean,signal?:AbortSignal){
 const client=await pool.connect(),key='account-directory-migration:'+account;
 const transaction=<T>(run:(c:PoolClient)=>Promise<T>)=>sessionTransaction(pool,session,run,client);
 try{
  // Match T12: session account lock BEFORE global transaction/ownership locks.
  await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[key]);
  let m!:AdoptionManifest;
  const state=await transaction(async c=>{await lock(c,account);const row=(await c.query('SELECT status,manifest FROM local_identity.account_directory_migrations WHERE id=$1 AND account_id=$2 FOR UPDATE',[id,account])).rows[0];if(!row)throw new ConfigurationError(404,'纳管计划不可见。');m=row.manifest;
   if(row.status==='completed'){if(rollback)throw new ConfigurationError(409,'已完成纳管不能回滚，请建立新的受控迁移计划。');for(const e of m.episodes){const location=await resolveEpisodeStorageLocation(c,mediaRoot,e.id);await requireEpisodeStorageDirectory(c,location);const io=await episodeFileIO(c,location.assetRoot,e.id);for(const source of e.sources)await io.assertFrozenDirectory(source.prefix,{deviceId:source.directory.device,inodeId:source.directory.inode},source.root.path);}return'completed';}
   if(rollback){await c.query("UPDATE local_identity.account_directory_migrations SET status='rolled_back',error=NULL,updated_at=clock_timestamp() WHERE id=$1",[id]);return'rolled_back';}
   if(row.status==='rolled_back'||m.conflicts.length)throw new ConfigurationError(409,'计划已回滚或存在冲突，请处理后重新盘点。');
   if((await adoptionBlockers(c,account)).length)throw new ConfigurationError(409,'存在活动任务、创建、删除或未知提交，请先处理原操作。');
   await c.query("UPDATE local_identity.account_directory_migrations SET status='copying',error=NULL,updated_at=clock_timestamp() WHERE id=$1",[id]);return'copying';
  });
  if(state!=='copying')return{id,status:state,...m,originalsRetained:true};
  const persist=()=>transaction(c=>c.query('UPDATE local_identity.account_directory_migrations SET manifest=$2,updated_at=clock_timestamp() WHERE id=$1 AND status=\'copying\'',[id,m]));
  await verifyMediaRootBinding(m.rootBinding);
  for(const episode of m.episodes)for(const source of episode.sources){if(fingerprint(await identity(source.root.path))!==fingerprint(source.root)||fingerprint(await identity(source.directory.path))!==fingerprint(source.directory))throw new ConfigurationError(409,'旧源挂载或生产单目录身份已变化，请恢复原位置。');if(await hasActiveNativeStudio(source.root.path,episode.id,source.prefix))throw new ConfigurationError(409,'Studio 正在编辑，请先保存并返回。');}
  if(fingerprint(await scopedInventory(m.episodes))!==fingerprint(m.files)||fingerprint(await transaction(c=>evidence(c,account)))!==m.evidenceSha256)throw new ConfigurationError(409,'源文件或生产记录已变化，请回滚后重新盘点。');
  if((await transaction(c=>adoptionReferenceConflicts(c,mediaRoot,m.episodes,m.files,m.references))).length)throw new ConfigurationError(409,'已纳管文件引用校验失败，未切换位置。');
  const ensure=async(path:string,existing:Root|null)=>{
   const recorded=existing??m.createdDirectories.find(d=>d.path===path);
   if(recorded){if(fingerprint(await identity(path))!==fingerprint(recorded))throw new ConfigurationError(409,'目标目录身份已变化，请保留现场后恢复。');return recorded;}
   // A restart may leave a pre-journal empty mkdir. Never acquire unknown bytes.
   let created=false;try{await mkdir(path,{mode:0o700});created=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
   const actual=await identity(path);if(!created&&(await readdir(path)).length)throw new ConfigurationError(409,'未登记目标目录已有内容，拒绝覆盖。');
   m.createdDirectories.push(actual);await persist();return actual;
  };
  const copyTarget=await ensure(m.targetRoot,m.targetIdentity);
  for(const container of m.containers)await ensure(join(m.targetRoot,container.prefix),container.identity);
  for(const episode of m.episodes.filter(e=>!e.managed))await ensure(join(m.targetRoot,episode.targetPrefix),null);
  const unique=[...new Map(m.files.map(f=>[f.targetRelativePath!,f])).values()];
  // Only a persisted handle identity can authorize removing our interrupted
  // partial copy. A name that merely resembles a temp is never disposable.
  for(const temp of m.temporaryFiles){try{const actual=await lstat(temp.path,{bigint:true});if(!actual.isFile()||actual.isSymbolicLink()||String(actual.dev)!==temp.device||String(actual.ino)!==temp.inode||await realpath(temp.path)!==temp.path)throw new ConfigurationError(409,'迁移暂存文件身份已变化，保留现场。');if(actual.nlink!==1n){const destination=temp.path.slice(0,-('.migration-'+id).length),published=await lstat(destination,{bigint:true});if(actual.nlink!==2n||published.dev!==actual.dev||published.ino!==actual.ino)throw new ConfigurationError(409,'迁移暂存链接身份不一致，保留现场。');}await unlink(temp.path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  const capacity=await statfs(m.targetRoot,{bigint:true});if(capacity.bavail*capacity.bsize<BigInt(m.totalBytes))throw new ConfigurationError(409,'目标空间不足，请释放空间后恢复。');
  for(const episode of m.episodes.filter(e=>!e.managed)){
   const expected=new Map(unique.filter(f=>f.targetRelativePath!.startsWith(episode.targetPrefix+'/')).map(f=>[f.targetRelativePath!.slice(episode.targetPrefix.length+1),f]));
   for(const actual of await inventory(join(m.targetRoot,episode.targetPrefix))){const f=expected.get(actual.relativePath);if(!f||actual.sha256!==f.sha256||actual.fileSize!==f.fileSize)throw new ConfigurationError(409,'目标出现未知或冲突文件，保留现场，未切换位置。');}
  }
  for(const file of unique){if(signal?.aborted)throw new ConfigurationError(409,'复制已中断，可恢复；原位置仍有效。');await copyStorageFile(copyTarget,file,id,signal,async temp=>{m.temporaryFiles=m.temporaryFiles.filter(f=>f.path!==temp.path);m.temporaryFiles.push(temp);await persist();});}
  for(const file of unique){const actual=await fileDigest(m.targetRoot,file.targetRelativePath!);if(actual.sha256!==file.sha256||actual.fileSize!==file.fileSize)throw new ConfigurationError(409,'目标文件校验失败，原位置保留。');}
  if(fingerprint(await scopedInventory(m.episodes))!==fingerprint(m.files))throw new ConfigurationError(409,'复制期间旧源改变，未切换位置。');
  const result=await transaction(async c=>{
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('global-media-root',0))");await lock(c,account);
   await verifyMediaRootBinding(m.rootBinding);if(fingerprint(await evidence(c,account))!==m.evidenceSha256||(await adoptionBlockers(c,account)).length)throw new ConfigurationError(409,'记录或占用已变化，未切换位置。');
   for(const directory of m.createdDirectories)if(fingerprint(await identity(directory.path))!==fingerprint(directory))throw new ConfigurationError(409,'切换前目标目录身份已变化。');
   const root=await identity(m.targetRoot);
   await c.query('INSERT INTO local_identity.account_asset_directories(account_id,actual_root,device_id,inode_id) VALUES($1,$2,$3,$4) ON CONFLICT(account_id) DO UPDATE SET actual_root=excluded.actual_root,device_id=excluded.device_id,inode_id=excluded.inode_id,updated_at=clock_timestamp()',[account,root.path,root.device,root.inode]);
   for(const container of m.containers){const actual=await identity(join(m.targetRoot,container.prefix));await c.query('INSERT INTO local_identity.account_storage_containers(id,account_id,kind,series_id,directory_relative_path,device_id,inode_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING',[container.id,account,container.seriesId?'series':'unassigned',container.seriesId,container.prefix,actual.device,actual.inode]);}
   // Completion derives its edges from this durable manifest, never HTTP paths.
   const targets=[];for(const episode of m.episodes.filter(e=>!e.managed))targets.push({episodeId:episode.id,prefix:episode.targetPrefix,...await identity(join(m.targetRoot,episode.targetPrefix))});
   await c.query(m.kind==='move'?'SELECT local_identity.complete_storage_move($1,$2)':'SELECT local_identity.complete_storage_adoption($1,$2)',[id,JSON.stringify(targets)]);
   // A database trigger/registration can pause across external filesystem writes.
   // Recheck AFTER the final SQL and before COMMIT, including pre-existing parents.
   await verifyMediaRootBinding(m.rootBinding);
   for(const directory of [...m.createdDirectories,...(m.targetIdentity?[m.targetIdentity]:[]),...m.containers.flatMap(v=>v.identity?[v.identity]:[])])if(fingerprint(await identity(directory.path))!==fingerprint(directory))throw new ConfigurationError(409,'最终登记期间目标父链或生产单目录身份改变，未切换位置。');
   for(const episode of m.episodes)for(const source of episode.sources)if(fingerprint(await identity(source.root.path))!==fingerprint(source.root)||fingerprint(await identity(source.directory.path))!==fingerprint(source.directory))throw new ConfigurationError(409,'最终登记期间旧源身份改变，未切换位置。');
   for(const file of unique){const actual=await fileDigest(m.targetRoot,file.targetRelativePath!);if(actual.sha256!==file.sha256||actual.fileSize!==file.fileSize)throw new ConfigurationError(409,'最终登记期间目标文件改变，未切换位置。');}
   if(fingerprint(await scopedInventory(m.episodes))!==fingerprint(m.files))throw new ConfigurationError(409,'最终登记期间旧源文件改变，未切换位置。');
   if(fingerprint(frozenAdoptionEvidence(await evidence(c,account)))!==m.businessEvidenceSha256)throw new ConfigurationError(409,'最终登记期间冻结业务记录改变，未切换位置。');
   if((await adoptionReferenceConflicts(c,mediaRoot,m.episodes,m.files,m.references)).length)throw new ConfigurationError(409,'最终登记期间已纳管文件引用改变，未切换位置。');

   return{id,status:'completed',...m,originalsRetained:true};
  });return result;
 }catch(error){const code=(error as NodeJS.ErrnoException).code;if(['EEXIST','ENOSPC','ENOENT','EIO','EACCES','EPERM','EROFS','EBUSY'].includes(code??''))error=new ConfigurationError(409,'纳管目录、挂载、权限或空间已变化；未切换位置，请恢复原条件后继续或回滚。');await transaction(c=>c.query("UPDATE local_identity.account_directory_migrations SET status='failed',error=$2,updated_at=clock_timestamp() WHERE id=$1 AND status='copying'",[id,error instanceof Error?error.message:'纳管未完成，原位置保留。'])).catch(()=>{});throw error;
 }finally{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]).catch(()=>{});client.release();}
}
