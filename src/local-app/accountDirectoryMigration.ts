import type {Pool,PoolClient} from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,readdir,realpath,open,mkdir,rename,unlink,readFile,statfs} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {sessionTransaction} from './ownerTransaction.js';
import type {OwnerSession} from './sessions.js';
import {ConfigurationError} from './configurationCommands.js';
import {readMediaDeployment,resolveLocalAssetRoot} from './mediaDeployment.js';
import {mappedAssetPath} from './mediaPaths.js';
import {safeRelative} from './localFiles.js';
import {hasActiveNativeStudio} from '../worker/openchatcutStudio.js';
import {validateAccountAssetLocation,accountAssetRootsOverlap as overlaps} from './accountAssetRoots.js';
type Client=Pick<PoolClient,'query'>;
interface File{sourceRoot:string;relativePath:string;sha256:string;fileSize:number}
interface Root{path:string;device:string;inode:string}
interface Reference{relativePath:string;sha256?:string;fileSize?:number}
interface Manifest{targetRoot:string;targetIdentity:Root;sources:Root[];logicalRoots:string[];episodes:{id:string;title:string}[];files:File[];references:Reference[];evidenceSha256:string;conflicts:string[];totalBytes:number}
const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,ordered(item)])):value;
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
async function identity(path:string):Promise<Root>{const s=await lstat(path,{bigint:true});if(!s.isDirectory()||await realpath(path)!==path)throw new ConfigurationError(409,'迁移目录不是安全的实际目录：'+path);return{path,device:String(s.dev),inode:String(s.ino)};}
async function fileDigest(root:string,path:string){
 if(!safeRelative(path))throw new ConfigurationError(409,'迁移文件路径无效：'+path);
 const full=join(root,path);if(await realpath(full)!==full)throw new ConfigurationError(409,'迁移不接受符号链接：'+full);
 const handle=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=await handle.stat({bigint:true});if(!before.isFile()||before.nlink!==1n)throw new ConfigurationError(409,'迁移仅接受独立普通文件：'+full);
 const hash=createHash('sha256');for await(const chunk of handle.createReadStream({autoClose:false}))hash.update(chunk);
 const after=await handle.stat({bigint:true});if(before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ino!==after.ino)throw new ConfigurationError(409,'复制期间文件已变化：'+full);
 if(after.size>BigInt(Number.MAX_SAFE_INTEGER))throw new ConfigurationError(409,'文件过大，无法安全记录大小。');return{sha256:hash.digest('hex'),fileSize:Number(after.size)};
 }finally{await handle.close();}
}
async function inventory(root:string):Promise<File[]>{const files:File[]=[];async function visit(path:string){for(const name of(await readdir(join(root,path))).sort()){
 const rel=path?path+'/'+name:name,full=join(root,rel),s=await lstat(full);if(s.isSymbolicLink()||await realpath(full)!==full)throw new ConfigurationError(409,'迁移不接受符号链接：'+full);
 if(s.isDirectory())await visit(rel);else files.push({sourceRoot:root,relativePath:rel,...await fileDigest(root,rel)});
 if(files.length>100000)throw new ConfigurationError(409,'文件超过本次迁移上限，请先整理目录。');
 }}await visit('');return files;}
async function allInventory(roots:{path:string}[]){const files:File[]=[];for(const root of roots){files.push(...await inventory(root.path));if(files.length>100000)throw new ConfigurationError(409,'迁移文件总数超过本次上限，请先整理目录。');}return files;}
function references(evidence:unknown){const refs:Reference[]=[];function visit(value:unknown){if(!value||typeof value!=='object')return;if(Array.isArray(value)){for(const x of value)visit(x);return;}
 const row=value as Record<string,unknown>;for(const key of ['relative_path','storage_path','relativePath','project_relative_path','projectRelativePath','workspaceRelativePath','project_path']){
 const path=row[key];if(typeof path==='string'&&path){if(!safeRelative(path))throw new ConfigurationError(409,'文件引用不安全：'+path);refs.push({relativePath:path,...(typeof (row.sha256??row.project_sha256)==='string'&&/^[a-f0-9]{64}$/.test(String(row.sha256??row.project_sha256))?{sha256:String(row.sha256??row.project_sha256)}:{}),...(row.file_size!==undefined||row.fileSize!==undefined||key==='project_path'&&row.project_size!==undefined?{fileSize:Number(row.file_size??row.fileSize??row.project_size)}:{})});}}
 if(typeof row.src==='string'&&row.src.startsWith('episodes/'))refs.push({relativePath:row.src});
 if(row.reverseSources&&typeof row.reverseSources==='object')for(const source of Object.values(row.reverseSources))if(typeof source==='string'&&source.startsWith('episodes/'))refs.push({relativePath:source});
 for(const x of Object.values(row))visit(x);
 }visit(evidence);return refs;}
