import type {PoolClient} from 'pg';
import {access,lstat,realpath,statfs} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {ConfigurationError} from './configurationCommands.js';
import {mappedAssetPath,assetPathWithin} from './mediaPaths.js';
import {readMediaDeployment} from './mediaDeployment.js';
import {safeRelative} from './localFiles.js';

/** Location lookup has no filesystem side effects, including for missing mounts. */
export async function resolveEpisodeStorageLocation(c:Pick<PoolClient,'query'>,mediaRoot:string,episodeId:string){
 const row=(await c.query('SELECT * FROM local_identity.episode_storage_location($1)',[episodeId])).rows[0];
 if(!row)throw new ConfigurationError(404,'生产单不可见。');
 let assetRoot:string;
 try{
  const aliases=await readMediaDeployment(c,mediaRoot);
  // Only a trusted episode location can interpret the shared legacy root itself.
  // mappedAssetPath intentionally continues to reject it as an account root.
  const logicalRoot=typeof row.asset_root==='string'?row.asset_root.replace(/\/+$/,''):row.asset_root;
  assetRoot=row.layout_version===1&&row.directory_relative_path==='episodes/'+episodeId&&(logicalRoot===mediaRoot||aliases.some(alias=>alias.replace(/\/+$/,'')===logicalRoot))?mediaRoot:mappedAssetPath(mediaRoot,row.asset_root,aliases);
 }catch(error){if(error instanceof ConfigurationError)throw error;throw new ConfigurationError(409,'生产单目录不在当前授权位置，请检查存储恢复回执。');}
 return storageLocationAtRoot(row,assetRoot,episodeId,assetRoot);
}
/** The caller supplies an already resolved, authorized account I/O root. */
export async function episodeStorageLocationAtRoot(c:Pick<PoolClient,'query'>,assetRoot:string,episodeId:string){
 const row=(await c.query('SELECT * FROM local_identity.episode_storage_location($1)',[episodeId])).rows[0];
 if(!row)throw new ConfigurationError(404,'生产单不可见。');
 const authority=(await c.query("SELECT to_regprocedure('local_identity.storage_physical_root(text)') IS NOT NULL present")).rows[0]?.present?(await c.query('SELECT local_identity.storage_physical_root($1) root',[row.asset_root])).rows[0]?.root:assetRoot;
 return storageLocationAtRoot(row,assetRoot,episodeId,authority??assetRoot);
}
function storageLocationAtRoot(row:Record<string,unknown>,assetRoot:string,episodeId:string,authorityRoot:string){
 if(typeof row.directory_relative_path!=='string'||!safeRelative(row.directory_relative_path))throw new ConfigurationError(409,'生产单目录记录无效，请检查存储恢复回执。');
 const directoryPath=join(assetRoot,row.directory_relative_path);
 if(!assetPathWithin(assetRoot,directoryPath))throw new ConfigurationError(409,'生产单目录超出账号范围。');
 return{episodeId,accountId:row.account_id as string,assetRoot,authorityRoot,relativePath:row.directory_relative_path as string,directoryPath,deviceId:row.directory_device_id as string|null,inodeId:row.directory_inode_id as string|null,storageSeriesId:row.storage_series_id as string|null,layoutVersion:row.layout_version as number};
}
export type EpisodeStorageLocation=Awaited<ReturnType<typeof resolveEpisodeStorageLocation>>;

/** SQL110 registration predates containers: layout2 alone is not a collection.
 * NULL storageSeries means unassigned only with a matching real container. */
export async function resolveEpisodeStorageCollection(c:Pick<PoolClient,'query'>,location:EpisodeStorageLocation){
 const parts=location.relativePath.split('/');
 if(parts.length!==2||location.deviceId===null)return{status:'legacy' as const,container:null};
 if(!(await c.query("SELECT to_regprocedure('local_identity.episode_storage_collection(uuid)') IS NOT NULL present")).rows[0]?.present)return{status:'legacy' as const,container:null};
 const row=(await c.query('SELECT * FROM local_identity.episode_storage_collection($1)',[location.episodeId])).rows[0];
 if(!row||row.account_root!==location.assetRoot)return{status:'legacy' as const,container:null};
 return{status:'registered' as const,container:{id:row.container_id as string,kind:row.kind as 'series'|'unassigned',seriesId:row.series_id as string|null,relativePath:row.directory_relative_path as string,deviceId:row.device_id as string,inodeId:row.inode_id as string}};
}

