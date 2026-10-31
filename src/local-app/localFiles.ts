import{mappedAssetPath}from'./mediaPaths.js';
import {mkdir,realpath,lstat,readFile,open,link,unlink,readdir} from 'node:fs/promises';
import {resolve,isAbsolute,join,basename,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {safeAssetOutputPath} from '../worker/controlledMediaExecutor.js';
import {ConfigurationError} from './configurationCommands.js';
import {mainScriptDiagnostic} from '../reviews/mainScript.js';
const uuid=/^[0-9a-f-]{36}$/;
export function safeRelative(path:string){return !!path&&!path.includes('\0')&&!isAbsolute(path)&&!path.split(/[\\/]/).some(p=>!p||p==='.'||p==='..');}
export async function nativeAssetRoot(mediaRoot:string,value:unknown,sourceRoots:readonly string[]=[]){
 let path:string;try{path=mappedAssetPath(mediaRoot,value,sourceRoots);}catch{throw new ConfigurationError(400,'资产目录超出本机授权范围。');}
 if(await realpath(path).catch(()=>null)!==path)throw new ConfigurationError(400,'资产目录不可用。');
 const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw new ConfigurationError(400,'资产目录不可用。');return path;
}
export async function ensureInputDirectories(root:string,episodeId:string,directoryRelativePath=`episodes/${episodeId}`){
 if(!uuid.test(episodeId))throw new ConfigurationError(400,'Episode ID无效。');
 if(!safeRelative(directoryRelativePath))throw new ConfigurationError(400,'生产单目录无效。');
 const parts=directoryRelativePath.split('/');
 for(const path of [...parts.map((_,i)=>parts.slice(0,i+1).join('/')),`${directoryRelativePath}/input`,`${directoryRelativePath}/materials`]){
  const full=join(root,path);await mkdir(full,{mode:0o700}).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='EEXIST')throw e;});
  const s=await lstat(full);if(!s.isDirectory()||s.isSymbolicLink()||await realpath(full)!==full)throw new ConfigurationError(409,'输入目录不是安全目录。');
 }
}
export async function verifyNativeFile(root:string,path:string,sha256:string,size:number){
 if(!safeRelative(path))throw new ConfigurationError(400,'文件路径无效。');
 const full=resolve(root,path),s=await lstat(full);
 if(await realpath(full)!==full||!s.isFile()||s.nlink!==1||s.size!==size)throw new ConfigurationError(409,'文件路径或大小已变化。');
 const bytes=await readFile(full);if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw new ConfigurationError(409,'文件指纹已变化。');return bytes;
}
export async function snapshotInput(root:string,episodeId:string,input:{sourceKind:string;sourcePath:string;logicalName?:string;contentBase64?:string;isMainScript?:boolean},directoryRelativePath=`episodes/${episodeId}`){
 if(!safeRelative(input.sourcePath)||input.logicalName&&!safeRelative(input.logicalName))throw new ConfigurationError(400,'材料路径无效。');
 await ensureInputDirectories(root,episodeId,directoryRelativePath);
 let bytes:Buffer;
 if(input.sourceKind==='directory'){
  const path=join(root,directoryRelativePath,'input',input.sourcePath);
  try{const s=await lstat(path);if(await realpath(path)!==path||!s.isFile()||s.nlink!==1)throw new ConfigurationError(400,'输入文件不是安全普通文件。');bytes=await readFile(path);}
  catch(error){if(error instanceof ConfigurationError)throw error;const code=(error as NodeJS.ErrnoException).code;if(code==='ENOENT')throw new ConfigurationError(409,'输入文件尚未就绪或已移走，请完成复制后重试。');if(code==='EACCES'||code==='EPERM')throw new ConfigurationError(403,'没有读取输入文件的权限。');throw error;}
 }else{
  if(!['file','paste'].includes(input.sourceKind)||typeof input.contentBase64!=='string')throw new ConfigurationError(400,'材料内容无效。');
  bytes=Buffer.from(input.contentBase64,'base64');
  if(bytes.toString('base64')!==input.contentBase64)throw new ConfigurationError(400,'材料内容无效。');
 }
 if(!bytes.length||bytes.length>100*1024*1024)throw new ConfigurationError(400,'材料不能为空或超过100MB。');
 if(input.isMainScript){const diagnostic=mainScriptDiagnostic(bytes.toString('utf8'));if(diagnostic)throw new ConfigurationError(400,diagnostic);}
 const sha256=createHash('sha256').update(bytes).digest('hex'),sourcePath=input.logicalName??input.sourcePath,storagePath=`${directoryRelativePath}/materials/${sha256}-${basename(sourcePath)}`;
 // Recover only our receipted publication; unknown or corrupt targets stay untouched.
 await recoverInputPublication(root,storagePath,sha256,bytes.length);
 try{await lstat(join(root,storagePath));await verifyNativeFile(root,storagePath,sha256,bytes.length);}catch(e){
  if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
  try{await publishInputSnapshot(root,storagePath,bytes,sha256);}catch(error){const code=(error as NodeJS.ErrnoException).code;if(code==='EACCES'||code==='EPERM')throw new ConfigurationError(403,'没有写入输入快照的权限，请恢复权限后重试。');if(code==='ENOSPC'||code==='EIO')throw new ConfigurationError(409,'输入快照未完成，请检查存储空间与挂载后重试。');throw error;}
  await verifyNativeFile(root,storagePath,sha256,bytes.length);
 }
 return {sourcePath,storagePath,sha256,fileSize:bytes.length};
}