function verifyReferences(files:File[],refs:Reference[]){const byPath=new Map(files.map(f=>[f.relativePath,f]));for(const ref of refs){const f=byPath.get(ref.relativePath);if(!f||ref.sha256&&ref.sha256!==f.sha256||ref.fileSize!==undefined&&ref.fileSize!==f.fileSize)throw new ConfigurationError(409,'文件引用校验失败：'+ref.relativePath);}}
async function lock(c:Client,account:string){if(!(await c.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked",['account-directory-migration:'+account])).rows[0].locked)throw new ConfigurationError(409,'账号迁移正在执行，请稍后读取结果。');await c.query("SELECT pg_advisory_xact_lock(hashtextextended('account-asset-root-ownership',0))");await c.query('SELECT local_identity.lock_account_directory_migration($1)',[account]);}
async function blockers(c:Client,account:string,episodes:{id:string}[],roots:string[]){const result=(await c.query('SELECT local_identity.account_directory_busy($1) reasons',[account])).rows[0].reasons as {reason:string}[];
 for(const episode of episodes)if((await Promise.all(roots.map(root=>hasActiveNativeStudio(root,episode.id)))).some(Boolean))result.push({reason:'Studio 正在编辑，请先保存并返回。'});return result.map(r=>r.reason);}
async function evidence(c:Client,account:string){return(await c.query('SELECT local_identity.account_directory_evidence($1) evidence',[account])).rows[0].evidence;}
async function plan(c:Client,mediaRoot:string,account:string,path:unknown):Promise<Manifest>{
 const valid=await validateAccountAssetLocation(c,mediaRoot,path),targetIdentity=await identity(valid.path),deployment=await readMediaDeployment(c,mediaRoot);
 const episodes=(await c.query('SELECT id,title FROM public.episodes WHERE account_id=$1 ORDER BY id',[account])).rows as {id:string;title:string}[];
 const logicalRoots=(await c.query("SELECT actual_root root FROM local_identity.account_asset_directories WHERE account_id=$1 UNION SELECT asset_root FROM local_identity.episode_asset_locations WHERE account_id=$1 UNION SELECT policy->>'asset_root' FROM public.account_blueprint_versions WHERE account_id=$1 AND coalesce(policy->>'asset_root','')<>'' UNION SELECT source_root FROM local_identity.account_directory_locations WHERE account_id=$1",[account])).rows.map(r=>r.root) as string[];
 const roots=[...new Set(await Promise.all(logicalRoots.map(root=>resolveLocalAssetRoot(c,mediaRoot,root))))].sort();
 if(roots.length>128)throw new ConfigurationError(409,'历史目录过多，请先核对目录归属。');
 if(!roots.length)throw new ConfigurationError(409,'账号没有可盘点的当前或历史目录。');
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
async function safeParents(root:string,path:string){for(const part of path.split('/').slice(0,-1)){root=join(root,part);await mkdir(root,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});await identity(root);}}
async function copy(root:string,f:File,id:string,signal?:AbortSignal){await safeParents(root,f.relativePath);const dest=join(root,f.relativePath);
 try{const existing=await fileDigest(root,f.relativePath);if(existing.sha256!==f.sha256||existing.fileSize!==f.fileSize)throw new ConfigurationError(409,'目标已有冲突文件，原件已保留：'+f.relativePath);return;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const temp=dest+'.migration-'+id;await identity(root);if(await realpath(join(f.sourceRoot,f.relativePath))!==join(f.sourceRoot,f.relativePath))throw new ConfigurationError(409,'复制源路径已变化。');const input=await open(join(f.sourceRoot,f.relativePath),constants.O_RDONLY|constants.O_NOFOLLOW),output=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{if(await realpath(temp)!==temp)throw new ConfigurationError(409,'复制目标路径已变化。');const stat=await input.stat();if(!stat.isFile()||stat.nlink!==1)throw new ConfigurationError(409,'复制源不是独立普通文件。');for await(const chunk of input.createReadStream({autoClose:false,highWaterMark:256*1024})){if(signal?.aborted)throw new ConfigurationError(409,'复制已中断，可恢复迁移；原位置仍有效。');const bytes=chunk as Buffer;let offset=0;while(offset<bytes.length){const written=await output.write(bytes,offset,bytes.length-offset);offset+=written.bytesWritten;}}await output.sync();}finally{await input.close();await output.close();}
 const copied=await fileDigest(root,relative(root,temp));if(copied.sha256!==f.sha256||copied.fileSize!==f.fileSize)throw new ConfigurationError(409,'复制文件指纹不一致：'+f.relativePath);
 // No source is renamed/deleted. A complete copied file is durable before publication.
 try{await lstat(dest);throw new ConfigurationError(409,'复制目标被其他操作占用：'+f.relativePath);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 await rename(temp,dest);
}
export async function executeAccountDirectoryMigration(pool:Pool,session:OwnerSession,mediaRoot:string,account:string,id:string,rollback:boolean,signal?:AbortSignal){
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
 for(const f of expected.values()){const temp=join(m.targetRoot,f.relativePath+'.migration-'+id);try{const stat=await lstat(temp);if(!stat.isFile()||stat.nlink!==1||await realpath(temp)!==temp)throw new ConfigurationError(409,'迁移暂存文件身份无效。');await unlink(temp);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
for(const actual of await inventory(m.targetRoot)){const f=expected.get(actual.relativePath);if(!f||f.sha256!==actual.sha256||f.fileSize!==actual.fileSize)throw new ConfigurationError(409,'目标存在冲突文件，请保留副本并重新盘点。');}
 const capacity=await statfs(m.targetRoot,{bigint:true}),remaining=[...expected.values()].reduce((bytes,file)=>bytes+BigInt(file.fileSize),0n)-(await inventory(m.targetRoot)).reduce((bytes,file)=>bytes+BigInt(file.fileSize),0n);if(capacity.bavail*capacity.bsize<remaining)throw new ConfigurationError(409,'目标磁盘空间不足，请释放空间后恢复迁移。');
 for(const file of m.files){if(signal?.aborted)throw new ConfigurationError(409,'复制已中断，可恢复迁移；原位置仍有效。');await copy(m.targetRoot,file,id,signal);}
 const copied=await inventory(m.targetRoot),copiedByPath=new Map(copied.map(f=>[f.relativePath,f]));verifyReferences(copied,m.references);for(const f of expected.values()){const dest=copiedByPath.get(f.relativePath);if(!dest||dest.sha256!==f.sha256||dest.fileSize!==f.fileSize)throw new ConfigurationError(409,'复制结果校验失败：'+f.relativePath);}
 if(fingerprint(await allInventory(m.sources))!==fingerprint(m.files)||fingerprint(await evidence(c,account))!==m.evidenceSha256)throw new ConfigurationError(409,'复制期间源文件或引用已变化，未切换目录。');
 if(fingerprint(await identity(m.targetRoot))!==fingerprint(m.targetIdentity))throw new ConfigurationError(409,'切换前目标挂载已变化。');
 if(signal?.aborted)throw new ConfigurationError(409,'复制已中断，可恢复迁移；原位置仍有效。');
 // Ownership claims are held globally until the same commit publishes all mappings.
 for(const root of new Set([...m.logicalRoots,...m.sources.map(s=>s.path)]))await c.query('INSERT INTO local_identity.account_directory_locations(account_id,source_root,actual_root,migration_id) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,source_root) DO UPDATE SET actual_root=excluded.actual_root,migration_id=excluded.migration_id',[account,root,m.targetRoot,id]);
 await c.query('UPDATE local_identity.account_directory_locations SET actual_root=$2,migration_id=$3 WHERE account_id=$1',[account,m.targetRoot,id]);
 await c.query('INSERT INTO local_identity.account_asset_directories(account_id,actual_root,device_id,inode_id) VALUES($1,$2,$3,$4) ON CONFLICT(account_id) DO UPDATE SET actual_root=excluded.actual_root,device_id=excluded.device_id,inode_id=excluded.inode_id,updated_at=clock_timestamp()',[account,m.targetRoot,m.targetIdentity.device,m.targetIdentity.inode]);
 await c.query("UPDATE local_identity.account_directory_migrations SET status='completed',error=NULL,updated_at=clock_timestamp() WHERE id=$1",[id]);return{id,status:'completed',...m,originalsRetained:true};
 });}catch(error){const code=(error as NodeJS.ErrnoException).code;if(['ENOSPC','ENOENT','EIO','EACCES','EPERM','EROFS'].includes(code??''))error=new ConfigurationError(409,code==='ENOSPC'?'目标磁盘空间不足，请释放空间后恢复迁移；原位置仍有效。':'迁移目录不可访问，请恢复挂载或读写权限后恢复迁移；原位置仍有效。');await sessionTransaction(pool,session,async c=>{await c.query("UPDATE local_identity.account_directory_migrations SET status='failed',error=$3,updated_at=clock_timestamp() WHERE id=$1 AND account_id=$2 AND status='copying'",[id,account,error instanceof Error?error.message:'迁移失败，原位置仍有效。']);});throw error;}
}
