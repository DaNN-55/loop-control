import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {isAbsolute,resolve,join} from 'node:path';

const keys=['LOOP_HARNESS_PRODUCTION_DIR','LOOP_HARNESS_PRODUCTION_OWNER_ID','LOOP_HARNESS_PRODUCTION_EPISODE_IDS'];
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const maxBytes=16*1024;
const invalid=()=>new Error('Harness production opt-in is invalid; use a private config and a complete directory/Owner binding.');
async function privateDirectory(directory,uid){
 if(typeof directory!=='string'||!isAbsolute(directory)||resolve(directory)!==directory||await realpath(directory)!==directory)throw invalid();
 const stat=await lstat(directory);
 if(!stat.isDirectory()||stat.uid!==uid||(stat.mode&0o777)!==0o700)throw invalid();
}
async function binding(directory,ownerId,episodeIds,uid){
 if(typeof ownerId!=='string'||!uuid.test(ownerId))throw invalid();
 if(episodeIds!==undefined&&(!Array.isArray(episodeIds)||!episodeIds.length||episodeIds.length>1000||episodeIds.some(id=>typeof id!=='string'||!uuid.test(id))))throw invalid();
 await privateDirectory(directory,uid);
 if(Buffer.byteLength(join(directory,'production.sock'))>103)throw invalid();
 return {[keys[0]]:directory,[keys[1]]:ownerId,...(episodeIds?{[keys[2]]:[...new Set(episodeIds.map(id=>id.toLowerCase()))].join(',')}:{})};
}
/** Read only explicit workspace opt-in. Never reads database, provider or DSH configuration. */
export async function loadHarnessProductionEnvironment({runtimeRoot,environment=process.env,uid=process.getuid?.()}){
 // A shell override is a complete binding, never a partial merge with another Owner.
 if(keys.some(key=>environment[key]!==undefined)){
  if(environment[keys[0]]===undefined||environment[keys[1]]===undefined)throw invalid();
  return binding(environment[keys[0]],environment[keys[1]],environment[keys[2]]===undefined?undefined:environment[keys[2]].split(','),uid);
 }
 const file=join(runtimeRoot,'harness-production.json');
 let before;try{before=await lstat(file);}catch(error){if(error.code==='ENOENT')return {};throw error;}
 await privateDirectory(runtimeRoot,uid);
 if(!before.isFile()||before.uid!==uid||before.nlink!==1||(before.mode&0o777)!==0o600||before.size>maxBytes)throw invalid();
 const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 let value;
 try{
  const stat=await handle.stat();
  if(stat.dev!==before.dev||stat.ino!==before.ino||!stat.isFile()||stat.uid!==uid||stat.nlink!==1||(stat.mode&0o777)!==0o600||stat.size>maxBytes)throw invalid();
  const bytes=Buffer.alloc(maxBytes+1);let length=0;
  while(length<bytes.length){const read=await handle.read(bytes,length,bytes.length-length,null);if(!read.bytesRead)break;length+=read.bytesRead;}
  if(length>maxBytes||length!==stat.size)throw invalid();
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length)));}catch{throw invalid();}
 }finally{await handle.close();}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['version','enabled','productionDir','ownerId','episodeIds'].includes(key))||value.version!==1||typeof value.enabled!=='boolean')throw invalid();
 if(!value.enabled)return {};
 return binding(value.productionDir,value.ownerId,value.episodeIds,uid);
}
