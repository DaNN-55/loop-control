// @vitest-environment node
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
import {readSpeechSample} from './speechSampleCache';

it('reads without generating, reserves one paid request, and reuses the cached bytes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'loop-speech-sample-'));
 const key=['owner','provider','model','voice'];
 const bytes=Buffer.from('controlled-sample');
 let release!:()=>void;
 const started=new Promise<void>(resolve=>{release=resolve;});
 let complete!:()=>void;
 const wait=new Promise<void>(resolve=>{complete=resolve;});
 const generate=vi.fn(async()=>{release();await wait;return bytes;});
 try{
  expect(await readSpeechSample(directory,key)).toBeNull();
  const pending=readSpeechSample(directory,key,generate);
  await started;
  await expect(readSpeechSample(directory,key,generate)).rejects.toMatchObject({status:409});
  complete();
  expect(await pending).toEqual(bytes);
  expect(await readSpeechSample(directory,key,generate)).toEqual(bytes);
  expect(await readSpeechSample(directory,['different-owner',...key.slice(1)])).toBeNull();
  expect(generate).toHaveBeenCalledTimes(1);
 }finally{complete();await rm(directory,{recursive:true,force:true});}
});
