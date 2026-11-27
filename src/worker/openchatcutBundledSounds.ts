import {createHash,randomUUID} from 'node:crypto';
import {readFile,lstat,realpath,rename,unlink,writeFile} from 'node:fs/promises';
import {basename,join,relative} from 'node:path';
import {safeAssetOutputPath} from './controlledMediaExecutor.js';
import type {EpisodeFileIO} from '../local-app/episodeFiles.js';
import {openChatCutBundledSounds,bundledSoundRuntimeSource,bundledSoundMaterialName} from '../openchatcutBundledSounds.js';

export async function readTrustedBundledSound(sdkRoot:string,id:string){
 if(!Object.hasOwn(openChatCutBundledSounds,id))throw Error('未登记的内置音效。');
 return readSoundFile(await sdkSoundPath(sdkRoot,id),openChatCutBundledSounds[id]);
}
const sdkSoundPath=async(sdkRoot:string,id:string)=>join(await realpath(sdkRoot),'assets/sound-effects',id+'.mp3');
const bundledSounds=Object.entries(openChatCutBundledSounds);
const materialSuffix=(id:string,sha256:string)=>`/materials/${sha256}-${bundledSoundMaterialName(id)}`;

/** Resolve shared bytes for a private viewing copy that has not yet adopted the sound. */
export async function resolvePrivateBundledSound(sdkRoot:string,prefix:string,reference:string){
 const entry=bundledSounds.find(([id,sound])=>reference===bundledSoundRuntimeSource(sound.sha256)||reference===prefix+materialSuffix(id,sound.sha256));
 if(!entry)return null;
 const [id,sound]=entry,path=await sdkSoundPath(sdkRoot,id);
 await readSoundFile(path,sound);return path;
}
async function readSoundFile(path:string,sound:{sha256:string;fileSize:number}){
 const stat=await lstat(path);
 if(!stat.isFile()||stat.nlink!==1||await realpath(path)!==path||stat.size!==sound.fileSize)throw Error('内置音效文件身份已变化。');
 const bytes=await readFile(path);if(createHash('sha256').update(bytes).digest('hex')!==sound.sha256)throw Error('内置音效文件指纹已变化。');return bytes;
}

const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';

/** Prefer SDK-native media references; its read, waveform and render paths all resolve
 * the same upload URL. Adopted sounds still get their own immutable Episode material. */
export async function prepareBundledStudioSounds(root:string,prefix:string,dataDir:string,sdkRoot:string,reverseSources:Map<string,string>,storage?:EpisodeFileIO){
 const sdk=await realpath(sdkRoot);
 // An older SDK without the reference resolver needs the original copy strategy.
 const referenceSupport=await readFile(join(sdk,'server/media-dir.ts'),'utf8').then(code=>code.includes('resolveMediaReference(d, name)')).catch(error=>{if(missing(error))return false;throw error;});
 await storage?.assertValid();
 for(const[id,sound]of bundledSounds){
  const runtimeSource=bundledSoundRuntimeSource(sound.sha256),suffix=materialSuffix(id,sound.sha256),current=prefix+suffix;
  let original=reverseSources.get(runtimeSource)??current;
  if(!original.endsWith(suffix))throw Error('内置音效归档路径无效。');
  let source=storage?await storage.resolveReference(original):await safeAssetOutputPath(root,original),bytes:Buffer;
  try{bytes=await readSoundFile(source,sound);}catch(error){if(!missing(error))throw error;original=current;source=await sdkSoundPath(sdk,id);bytes=await readSoundFile(source,sound);}
  const destination=await safeAssetOutputPath(root,relative(root,join(dataDir,runtimeSource.slice(1))));
  // Legacy MP3s are not deleted. The SDK prefers them over reference records.
  try{await readSoundFile(destination,sound);}catch(error){
   if(!missing(error))throw error;
   if(referenceSupport){
    const manifest=await safeAssetOutputPath(root,relative(root,join(dataDir,'media/uploads/.references',basename(runtimeSource)+'.json')));
    let unchanged=false;
    try{const stat=await lstat(manifest);if(!stat.isFile()||stat.nlink!==1||stat.size>8192)throw Error('内置音效引用不是安全普通文件。');const value=JSON.parse(await readFile(manifest,'utf8'));unchanged=value.version===1&&value.sourcePath===source;}
    catch(error){if(!missing(error))throw error;}
    if(!unchanged){
     const temporary=manifest+'.'+randomUUID()+'.tmp';
     await writeFile(temporary,JSON.stringify({version:1,sourcePath:source,createdAt:new Date().toISOString()})+'\n',{flag:'wx',mode:0o600});
     try{await rename(temporary,manifest);}finally{await unlink(temporary).catch(error=>{if(!missing(error))throw error;});}
    }
   }else await writeFile(destination,bytes,{flag:'wx',mode:0o600});
  }
  reverseSources.set(runtimeSource,original);
 }
 await storage?.assertValid();
}
