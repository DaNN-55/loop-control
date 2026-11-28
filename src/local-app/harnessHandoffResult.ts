import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,realpath,rename,unlink} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import type {Readable} from 'node:stream';
import {harnessHandoffVersion} from './harnessHandoffPackage.js';

const schema='loop-control-handoff-result/v1' as const;
const videoPath='exports/final.mp4' as const;
const statuses=['received','producing','needs_attention','failed','delivered'] as const;
const maxResultBytes=16*1024;
type Status=typeof statuses[number];
type ProductionOrder={id:string;url:string};
type VideoIdentity={sha256:string;fileSize:number};
export interface HarnessHandoffDelivery extends VideoIdentity {open():Readable|Promise<Readable>}
export interface HarnessHandoffResultInput {
 handoffId:string;
 revision:number;
 status:Status;
 productionOrder?:ProductionOrder|null;
 reasonCode?:string;
 message:string;
 metrics?:{videoSeconds?:number|null;estimatedCostYuan?:number|null;actualCostYuan?:number|null};
 delivery?:HarnessHandoffDelivery;
}
export interface HarnessHandoffResult {
 schema:typeof schema;
 handoff_id:string;
 revision:number;
 status:Status;
 updated_at:string;
 production_order:ProductionOrder|null;
 message:string;
 reason_code?:string;
 outputs:{video?:typeof videoPath;video_sha256?:string;video_file_size?:number};
 metrics:{video_seconds:number|null;estimated_cost_yuan:number|null;actual_cost_yuan:number|null};
}

const isCode=(error:unknown,code:string)=>(error as NodeJS.ErrnoException|null)?.code===code;
function validIdentity(value:VideoIdentity) {
 return typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256)&&Number.isSafeInteger(value.fileSize)&&value.fileSize>0;
}
function videoIdentity(result:HarnessHandoffResult):VideoIdentity {
 const {video,video_sha256:sha256,video_file_size:fileSize}=result.outputs;
 if(video!==videoPath||sha256===undefined||fileSize===undefined||!validIdentity({sha256,fileSize}))throw Error('Invalid handoff video identity');
 return {sha256,fileSize};
}
function validateContent(result:HarnessHandoffResult) {
 const {status,production_order:order,message,reason_code:reason,outputs,metrics}=result;
 if(!statuses.includes(status)||typeof message!=='string'||!message.trim()||message.length>2000||
    (reason!==undefined&&(typeof reason!=='string'||!/^[a-z][a-z0-9_]{0,63}$/.test(reason))))throw Error('Invalid handoff status or message');
 if(order!==null){
  if(typeof order?.id!=='string'||!order.id.trim()||order.id.length>128||typeof order.url!=='string'||order.url.length>2048||order.url!==order.url.trim()||/[\x00-\x20\x7f\\]/.test(order.url))throw Error('Invalid production order');
  const url=new URL(order.url);
  if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password)throw Error('Unsafe production order URL');
 }
 if(!outputs||typeof outputs!=='object'||(status!=='delivered'&&Object.keys(outputs).length))throw Error('Invalid handoff outputs');
 if(status==='delivered'){if(!order)throw Error('Delivery must have a production order');videoIdentity(result);}
 if(!metrics||![metrics.video_seconds,metrics.estimated_cost_yuan,metrics.actual_cost_yuan].every(value=>value===null||(typeof value==='number'&&Number.isFinite(value)&&value>=0)))throw Error('Invalid handoff metrics');
}

