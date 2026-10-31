import {lstat, realpath, readdir, readlink,readFile,mkdtemp,open,unlink,rmdir} from 'node:fs/promises';
import {join, relative, resolve,extname} from 'node:path';
import {assetPathWithin} from './mediaPaths.js';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import type {PoolClient} from 'pg';
import type {EpisodeStorageLocation} from './episodeStorageLocation.js';
import {hasActiveNativeStudio} from '../worker/openchatcutStudio.js';
import {isDeepStrictEqual} from 'node:util';
import {tmpdir} from 'node:os';
import {safeRelative} from './localFiles.js';
import {episodeFileIO} from './episodeFiles.js';

interface Identity {dev:string;ino:string}
export interface EpisodeDeletionTarget {
 root:string;path:string;stagingPath:string;rootIdentity:Identity;identity:Identity|null;
 files?:DeletionFile[];preserved?:{path:string;reason:string;fingerprint:string}[];
 directories?:{path:string;identity:Identity}[];
 links?:{path:string;identity:Identity;value:string;parent:string;parentIdentity:Identity}[];
 cleanupContainers?:{path:string;identity:Identity}[];
}
export interface DeletionFile {path:string;stagingPath:string;identity:Identity;sha256:string;bytes:number;authority:string}
const identity=(stat:{dev:bigint;ino:bigint}):Identity=>({dev:String(stat.dev),ino:String(stat.ino)});
const same=(a:Identity,b:Identity)=>a.dev===b.dev&&a.ino===b.ino;
async function directory(path:string){
 try{
  const stat=await lstat(path,{bigint:true});
  if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(path)!==path)throw Error('目录不是独立的安全目录：'+path);
  return identity(stat);
 }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
async function volumeAvailable(path:string){
 if(path.startsWith('/Volumes/')){
  const volume=path.split('/').slice(0,3).join('/');
  const mounted=await directory(volume),parent=await directory('/Volumes');
  if(!mounted||mounted.dev===parent?.dev)throw Error('外部盘不可访问，请挂载后重新检查：'+volume);
 }
}
// Only the unified resolver's current position grants a deletion target. Deployment
// aliases and retained migration/restore sources never expand this authority.
export async function episodeDeletionTargets(mediaRoot:string,root:string,episodeId:string,_sources:readonly string[],location?:EpisodeStorageLocation):Promise<EpisodeDeletionTarget[]>{
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(episodeId))throw Error('生产单标识无效。');
 const legacyGlobal=location?.layoutVersion===1&&location.assetRoot===mediaRoot&&location.relativePath==='episodes/'+episodeId;
 if(!assetPathWithin(mediaRoot,root)&&!legacyGlobal||location&&location.assetRoot!==root)throw Error('删除目录超出当前登记位置。');
 await volumeAvailable(root);const rootIdentity=await directory(root);if(!rootIdentity)throw Error('当前账号资产目录不可访问。');
 const episodes=join(root,'episodes'),path=location?location.directoryPath:join(episodes,episodeId),stagingRoot=join(episodes,'.deletion-staging'),stagingPath=join(stagingRoot,episodeId);
 if(!assetPathWithin(root,path))throw Error('生产单目录超出当前账号范围。');
 const parent=await directory(episodes),existing=await directory(path);
 if(location?.deviceId!==null&&location?.deviceId!==undefined&&(!existing||existing.dev!==location.deviceId||existing.ino!==location.inodeId))throw Error('生产单登记目录身份已变化。');
 if(parent&&await directory(stagingRoot)&&await directory(stagingPath))throw Error('生产单存在未完成的删除暂存，请先恢复或重试原操作：'+stagingPath);
 const links:NonNullable<EpisodeDeletionTarget['links']>=[],cleanupContainers:NonNullable<EpisodeDeletionTarget['cleanupContainers']>=[],navigation=join(episodes,'按标题浏览');
 if(parent){const navigationIdentity=await directory(navigation);if(navigationIdentity){for(const name of(await readdir(navigation)).sort()){const link=join(navigation,name),stat=await lstat(link,{bigint:true});if(stat.isSymbolicLink()){const value=await readlink(link);if(resolve(navigation,value)===path)links.push({path:link,identity:identity(stat),value,parent:navigation,parentIdentity:navigationIdentity});}}if(links.length)cleanupContainers.push({path:navigation,identity:navigationIdentity});}
  if(links.length||path===join(episodes,episodeId))cleanupContainers.push({path:episodes,identity:parent});
 }
 return[{root,path,stagingPath,rootIdentity,identity:existing,links,cleanupContainers}];
}
// Recheck device/inode and every parent immediately before moving or removing a directory.
export async function verifyEpisodeDeletionTarget(target:EpisodeDeletionTarget,phase:'original'|'staged'){
 await volumeAvailable(target.root);
 const currentRoot=await directory(target.root);
 if(!currentRoot||!same(currentRoot,target.rootIdentity))throw Error('删除目录所在位置已变化：'+target.root);
 if(target.files){
  const current=await directory(target.path);
  if(current&&(!target.identity||!same(current,target.identity))||!current&&target.identity&&phase==='original')throw Error('生产单目录已变化：'+target.path);
  for(const parent of target.directories??[]){const actual=await directory(parent.path);if(actual&&!same(actual,parent.identity)||!actual&&phase==='original')throw Error('删除文件父目录已变化：'+parent.path);}
  return;
 }
 const episodes=await directory(join(target.root,'episodes'));
 if(!episodes){if(phase==='original'&&target.identity)throw Error('生产单目录已变化。');return;}
 if(phase==='staged'&&!await directory(join(target.root,'episodes','.deletion-staging')))return;
 const current=await directory(phase==='original'?target.path:target.stagingPath);
 if(phase==='staged'&&!current)return; // An earlier cleanup attempt already removed this target.
 if(current&&(!target.identity||!same(current,target.identity))||!current&&target.identity)throw Error('生产单目录已变化，请重新检查：'+target.path);
}

