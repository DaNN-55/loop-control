import type {PoolClient} from 'pg';
import {join,relative} from 'node:path';
import {episodeStorageLocationAtRoot,requireEpisodeStorageDirectory,type EpisodeStorageLocation} from './episodeStorageLocation.js';
import {safeRelative,verifyNativeFile} from './localFiles.js';
import {ConfigurationError} from './configurationCommands.js';

/** The caller first owns/registers the original reference. Frozen coordinates stay
 * unchanged; future persisted prefix lineage is interpreted only at this I/O seam. */
export async function resolveEpisodeFileReference(_c:Pick<PoolClient,'query'>,location:EpisodeStorageLocation,reference:string){
 if(!safeRelative(reference))throw new ConfigurationError(400,'文件路径无效。');
 return join(location.assetRoot,reference);
}
export async function verifyEpisodeFile(c:Pick<PoolClient,'query'>,assetRoot:string,episodeId:string,reference:string,sha256:string,size:number){
 const location=await episodeStorageLocationAtRoot(c,assetRoot,episodeId);await requireEpisodeStorageDirectory(c,location);
 const path=await resolveEpisodeFileReference(c,location,reference);
 return verifyNativeFile(assetRoot,relative(assetRoot,path),sha256,size);
}
