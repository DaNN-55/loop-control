import {lstat, realpath, readdir, rmdir} from 'node:fs/promises';
import {isAbsolute, join, relative, resolve} from 'node:path';
import {mappedAssetPath} from './mediaPaths.js';

export interface EmptyAccountDirectory {
 path:string;
 aliases:string[];
 dev:string;
 ino:string;
}

async function safeDirectory(path:string){
 const stat=await lstat(path,{bigint:true});
 if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(path)!==path)throw Error('账号目录不是独立目录。');
 if(path.startsWith('/Volumes/')){
  const volume=path.split('/').slice(0,3).join('/');
  if((await lstat(volume)).dev===(await lstat('/Volumes')).dev)throw Error('外部盘未挂载。');
 }
 return{dev:String(stat.dev),ino:String(stat.ino)};
}

// Only exact blueprint roots and their registered deployment aliases are considered.
// Nonempty or inaccessible directories never become deletion candidates.
export async function planEmptyAccountDirectories(mediaRoot:string,assetRoots:unknown[],sources:readonly string[]):Promise<EmptyAccountDirectory[]>{
 const logical=new Set<string>();
 for(const value of assetRoots)try{logical.add(mappedAssetPath(mediaRoot,value,sources));}catch{/* Unmapped roots are retained. */}
 const targets=new Map<string,EmptyAccountDirectory>();
 for(const root of logical){
  const suffix=relative(mediaRoot,root);
  if(!suffix||suffix.startsWith('..')||isAbsolute(suffix))continue;
  const aliases=new Set([root]);
  for(const source of sources){
   if(source==='/'||!isAbsolute(source)||resolve(source)!==source)continue;
   const candidate=join(source,suffix);
   if(mappedAssetPath(mediaRoot,candidate,sources)===root)aliases.add(candidate);
  }
  for(const path of aliases)try{
   const identity=await safeDirectory(path);
   if((await readdir(path)).length===0)targets.set(path,{path,aliases:[...aliases],...identity});
  }catch{/* Missing, linked or inaccessible locations are retained. */}
 }
 return[...targets.values()];
}

export async function cleanupEmptyAccountDirectories(targets:readonly EmptyAccountDirectory[],isReferenced:(aliases:string[])=>Promise<boolean>){
 const results:{path:string;status:'removed'|'retained'|'missing'}[]=[];
 for(const target of targets){
  let status:'removed'|'retained'|'missing'='retained';
  try{
   const current=await safeDirectory(target.path);
   if(current.dev===target.dev&&current.ino===target.ino&&!await isReferenced(target.aliases)){
    // rmdir is deliberately nonrecursive: even a newly added hidden file keeps the directory.
    await rmdir(target.path);status='removed';
   }
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')status='missing';}
  results.push({path:target.path,status});
 }
 return results;
}