async function directory(path:string,create=false) {
 if(create){
  try{await mkdir(path,{mode:0o700});}
  catch(error){if(!isCode(error,'EEXIST'))throw error;}
 }
 const stat=await lstat(path);
 if(!stat.isDirectory()||stat.uid!==process.getuid?.()||(stat.mode&0o022)!==0||await realpath(path)!==path)throw Error('Unsafe handoff directory');
 return stat;
}
async function syncDirectory(path:string) {
 await directory(path);
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_DIRECTORY);
 try{await handle.sync();}finally{await handle.close();}
}
async function openRegular(path:string) {
 try{
  const before=await lstat(path);
  if(!before.isFile()||before.nlink!==1||before.uid!==process.getuid?.()||(before.mode&0o022)!==0||await realpath(path)!==path)throw Error('Unsafe handoff file');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const stat=await handle.stat();
   if(!stat.isFile()||stat.dev!==before.dev||stat.ino!==before.ino||stat.nlink!==1)throw Error('Handoff file changed while opening');
   return {handle,stat};
  }catch(error){await handle.close();throw error;}
 }catch(error){if(isCode(error,'ENOENT'))return null;throw error;}
}
async function readResult(path:string,id:string,revision:number):Promise<HarnessHandoffResult|null> {
 const file=await openRegular(path);
 if(!file)return null;
 try{
  if(file.stat.size>maxResultBytes)throw Error('Handoff result exceeds size limit');
  const data=Buffer.alloc(maxResultBytes+1);
  let length=0;
  while(length<data.length){
   const {bytesRead}=await file.handle.read(data,length,data.length-length,length);
   if(!bytesRead)break;
   length+=bytesRead;
  }
  if(length!==file.stat.size)throw Error('Handoff result size changed');
  const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(0,length))) as HarnessHandoffResult;
  if(!result||result.schema!==schema||result.handoff_id!==id||result.revision!==revision||typeof result.updated_at!=='string'||!Number.isFinite(Date.parse(result.updated_at)))throw Error('Invalid handoff result');
  validateContent(result);
  return result;
 }finally{await file.handle.close();}
}
function assertMedia(actual:VideoIdentity,expected:VideoIdentity) {
 if(actual.fileSize!==expected.fileSize||actual.sha256!==expected.sha256)throw Error('Handoff video does not match the verified delivery');
}
async function verifyVideo(path:string,expected:VideoIdentity) {
 const file=await openRegular(path);
 if(!file)return false;
 try{
  if(file.stat.size!==expected.fileSize)throw Error('Handoff video size does not match the verified delivery');
  const hash=createHash('sha256');let fileSize=0;
  for await(const chunk of file.handle.createReadStream({autoClose:false,start:0,end:expected.fileSize-1})){
   fileSize+=chunk.length;hash.update(chunk);
  }
  assertMedia({fileSize,sha256:hash.digest('hex')},expected);
  const after=await file.handle.stat();
  if(after.size!==file.stat.size||after.mtimeMs!==file.stat.mtimeMs||after.ctimeMs!==file.stat.ctimeMs)throw Error('Handoff video changed during verification');
  return true;
 }finally{await file.handle.close();}
}

// Provision the root under a trusted parent, with a single Loop Control writer. Path checks
// reject links and other users' writes; they are not an isolation boundary against the same UID.
// Serialize overlapping writes (also across factory instances) inside the writer process.
const ongoing=new Map<string,Promise<unknown>>();
function serialize<T>(key:string,write:()=>Promise<T>):Promise<T> {
 const pending=(ongoing.get(key)??Promise.resolve()).catch(()=>{}).then(write);
 ongoing.set(key,pending);
 return pending.finally(()=>{if(ongoing.get(key)===pending)ongoing.delete(key);});
}

async function publish(dir:string,target:string,stage:(file:Awaited<ReturnType<typeof open>>)=>Promise<void>,replace:boolean) {
 const identity=await directory(dir);
 const temporary=join(dir,`.handoff-${randomUUID()}.tmp`);
 const handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 let published=false;
 try{
  try{await stage(handle);await handle.sync();}finally{await handle.close();}
  const current=await directory(dir);
  if(identity.dev!==current.dev||identity.ino!==current.ino)throw Error('Handoff directory changed during write');
  // Do not silently replace a symlink or a different kind of filesystem entry.
  const existing=await openRegular(target);
  if(existing){
   await existing.handle.close();
   if(!replace)throw Error('Handoff video appeared during publication');
  }
  await rename(temporary,target);
  published=true;
  await syncDirectory(dir);
 }finally{
  if(!published){
   const current=await directory(dir).catch(()=>null);
   if(current?.dev===identity.dev&&current.ino===identity.ino)await unlink(temporary).catch(()=>{});
  }
 }
}

async function writeVideo(dir:string,delivery:HarnessHandoffDelivery) {
 const path=join(dir,'final.mp4');
 if(await verifyVideo(path,delivery))return;
 await publish(dir,path,async handle=>{
  const hash=createHash('sha256');let fileSize=0;
  for await(const chunk of await delivery.open()){
   if(!(chunk instanceof Uint8Array))throw Error('Handoff video source must stream bytes');
   fileSize+=chunk.byteLength;
   if(fileSize>delivery.fileSize)throw Error('Handoff video exceeds the verified delivery size');
   hash.update(chunk);
   for(let offset=0;offset<chunk.byteLength;){
    const {bytesWritten}=await handle.write(chunk,offset,chunk.byteLength-offset);
    if(!bytesWritten)throw Error('Handoff video write made no progress');
    offset+=bytesWritten;
   }
  }
  assertMedia({fileSize,sha256:hash.digest('hex')},delivery);
 },false);
}
function sameContent(previous:HarnessHandoffResult,next:HarnessHandoffResult) {
 return previous.status===next.status&&previous.reason_code===next.reason_code&&previous.message===next.message&&
  previous.production_order?.id===next.production_order?.id&&previous.production_order?.url===next.production_order?.url&&
  previous.metrics.video_seconds===next.metrics.video_seconds&&previous.metrics.estimated_cost_yuan===next.metrics.estimated_cost_yuan&&
  previous.metrics.actual_cost_yuan===next.metrics.actual_cost_yuan&&previous.outputs.video===next.outputs.video&&
  previous.outputs.video_sha256===next.outputs.video_sha256&&previous.outputs.video_file_size===next.outputs.video_file_size;
}

