import type {PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {safeAssetOutputPath} from '../worker/controlledMediaExecutor.js';
import {verifyEpisodeFile} from './episodeFiles.js';
export async function persistPublicationFile(c:PoolClient,root:string,episodeId:string,path:string,bytes:Buffer){
 const file={relativePath:path,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length};
 try{await writeFile(await safeAssetOutputPath(root,path),bytes,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;await verifyEpisodeFile(c,root,episodeId,path,file.sha256,file.fileSize);}
 await c.query('INSERT INTO local_identity.workspace_publication_files(episode_id,relative_path,sha256,file_size) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[episodeId,path,file.sha256,file.fileSize]);return file;
}