export async function deletionFileFingerprint(path:string,expectedLinks=1n){
 const before=await lstat(path,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.nlink!==expectedLinks||await realpath(path)!==path)throw Error('文件不是独占普通文件：'+path);
 const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
 const after=await lstat(path,{bigint:true});if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs)throw Error('文件正在变化：'+path);
 return{identity:identity(before),sha256:hash.digest('hex'),bytes:Number(before.size)};
}

/** A registered directory never grants ownership of its unknown contents. */
export async function inventoryEpisodeDeletion(c:PoolClient,target:EpisodeDeletionTarget,episodeId:string){
 const rows=(await c.query(`SELECT relative_path path,sha256,file_size bytes,'artifact:'||id authority FROM public.artifacts WHERE episode_id=$1
 UNION ALL SELECT storage_path,sha256,file_size,'material:'||id FROM public.production_material_revisions WHERE episode_id=$1
 UNION ALL SELECT project_path,project_sha256,project_size,'workspace:'||id FROM local_identity.production_workspaces WHERE episode_id=$1
 UNION ALL SELECT project_path,project_sha256,project_size,'workspace-version:'||workspace_id FROM local_identity.production_workspace_versions WHERE episode_id=$1
 UNION ALL SELECT r.relative_path,r.sha256,r.file_size,'legacy-recovery:'||r.workspace_id FROM local_identity.workspace_legacy_recoveries r JOIN local_identity.production_workspaces w ON w.id=r.workspace_id WHERE w.episode_id=$1
 UNION ALL SELECT coalesce(a->>'relative_path',a->>'relativePath'),a->>'sha256',coalesce(a->>'file_size',a->>'fileSize')::bigint,'frozen-input:'||t.id FROM public.tasks t CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.input_snapshot->'input_artifacts')='array' THEN t.input_snapshot->'input_artifacts' ELSE '[]'::jsonb END) a WHERE t.episode_id=$1 AND t.status='completed'`,[episodeId])).rows;
 const storage=await episodeFileIO(c,target.root,episodeId),aliases=new Map<string,string[]>();
 const registered=new Map<string,typeof rows>();for(const row of rows){if(typeof row.path!=='string'||!safeRelative(row.path)||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256)||!Number.isSafeInteger(Number(row.bytes))||Number(row.bytes)<0)continue;let path:string;try{path=await storage.resolveReference(row.path);}catch{continue;}if(assetPathWithin(target.path,path)){registered.set(path,[...(registered.get(path)??[]),row]);aliases.set(path,await storage.referenceAliases(row.path));}}
 for(const candidate of await nativeDeletionAuthorities(c,target,episodeId,rows))registered.set(candidate.path,[candidate]);
 const files:DeletionFile[]=[],preserved:NonNullable<EpisodeDeletionTarget['preserved']>=[],directories:NonNullable<EpisodeDeletionTarget['directories']>=[];
 async function visit(path:string){
  const stat=await lstat(path,{bigint:true});
  if(stat.isDirectory()&&!stat.isSymbolicLink()){
   if(await realpath(path)!==path||stat.dev!==BigInt(target.rootIdentity.dev))throw Error('生产单子目录身份或设备已变化：'+path);
   const names=(await readdir(path)).sort();directories.push({path,identity:identity(stat)});if(!names.length&&path!==target.path)preserved.push({path,reason:'未登记的空目录，保留。',fingerprint:[stat.dev,stat.ino,stat.mode].join(':')});for(const name of names)await visit(join(path,name));return;
  }
  let reason='未登记或无法证明属于本单的文件，保留。',fingerprint=[String(stat.dev),String(stat.ino),String(stat.size),String(stat.mtimeNs),String(stat.mode)].join(':');
  if(stat.isSymbolicLink()){fingerprint+=':'+await readlink(path);reason='符号链接，保留。';}
  else if(stat.isFile()&&stat.nlink===1n){
   const actual=await deletionFileFingerprint(path);fingerprint+=':'+actual.sha256;const authority=registered.get(path)?.find(row=>row.sha256===actual.sha256&&Number(row.bytes)===actual.bytes);
   if(authority){let shared=false;for(const reference of aliases.get(path)??[path,relative(target.root,path)])if((await c.query('SELECT local_identity.history_media_path_referenced($1,$2) referenced',[reference,episodeId])).rows[0].referenced){shared=true;break;}
    if(!shared){files.push({path,stagingPath:path+'.loop-control-deletion',...actual,authority:authority.authority});return;}reason='其他生产单或历史资料仍引用，保留。';
   }else if(registered.has(path))reason='登记指纹与实际文件不符，保留。';
  }else if(stat.isFile())reason='存在硬链接或共享文件身份，保留。';
  preserved.push({path,reason,fingerprint});
 }
 if(target.identity)await visit(target.path);
 const references=new Set<string>(),patterns=files.map(file=>({file,values:[file.path,relative(target.root,file.path),file.sha256,...aliases.get(file.path)??[]].map(value=>Buffer.from(value).toString('latin1'))})),carryLength=patterns.reduce((maximum,pattern)=>pattern.values.reduce((length,value)=>Math.max(length,value.length),maximum),64);
 // Retained native/manual documents may reference otherwise owned bytes. Stream
 // them as literal bytes so UTF-8 and chunk boundaries cannot hide a dependency.
 const queue=preserved.map(file=>file.path),scanned=new Set<string>();
 for(let index=0;index<queue.length;index++){const path=queue[index];if(scanned.has(path))continue;scanned.add(path);const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())continue;let carry='';for await(const chunk of createReadStream(path)){const text=carry+(chunk as Buffer).toString('latin1');for(const pattern of patterns)if(pattern.values.some(value=>text.includes(value))&&!references.has(pattern.file.path)){references.add(pattern.file.path);queue.push(pattern.file.path);}carry=text.slice(-carryLength);}}
 const deletable=files.filter(file=>{if(!references.has(file.path))return true;preserved.push({path:file.path,reason:'保留文件仍引用此文件，保留。',fingerprint:[file.identity.dev,file.identity.ino,file.bytes,file.sha256].join(':')});return false;});
 return{...target,files:deletable,preserved,directories:directories.filter(directory=>directory.path===target.path||deletable.some(file=>assetPathWithin(directory.path,file.path)))};
}

