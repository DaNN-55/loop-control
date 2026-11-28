import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {parseProductionScript} from '../reviews/productionScript.js';

export const harnessHandoffSchema='loop-control-handoff/v1';
const MiB=1024*1024;
const idPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const imagePath=/^images\/[\p{L}\p{N}][\p{L}\p{N}\p{M}._ -]{0,119}\.(png|jpe?g)$/iu;
const pngSignature=Buffer.from([137,80,78,71,13,10,26,10]);

type PackageErrorCode='invalid_manifest'|'invalid_script'|'invalid_image';
export class HarnessHandoffPackageError extends Error {
 constructor(readonly code:PackageErrorCode,message:string){super(message);}
}
export interface HarnessHandoffManifest {
 schema:typeof harnessHandoffSchema;handoff_id:string;revision:number;product_id:string;title:string;product_images:string[];
}
export interface HarnessHandoffImage {name:string;mimeType:'image/png'|'image/jpeg';bytes:Buffer}

export function harnessHandoffVersion(id:string,revision:number){
 if(id.length>80||!idPattern.test(id)||!Number.isInteger(revision)||revision<1||revision>9999)throw new HarnessHandoffPackageError('invalid_manifest','交接编号或修订号不合法。');
 return `v${String(revision).padStart(4,'0')}`;
}

async function safeDirectory(path:string){
 if(!(await lstat(path)).isDirectory()||await realpath(path)!==path)throw Error('不是交接目录内的普通目录');
 return path;
}
async function readBounded(path:string,limit:number){
 const before=await lstat(path);
 if(!before.isFile()||before.nlink!==1||await realpath(path)!==path)throw Error('不是普通文件');
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const stat=await handle.stat();
  if(!stat.isFile()||stat.nlink!==1||stat.dev!==before.dev||stat.ino!==before.ino||stat.size<1||stat.size>limit)throw Error('文件不安全、为空或超过大小限制');
  const bytes=Buffer.allocUnsafe(stat.size+1);
  let offset=0;
  while(offset<bytes.length){const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
  const after=await handle.stat();
  if(offset!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs)throw Error('读取期间文件发生变化');
  return bytes.subarray(0,offset);
 }finally{await handle.close();}
}
const utf8=(b:Buffer)=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);
const cleanText=(s:unknown):s is string=>typeof s==='string'&&s.trim()===s&&s.length>0&&s.length<=200&&!/[\x00-\x1f\x7f]/.test(s);

function readManifest(bytes:Buffer,id:string,revision:number):HarnessHandoffManifest{
 const m=JSON.parse(utf8(bytes));
 if(!m||m.schema!==harnessHandoffSchema||m.handoff_id!==id||m.revision!==revision||!cleanText(m.product_id)||!cleanText(m.title)||!Array.isArray(m.product_images)||m.product_images.length<1||m.product_images.length>12||m.product_images.some((p:unknown)=>typeof p!=='string'||!imagePath.test(p)||Buffer.byteLength(basename(p))>240)||new Set(m.product_images.map((p:string)=>p.normalize('NFC').toLowerCase())).size!==m.product_images.length)throw Error('版本、编号、标题或图片清单不合法');
 return {schema:m.schema,handoff_id:id,revision,product_id:m.product_id,title:m.title,product_images:m.product_images};
}

async function verifyImage(bytes:Buffer,mimeType:HarnessHandoffImage['mimeType']){
 const png=mimeType==='image/png';
 if(png?!bytes.subarray(0,8).equals(pngSignature):!bytes.subarray(0,3).equals(Buffer.from([255,216,255])))throw Error('文件与声明的图片格式不符');
 await new Promise<void>((resolve,reject)=>{
  const child=spawn('ffmpeg',['-v','error','-xerror','-threads','1','-max_pixels','24000000','-f',png?'png_pipe':'jpeg_pipe','-i','pipe:0','-frames:v','1','-f','null','-'],{stdio:['pipe','ignore','ignore'],timeout:10000,killSignal:'SIGKILL'});
  child.stdin.on('error',()=>{});
  child.on('error',reject);
  child.on('close',code=>code===0?resolve():reject(Error('图片无法解码或超过像素限制')));
  child.stdin.end(bytes);
 });
}

/** Accept only a named, fully published revision and snapshot the bytes before any production mutation. */
export async function readHarnessHandoffPackage(root:string,id:string,revision:number){
 const version=harnessHandoffVersion(id,revision);
 let dir:string,manifestBytes:Buffer,manifest:HarnessHandoffManifest;
 try{
  const base=await realpath(root),inbox=await safeDirectory(join(base,'in')),handoff=await safeDirectory(join(inbox,id));
  dir=await safeDirectory(join(handoff,version));
  manifestBytes=await readBounded(join(dir,'manifest.json'),64*1024);
  manifest=readManifest(manifestBytes,id,revision);
 }catch(error){throw new HarnessHandoffPackageError('invalid_manifest',`无法读取制作包清单：${error instanceof SyntaxError?'JSON 格式错误':'检查目录、版本、编号与图片清单。'}`);}
 let script:string,scriptBytes:Buffer,parsed:NonNullable<ReturnType<typeof parseProductionScript>>;
 try{
  scriptBytes=await readBounded(join(dir,'script.md'),256*1024);script=utf8(scriptBytes);
  const value=parseProductionScript(script);
  if(value?.version!==3)throw Error('须提供 v3 结构化脚本，不接受自由正文或旧模板。');
  parsed=value;
 }catch(error){throw new HarnessHandoffPackageError('invalid_script',`无法读取 v3 脚本：${error instanceof Error&&('line' in error||!('code' in error))?error.message:'检查 script.md 文件。'}`);}
 const digest=createHash('sha256');
 for(const bytes of [manifestBytes,scriptBytes])digest.update(`${bytes.length}:`).update(bytes);
 const images:HarnessHandoffImage[]=[];
 let imageBytes=0;
 for(const path of manifest.product_images){
  const name=basename(path),mimeType=/\.png$/i.test(name)?'image/png':'image/jpeg';
  try{
   const folder=await safeDirectory(join(dir,'images'));
   const bytes=await readBounded(join(folder,name),Math.min(10*MiB,30*MiB-imageBytes));
   await verifyImage(bytes,mimeType);imageBytes+=bytes.length;
   digest.update(`${bytes.length}:`).update(bytes);images.push({name,mimeType,bytes});
  }catch{throw new HarnessHandoffPackageError('invalid_image',`商品图片「${name}」缺失、格式不符、无法解码或超出大小限制。`);}
 }
 return {manifest,script,parsed,images,digest:digest.digest('hex')};
}
