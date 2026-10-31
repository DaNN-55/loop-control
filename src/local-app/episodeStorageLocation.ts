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
 try{assetRoot=mappedAssetPath(mediaRoot,row.asset_root,await readMediaDeployment(c,mediaRoot));}catch(error){if(error instanceof ConfigurationError)throw error;throw new ConfigurationError(409,'生产单目录不在当前授权位置，请检查存储恢复回执。');}
 return storageLocationAtRoot(row,assetRoot);
}
/** The caller supplies an already resolved, authorized account I/O root. */
export async function episodeStorageLocationAtRoot(c:Pick<PoolClient,'query'>,assetRoot:string,episodeId:string){
 const row=(await c.query('SELECT * FROM local_identity.episode_storage_location($1)',[episodeId])).rows[0];
 if(!row)throw new ConfigurationError(404,'生产单不可见。');
 return storageLocationAtRoot(row,assetRoot);
}
function storageLocationAtRoot(row:Record<string,unknown>,assetRoot:string){
 if(typeof row.directory_relative_path!=='string'||!safeRelative(row.directory_relative_path))throw new ConfigurationError(409,'生产单目录记录无效，请检查存储恢复回执。');
 const directoryPath=join(assetRoot,row.directory_relative_path);
 if(!assetPathWithin(assetRoot,directoryPath))throw new ConfigurationError(409,'生产单目录超出账号范围。');
 return{accountId:row.account_id as string,assetRoot,relativePath:row.directory_relative_path as string,directoryPath,deviceId:row.directory_device_id as string|null,inodeId:row.directory_inode_id as string|null,storageSeriesId:row.storage_series_id as string|null,layoutVersion:row.layout_version as number};
}
export type EpisodeStorageLocation=Awaited<ReturnType<typeof resolveEpisodeStorageLocation>>;

/** Read/open never mkdir or replace a missing directory. */
export async function requireEpisodeStorageDirectory(c:Pick<PoolClient,'query'>,location:EpisodeStorageLocation){
 try{
  const account=(await c.query('SELECT * FROM local_identity.account_asset_directories WHERE account_id=$1',[location.accountId])).rows[0];
  const root=await lstat(location.assetRoot,{bigint:true});
  if(!root.isDirectory()||root.isSymbolicLink()||await realpath(location.assetRoot)!==location.assetRoot)throw new ConfigurationError(409,'账号目录路径身份已变化，请恢复原位置或检查目录迁移回执。');
  if(account?.actual_root===location.assetRoot&&(String(root.dev)!==account.device_id||String(root.ino)!==account.inode_id))throw new ConfigurationError(409,'账号目录身份已变化，请恢复原挂载或检查目录迁移回执。');
  if(location.assetRoot.startsWith('/Volumes/')){const volume=location.assetRoot.split('/').slice(0,3).join('/');if((await lstat(volume)).dev===(await lstat('/Volumes')).dev)throw new ConfigurationError(409,'生产单所在外部盘尚未挂载，请重新连接后重试。');}
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
 const location=await episodeStorageLocationAtRoot(c,assetRoot,episodeId);
 await requireEpisodeStorageDirectory(c,location);
 try{await access(location.directoryPath,constants.W_OK);}catch{throw new ConfigurationError(403,'没有写入生产单目录的权限，请恢复访问权限后重试。');}
 const fs=await statfs(location.directoryPath);if(fs.bavail*fs.bsize<minimumFreeBytes)throw new ConfigurationError(409,'生产单存储空间不足，请释放空间后重试。');
 return location;
}
