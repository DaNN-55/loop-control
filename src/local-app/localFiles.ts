import{mappedAssetPath}from'./mediaPaths.js';
import {mkdir,realpath,lstat,readFile,open,link,unlink} from 'node:fs/promises';
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
 // Existing immutable content is checked before an idempotent write.
 try{await lstat(join(root,storagePath));await verifyNativeFile(root,storagePath,sha256,bytes.length);}catch(e){
  if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
  // Publish complete immutable bytes atomically; interruption never exposes a partial snapshot.
  const destination=await safeAssetOutputPath(root,storagePath),temporary=join(dirname(destination),'.input-'+randomUUID());
  try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
   try{await link(temporary,destination);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  }finally{await unlink(temporary).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});}
  await verifyNativeFile(root,storagePath,sha256,bytes.length);
 }
 return {sourcePath,storagePath,sha256,fileSize:bytes.length};
}