export function createHarnessHandoffResults(root:string) {
 if(!isAbsolute(root)||resolve(root)!==root)throw Error('Handoff root must be an absolute canonical directory');
 const layout=(id:string,revision:number)=>{
  const version=harnessHandoffVersion(id,revision);
  const out=join(root,'out'),order=join(out,id),dir=join(order,version);
  return {dirs:[out,order,dir],dir,result:join(dir,'result.json'),exports:join(dir,'exports')};
 };
 async function locate(id:string,revision:number) {
  const entry=layout(id,revision);
  await directory(root);
  try{for(const dir of entry.dirs)await directory(dir);}
  catch(error){if(isCode(error,'ENOENT'))return null;throw error;}
  return entry;
 }
 const read=(handoffId:string,revision:number)=>serialize(layout(handoffId,revision).result,async()=>{
  const entry=await locate(handoffId,revision);
  return entry?readResult(entry.result,handoffId,revision):null;
 });
 const readPlayable=(handoffId:string,revision:number)=>serialize(layout(handoffId,revision).result,async()=>{
  const entry=await locate(handoffId,revision);
  const result=entry&&await readResult(entry.result,handoffId,revision);
  if(!entry||result?.status!=='delivered')return null;
  try{await directory(entry.exports);}catch(error){if(isCode(error,'ENOENT'))return null;throw error;}
  const path=join(entry.dir,videoPath),identity=videoIdentity(result);
  return await verifyVideo(path,identity)?{path,...identity}:null;
 });
 const write=(input:HarnessHandoffResultInput)=>{
  const {handoffId,revision,status,productionOrder,reasonCode,message,metrics,delivery}=input;
  const entry=layout(handoffId,revision);
  if((status==='delivered')!==Boolean(delivery)||(delivery&&(!validIdentity(delivery)||typeof delivery.open!=='function')))throw Error('Delivered results require a verified video source');
  const source=delivery&&{sha256:delivery.sha256,fileSize:delivery.fileSize,open:delivery.open.bind(delivery)};
  const next:HarnessHandoffResult={schema,handoff_id:handoffId,revision,status,updated_at:'',
   production_order:productionOrder?{id:productionOrder.id,url:productionOrder.url}:null,message,...(reasonCode!==undefined?{reason_code:reasonCode}:{}),
   outputs:source?{video:videoPath,video_sha256:source.sha256,video_file_size:source.fileSize}:{},
   metrics:{video_seconds:metrics?.videoSeconds??null,estimated_cost_yuan:metrics?.estimatedCostYuan??null,actual_cost_yuan:metrics?.actualCostYuan??null}};
  validateContent(next);
  return serialize(entry.result,async()=>{
   await directory(root);
   let parent=root;
   for(const dir of entry.dirs){await directory(dir,true);await syncDirectory(parent);parent=dir;}
   const previous=await readResult(entry.result,handoffId,revision);
   if(previous?.production_order&&next.production_order&&previous.production_order.id!==next.production_order.id)throw Error('Handoff revision is bound to another production order');
   if(previous?.status==='delivered'){
    if(!source)return previous;
    assertMedia(source,videoIdentity(previous));
   }
   if(!next.production_order&&previous?.production_order)next.production_order=previous.production_order;
   if(source){await directory(entry.exports,true);await syncDirectory(entry.dir);await writeVideo(entry.exports,source);await syncDirectory(entry.exports);}
   if(previous&&sameContent(previous,next))return previous;
   next.updated_at=new Date().toISOString();
   await publish(entry.dir,entry.result,file=>file.writeFile(`${JSON.stringify(next,null,2)}\n`),true);
   return next;
  });
 };
 return {read,write,readPlayable};
}
export type HarnessHandoffResults=ReturnType<typeof createHarnessHandoffResults>;
