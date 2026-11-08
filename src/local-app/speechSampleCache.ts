import {createHash, randomUUID} from 'node:crypto';
import {mkdir, open, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ConfigurationError} from './configurationCommands.js';

const maxSampleBytes = 1024 * 1024;

export async function readSpeechSample(directory:string, identity:readonly string[], generate?:()=>Promise<Uint8Array>):Promise<Buffer|null>{
 const key=createHash('sha256').update(JSON.stringify(identity)).digest('hex');
 const path=join(directory,key+'.mp3');
 const read=async()=>{
  try{return await readFile(path);}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
 };
 const cached=await read();
 if(cached||!generate)return cached;

 await mkdir(directory,{recursive:true,mode:0o700});
 const lockPath=path+'.lock';
 const lock=await open(lockPath,'wx',0o600).catch(error=>{
  if(error.code==='EEXIST')throw new ConfigurationError(409,'此音色的样音正在准备或上次结果待核对。');
  throw error;
 });
 const temp=path+'.'+randomUUID()+'.tmp';
 try{
  const existing=await read();
  if(existing)return existing;
  const bytes=await generate();
  if(!bytes.length||bytes.length>maxSampleBytes)throw new ConfigurationError(502,'供应商返回的样音大小无效。');
  await writeFile(temp,bytes,{flag:'wx',mode:0o600});
  await rename(temp,path);
  return Buffer.from(bytes);
 }finally{
  await lock.close();
  await unlink(lockPath);
  await unlink(temp).catch(()=>{});
 }
}
