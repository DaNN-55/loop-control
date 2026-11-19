import {constants} from 'node:fs';
import {copyFile,lstat,mkdir,realpath} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileSha256} from '../worker/fileSha256.js';
import {ConfigurationError} from './configurationCommands.js';
export async function copyProductionMedia(source:string,destination:string,sha256:string,fileSize:number){
 const valid=async(path:string)=>{const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size!==fileSize||await realpath(path)!==resolve(path)||await fileSha256(path)!==sha256)throw new ConfigurationError(409,'副本来源或目标文件已变化，请保留当前修改后恢复原文件。');return s;};
 const before=await valid(source);await mkdir(dirname(destination),{recursive:true,mode:0o700});
 if(await realpath(dirname(destination))!==resolve(dirname(destination)))throw new ConfigurationError(409,'副本目录不是独立的实际目录。');
 try{await copyFile(source,destination,constants.COPYFILE_FICLONE|constants.COPYFILE_EXCL);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 const target=await valid(destination),after=await valid(source);
 if(before.dev!==after.dev||before.ino!==after.ino||before.mtimeMs!==after.mtimeMs||before.dev===target.dev&&before.ino===target.ino)throw new ConfigurationError(409,'副本文件未能独立保存，请重试。');
}
