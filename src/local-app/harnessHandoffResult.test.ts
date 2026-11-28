// @vitest-environment node
import {createHash} from 'node:crypto';
import {chmod,lstat,mkdir,mkdtemp,readFile,readdir,realpath,rm,symlink,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createHarnessHandoffResults,type HarnessHandoffResultInput} from './harnessHandoffResult.js';

const id='p01-001',revision=1;
const order={id:'episode-1',url:'http://127.0.0.1:5174/?view=episodes&episode=episode-1'};
const video=Buffer.from('fixture bytes supplied by the official verified delivery adapter');
const identity={fileSize:video.length,sha256:createHash('sha256').update(video).digest('hex')};
const received={handoffId:id,revision,status:'received',message:'已接收'} satisfies HarnessHandoffResultInput;
const ready={...received,status:'delivered',productionOrder:order,message:'已交付'} satisfies HarnessHandoffResultInput;

let work:string,root:string,dir:string,resultPath:string,exportDir:string,mp4:string;
beforeEach(async()=>{
 work=await realpath(await mkdtemp(join(tmpdir(),'loop-handoff-result-')));
 root=join(work,'handoff');await mkdir(root,{mode:0o700});
 dir=join(root,'out',id,'v0001');resultPath=join(dir,'result.json');exportDir=join(dir,'exports');mp4=join(exportDir,'final.mp4');
});
afterEach(async()=>{await rm(work,{recursive:true,force:true});});
const openVideo=()=>Readable.from([video.subarray(0,15),video.subarray(15)]);

