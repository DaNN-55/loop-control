import {createHash,randomUUID} from 'node:crypto';
import {mkdir,lstat,readdir,readFile,writeFile,rm,utimes,open,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildTransitionRenderBundle} from './openchatcut-transition-bundle.mjs';
import {nativeWorkspaceModuleFiles} from './openchatcut-host-modules.mjs';

const sourceDirectory=fileURLToPath(new URL('../',import.meta.url));
const versionName=/^[a-f0-9]{64}$/;
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
async function privateDirectory(path){
 await mkdir(path,{recursive:true,mode:0o700});
 const stat=await lstat(path);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid())throw Error('Unsafe Studio program cache directory');
}
async function fileNames(directory,prefix=''){
 const entries=(await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
 const result=[];
 for(const entry of entries){
  const relative=join(prefix,entry.name);
  if(entry.isSymbolicLink())throw Error('Studio cache source/output contains a symbolic link');
  if(entry.isDirectory())result.push(...await fileNames(join(directory,entry.name),relative));
  else if(entry.isFile())result.push(relative);
 }
 return result;
}
async function files(directory){
 const names=await fileNames(directory),result=[];
 // Bounded reads reduce startup I/O round trips without exhausting file handles.
 for(let index=0;index<names.length;index+=16){
  result.push(...await Promise.all(names.slice(index,index+16).map(async name=>[name,await readFile(join(directory,name))])));
 }
 return result;
}
async function optionalFiles(directory){try{return await files(directory);}catch(e){if(e.code==='ENOENT')return[];throw e;}}
async function fingerprint(sdkRoot,sourceRoot){
 const hash=createHash('sha256');
 hash.update('loop-studio-program-v1\0'+process.version+'\0'+process.platform+'\0'+process.arch+'\0'+await realpath(sdkRoot)+'\0'+await realpath(sourceRoot));
 const add=(name,data)=>hash.update(name+'\0'+data.length+'\0').update(data);
 for(const directory of ['src','remotion','assets','config'])for(const [name,data]of await files(join(sdkRoot,directory)))add('sdk/'+directory+'/'+name,data);
 for(const name of ['package.json','pnpm-lock.yaml','package-lock.json','yarn.lock','tsconfig.json','tsconfig.app.json','tsconfig.node.json']){
  try{add('sdk/'+name,await readFile(join(sdkRoot,name)));}catch(e){if(e.code!=='ENOENT'||name==='package.json')throw e;}
 }
 for(const[name,data]of await optionalFiles(join(sourceRoot,'scripts')))if(/^openchatcut-/.test(name)&&!name.endsWith('.test.mjs'))add('host/scripts/'+name,data);
 for(const name of nativeWorkspaceModuleFiles.filter(name=>name.startsWith('src/'))){
  try{add('host/'+name,await readFile(join(sourceRoot,name)));}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 // Installed versions may differ from the lockfile after a partial SDK update.
 for(const name of ['vite','@remotion/bundler','remotion']){
  try{add('installed/'+name,await readFile(join(sdkRoot,'node_modules',name,'package.json')));}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 return hash.digest('hex');
}
async function lock(path,{wait=true}={}){
 const token=randomUUID(),started=Date.now();
 for(;;){
  try{await writeFile(path,JSON.stringify({pid:process.pid,token}),{flag:'wx',mode:0o600});return async()=>{const current=JSON.parse(await readFile(path,'utf8'));if(current.token===token)await rm(path);};}
  catch(e){if(e.code!=='EEXIST')throw e;}
  // Serialize stale-owner recovery too: two recoverers must never unlink a
  // new lock that the first recoverer has just allowed another process to take.
  let recovery;
  try{
   recovery=await open(path+'.recovery','wx',0o600);
   const owner=JSON.parse(await readFile(path,'utf8'));
   if(Number.isInteger(owner.pid)&&owner.pid>0&&!alive(owner.pid)){await rm(path);continue;}
  }catch(e){if(e.code==='ENOENT')continue;/* Live/incomplete locks are never stolen. */}
  finally{if(recovery){await recovery.close();await rm(path+'.recovery',{force:true});}}
  if(!wait)return null;
  if(Date.now()-started>5000)throw Error('Studio program cache busy');
  await new Promise(resolve=>setTimeout(resolve,100));
 }
}
async function active(directory){
 for(const name of await readdir(directory)){
  if(!name.startsWith('.lease-'))continue;
  const path=join(directory,name);
  try{const {pid}=JSON.parse(await readFile(path,'utf8'));if(!Number.isInteger(pid)||pid<1||alive(pid))return true;await rm(path);}
  catch(e){if(e.code!=='ENOENT')return true;}
 }
 return false;
}
async function outputManifest(bundle){return Object.fromEntries((await files(bundle)).map(([name,bytes])=>[name,createHash('sha256').update(bytes).digest('hex')]));}
async function valid(directory){
 try{const expected=JSON.parse(await readFile(join(directory,'render-manifest.json'),'utf8')),actual=await outputManifest(join(directory,'render'));return !!actual['index.html']&&JSON.stringify(expected)===JSON.stringify(actual);}
 catch{return false;}
}
/** Cache only immutable compiler output. A lease protects every live renderer. */
export async function prepareStudioProgram({sdkRoot,cacheRoot,sourceRoot=sourceDirectory,build=buildTransitionRenderBundle}){
 await privateDirectory(cacheRoot);
 const unlock=await lock(join(cacheRoot,'.maintenance'));
 try{
  const key=await fingerprint(sdkRoot,sourceRoot),directory=join(cacheRoot,key),bundle=join(directory,'render');
  let cacheHit=false;
  try{const stat=await lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Unsafe Studio program version');cacheHit=await valid(directory);if(!cacheHit&&await active(directory))throw Error('Active Studio program cache is damaged');if(!cacheHit)await rm(directory,{recursive:true});}
  catch(e){if(e.code!=='ENOENT')throw e;}
  if(!cacheHit){
   await privateDirectory(directory);
   try{
    await build(sdkRoot,bundle);
    if(await fingerprint(sdkRoot,sourceRoot)!==key)throw Error('Studio program source changed during compilation');
    const manifest=await outputManifest(bundle);
    if(!manifest['index.html'])throw Error('Studio program output is incomplete');
    await writeFile(join(directory,'render-manifest.json'),JSON.stringify(manifest),{mode:0o600});
   }catch(e){await rm(directory,{recursive:true,force:true});throw e;}
  }
  const lease=join(directory,`.lease-${process.pid}-${randomUUID()}.json`);
  await writeFile(lease,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});
  const now=new Date();await utimes(directory,now,now);
  return {key,directory,bundle,cacheHit,release:()=>rm(lease,{force:true})};
 }finally{await unlock();}
}
/** Vite's mutable dependency cache has exactly one writer, or a private fallback. */
export async function acquireStudioViteCache(program,fallbackDirectory){
 const release=await lock(join(program.directory,'.vite-owner'),{wait:false});
 if(!release)return{directory:fallbackDirectory,release:async()=>{}};
 try{const directory=join(program.directory,'vite');await privateDirectory(directory);return{directory,release};}
 catch(e){await release();throw e;}
}
export async function pruneStudioProgramCache(cacheRoot,{maxEntries=2,maxBytes=512*1024*1024}={}){
 await privateDirectory(cacheRoot);const unlock=await lock(join(cacheRoot,'.maintenance'),{wait:false});
 if(!unlock)return;
 try{
  const entries=[];
  for(const name of await readdir(cacheRoot)){
   if(!versionName.test(name))continue;
   const directory=join(cacheRoot,name),stat=await lstat(directory);
   if(!stat.isDirectory()||stat.isSymbolicLink()||await active(directory))continue;
   // Refuse to follow links even in a partially written compiler cache.
   try{entries.push({directory,modified:stat.mtimeMs,bytes:(await Promise.all((await fileNames(directory)).map(name=>lstat(join(directory,name))))).reduce((total,stat)=>total+stat.size,0)});}catch{/* Unknown entries are retained. */}
  }
  entries.sort((a,b)=>b.modified-a.modified);
  let total=0,retained=0;
  for(const entry of entries){
   if(retained>=maxEntries||total+entry.bytes>maxBytes)await rm(entry.directory,{recursive:true});
   else{total+=entry.bytes;retained++;}
  }
 }finally{await unlock();}
}
