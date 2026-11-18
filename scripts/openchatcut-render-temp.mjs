import {execFileSync} from 'node:child_process';
import {lstat,mkdtemp,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const prefix='loop-control-render-',marker='.render-owner.json';
function alive(pid){try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}
function opened(path){
 try{return execFileSync('/usr/sbin/lsof',['-nP','-Fp','+D',path],{encoding:'utf8',timeout:5000,stdio:['ignore','pipe','pipe']}).trim()!=='';}
 catch(error){if(error.status===1&&!String(error.stderr??'').trim())return String(error.stdout??'').trim()!=='';throw error;}
}

/** Only reclaim our marked, private, dead-process directories. Never sweep arbitrary OS temp files. */
export async function pruneRenderTemps(parent=tmpdir(),{staleAfterMs=60_000}={}){
 const removed=[];
 try{
  parent=await realpath(parent);
  for(const name of await readdir(parent)){
   if(!/^loop-control-render-[A-Za-z0-9]{6}$/.test(name))continue;
   const path=join(parent,name);
   try{
    const stat=await lstat(path),owner=await lstat(join(path,marker));
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0||!owner.isFile()||owner.isSymbolicLink()||owner.nlink!==1||owner.size>4096||Date.now()-owner.mtimeMs<staleAfterMs)continue;
    const lease=JSON.parse(await readFile(join(path,marker),'utf8'));
    if(lease.version!==1||!Array.isArray(lease.pids)||!lease.pids.length||!lease.pids.every(pid=>Number.isSafeInteger(pid)&&pid>0)||lease.pids.some(alive)||opened(path))continue;
    const now=await lstat(path);
    if(now.dev!==stat.dev||now.ino!==stat.ino||now.isSymbolicLink())continue;
    await rm(path,{recursive:true});removed.push(path);
   }catch{ /* Maintenance must not block an export or delete an ambiguous directory. */ }
  }
 }catch{ /* Optional on systems without supported process/file inspection. */ }
 return removed;
}

export async function createRenderTemp(parent=tmpdir()){
 parent=await realpath(parent);await pruneRenderTemps(parent);
 const directory=await mkdtemp(join(parent,prefix)),identity=await lstat(directory),pids=[process.pid];
 const publish=()=>writeFile(join(directory,marker),JSON.stringify({version:1,pids}),{mode:0o600});
 try{await publish();}catch(error){await rm(directory,{recursive:true,force:true});throw error;}
 return{directory,async track(pid){if(Number.isSafeInteger(pid)&&pid>0&&!pids.includes(pid)){pids.push(pid);await publish();}},async cleanup(){
  const current=await lstat(directory).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!current)return;
  if(current.dev!==identity.dev||current.ino!==identity.ino||current.isSymbolicLink())throw Error('Export temporary directory identity changed');
  await rm(directory,{recursive:true});
 }};
}
