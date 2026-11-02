import {createHash} from 'node:crypto';
import {readFile,lstat,realpath,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {safeAssetOutputPath} from './controlledMediaExecutor.js';
import type {EpisodeFileIO} from '../local-app/episodeFiles.js';
import {openChatCutBundledSounds,bundledSoundRuntimeSource,bundledSoundMaterialName} from '../openchatcutBundledSounds.js';

export async function readTrustedBundledSound(sdkRoot:string,id:string){
 const sound=openChatCutBundledSounds[id];if(!sound)throw Error('未登记的内置音效。');
 return readSoundFile(join(sdkRoot,'assets/sound-effects',id+'.mp3'),sound);
}
async function readSoundFile(path:string,sound:{sha256:string;fileSize:number}){
 const stat=await lstat(path);
 if(!stat.isFile()||stat.nlink!==1||await realpath(path)!==path||stat.size!==sound.fileSize)throw Error('内置音效文件身份已变化。');
 const bytes=await readFile(path);if(createHash('sha256').update(bytes).digest('hex')!==sound.sha256)throw Error('内置音效文件指纹已变化。');return bytes;
}

/** Only a rebuildable runtime cache is prepared here; material registration is lazy on actual use. */
export async function cacheBundledStudioSounds(root:string,prefix:string,dataDir:string,sdkRoot:string,reverseSources:Map<string,string>,storage?:EpisodeFileIO){
 await storage?.assertValid();
 for(const[id,sound]of Object.entries(openChatCutBundledSounds)){
  const runtimeSource=bundledSoundRuntimeSource(sound.sha256),current=`${prefix}/materials/${sound.sha256}-${bundledSoundMaterialName(id)}`;
  let original=reverseSources.get(runtimeSource)??current;
  let bytes:Buffer;
  const registered=storage?await storage.resolveReference(original):join(root,original);
  try{bytes=await readSoundFile(registered,sound);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;original=current;bytes=await readTrustedBundledSound(sdkRoot,id);}
  const destination=await safeAssetOutputPath(root,relative(root,join(dataDir,runtimeSource.slice(1))));
  try{await readSoundFile(destination,sound);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await writeFile(destination,bytes,{flag:'wx',mode:0o600});}
  reverseSources.set(runtimeSource,original);
 }
 await storage?.assertValid();
}
