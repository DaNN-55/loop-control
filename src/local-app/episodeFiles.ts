import type {PoolClient} from 'pg';
import {join,relative} from 'node:path';
import {episodeStorageLocationAtRoot,requireEpisodeStorageDirectory,requireWritableEpisodeStorage,type EpisodeStorageLocation} from './episodeStorageLocation.js';
import {safeRelative,verifyNativeFile} from './localFiles.js';
import {ConfigurationError} from './configurationCommands.js';

/** The caller first owns/registers the original reference. Frozen coordinates stay
 * unchanged; future persisted prefix lineage is interpreted only at this I/O seam. */
interface Coordinate{root:string;prefix:string;device:string|null;inode:string|null}
export interface EpisodeStorageEdge{source_root:string;source_prefix:string;source_device_id:string;source_inode_id:string;target_root:string;target_prefix:string;target_device_id:string;target_inode_id:string;operation_id:string}
const same=(a:Coordinate,b:Coordinate)=>a.root===b.root&&a.prefix===b.prefix&&a.device===b.device&&a.inode===b.inode;
const source=(e:EpisodeStorageEdge):Coordinate=>({root:e.source_root,prefix:e.source_prefix,device:e.source_device_id,inode:e.source_inode_id});
const target=(e:EpisodeStorageEdge):Coordinate=>({root:e.target_root,prefix:e.target_prefix,device:e.target_device_id,inode:e.target_inode_id});
async function lineage(c:Pick<PoolClient,'query'>,location:EpisodeStorageLocation):Promise<EpisodeStorageEdge[]>{
 if(!(await c.query("SELECT to_regprocedure('local_identity.episode_completed_storage_lineage(uuid)') IS NOT NULL present")).rows[0]?.present)return[];
 return(await c.query('SELECT * FROM local_identity.episode_completed_storage_lineage($1)',[location.episodeId])).rows;
}
function reachesCurrent(start:Coordinate,edges:EpisodeStorageEdge[],location:EpisodeStorageLocation){
 const current={root:location.authorityRoot,prefix:location.relativePath,device:location.deviceId,inode:location.inodeId};
 const visited=new Set<string>();let point=start;
 for(let i=0;i<=edges.length;i++){
  if(same(point,current))return true;
  const key=JSON.stringify(point);if(visited.has(key))return false;visited.add(key);
  const next=edges.filter(e=>same(source(e),point));if(next.length!==1)return false;point=target(next[0]);
 }return false;
}
export async function resolveEpisodeFileReference(c:Pick<PoolClient,'query'>,location:EpisodeStorageLocation,reference:string){
 if(!safeRelative(reference))throw new ConfigurationError(400,'文件路径无效。');
 if(reference.startsWith(location.relativePath+'/'))return join(location.assetRoot,reference);
 const edges=await lineage(c,location),matches=edges.filter(e=>reference.startsWith(e.source_prefix+'/')&&reachesCurrent(source(e),edges,location));
 const suffixes=[...new Set(matches.map(e=>reference.slice(e.source_prefix.length+1)))];
 if(suffixes.length!==1)throw new ConfigurationError(409,'文件引用缺少本生产单的完整位置迁移证明。');
 return join(location.directoryPath,suffixes[0]);
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
  if(current.accountId!==location.accountId||current.authorityRoot!==location.authorityRoot||current.relativePath!==location.relativePath||current.deviceId!==location.deviceId||current.inodeId!==location.inodeId)throw new ConfigurationError(409,'生产单位置已变化，请重新打开当前工程。');
  if(!writable)await requireEpisodeStorageDirectory(c,current);
 };
 return {relativePath:location.relativePath,assetRoot:location.assetRoot,resolveReference:(reference:string)=>resolveEpisodeFileReference(c,location,reference),assertValid,
  async assertFrozenDirectory(prefix:string,expected?:{deviceId:string|null;inodeId:string|null},root?:string){
   await assertValid();root=root?.replace(/\/+$/,'');
   if(prefix===location.relativePath&&(!root||root===location.assetRoot)&&(!expected?.deviceId||expected.deviceId===location.deviceId&&expected.inodeId===location.inodeId))return location.directoryPath;
   const edges=await lineage(c,location);
   if(!edges.some(e=>e.source_prefix===prefix&&(!root||e.source_root===root)&&(!expected?.deviceId||e.source_device_id===expected.deviceId&&e.source_inode_id===expected.inodeId)&&reachesCurrent(source(e),edges,location)))throw new ConfigurationError(409,'冻结生产单目录缺少完整身份迁移证明。');
   return location.directoryPath;
  },
  async referencePrefixes(){const edges=await lineage(c,location);return[...new Set([location.relativePath,...edges.filter(e=>reachesCurrent(source(e),edges,location)).map(e=>e.source_prefix)])];}
  ,async referenceAliases(reference:string){const physical=await resolveEpisodeFileReference(c,location,reference),suffix=relative(location.directoryPath,physical),edges=await lineage(c,location);return[...new Set([physical,location.relativePath+'/'+suffix,...edges.filter(e=>reachesCurrent(source(e),edges,location)).flatMap(e=>[e.source_prefix+'/'+suffix,join(e.source_root,e.source_prefix,suffix)])])];}

 };
}
export type EpisodeFileIO=Awaited<ReturnType<typeof episodeFileIO>>;
