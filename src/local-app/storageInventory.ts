import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,opendir,realpath,open} from 'node:fs/promises';
import {join} from 'node:path';
import {ConfigurationError} from './configurationCommands.js';
import {safeRelative} from './localFiles.js';
export interface File{sourceRoot:string;relativePath:string;sha256:string;fileSize:number;targetRelativePath?:string}
export interface Root{path:string;device:string;inode:string}
export interface Reference{episodeId?:string;relativePath:string;sha256?:string;fileSize?:number}
const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,ordered(item)])):value;
export const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
export async function identity(path:string):Promise<Root>{const s=await lstat(path,{bigint:true});if(!s.isDirectory()||await realpath(path)!==path)throw new ConfigurationError(409,'迁移目录不是安全的实际目录：'+path);return{path,device:String(s.dev),inode:String(s.ino)};}
export async function fileDigest(root:string,path:string){
 if(!safeRelative(path))throw new ConfigurationError(409,'迁移文件路径无效：'+path);
 const full=join(root,path);if(await realpath(full)!==full)throw new ConfigurationError(409,'迁移不接受符号链接：'+full);
 const entry=await lstat(full,{bigint:true});if(!entry.isFile()||entry.nlink!==1n)throw new ConfigurationError(409,'迁移仅接受独立普通文件：'+full);
 const handle=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const before=await handle.stat({bigint:true});if(!before.isFile()||before.nlink!==1n)throw new ConfigurationError(409,'迁移仅接受独立普通文件：'+full);
 const hash=createHash('sha256');for await(const chunk of handle.createReadStream({autoClose:false,highWaterMark:256*1024}))hash.update(chunk);
 const after=await handle.stat({bigint:true}),actual=await lstat(full,{bigint:true});if(before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||before.dev!==after.dev||before.ino!==after.ino||actual.dev!==after.dev||actual.ino!==after.ino||actual.nlink!==1n||await realpath(full)!==full)throw new ConfigurationError(409,'复制期间文件已变化：'+full);
 if(after.size>BigInt(Number.MAX_SAFE_INTEGER))throw new ConfigurationError(409,'文件过大，无法安全记录大小。');return{sha256:hash.digest('hex'),fileSize:Number(after.size)};
 }finally{await handle.close();}
}
export async function inventory(root:string,options:{onDirectory?:(path:string)=>Promise<void>;maximumEntries?:number}={}):Promise<File[]>{const files:File[]=[],maximum=options.maximumEntries??100000;let count=0;async function visit(path:string,depth=0){
 if(depth>128)throw new ConfigurationError(409,'目录层级超过 128 层上限，请先整理目录。');
 const names:string[]=[];for await(const entry of await opendir(join(root,path))){if(++count>maximum)throw new ConfigurationError(409,'文件及目录超过本次迁移上限，请先整理目录。');names.push(entry.name);}
 for(const name of names.sort()){
 const rel=path?path+'/'+name:name,full=join(root,rel),s=await lstat(full);if(s.isSymbolicLink()||await realpath(full)!==full)throw new ConfigurationError(409,'迁移不接受符号链接：'+full);
 if(s.isDirectory()){await options.onDirectory?.(full);await visit(rel,depth+1);}else if(s.isFile())files.push({sourceRoot:root,relativePath:rel,...await fileDigest(root,rel)});else throw new ConfigurationError(409,'迁移仅接受独立普通文件与实际目录：'+full);
 }}await visit('');return files;}
export function references(evidence:unknown){const refs:Reference[]=[],workspaces=new Map<string,string>();if(evidence&&typeof evidence==='object')for(const row of ((evidence as Record<string,unknown>)['local_identity.production_workspaces']??[]) as {id:string;episode_id:string}[])workspaces.set(row.id,row.episode_id);function visit(value:unknown,episodeId?:string){if(!value||typeof value!=='object')return;if(Array.isArray(value)){for(const x of value)visit(x,episodeId);return;}
 const row=value as Record<string,unknown>;episodeId??=typeof row.episode_id==='string'?row.episode_id:typeof row.workspace_id==='string'?workspaces.get(row.workspace_id):undefined;
 // Frozen output contracts describe promised files, not completed artifacts.
 if(Array.isArray(row.required_artifact_types)&&typeof row.content_type==='string'||Array.isArray(row.requiredArtifactTypes)&&typeof row.contentType==='string')return;
 for(const key of ['relative_path','storage_path','relativePath','project_relative_path','projectRelativePath','workspaceRelativePath','project_path']){
 const path=row[key];if(typeof path==='string'&&path){if(!safeRelative(path))throw new ConfigurationError(409,'文件引用不安全：'+path);refs.push({episodeId,relativePath:path,...(typeof (row.sha256??row.project_sha256)==='string'&&/^[a-f0-9]{64}$/.test(String(row.sha256??row.project_sha256))?{sha256:String(row.sha256??row.project_sha256)}:{}),...(row.file_size!==undefined||row.fileSize!==undefined||key==='project_path'&&row.project_size!==undefined?{fileSize:Number(row.file_size??row.fileSize??row.project_size)}:{})});}}
 if(typeof row.src==='string'&&safeRelative(row.src))refs.push({episodeId,relativePath:row.src});
 if(row.reverseSources&&typeof row.reverseSources==='object')for(const source of Object.values(row.reverseSources))if(typeof source==='string'&&safeRelative(source))refs.push({episodeId,relativePath:source});
 for(const [key,x] of Object.entries(row)){
  if(key==='input_snapshot'&&typeof row.task_type==='string'&&x&&typeof x==='object'){
   for(const [slot,entry] of Object.entries(x)){if(slot==='output')continue;if(['review_render','final_render'].includes(slot)&&entry&&typeof entry==='object')visit(Object.fromEntries(Object.entries(entry).filter(([field])=>field!=='project_relative_path')),episodeId);else visit(entry,episodeId);}
  }else visit(x,episodeId);
 }

 }visit(evidence);return refs;}
