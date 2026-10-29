import {lstat, realpath, readdir, readlink} from 'node:fs/promises';
import {isAbsolute, join, relative, resolve} from 'node:path';
import {mappedAssetPath} from './mediaPaths.js';

interface Identity {dev:string;ino:string}
export interface EpisodeDeletionTarget {
 root:string;path:string;stagingPath:string;rootIdentity:Identity;identity:Identity|null;
}
const identity=(stat:{dev:bigint;ino:bigint}):Identity=>({dev:String(stat.dev),ino:String(stat.ino)});
const same=(a:Identity,b:Identity)=>a.dev===b.dev&&a.ino===b.ino;
async function directory(path:string){
 try{
  const stat=await lstat(path,{bigint:true});
  if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(path)!==path)throw Error('目录不是独立的安全目录：'+path);
  return identity(stat);
 }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
async function volumeAvailable(path:string){
 if(path.startsWith('/Volumes/')){
  const volume=path.split('/').slice(0,3).join('/');
  const mounted=await directory(volume),parent=await directory('/Volumes');
  if(!mounted||mounted.dev===parent?.dev)throw Error('外部盘不可访问，请挂载后重新检查：'+volume);
 }
}
// Only deployment aliases of this exact account and Episode are candidates. Never scan a disk.
export async function episodeDeletionTargets(mediaRoot:string,root:string,episodeId:string,sources:readonly string[]):Promise<EpisodeDeletionTarget[]>{
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(episodeId))throw Error('生产单标识无效。');
 const suffix=relative(mediaRoot,root);
 if(!suffix||suffix.startsWith('..')||isAbsolute(suffix))throw Error('删除目录超出媒体部署范围。');
 const roots=new Set([root]);
 for(const source of sources){
  if(source==='/'||!isAbsolute(source)||resolve(source)!==source)continue;
  const candidate=join(source,suffix);
  if(mappedAssetPath(mediaRoot,candidate,sources)!==root)continue;
  await volumeAvailable(candidate);
  roots.add(candidate);
 }
 const targets:EpisodeDeletionTarget[]=[];
 for(const candidate of [root,...[...roots].filter(value=>value!==root).sort()]){
  const rootIdentity=await directory(candidate);
  if(!rootIdentity){if(candidate===root)throw Error('当前账号资产目录不可访问。');continue;}
  const episodes=join(candidate,'episodes'),path=join(episodes,episodeId),stagingRoot=join(episodes,'.deletion-staging'),stagingPath=join(stagingRoot,episodeId);
  const parent=await directory(episodes),existing=parent?await directory(path):null;
  if(parent&&await directory(stagingRoot)&&await directory(stagingPath))throw Error('生产单存在未完成的删除暂存，请先恢复或重试原操作：'+stagingPath);
  let matchingTitle=false;
  if(candidate!==root&&!existing&&parent){
   const navigation=join(episodes,'按标题浏览');
   if(await directory(navigation))for(const name of await readdir(navigation)){
    const link=join(navigation,name),stat=await lstat(link);
    if(stat.isSymbolicLink()&&resolve(navigation,await readlink(link))===path){matchingTitle=true;break;}
   }
  }
  if(candidate===root||existing||matchingTitle)targets.push({root:candidate,path,stagingPath,rootIdentity,identity:existing});
 }
 return targets;
}
// Recheck device/inode and every parent immediately before moving or removing a directory.
export async function verifyEpisodeDeletionTarget(target:EpisodeDeletionTarget,phase:'original'|'staged'){
 await volumeAvailable(target.root);
 const currentRoot=await directory(target.root);
 if(!currentRoot||!same(currentRoot,target.rootIdentity))throw Error('删除目录所在位置已变化：'+target.root);
 const episodes=await directory(join(target.root,'episodes'));
 if(!episodes){if(phase==='original'&&target.identity)throw Error('生产单目录已变化。');return;}
 if(phase==='staged'&&!await directory(join(target.root,'episodes','.deletion-staging')))return;
 const current=await directory(phase==='original'?target.path:target.stagingPath);
 if(phase==='staged'&&!current)return; // An earlier cleanup attempt already removed this target.
 if(current&&(!target.identity||!same(current,target.identity))||!current&&target.identity)throw Error('生产单目录已变化，请重新检查：'+target.path);
}