/** Read/open never mkdir or replace a missing directory. */
export async function requireEpisodeStorageDirectory(c:Pick<PoolClient,'query'>,location:EpisodeStorageLocation){
 try{
  const account=(await c.query('SELECT * FROM local_identity.account_asset_directories WHERE account_id=$1',[location.accountId])).rows[0];
  const root=await lstat(location.assetRoot,{bigint:true});
  if(!root.isDirectory()||root.isSymbolicLink()||await realpath(location.assetRoot)!==location.assetRoot)throw new ConfigurationError(409,'账号目录路径身份已变化，请恢复原位置或检查目录迁移回执。');
  if(account?.actual_root===location.assetRoot&&(String(root.dev)!==account.device_id||String(root.ino)!==account.inode_id))throw new ConfigurationError(409,'账号目录身份已变化，请恢复原挂载或检查目录迁移回执。');
  if(location.assetRoot.startsWith('/Volumes/')){const volume=location.assetRoot.split('/').slice(0,3).join('/');if((await lstat(volume)).dev===(await lstat('/Volumes')).dev)throw new ConfigurationError(409,'生产单所在外部盘尚未挂载，请重新连接后重试。');}
  const collection=await resolveEpisodeStorageCollection(c,location);
  if(collection.status==='registered'){const container=collection.container,path=join(location.assetRoot,container.relativePath),actual=await lstat(path,{bigint:true});if(!actual.isDirectory()||actual.isSymbolicLink()||await realpath(path)!==path||String(actual.dev)!==container.deviceId||String(actual.ino)!==container.inodeId)throw new ConfigurationError(409,'生产单上级系列目录身份已变化，请恢复原位置或检查迁移回执。');}
  const directory=await lstat(location.directoryPath,{bigint:true});
  if(!directory.isDirectory()||directory.isSymbolicLink()||await realpath(location.directoryPath)!==location.directoryPath)throw new ConfigurationError(409,'生产单目录路径身份已变化，请恢复原目录或检查目录迁移回执。');
  if(location.deviceId!==null&&(String(directory.dev)!==location.deviceId||String(directory.ino)!==location.inodeId))throw new ConfigurationError(409,'生产单目录身份已变化，请恢复原目录或检查目录迁移回执。');
  await access(location.directoryPath,constants.R_OK|constants.X_OK);
  return location.directoryPath;
 }catch(error){
  if(error instanceof ConfigurationError)throw error;
  const code=(error as NodeJS.ErrnoException).code;
  if(code==='ENOENT')throw new ConfigurationError(409,'生产单目录缺失或存储盘未挂载，请恢复原目录或连接存储盘后重试。');
  if(code==='EACCES'||code==='EPERM')throw new ConfigurationError(403,'没有读取生产单目录的权限，请在系统设置中恢复访问权限后重试。');
  throw new ConfigurationError(409,'生产单目录不可用，请检查存储位置后重试。');
 }
}

/** Write preflight shares the same persisted location and filesystem identity as reads. */
export async function requireWritableEpisodeStorage(c:Pick<PoolClient,'query'>,assetRoot:string,episodeId:string,minimumFreeBytes=0){
 if((await c.query("SELECT (local_identity.media_deployment()->>'writeBlocked')::boolean blocked")).rows[0].blocked)throw new ConfigurationError(409,'媒体根迁移尚未完成，请继续或回滚原计划。');
 const location=await episodeStorageLocationAtRoot(c,assetRoot,episodeId);
 if((await c.query("SELECT 1 FROM local_identity.account_directory_migrations WHERE account_id=$1 AND status='copying'",[location.accountId])).rowCount)throw new ConfigurationError(409,'账号目录正在迁移，请先恢复或回滚原操作。');
 await requireEpisodeStorageDirectory(c,location);
 try{await access(location.directoryPath,constants.W_OK);}catch{throw new ConfigurationError(403,'没有写入生产单目录的权限，请恢复访问权限后重试。');}
 const fs=await statfs(location.directoryPath);if(fs.bavail*fs.bsize<minimumFreeBytes)throw new ConfigurationError(409,'生产单存储空间不足，请释放空间后重试。');
 return location;
}
