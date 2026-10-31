import {access,statfs} from 'node:fs/promises';
import {constants} from 'node:fs';
import type {PoolClient} from 'pg';
import {safeRelative} from './localFiles.js';
import {requireEpisodeStorageDirectory} from './episodeStorageLocation.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {ConfigurationError} from './configurationCommands.js';
export async function inspectWorkspaceVisualFile(root:string,path:string,kind:'video'|'image'){
 try{const {stdout}=await promisify(execFile)('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=codec_type,width,height,duration:format=duration','-of','json',join(root,path)],{timeout:15000});const p=JSON.parse(stdout),s=p.streams?.[0],width=Number(s?.width),height=Number(s?.height),durationSeconds=Number(s?.duration??p.format?.duration);
 if(!Number.isInteger(width)||width<1||!Number.isInteger(height)||height<1||kind==='video'&&(!Number.isFinite(durationSeconds)||durationSeconds<=0))throw Error();return{width,height,durationSeconds:kind==='video'?durationSeconds:null};
 }catch{throw new ConfigurationError(409,'视觉素材无法读取，请检查原始文件。');}
}

/** Account root is already authorized by the command; SQL110 owns its episode prefix. */
export async function requireVisualStorageLocation(c:PoolClient,assetRoot:string,episodeId:string,minimumFreeBytes=0){
 const row=(await c.query('SELECT * FROM local_identity.episode_storage_location($1)',[episodeId])).rows[0];
 if(!row||!safeRelative(row.directory_relative_path))throw new ConfigurationError(409,'生产单目录记录不可用。');
 const location={accountId:row.account_id,assetRoot,relativePath:row.directory_relative_path as string,directoryPath:join(assetRoot,row.directory_relative_path),deviceId:row.directory_device_id as string|null,inodeId:row.directory_inode_id as string|null,storageSeriesId:row.storage_series_id as string|null,layoutVersion:row.layout_version as number};
 await requireEpisodeStorageDirectory(c,location);
 try{await access(location.directoryPath,constants.W_OK);}catch{throw new ConfigurationError(403,'没有写入生产单目录的权限，请恢复访问权限后重试。');}
 const fs=await statfs(location.directoryPath);if(fs.bavail*fs.bsize<minimumFreeBytes)throw new ConfigurationError(409,'生产单存储空间不足，请释放空间后重试。');
 return location;
}