/** Exact Host/SDK protocol members, never ownership of a work or runtime tree. */
async function nativeDeletionAuthorities(c:PoolClient,target:EpisodeDeletionTarget,episodeId:string,rows:{path:string;sha256:string;bytes:number|string;authority:string}[]){
 const candidates:{path:string;sha256:string;bytes:number;authority:string}[]=[],work=join(target.path,'openchatcut-work/current'),runtime=join(work,'runtime'),projectId='loop-control-'+episodeId;
 const json=async(path:string)=>{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>32*1024*1024||await realpath(path)!==path)throw Error('无法确认原生协议文件身份。');return JSON.parse(await readFile(path,'utf8'));};
 const own=async(path:string,authority:string,expected?:{sha256:string;bytes:number|string})=>{try{const actual=await deletionFileFingerprint(path);if(!expected||actual.sha256===expected.sha256&&actual.bytes===Number(expected.bytes))candidates.push({path,sha256:actual.sha256,bytes:actual.bytes,authority});}catch{/* Missing or unverifiable members remain outside the owned list. */}};
 try{
  if(await hasActiveNativeStudio(target.root,episodeId,relative(target.root,target.path)))return candidates;
  const workspace=(await c.query('SELECT id,script_revision_id,storyboard_package_id FROM local_identity.production_workspaces WHERE episode_id=$1',[episodeId])).rows[0];if(!workspace)return candidates;
  const metadata=await json(join(work,'workspace.json')),generated=await json(join(work,'generated-project.json')),host=await json(join(work,'project.json'));
  const expectedInput=createHash('sha256').update(JSON.stringify({id:workspace.id,scriptRevisionId:workspace.script_revision_id,storyboardPackageId:workspace.storyboard_package_id})).digest('hex');
  const validProject=(document:any)=>document?.version===3&&document.loopControl?.inputFingerprint===workspace.id&&Array.isArray(document.timelines)&&document.timelines.some((timeline:any)=>timeline.id===projectId);
  if(metadata.projectId!==projectId||metadata.inputFingerprint!==expectedInput||!validProject(generated)||!validProject(host)||metadata.baseProjectSha256!==createHash('sha256').update(JSON.stringify(generated)).digest('hex')||!metadata.reverseSources||Array.isArray(metadata.reverseSources))return candidates;
  const hostIdentity=await deletionFileFingerprint(join(work,'project.json'));if(!rows.some(row=>row.sha256===hostIdentity.sha256&&Number(row.bytes)===hostIdentity.bytes&&row.authority.startsWith('workspace')))return candidates;
  const databasePath=join(runtime,'project-store-v1.sqlite3');let receipt:any;
  try{
   receipt=await inspectDeletionSqlite(databasePath,database=>{
    const tables=database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[];if(tables.some(table=>!['kv','storage_migration_state','search_state','search_fts','search_fts_data','search_fts_idx','search_fts_content','search_fts_docsize','search_fts_config'].includes(table.name)))return null;
    if(tables.some(table=>table.name==='search_fts')&&(database.prepare("SELECT 1 FROM search_fts WHERE project_id<>? OR kind NOT IN ('caption','transcript') LIMIT 1").get(projectId)||database.prepare('SELECT 1 FROM search_state WHERE k<>? LIMIT 1').get('project:'+projectId)))return null;
    const entries=database.prepare('SELECT k,v FROM kv').all() as {k:string;v:string}[];
    if(!entries.some(entry=>entry.k==='project:'+projectId))return null;
    for(const entry of entries){const value=JSON.parse(entry.v);if(entry.k==='project:'+projectId){if(!validProject(value))return null;}
     else if(entry.k==='projects'){if(!Array.isArray(value)||value.length!==1||value[0].id!==projectId)return null;}
     else if(entry.k==='project-edit-ownership:'+projectId){if(value.version!==1||value.projectId!==projectId||!['browser','offline'].includes(value.ownerKind)||typeof value.ownerId!=='string'||!Number.isSafeInteger(value.epoch)||typeof value.baseRevision!=='string'||typeof value.leaseExpiresAt!=='number'||value.leaseExpiresAt>Date.now())return null;}
     else if(entry.k==='generation-jobs:snapshot'){if(value.version!==1||!Array.isArray(value.jobs)||value.jobs.length)return null;}
     else if(entry.k==='deleted-projects:v1'){if(!value||Array.isArray(value)||Object.keys(value).length)return null;}
     else return null;
    }
    const state=database.prepare("SELECT receipt FROM storage_migration_state WHERE singleton=1 AND state='complete'").get() as {receipt:string}|undefined;if(!state)return null;const record=JSON.parse(state.receipt);
    if(!record.keys||!record.sources||Object.keys(record.keys).length!==record.count||![1,2].includes(record.phase)||Object.keys(record.keys).some(key=>!['projects','project:'+projectId,'generation-jobs:snapshot','deleted-projects:v1'].includes(key)))return null;return record;
   });if(!receipt)return candidates;
  }catch{/* Unknown SQLite authority remains outside deletion. */return candidates;}
  await own(join(work,'workspace.json'),'native-host:'+workspace.id);await own(join(work,'generated-project.json'),'native-baseline:'+workspace.id);await own(join(work,'project.json'),'native-snapshot:'+workspace.id);
  for(const suffix of ['','-wal','-shm'])await own(databasePath+suffix,'native-sqlite:'+workspace.id);
  try{if(isDeepStrictEqual(await json(databasePath+'.receipt.json'),receipt))await own(databasePath+'.receipt.json','native-sqlite-receipt:'+workspace.id);}catch{/* Inspection sidecars do not establish authority. */}
  for(const [key,value]of Object.entries(receipt.sources) as [string,{path:string;sha256:string;kind:string}][]){
   if(!assetPathWithin(runtime,value.path)||receipt.keys[key]!==value.sha256||!['project-store-entry','project-store-monolith'].includes(value.kind))continue;
   for(const path of [value.path,value.kind==='project-store-monolith'?value.path+'.migrated':value.path])try{const actual=await deletionFileFingerprint(path);if(actual.sha256===value.sha256)await own(path,'native-import:'+workspace.id,actual);}catch{/* Unknown imports and changed backups remain. */}
  }
  for(const [url,reference]of Object.entries(metadata.reverseSources) as [string,string][]){
   if(typeof reference!=='string')continue;const name=createHash('sha256').update(reference).digest('hex').slice(0,20)+extname(reference).toLowerCase();if(url!=='/media/uploads/'+name)continue;
   const source=rows.find(row=>row.path===reference);if(source)await own(join(runtime,'media/uploads',name),'native-upload:'+source.authority,source);
  }
 }catch{/* Missing or inconsistent Host identity preserves all unproven native files. */}
 return [...new Map(candidates.map(candidate=>[candidate.path,candidate])).values()];
}

