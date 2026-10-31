import {lstat, realpath, readdir, readlink} from 'node:fs/promises';
import {isAbsolute, join, relative, resolve} from 'node:path';
import {mappedAssetPath,assetPathWithin} from './mediaPaths.js';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import type {PoolClient} from 'pg';
import type {EpisodeStorageLocation} from './episodeStorageLocation.js';

interface Identity {dev:string;ino:string}
export interface EpisodeDeletionTarget {
 root:string;path:string;stagingPath:string;rootIdentity:Identity;identity:Identity|null;
 files?:DeletionFile[];preserved?:{path:string;reason:string;fingerprint:string}[];
 directories?:{path:string;identity:Identity}[];
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
// Only deployment aliases of this exact account and Episode are candidates. Never scan a disk.
export async function episodeDeletionTargets(mediaRoot:string,root:string,episodeId:string,sources:readonly string[],location?:EpisodeStorageLocation):Promise<EpisodeDeletionTarget[]>{
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(episodeId))throw Error('生产单标识无效。');
 const suffix=relative(mediaRoot,root);
 if(!assetPathWithin(mediaRoot,root))throw Error('删除目录超出媒体部署范围。');
 const roots=new Set([root]);
 for(const source of sources){
  if(source==='/'||!isAbsolute(source)||resolve(source)!==source)continue;
  const candidate=join(source,suffix);
  if(mappedAssetPath(mediaRoot,candidate,sources)!==root)continue;
  await volumeAvailable(candidate);
  roots.add(candidate);
 }
 const targets:EpisodeDeletionTarget[]=[];
 for(const candidate of [root,...[...roots].filter(value=>value!==root).sort()]){
  const rootIdentity=await directory(candidate);
  if(!rootIdentity){if(candidate===root)throw Error('当前账号资产目录不可访问。');continue;}
  const episodes=join(candidate,'episodes'),path=location?join(candidate,location.relativePath):join(episodes,episodeId),stagingRoot=join(episodes,'.deletion-staging'),stagingPath=join(stagingRoot,episodeId);
  const parent=await directory(episodes),existing=await directory(path);
  if(candidate===root&&location?.deviceId!==null&&location?.deviceId!==undefined&&(!existing||existing.dev!==location.deviceId||existing.ino!==location.inodeId))throw Error('生产单登记目录身份已变化。');
  if(parent&&await directory(stagingRoot)&&await directory(stagingPath))throw Error('生产单存在未完成的删除暂存，请先恢复或重试原操作：'+stagingPath);
  let matchingTitle=false;
  if(candidate!==root&&!existing&&parent){
   const navigation=join(episodes,'按标题浏览');
   if(await directory(navigation))for(const name of await readdir(navigation)){
    const link=join(navigation,name),stat=await lstat(link);
    if(stat.isSymbolicLink()&&resolve(navigation,await readlink(link))===path){matchingTitle=true;break;}
   }
  }
  if(candidate===root||existing||matchingTitle)targets.push({root:candidate,path,stagingPath,rootIdentity,identity:existing});
 }
 return targets;
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
 UNION ALL SELECT r.relative_path,r.sha256,r.file_size,'legacy-recovery:'||r.workspace_id FROM local_identity.workspace_legacy_recoveries r JOIN local_identity.production_workspaces w ON w.id=r.workspace_id WHERE w.episode_id=$1`,[episodeId])).rows;
 const registered=new Map<string,typeof rows>();for(const row of rows){const path=join(target.root,row.path);if(assetPathWithin(target.path,path))registered.set(path,[...(registered.get(path)??[]),row]);}
 const files:DeletionFile[]=[],preserved:NonNullable<EpisodeDeletionTarget['preserved']>=[],directories:NonNullable<EpisodeDeletionTarget['directories']>=[];
 async function visit(path:string){
  const stat=await lstat(path,{bigint:true});
  if(stat.isDirectory()&&!stat.isSymbolicLink()){
   if(await realpath(path)!==path||stat.dev!==BigInt(target.rootIdentity.dev))throw Error('生产单子目录身份或设备已变化：'+path);
   directories.push({path,identity:identity(stat)});for(const name of(await readdir(path)).sort())await visit(join(path,name));return;
  }
  let reason='未登记或无法证明属于本单的文件，保留。',fingerprint=[String(stat.dev),String(stat.ino),String(stat.size),String(stat.mtimeNs),String(stat.mode)].join(':');
  if(stat.isSymbolicLink()){fingerprint+=':'+await readlink(path);reason='符号链接，保留。';}
  else if(stat.isFile()&&stat.nlink===1n){
   const actual=await deletionFileFingerprint(path);fingerprint+=':'+actual.sha256;const authority=registered.get(path)?.find(row=>row.sha256===actual.sha256&&Number(row.bytes)===actual.bytes);
   if(authority){const shared=(await c.query('SELECT local_identity.history_media_path_referenced($1,$2) referenced',[path,episodeId])).rows[0].referenced||(await c.query('SELECT local_identity.history_media_path_referenced($1,$2) referenced',[relative(target.root,path),episodeId])).rows[0].referenced;
    if(!shared){files.push({path,stagingPath:path+'.loop-control-deletion',...actual,authority:authority.authority});return;}reason='其他生产单或历史资料仍引用，保留。';
   }else if(registered.has(path))reason='登记指纹与实际文件不符，保留。';
  }else if(stat.isFile())reason='存在硬链接或共享文件身份，保留。';
  preserved.push({path,reason,fingerprint});
 }
 if(target.identity)await visit(target.path);return{...target,files,preserved,directories};
}