async function publishInputSnapshot(root:string,path:string,bytes:Buffer,sha256:string){
 const destination=await safeAssetOutputPath(root,path),token=randomUUID(),temporary=join(dirname(destination),`.input-${token}.part`),receipt=join(dirname(destination),`.input-${token}.receipt.json`);let receipted=false;
 try{
  const file=await open(temporary,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  const stat=await lstat(temporary,{bigint:true}),record=await open(receipt,'wx',0o600);try{await record.writeFile(JSON.stringify({version:1,target:basename(path),sha256,size:bytes.length,device:String(stat.dev),inode:String(stat.ino)}));await record.sync();receipted=true;}finally{await record.close();}
  try{await link(temporary,destination);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;await verifyNativeFile(root,path,sha256,bytes.length);}
 }finally{
  // If unlink fails the durable receipt remains, so restart can safely finish it.
  await unlink(temporary).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});
  if(receipted)await unlink(receipt);
 }
}
async function recoverInputPublication(root:string,path:string,sha256:string,size:number){
 const directory=dirname(join(root,path));
 for(const name of await readdir(directory)){
  const match=/^\.input-([0-9a-f-]{36})\.receipt\.json$/.exec(name);if(!match)continue;
  const receipt=join(directory,name),temporary=join(directory,`.input-${match[1]}.part`),target=join(root,path);
  const r=await lstat(receipt);if(!r.isFile()||r.isSymbolicLink()||r.nlink!==1||r.size>4096||await realpath(receipt)!==receipt)continue;
  let record;try{record=JSON.parse(await readFile(receipt,'utf8'));}catch{continue;}
  if(!record||typeof record!=='object'||record.version!==1||record.target!==basename(path)||record.sha256!==sha256||record.size!==size)continue;
  const temp=await lstat(temporary,{bigint:true}).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
  if(!temp){await verifyNativeFile(root,path,sha256,size);await unlink(receipt);continue;}
  if(!temp.isFile()||temp.isSymbolicLink()||await realpath(temporary)!==temporary||String(temp.dev)!==record.device||String(temp.ino)!==record.inode||Number(temp.size)!==size||createHash('sha256').update(await readFile(temporary)).digest('hex')!==sha256)throw new ConfigurationError(409,'输入发布记录或临时文件已变化，请检查恢复记录。');
  let final=await lstat(target,{bigint:true}).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
  if(!final){if(temp.nlink!==1n)throw new ConfigurationError(409,'输入发布临时文件链接已变化。');try{await link(temporary,target);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}final=await lstat(target,{bigint:true});}
  if(final.dev===temp.dev&&final.ino===temp.ino){if(temp.nlink>2n||final.nlink!==2n||await realpath(target)!==target)throw new ConfigurationError(409,'输入发布目标链接已变化。');}
  else{if(temp.nlink!==1n)throw new ConfigurationError(409,'输入发布临时文件链接已变化。');await verifyNativeFile(root,path,sha256,size);}
  await unlink(temporary);await unlink(receipt);
 }
}
