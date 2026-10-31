import type {Pool} from 'pg';
import {planMediaRootMigration,readMediaRootMigration,type StorageResource} from './mediaRootMigration.js';
import {access,lstat,readdir,realpath,statfs} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,isAbsolute,resolve,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ConfigurationError} from './configurationCommands.js';
import {sessionTransaction} from './ownerTransaction.js';
import type {OwnerSession} from './sessions.js';
import {assetPathWithin} from './mediaPaths.js';
const exec=promisify(execFile);
export interface MediaRootBinding {path:string;deviceId:string;inodeId:string;mountPath:string}
export interface MediaRootRuntime {
 protectedRoots:string[];retainedRoots?:string[];resources?:StorageResource[];minimumFreeBytes:number;
 pendingOperations?:()=>Promise<{kind:string;reason:string}[]>;
 persist:(binding:MediaRootBinding)=>Promise<(()=>Promise<void>) & {commit?:()=>Promise<void>}>;
 activate:(binding:MediaRootBinding)=>Promise<void>;
}
const overlap=(a:string,b:string)=>a===b||assetPathWithin(a,b)||assetPathWithin(b,a);
export async function inspectMediaRoot(path:unknown,minimumFreeBytes=0):Promise<MediaRootBinding>{
 if(typeof path!=='string'||path.length>4096||!isAbsolute(path)||resolve(path)!==path||path==='/')throw new ConfigurationError(400,'请选择实际本地文件夹。');
 try{
  if(await realpath(path)!==path)throw new ConfigurationError(400,'请选择实际目录，不能使用符号链接或路径别名。');
  const stat=await lstat(path,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==BigInt(process.getuid?.()??stat.uid))throw new ConfigurationError(409,'媒体根必须是当前用户拥有的实际文件夹。');
  await access(path,constants.R_OK|constants.W_OK|constants.X_OK);
  const fs=await statfs(path,{bigint:true});if(fs.bavail*fs.bsize<BigInt(minimumFreeBytes))throw new ConfigurationError(409,'媒体根可用空间不足，请释放空间或选择其他位置。');
  let mountPath=path;while(dirname(mountPath)!==mountPath&&(await lstat(dirname(mountPath),{bigint:true})).dev===stat.dev)mountPath=dirname(mountPath);
  if(path.startsWith('/Volumes/')&&(mountPath==='/Volumes'||!mountPath.startsWith('/Volumes/')))throw new ConfigurationError(409,'媒体根所在外部盘尚未挂载。');
  return{path,deviceId:String(stat.dev),inodeId:String(stat.ino),mountPath};
 }catch(error){if(error instanceof ConfigurationError)throw error;throw new ConfigurationError(409,'媒体根不存在或不可读写，请恢复挂载和权限后重试。');}
}
export async function verifyMediaRootBinding(binding:MediaRootBinding,minimumFreeBytes=0){
 const actual=await inspectMediaRoot(binding.path,minimumFreeBytes);
 if(actual.deviceId!==binding.deviceId||actual.inodeId!==binding.inodeId||actual.mountPath!==binding.mountPath)throw new ConfigurationError(409,'媒体根身份或挂载已变化，请恢复原位置后重试。');return actual;
}
export class LocalMediaRootSettings{
 private busy=false;private chooser?:AbortController;
 constructor(private pool:Pool,private mediaRoot:string,private runtime?:MediaRootRuntime){}
 close(){this.chooser?.abort();}
 async read(session:OwnerSession){
  return sessionTransaction(this.pool,session,async c=>{
   const row=(await c.query('SELECT local_identity.owner_id()=local_identity.media_root_owner() authorized,local_identity.media_workspace_empty() empty,local_identity.media_root_binding() binding')).rows[0];
   if(!row.authorized)throw new ConfigurationError(403,'仅工作区存储所有者可管理媒体根。');
   let reason:string|undefined;try{if(row.binding){if(row.binding.path!==this.mediaRoot)throw Error('服务与已提交媒体根不一致，请重启本机服务。');await verifyMediaRootBinding(row.binding,this.runtime?.minimumFreeBytes??0);}else await inspectMediaRoot(this.mediaRoot,this.runtime?.minimumFreeBytes??0);}catch(e){reason=e instanceof Error?e.message:'媒体根不可用。';}
   return{migration:await readMediaRootMigration(c),path:row.binding?.path??this.mediaRoot,canInitialize:row.empty,status:reason?'unavailable':'ready',...(reason?{reason}:{})};
  });
 }
 async execute(session:OwnerSession,body:Record<string,unknown>){
  if(!['choose','open','initialize','planMigration'].includes(String(body.command))||Object.keys(body).some(k=>!['command','path','idempotencyKey'].includes(k))||typeof body.idempotencyKey!=='string'||!/^[a-f0-9-]{36}$/i.test(body.idempotencyKey)||!['initialize','planMigration'].includes(String(body.command))&&body.path!==undefined)throw new ConfigurationError(400,'本机存储请求无效。');
  const state=await this.read(session);
  if(body.command==='planMigration')return planMediaRootMigration(this.pool,session,this.mediaRoot,body.path,body.idempotencyKey,this.runtime);
  if(body.command==='open'){
   if(state.status!=='ready')throw new ConfigurationError(409,state.reason!);
   try{await exec(process.platform==='darwin'?'/usr/bin/open':process.platform==='win32'?'explorer.exe':'xdg-open',[state.path],{timeout:5000,maxBuffer:8192});}catch{throw new ConfigurationError(503,'无法打开本地文件夹，请检查本机桌面环境。');}return{opened:true,path:state.path};
  }
  if(body.command==='initialize'&&!state.canInitialize)throw new ConfigurationError(409,'工作区已有资料或待恢复操作，请保留现址并使用迁移盘点。');
  if(this.busy)throw new ConfigurationError(409,'本机存储操作进行中，请稍后重试。');this.busy=true;
  try{
   if(body.command==='choose'){
    if(process.platform!=='darwin')throw new ConfigurationError(501,'当前平台请填写已授权的实际文件夹路径。');
    this.chooser=new AbortController();try{const {stdout}=await exec('/usr/bin/osascript',['-e','on run argv\nactivate\nreturn POSIX path of (choose folder with prompt "选择媒体根文件夹" default location (POSIX file (item 1 of argv)))\nend run','--',state.path],{signal:this.chooser.signal,timeout:120000,maxBuffer:8192});return{path:resolve(stdout.trim())};}catch(error){if(/\(-128\)/.test(String((error as {stderr?:string}).stderr)))return{cancelled:true};throw new ConfigurationError(503,'未能选择文件夹，请重试或填写实际路径。');}finally{this.chooser=undefined;}
   }
   if(!this.runtime)throw new ConfigurationError(503,'本机存储配置未启用，请通过正式本机服务初始化。');
   const binding=await inspectMediaRoot(body.path,this.runtime.minimumFreeBytes);
   if(binding.path===state.path)return state;
   const protectedRoots=[...this.runtime.protectedRoots,state.path,'/System','/Library','/usr','/bin','/sbin','/etc','/dev','/proc'];
   if(protectedRoots.some(p=>overlap(binding.path,p)))throw new ConfigurationError(400,'媒体根不能与源位置、平台运行目录、备份或独立历史库重叠。');
   const retained=this.runtime.retainedRoots??[];for(const root of retained)await inspectMediaRoot(root);
   if((await readdir(state.path)).some(name=>!retained.includes(join(state.path,name)))||(await readdir(binding.path)).length)throw new ConfigurationError(409,'初始化仅适用于空工作区与空目标文件夹；已有文件需要受控迁移。');
   let undo:((()=>Promise<void>) & {commit?:()=>Promise<void>})|undefined;let previous:MediaRootBinding|null=null;
   try{
    await sessionTransaction(this.pool,session,async c=>{
     await c.query("SELECT pg_advisory_xact_lock(hashtextextended('global-media-root',0))");
     if(!(await c.query('SELECT local_identity.media_workspace_empty() empty')).rows[0].empty)throw new ConfigurationError(409,'工作区已有资料或未完成创建，请先恢复原操作。');
     previous=(await c.query('SELECT local_identity.media_root_binding() binding')).rows[0].binding;
     await c.query('SELECT local_identity.bind_media_root($1,$2,$3,$4,true)',[binding.path,binding.deviceId,binding.inodeId,binding.mountPath]);
     await verifyMediaRootBinding(binding,this.runtime!.minimumFreeBytes);
     undo=await this.runtime!.persist(binding);
    });
   }catch(error){await undo?.();throw error;}
   try{await this.runtime.activate(binding);}catch{
    // Restore metadata/config only. Never delete either user's directory.
    const old=previous??await inspectMediaRoot(state.path);
    await sessionTransaction(this.pool,session,c=>c.query('SELECT local_identity.bind_media_root($1,$2,$3,$4,true)',[old.path,old.deviceId,old.inodeId,old.mountPath]));await undo?.();
    throw new ConfigurationError(503,'媒体根重载失败，已恢复原配置；请重试。');
   }
   await undo?.commit?.();
   return{path:binding.path,canInitialize:true,status:'ready'};
  }finally{this.busy=false;}
 }
}
