import {constants} from 'node:fs';
import {copyFile,lstat,realpath,rm,link} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {basename,extname,join} from 'node:path';
import {safeAssetOutputPath} from './controlledMediaExecutor.js';
import {fileSha256} from './fileSha256.js';

export interface NativeStudioImport {
 url:string;relativePath:string;sha256:string;fileSize:number;
 kind:'image'|'video'|'audio';displayName:string;mimeType:string;
}
const formats:Record<string,[NativeStudioImport['kind'],string]>={
 '.png':['image','image/png'],'.jpg':['image','image/jpeg'],'.jpeg':['image','image/jpeg'],'.webp':['image','image/webp'],'.gif':['image','image/gif'],'.bmp':['image','image/bmp'],'.avif':['image','image/avif'],'.svg':['image','image/svg+xml'],
 '.mp4':['video','video/mp4'],'.mov':['video','video/quicktime'],'.webm':['video','video/webm'],'.mkv':['video','video/x-matroska'],'.m4v':['video','video/x-m4v'],
 '.mp3':['audio','audio/mpeg'],'.wav':['audio','audio/wav'],'.m4a':['audio','audio/mp4'],'.aac':['audio','audio/aac'],'.ogg':['audio','audio/ogg'],'.flac':['audio','audio/flac'],'.aiff':['audio','audio/aiff'],
};
async function safeFile(path:string){
 const stat=await lstat(path);
 if(!stat.isFile()||stat.nlink!==1||await realpath(path)!==path)throw Error('原生导入来源不是安全普通文件。');
 return stat;
}
function uploadName(url:string){
 const raw=url.slice('/media/uploads/'.length);let name:string;
 try{name=decodeURIComponent(raw);}catch{throw Error('原生素材路径无效。');}
 if(!name||name==='.'||name==='..'||/[\\/\x00-\x1f?#]/.test(name))throw Error('原生素材路径超出本期上传目录。');
 return name;
}
/** Keep import interaction inside the SDK. Only a saved owned document promotes
 * actual upload bytes to durable episode materials; the SDK URLs stay untouched. */
export async function archiveNativeStudioImports({assetRoot,episodeRelativePath,dataDir,project,knownSources,imports=[]}:{
 assetRoot:string;episodeRelativePath:string;dataDir:string;project:unknown;
 knownSources:Map<string,string>;imports?:NativeStudioImport[];
}){
 const sources=new Map(knownSources),records=[...imports],urls=new Map<string,string>();
 function scan(value:unknown){
  if(Array.isArray(value)){value.forEach(scan);return;}
  if(!value||typeof value!=='object')return;
  const object=value as Record<string,unknown>;
  for(const[key,child]of Object.entries(object)){
   if(key==='src'&&typeof child==='string'&&child.startsWith('/media/uploads/')){if(!urls.has(child)||typeof object.name==='string')urls.set(child,typeof object.name==='string'?object.name:basename(child));}
   else scan(child);
  }
 }
 scan(project);
 for(const[url,displayName]of urls){
  const previous=[...records].reverse().find(record=>record.url===url);
  // Existing host-provided materials retain their original registered identity.
  if(sources.has(url)&&!previous)continue;
  const name=uploadName(url),extension=extname(name).toLowerCase(),format=formats[extension];
  if(!format)throw Error(`原生素材格式暂不能归档：${extension||'无扩展名'}。当前工程仍保留。`);
  const source=await safeAssetOutputPath(assetRoot,`${episodeRelativePath}/openchatcut-work/current/runtime/media/uploads/${name}`);
  if(source!==join(dataDir,'media/uploads',name))throw Error('原生素材目录身份已变化。');
  let identity;
  try{identity=await safeFile(source);}catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT'||!previous)throw error;
   if(!/^[a-f0-9]{64}$/.test(previous.sha256)||previous.relativePath!==`${episodeRelativePath}/materials/${previous.sha256}-native${extension}`)throw Error('原生素材归档回执无效。');
   const archived=await safeAssetOutputPath(assetRoot,previous.relativePath),saved=await safeFile(archived);
   if(saved.size!==previous.fileSize||await fileSha256(archived)!==previous.sha256)throw Error('原生素材归档指纹已变化。');
   await copyFile(archived,source,constants.COPYFILE_EXCL);identity=await safeFile(source);
  }
  const sha256=await fileSha256(source);
  if(!identity.size)throw Error('原生素材尚未上传完成，请稍后保存。');
  const relativePath=`${episodeRelativePath}/materials/${sha256}-native${extension}`;
  const target=await safeAssetOutputPath(assetRoot,relativePath);
  let exists=false;try{const stat=await safeFile(target);if(stat.size!==identity.size||await fileSha256(target)!==sha256)throw Error('原生素材归档指纹已变化。');exists=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(!exists){
   const temporary=target+'.'+randomUUID()+'.part';
   try{
    await copyFile(source,temporary,constants.COPYFILE_EXCL);
    if(await fileSha256(temporary)!==sha256||await fileSha256(source)!==sha256)throw Error('原生素材在归档时发生变化，请重新保存。');
    const after=await safeFile(source);if(after.dev!==identity.dev||after.ino!==identity.ino||after.size!==identity.size)throw Error('原生素材在归档时已被替换。');
    try{await link(temporary,target);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const existing=await lstat(target);if(!existing.isFile()||existing.nlink!==1||await fileSha256(target)!==sha256)throw Error('原生素材归档目标已变化。');}
   }finally{await rm(temporary,{force:true});}
  }
  sources.set(url,relativePath);
  if(!previous||previous.sha256!==sha256)records.push({url,relativePath,sha256,fileSize:identity.size,kind:format[0],mimeType:format[1],displayName:displayName.slice(0,255)});
 }
 return{sources,imports:records};
}
