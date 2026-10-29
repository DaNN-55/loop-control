import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,realpath,readdir,unlink} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import type {PoolClient} from 'pg';
import {ConfigurationError} from './configurationCommands.js';
import {tokenHash,type OwnerSession} from './sessions.js';

export interface HistoryBlobTarget {sha:string;path:string;root:string;rootIdentity:string;identity:string;bytes:number}
export interface HistoryDeleteInventory {
 episodeId:string;title:string;revision:string;live:{id:string;title:string;policy:{asset_root:string}}|null;
 records:unknown[];files:{sha256:string}[];blobs:{sha256:string;bytes:number}[];
}
const identity=(s:{dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint})=>[s.dev,s.ino,s.size,s.mtimeNs].join(':');
const nodeIdentity=(s:{dev:bigint;ino:bigint})=>[s.dev,s.ino].join(':');
export async function historyDeleteInventory(c:PoolClient,id:unknown,session:OwnerSession):Promise<HistoryDeleteInventory>{
 if(typeof id!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))throw new ConfigurationError(400,'生产单标识无效。');
 try{await c.query('SET LOCAL enable_nestloop=off');const result=(await c.query('SELECT local_identity.history_episode_delete_plan($1,$2) result',[id,tokenHash(session.token)])).rows[0].result as HistoryDeleteInventory;return{...result,title:result.title.trim()||'未命名生产单 · '+id.slice(0,8)};}
 catch(error){if((error as {code?:string}).code==='42501')throw new ConfigurationError(404,'历史生产单不存在，或没有永久删除权限。');if((error as {code?:string}).code==='55000'&&(error as Error).message.includes('dependency'))throw new ConfigurationError(409,'其他生产单仍引用此条目的素材、任务或记录，请先解除相关依赖，再重新检查。');if(['55000','55P03'].includes((error as {code?:string}).code??''))throw new ConfigurationError(409,'生产单有运行任务、资产锁、并发操作或已被删除，请稍后重新检查。');throw error;}
}
// Standalone raster/audio/video bytes do not carry executable project references.
function standaloneMedia(bytes:Buffer){
 return bytes.length>=12&&(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  ||bytes[0]===255&&bytes[1]===216&&bytes[2]===255
  ||['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6))
  ||bytes.toString('ascii',0,4)==='RIFF'&&['WAVE','WEBP','AVI '].includes(bytes.toString('ascii',8,12))
  ||bytes.toString('ascii',4,8)==='ftyp'&&bytes.readUInt32BE(0)>=8&&bytes.readUInt32BE(0)<=bytes.length
  ||['OggS','fLaC'].includes(bytes.toString('ascii',0,4)));
}
async function hashFile(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
// Stream preserved files for indirect content-address references; no whole media file is buffered.
export async function historyBlobTargets(root:string|undefined,inventory:HistoryDeleteInventory,mediaRoots:string[],removedPaths:string[]){
 if(!root){if(inventory.blobs.length||removedPaths.length)throw new ConfigurationError(503,'历史文件库尚未配置，不能确认永久删除范围。');return{targets:[],retainedShas:[] as string[]};}
 const canonicalRoot=await realpath(root),rootStat=await lstat(canonicalRoot,{bigint:true});
 if(canonicalRoot!==resolve(root)||!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new ConfigurationError(409,'历史文件库位置不安全。');
 const targets:HistoryBlobTarget[]=[];
 for(const item of inventory.blobs){
  if(!/^[a-f0-9]{64}$/.test(item.sha256))throw new ConfigurationError(409,'历史文件摘要无效。');
  const path=join(canonicalRoot,item.sha256);let stat;
  try{stat=await lstat(path,{bigint:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
  if(!stat.isFile()||stat.isSymbolicLink()||await realpath(path)!==path||Number(stat.size)!==Number(item.bytes)||await hashFile(path)!==item.sha256)throw new ConfigurationError(409,'历史文件已变化，请重新检查删除范围。');
  targets.push({sha:item.sha256,path,root:canonicalRoot,rootIdentity:nodeIdentity(rootStat),identity:identity(stat),bytes:Number(stat.size)});
 }
 if(!targets.length&&!removedPaths.length)return{targets,retainedShas:[] as string[]};
 const candidates=new Set(targets.map(x=>x.sha)),excluded=new Set(targets.map(x=>x.path)),referenced=new Set<string>(),visited=new Set<string>(),dependencies=new Map<string,Set<string>>(),pathReferences=new Set<string>();
 async function inspect(path:string,refs:Set<string>,runtime=false){
  let carry='',first=true;for await(const chunk of createReadStream(path)){
   if(first&&standaloneMedia(chunk as Buffer))break;first=false;
   const text=carry+(chunk as Buffer).toString('latin1');for(const m of text.matchAll(/[a-f0-9]{64}/g))if(candidates.has(m[0]))refs.add(m[0]);
   if(runtime&&removedPaths.some(p=>text.includes(p)||text.includes('episodes/'+inventory.episodeId+'/')))pathReferences.add(path);carry=text.slice(-Math.max(63,...removedPaths.map(p=>p.length)));
  }
 }
 async function scan(directory:string,runtime:boolean){
  const resolved=await realpath(directory),key=runtime+resolved;if(visited.has(key))return;visited.add(key);
  for(const entry of await readdir(resolved,{withFileTypes:true})){
   const path=join(resolved,entry.name);if(excluded.has(path)||removedPaths.some(p=>path===p||path.startsWith(p+sep))||entry.isSymbolicLink())continue;
   if(entry.isDirectory()){await scan(path,runtime);continue;}if(!entry.isFile())continue;
   await inspect(path,referenced,runtime);
  }
 }
 try{if(targets.length)await scan(canonicalRoot,false);for(const directory of new Set(mediaRoots))await scan(directory,true);for(const target of targets){const refs=new Set<string>();await inspect(target.path,refs);dependencies.set(target.sha,refs);}}
 catch{throw new ConfigurationError(409,'部分留存文件无法核查引用，未执行删除。请恢复存储位置后重试。');}
 let changed=true;while(changed){changed=false;for(const sha of [...referenced])for(const dependency of dependencies.get(sha)??[])if(!referenced.has(dependency)){referenced.add(dependency);changed=true;}}
 if([...pathReferences].some(path=>!excluded.has(path)||targets.some(t=>t.path===path&&referenced.has(t.sha))))throw new ConfigurationError(409,'其他留存文件仍引用该生产单目录，未执行删除。');
 return{targets:targets.filter(x=>!referenced.has(x.sha)),retainedShas:[...referenced].sort()};
}
// Bind every directory entry to the reviewed plan without buffering or re-hashing large media.
export async function historyDirectoryRevision(paths:string[]){
 const hash=createHash('sha256');
 async function visit(path:string){
  let stat;try{stat=await lstat(path,{bigint:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){hash.update(path+':absent');return;}throw error;}
  hash.update(JSON.stringify([path,identity(stat),String(stat.mode)]));
  if(stat.isDirectory()&&!stat.isSymbolicLink()){
   for(const name of (await readdir(path)).sort())await visit(join(path,name));
   const after=await lstat(path,{bigint:true});if(identity(after)!==identity(stat))throw new ConfigurationError(409,'生产单目录正在变化，请稍后重新检查。');
  }
 }
 for(const path of paths)await visit(path);return hash.digest('hex');
}
export async function assertHistoryMediaUnshared(c:PoolClient,paths:string[],episode:string){
 for(const path of paths){
  const r=await c.query('SELECT local_identity.history_media_path_referenced($1,$2) referenced',[path,episode]);
  if(r.rows[0].referenced)throw new ConfigurationError(409,'其他生产单或历史资料仍引用该目录，不能删除：'+path);
 }
}
export async function finishHistoryBlob(c:PoolClient,target:HistoryBlobTarget,session:OwnerSession){
 if(target.path!==join(target.root,target.sha)||!/^[a-f0-9]{64}$/.test(target.sha)||await realpath(target.root)!==target.root)throw Error('历史清理位置无效。');
 const root=await lstat(target.root,{bigint:true});if(!root.isDirectory()||root.isSymbolicLink()||nodeIdentity(root)!==target.rootIdentity)throw Error('历史文件库位置已变化。');
 const referenced=(await c.query('SELECT local_identity.history_cleanup_blob_referenced($1,$2) referenced',[target.sha,tokenHash(session.token)])).rows[0].referenced;
 if(referenced)return false;
 let stat;try{stat=await lstat(target.path,{bigint:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return true;throw error;}
 if(!stat.isFile()||stat.isSymbolicLink()||identity(stat)!==target.identity||await hashFile(target.path)!==target.sha)throw Error('待清理历史文件已变化。');
 await unlink(target.path);return true;
}