describe('Harness result writeback',()=>{
 it('atomically writes the v1 metadata and does not churn on identical concurrent or restarted writes',async()=>{
  const results=createHarnessHandoffResults(root);
  expect(await results.read(id,revision)).toBeNull();
  expect(await readdir(root)).toEqual([]);
  const input={...received,status:'needs_attention',reasonCode:'owner_confirmation_required'} as const;
  const first=await results.write(input);
  expect(first).toMatchObject({schema:'loop-control-handoff-result/v1',handoff_id:id,revision,status:'needs_attention',production_order:null,reason_code:'owner_confirmation_required',outputs:{},metrics:{video_seconds:null,estimated_cost_yuan:null,actual_cost_yuan:null}});
  const before=await lstat(resultPath);
  const fresh=createHarnessHandoffResults(root);
  expect(await Promise.all([fresh.write(input),results.write(input),fresh.read(id,revision)])).toEqual([first,first,first]);
  const after=await lstat(resultPath);
  expect(after.ino).toBe(before.ino);expect(after.mtimeMs).toBe(before.mtimeMs);
  expect(await readdir(dir)).toEqual(['result.json']);
  const changed=await fresh.write({...received,status:'producing',productionOrder:order});
  expect(changed.status).toBe('producing');
  expect(JSON.parse(await readFile(resultPath,'utf8'))).toEqual(changed);
 });

 it('does not expose a final file before the complete stream verifies; mismatch or stream failure leaves the old result',async()=>{
  const results=createHarnessHandoffResults(root);
  const previous=await results.write({...received,status:'producing',productionOrder:order});
  const open=()=>Readable.from((async function*(){
   yield video.subarray(0,10);
   await expect(lstat(mp4)).rejects.toMatchObject({code:'ENOENT'});
   expect(JSON.parse(await readFile(resultPath,'utf8'))).toEqual(previous);
   yield Buffer.alloc(video.length-10,42);
  })());
  await expect(results.write({...ready,delivery:{...identity,open}})).rejects.toThrow('does not match');
  await expect(results.write({...ready,delivery:{...identity,open:()=>Readable.from([video,Buffer.from([1])])}})).rejects.toThrow('exceeds');
  await expect(results.write({...ready,delivery:{...identity,open:()=>Readable.from((async function*(){yield video;throw Error('source failed');})())}})).rejects.toThrow('source failed');
  expect(await results.read(id,revision)).toEqual(previous);
  expect(await readdir(exportDir)).toEqual([]);
 });

 it('publishes the canonical MP4 before delivered, leaves it immutable, and repairs missing files on restart',async()=>{
  const results=createHarnessHandoffResults(root),open=vi.fn(openVideo);
  const input={...ready,delivery:{...identity,open},metrics:{videoSeconds:5,estimatedCostYuan:0.19}};
  const [first,same]=await Promise.all([results.write(input),createHarnessHandoffResults(root).write(input)]);
  expect(same).toEqual(first);expect(open).toHaveBeenCalledTimes(1);
  expect(first.outputs).toEqual({video:'exports/final.mp4',video_sha256:identity.sha256,video_file_size:identity.fileSize});
  expect(first.metrics).toEqual({video_seconds:5,estimated_cost_yuan:0.19,actual_cost_yuan:null});
  expect(await readFile(mp4)).toEqual(video);
  const before=await lstat(resultPath);
  expect(await results.write({...received,status:'producing',productionOrder:order})).toEqual(first);
  await unlink(mp4);
  const restarted=createHarnessHandoffResults(root);
  expect(await restarted.read(id,revision)).toEqual(first);
  expect(await restarted.readPlayable(id,revision)).toBeNull();
  await expect(restarted.write({...ready,delivery:{...identity,sha256:'f'.repeat(64),open}})).rejects.toThrow('does not match');
  expect(await restarted.write(input)).toEqual(first);
  expect(open).toHaveBeenCalledTimes(2);
  expect(await restarted.readPlayable(id,revision)).toEqual({path:mp4,...identity});
  expect((await lstat(resultPath)).ino).toBe(before.ino);
 });

 it('does not overwrite a canonical video that appears while a new copy is being staged',async()=>{
  const results=createHarnessHandoffResults(root);
  const open=()=>Readable.from((async function*(){
   yield video.subarray(0,10);
   await writeFile(mp4,'unexpected canonical entry',{mode:0o600});
   yield video.subarray(10);
  })());
  await expect(results.write({...ready,delivery:{...identity,open}})).rejects.toThrow('appeared during publication');
  expect(await readFile(mp4,'utf8')).toBe('unexpected canonical entry');
  expect(await results.read(id,revision)).toBeNull();
 });

 it('recovers a fully committed MP4 after interruption before result publication without re-opening the source',async()=>{
  const results=createHarnessHandoffResults(root);
  await results.write({...received,status:'producing',productionOrder:order});
  await mkdir(exportDir,{mode:0o700});
  await writeFile(mp4,video,{mode:0o600});
  const open=vi.fn(openVideo);
  expect((await createHarnessHandoffResults(root).write({...ready,delivery:{...identity,open}})).status).toBe('delivered');
  expect(open).not.toHaveBeenCalled();
 });

 it('rejects tampered canonical copies rather than replacing or advertising their bytes as playable',async()=>{
  const results=createHarnessHandoffResults(root),open=vi.fn(openVideo),input={...ready,delivery:{...identity,open}};
  await results.write(input);
  await writeFile(mp4,Buffer.alloc(identity.fileSize,42));
  await expect(results.readPlayable(id,revision)).rejects.toThrow('does not match');
  await expect(results.write(input)).rejects.toThrow('does not match');
  expect(open).toHaveBeenCalledTimes(1);
 });

 it('rejects escaping and symlinked directories, result files, and MP4 targets without changing their destinations',async()=>{
  const results=createHarnessHandoffResults(root);
  const outside=join(work,'outside');await mkdir(outside);const sentinel=join(outside,'sentinel');await writeFile(sentinel,'untouched');
  expect(()=>results.write({...received,handoffId:'../outside'})).toThrow();
  expect(()=>results.write({...received,revision:10000})).toThrow();
  expect(()=>results.write({...received,productionOrder:{id:order.id,url:'https://127.0.0.1@elsewhere.test/'}})).toThrow('Unsafe production order URL');
  await symlink(outside,join(root,'out'),'dir');
  await expect(results.write(received)).rejects.toThrow('Unsafe handoff directory');
  await unlink(join(root,'out'));await mkdir(dir,{recursive:true,mode:0o700});
  await chmod(dir,0o777);
  await expect(results.write(received)).rejects.toThrow('Unsafe handoff directory');
  await chmod(dir,0o700);
  await symlink(sentinel,resultPath);
  await expect(results.read(id,revision)).rejects.toThrow('Unsafe handoff file');
  await expect(results.write(received)).rejects.toThrow('Unsafe handoff file');
  await unlink(resultPath);await results.write(received);
  await mkdir(exportDir);await symlink(sentinel,mp4);
  await expect(results.write({...ready,delivery:{...identity,open:openVideo}})).rejects.toThrow('Unsafe handoff file');
  expect(await readFile(sentinel,'utf8')).toBe('untouched');
  expect(await readdir(outside)).toEqual(['sentinel']);
 });
});
