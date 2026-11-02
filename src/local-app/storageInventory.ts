import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,opendir,realpath,open,mkdir,link,unlink} from 'node:fs/promises';
import {join,relative} from 'node:path';
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
  // These named protocol fields contain creative JSON, whose extension keys
  // are not file contracts. Keep scanning the context's actual input evidence.
  if(row.version==='prompt-context/v1'&&['account_hard_constraints','account_defaults','series_baseline'].includes(key))continue;
  if(typeof row.accountId==='string'&&typeof row.blueprintVersionId==='string'&&['accountRules','seriesRules'].includes(key))continue;
  if(key==='input_snapshot'&&typeof row.task_type==='string'&&x&&typeof x==='object'){
   for(const [slot,entry] of Object.entries(x)){if(slot==='output')continue;if(['review_render','final_render'].includes(slot)&&entry&&typeof entry==='object')visit(Object.fromEntries(Object.entries(entry).filter(([field])=>field!=='project_relative_path')),episodeId);else visit(entry,episodeId);}
  }else visit(x,episodeId);
 }

 }visit(evidence);return refs;}

interface StorageCopyJournal {
 pending():readonly Root[];
 record(temporary:Root):Promise<void>;
}

/** Both migration ledgers keep their own lifecycle; filesystem recovery and publication share one protocol. */
export function storageCopySession(root:Root,id:string,journal:StorageCopyJournal,errors:{identity:string;link:string}){
 return {
  async recover(){
   for(const temporary of journal.pending()){
    try{
     const actual=await lstat(temporary.path,{bigint:true});
     if(!actual.isFile()||actual.isSymbolicLink()||String(actual.dev)!==temporary.device||String(actual.ino)!==temporary.inode||await realpath(temporary.path)!==temporary.path)throw new ConfigurationError(409,errors.identity);
     if(actual.nlink!==1n){
      const destination=temporary.path.slice(0,-('.migration-'+id).length),published=await lstat(destination,{bigint:true});
      if(actual.nlink!==2n||published.dev!==actual.dev||published.ino!==actual.ino)throw new ConfigurationError(409,errors.link);
     }
     await unlink(temporary.path);
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   }
  },
  copy(file:File,signal?:AbortSignal,onProgress?:(bytes:number)=>Promise<void>){
   // The copy awaits this journal's durable identity before its first write.
   return copyStorageFile(root,file,id,signal,temporary=>journal.record(temporary),onProgress);
  },
 };
}

async function assertCopyRoot(root:Root){if(fingerprint(await identity(root.path))!==fingerprint(root))throw new ConfigurationError(409,'复制目标挂载或目录身份已变化，请恢复原位置。');}
async function safeParents(root:Root,path:string){let parent=root.path;for(const part of path.split('/').slice(0,-1)){await assertCopyRoot(root);parent=join(parent,part);await mkdir(parent,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});if((await identity(parent)).device!==root.device)throw new ConfigurationError(409,'复制目标父目录所在位置已变化。');await assertCopyRoot(root);}}
export async function copyStorageFile(root:Root,f:File,id:string,signal?:AbortSignal,onTemporary?:(value:{path:string;device:string;inode:string})=>Promise<void>,onProgress?:(bytes:number)=>Promise<void>){const outputPath=f.targetRelativePath??f.relativePath;await assertCopyRoot(root);await safeParents(root,outputPath);const dest=join(root.path,outputPath);
 try{const existing=await fileDigest(root.path,outputPath);if(existing.sha256!==f.sha256||existing.fileSize!==f.fileSize)throw new ConfigurationError(409,'目标已有冲突文件，原件已保留：'+outputPath);await assertCopyRoot(root);return;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const temp=dest+'.migration-'+id;if(await realpath(join(f.sourceRoot,f.relativePath))!==join(f.sourceRoot,f.relativePath))throw new ConfigurationError(409,'复制源路径已变化。');const input=await open(join(f.sourceRoot,f.relativePath),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let output:Awaited<ReturnType<typeof open>>;try{await assertCopyRoot(root);output=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}catch(error){await input.close();throw error;}
 try{const own=await output.stat({bigint:true});try{await assertCopyRoot(root);if(String(own.dev)!==root.device||await realpath(temp)!==temp)throw new ConfigurationError(409,'复制目标路径已变化。');}catch(error){const actual=await lstat(temp,{bigint:true}).catch(()=>undefined);if(actual?.dev===own.dev&&actual.ino===own.ino)await unlink(temp);throw error;}
 await onTemporary?.({path:temp,device:String(own.dev),inode:String(own.ino)});await assertCopyRoot(root);const stat=await input.stat();if(!stat.isFile()||stat.nlink!==1)throw new ConfigurationError(409,'复制源不是独立普通文件。');let copiedBytes=0,reportedBytes=0;for await(const chunk of input.createReadStream({autoClose:false,highWaterMark:256*1024})){if(signal?.aborted)throw new ConfigurationError(409,'复制已中断，可恢复迁移；原位置仍有效。');const bytes=chunk as Buffer;let offset=0;while(offset<bytes.length){const written=await output.write(bytes,offset,bytes.length-offset);offset+=written.bytesWritten;}copiedBytes+=bytes.length;if(onProgress&&(!reportedBytes||copiedBytes-reportedBytes>=4*1024*1024)){await onProgress(copiedBytes);reportedBytes=copiedBytes;}}await output.sync();}finally{try{await input.close();}finally{await output.close();}}
 await assertCopyRoot(root);const copied=await fileDigest(root.path,relative(root.path,temp));if(copied.sha256!==f.sha256||copied.fileSize!==f.fileSize)throw new ConfigurationError(409,'复制文件指纹不一致：'+f.relativePath);
 // Exclusive publication never replaces a file created after the collision check.
 // The receipt also recovers a crash between linking and removing this temp name.
 try{await lstat(dest);throw new ConfigurationError(409,'复制目标被其他操作占用：'+f.relativePath);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 await assertCopyRoot(root);await link(temp,dest);await unlink(temp);
}
