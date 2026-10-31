import {lstat, realpath, readdir, rmdir} from 'node:fs/promises';
import {isAbsolute, join, relative, resolve} from 'node:path';
import {mappedAssetPath,assetPathWithin} from './mediaPaths.js';

export interface EmptyAccountDirectory {
 path:string;
 aliases:string[];
 dev:string;
 ino:string;
}

/** Only captured registrations can authorize empty child cleanup after FK removal. */
export async function planRegisteredEmptyAccountDirectories(root:{actual_root:string;device_id:string;inode_id:string}|undefined,containers:{directory_relative_path:string;device_id:string;inode_id:string}[]):Promise<EmptyAccountDirectory[]>{
 if(!root)return[];const targets:EmptyAccountDirectory[]=[];
 try{
  const identity=await safeDirectory(root.actual_root);if(identity.dev!==root.device_id||identity.ino!==root.inode_id)return[];
  for(const container of containers){
   const path=join(root.actual_root,container.directory_relative_path);if(!assetPathWithin(root.actual_root,path))continue;
   try{const actual=await safeDirectory(path);if(actual.dev===container.device_id&&actual.ino===container.inode_id&&(await readdir(path)).length===0)targets.push({path,aliases:[path],...actual});}catch{/* Unavailable, replaced or nonempty containers stay. */}
  }
  const removable=new Set(targets.map(target=>target.path));if((await readdir(root.actual_root)).every(name=>removable.has(join(root.actual_root,name))))targets.push({path:root.actual_root,aliases:[root.actual_root],...identity});
 }catch{/* Unavailable or replaced roots remain. */}
 return targets.sort((a,b)=>b.path.split('/').length-a.path.split('/').length);
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

// Deployment aliases participate in reference checks, never in filesystem deletion.
// Nonempty or inaccessible directories never become deletion candidates.
export async function planEmptyAccountDirectories(mediaRoot:string,assetRoots:unknown[],sources:readonly string[]):Promise<EmptyAccountDirectory[]>{
 const logical=new Set<string>();
 for(const value of assetRoots)try{logical.add(mappedAssetPath(mediaRoot,value,sources));}catch{/* Unmapped roots are retained. */}
 const targets=new Map<string,EmptyAccountDirectory>();
 for(const root of logical){
  const suffix=relative(mediaRoot,root);
  if(!assetPathWithin(mediaRoot,root))continue;
  const aliases=new Set([root]);
  for(const source of sources){
   if(source==='/'||!isAbsolute(source)||resolve(source)!==source)continue;
   const candidate=join(source,suffix);
   if(mappedAssetPath(mediaRoot,candidate,sources)===root)aliases.add(candidate);
  }
  const path=root;try{
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
