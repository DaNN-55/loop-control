import type {PoolClient} from 'pg';
import {join,relative} from 'node:path';
import {episodeStorageLocationAtRoot,requireEpisodeStorageDirectory,requireWritableEpisodeStorage,type EpisodeStorageLocation} from './episodeStorageLocation.js';
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

/** Adapter over the persisted location/file boundary; original references remain keys. */
export async function episodeFileIO(c:Pick<PoolClient,'query'>,assetRoot:string,episodeId:string,writable=false){
 const location=writable?await requireWritableEpisodeStorage(c,assetRoot,episodeId):await episodeStorageLocationAtRoot(c,assetRoot,episodeId);
 if(!writable)await requireEpisodeStorageDirectory(c,location);
 const assertValid=async()=>{
  const current=writable?await requireWritableEpisodeStorage(c,assetRoot,episodeId):await episodeStorageLocationAtRoot(c,assetRoot,episodeId);
  if(current.relativePath!==location.relativePath||current.deviceId!==location.deviceId||current.inodeId!==location.inodeId)throw new ConfigurationError(409,'生产单位置已变化，请重新打开当前工程。');
  if(!writable)await requireEpisodeStorageDirectory(c,current);
 };
 return {relativePath:location.relativePath,resolveReference:(reference:string)=>resolveEpisodeFileReference(c,location,reference),assertValid};
}
export type EpisodeFileIO=Awaited<ReturnType<typeof episodeFileIO>>;