/** Even a SQLite read-only connection writes SHM locks. Inspect a bounded streamed
 * private copy of the exact stable DB/WAL/SHM set, leaving production bytes alone. */
async function inspectDeletionSqlite<T>(path:string,inspect:(database:import('node:sqlite').DatabaseSync)=>T){
 const source=new Map<string,Awaited<ReturnType<typeof deletionFileFingerprint>>>();for(const suffix of ['','-wal','-shm'])try{source.set(suffix,await deletionFileFingerprint(path+suffix));}catch(error){if(suffix===''||(error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const temporary=await realpath(await mkdtemp(join(tmpdir(),'loop-deletion-sqlite-'))),root=await lstat(temporary,{bigint:true}),owned=new Map<string,Identity>();
 try{
  for(const suffix of ['','-wal','-shm']){const target=join(temporary,'store.sqlite3'+suffix),file=await open(target,'wx',0o600);try{
    const created=await file.stat({bigint:true});owned.set(target,identity(created));
    if(source.has(suffix))for await(const chunk of createReadStream(path+suffix)){const bytes=chunk as Buffer;let offset=0;while(offset<bytes.length)offset+=(await file.write(bytes,offset,bytes.length-offset,null)).bytesWritten;}
   }finally{await file.close();}
  }
  for(const[suffix,before]of source){const after=await deletionFileFingerprint(path+suffix);if(!same(before.identity,after.identity)||before.sha256!==after.sha256||before.bytes!==after.bytes)throw Error('原生数据库正在变化，保留原位置。');}
  const {DatabaseSync}=await import('node:sqlite'),database=new DatabaseSync(join(temporary,'store.sqlite3'),{readOnly:true});try{return inspect(database);}finally{database.close();}
 }finally{
  const current=await lstat(temporary,{bigint:true}).catch(()=>null);
  if(current&&current.dev===root.dev&&current.ino===root.ino&&await realpath(temporary)===temporary){for(const[file,expected]of owned)try{const stat=await lstat(file,{bigint:true});if(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1n&&same(identity(stat),expected))await unlink(file);}catch{/* Preserve replaced or inaccessible private files. */}await rmdir(temporary).catch(()=>{});}
 }
}
