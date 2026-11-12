import {readEpisodeCollection,planEpisodeCollectionCommand} from './episodeCollection.js';
import {createStorageContainer,ownedContainerAccount,readStorageContainer,resolveStorageContainer,requireStorageContainer} from './seriesDirectories.js';
import {planLegacyStorageAdoption,planAccountDirectoryMigration,readAccountDirectoryMigrations,executeAccountDirectoryMigration} from './accountDirectoryMigration.js';
import {readAccountAssetDirectory,setAccountAssetDirectory,requireAccountAssetRoot} from './accountAssetRoots.js';
import type {Pool,PoolClient} from 'pg';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isAbsolute,resolve} from 'node:path';
import type {OwnerSession} from './sessions.js';
import {sessionTransaction} from './ownerTransaction.js';
import {canonicalFingerprint,ConfigurationError} from './configurationCommands.js';
import {resolveLocalAssetRoot} from './mediaDeployment.js';
import type {LocalEpisodeCommands} from './episodeCommands.js';
const exec=promisify(execFile),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface AccountDirectoryActions{choose(root:string,signal:AbortSignal):Promise<string|null>;open(path:string):Promise<void>}
const nativeDirectories:AccountDirectoryActions={
 async choose(root,signal){
  if(process.platform!=='darwin')throw new ConfigurationError(501,'当前本机不支持目录选择器，请直接填写已授权路径。');
  try{const {stdout}=await exec('/usr/bin/osascript',['-e','on run argv\nactivate\nreturn POSIX path of (choose folder with prompt "选择账号资产目录" default location (POSIX file (item 1 of argv)))\nend run','--',root],{env:{PATH:'/usr/bin:/bin'},signal,killSignal:'SIGKILL',timeout:120000,maxBuffer:8192});const path=stdout.trim();if(!isAbsolute(path))throw Error();return resolve(path);}
  catch(error){if(/\(-128\)/.test(String((error as {stderr?:string}).stderr)))return null;if(error instanceof ConfigurationError)throw error;throw new ConfigurationError(503,'未能选择本地文件夹，请重试或填写已授权路径。');}
 },
 async open(path){try{await exec(process.platform==='darwin'?'/usr/bin/open':process.platform==='win32'?'explorer.exe':'xdg-open',[path],{env:{PATH:process.env.PATH},timeout:5000,maxBuffer:8192});}catch{throw new ConfigurationError(503,'无法打开本地文件夹，请检查本机桌面环境。');}},
};
export class LocalAccountCommands{
 private choosing=false;
 private chooserAbort?:AbortController;
 private closed=false;
 constructor(private pool:Pool,private mediaRoot:string,_episodes?:LocalEpisodeCommands,private directories:AccountDirectoryActions=nativeDirectories){}
 close(){this.closed=true;this.chooserAbort?.abort();}
 private async account(c:PoolClient,session:OwnerSession,id:unknown){
  if(!(await c.query('SELECT local_identity.lock_owned_account_row($1) owned',[id])).rows[0].owned)throw new ConfigurationError(404,'账号不可见。');
  const row=(await c.query("SELECT a.id,a.current_blueprint_version_id,b.policy,md5(b.policy::text) revision FROM public.accounts a JOIN public.account_memberships m ON m.account_id=a.id LEFT JOIN public.account_blueprint_versions b ON b.id=a.current_blueprint_version_id WHERE a.id=$1 AND m.user_id=$2 AND m.role='owner' AND a.archived_at IS NULL",[id,session.id])).rows[0];
  if(!row)throw new ConfigurationError(404,'账号不可见。');if(this.closed)throw new ConfigurationError(503,'本机服务正在退出。');return row;
 }
 async execute(session:OwnerSession,body:Record<string,unknown>,signal?:AbortSignal){
  if(this.closed)throw new ConfigurationError(503,'本机服务正在退出。');
  if(!['readEpisodeCollection','planEpisodeCollectionMove','planLegacyStorageAdoption','readSeriesDirectory','openSeriesDirectory','readUnassignedDirectory','openUnassignedDirectory','createUnassignedDirectory','chooseAssetDirectory','openAssetDirectory','setAssetDirectory','readAssetDirectory','planAssetDirectoryMigration','readAssetDirectoryMigrations','executeAssetDirectoryMigration','rollbackAssetDirectoryMigration'].includes(String(body.command))||Object.keys(body).some(k=>!['command','data','idempotencyKey'].includes(k))||typeof body.idempotencyKey!=='string'||!uuid.test(body.idempotencyKey)||!body.data||typeof body.data!=='object'||Array.isArray(body.data))throw new ConfigurationError(400,'账号本机操作无效。');
  const data=body.data as Record<string,unknown>,choose=body.command==='chooseAssetDirectory';
  if(body.command==='readEpisodeCollection'){
   if(typeof data.episodeId!=='string'||!uuid.test(data.episodeId)||Object.keys(data).some(k=>k!=='episodeId'))throw new ConfigurationError(400,'系列读取只接受生产单身份。');
   return sessionTransaction(this.pool,session,c=>readEpisodeCollection(c,this.mediaRoot,String(data.episodeId)));
  }
  if(body.command==='planEpisodeCollectionMove'){
   if(typeof data.episodeId!=='string'||!uuid.test(data.episodeId)||data.seriesId!==null&&(typeof data.seriesId!=='string'||!uuid.test(data.seriesId))||Object.keys(data).some(k=>!['episodeId','seriesId'].includes(k)))throw new ConfigurationError(400,'系列调整只接受生产单与目标系列身份。');
   return planEpisodeCollectionCommand(this.pool,session,this.mediaRoot,body,String(data.episodeId),data.seriesId as string|null);
  }
  if(body.command==='planLegacyStorageAdoption'){
   if(typeof data.accountId!=='string'||!uuid.test(data.accountId)||Object.keys(data).some(k=>k!=='accountId'))throw new ConfigurationError(400,'纳管计划只接受账号身份。');
   return sessionTransaction(this.pool,session,async c=>{await this.account(c,session,data.accountId);return planLegacyStorageAdoption(c,this.mediaRoot,String(data.accountId));});
  }
  if(['readSeriesDirectory','openSeriesDirectory','readUnassignedDirectory','openUnassignedDirectory','createUnassignedDirectory'].includes(String(body.command))){
   const series=String(body.command).includes('Series'),field=series?'seriesId':'accountId';
   if(typeof data[field]!=='string'||!uuid.test(String(data[field]))||Object.keys(data).some(k=>k!==field))throw new ConfigurationError(400,'系列目录参数无效。');
   if(body.command==='createUnassignedDirectory')return createStorageContainer(this.pool,session,body.idempotencyKey,canonicalFingerprint(body),data,this.mediaRoot,'unassigned');
   return sessionTransaction(this.pool,session,async c=>{const accountId=await ownedContainerAccount(c,series?String(data.seriesId):null,series?undefined:String(data.accountId));
    if(String(body.command).startsWith('read'))return readStorageContainer(c,this.mediaRoot,accountId,series?String(data.seriesId):null);
    const location=await resolveStorageContainer(c,this.mediaRoot,accountId,series?String(data.seriesId):null);await this.directories.open(await requireStorageContainer(c,this.mediaRoot,location));return{opened:true};
   });
  }
  if(['planAssetDirectoryMigration','readAssetDirectoryMigrations','executeAssetDirectoryMigration','rollbackAssetDirectoryMigration'].includes(String(body.command))){
   const planning=body.command==='planAssetDirectoryMigration',reading=body.command==='readAssetDirectoryMigrations';
   if(typeof data.accountId!=='string'||!uuid.test(data.accountId)||Object.keys(data).some(k=>!['accountId',...(planning?['path']:reading?[]:['migrationId'])].includes(k))||!planning&&!reading&&(typeof data.migrationId!=='string'||!uuid.test(data.migrationId)))throw new ConfigurationError(400,'目录迁移参数无效。');
   if(planning||reading)return sessionTransaction(this.pool,session,async c=>{await this.account(c,session,data.accountId);return planning?planAccountDirectoryMigration(c,this.mediaRoot,String(data.accountId),data.path):readAccountDirectoryMigrations(c,String(data.accountId));});
   await sessionTransaction(this.pool,session,c=>this.account(c,session,data.accountId));
   return executeAccountDirectoryMigration(this.pool,session,this.mediaRoot,String(data.accountId),String(data.migrationId),body.command==='rollbackAssetDirectoryMigration',signal);
  }
  if(['readAssetDirectory','setAssetDirectory'].includes(String(body.command))){
   if(typeof data.accountId!=='string'||!uuid.test(data.accountId)||Object.keys(data).some(k=>!['accountId',...(body.command==='setAssetDirectory'?['path']:[])].includes(k)))throw new ConfigurationError(400,'账号目录参数无效。');
   return sessionTransaction(this.pool,session,async c=>{await this.account(c,session,data.accountId);return body.command==='setAssetDirectory'?setAccountAssetDirectory(c,this.mediaRoot,String(data.accountId),data.path):readAccountAssetDirectory(c,this.mediaRoot,String(data.accountId));});
  }
  if(body.command==='openAssetDirectory'){
   if(typeof data.accountId!=='string'||!uuid.test(data.accountId)||Object.keys(data).some(k=>k!=='accountId'))throw new ConfigurationError(400,'账号目录参数无效。');
   return sessionTransaction(this.pool,session,async c=>{await this.account(c,session,data.accountId);const path=await requireAccountAssetRoot(c,this.mediaRoot,String(data.accountId));await this.directories.open(path);return{opened:true};});
  }
  if(typeof data.accountId!=='string'||!uuid.test(data.accountId)||Object.keys(data).some(k=>k!=='accountId'))throw new ConfigurationError(400,'账号或目录参数无效。');
  if(choose){
   await sessionTransaction(this.pool,session,c=>this.account(c,session,data.accountId));
   if(this.choosing)throw new ConfigurationError(409,'已有文件夹选择窗口，请先完成或取消。');this.choosing=true;this.chooserAbort=new AbortController();
   try{const path=await this.directories.choose(this.mediaRoot,signal?AbortSignal.any([signal,this.chooserAbort.signal]):this.chooserAbort.signal);return await sessionTransaction(this.pool,session,async c=>{await this.account(c,session,data.accountId);if(path===null)return{cancelled:true};return{assetRoot:await resolveLocalAssetRoot(c,this.mediaRoot,path)};});}finally{this.choosing=false;this.chooserAbort=undefined;}
  }
  throw new ConfigurationError(400,'账号本机操作无效。');
 }
}
