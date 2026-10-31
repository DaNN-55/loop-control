import {resolveEpisodeFileReference} from './episodeFiles.js';
import {resolveEpisodeStorageLocation,requireEpisodeStorageDirectory} from './episodeStorageLocation.js';
import {join} from 'node:path';
import {safeRelative} from './localFiles.js';
import{createHash}from'node:crypto';
import{mappedAssetPath}from'./mediaPaths.js';
import{readMediaDeployment}from'./mediaDeployment.js';
import {ownerTransaction} from './ownerTransaction.js';
import type {Pool} from 'pg';
export async function readLocalEpisode(pool:Pool,ownerId:string,episodeId:string,known:Record<string,string>={},mediaRoot?:string){
 return ownerTransaction(pool,ownerId,true,async client=>{
  const {rows:[row]}=await client.query('SELECT public.read_episode_production($1,$2) AS result',[episodeId,known]);if(!row.result||!mediaRoot)return row.result;
  const b=(await client.query("SELECT s.asset_root root,s.directory_relative_path,local_identity.is_historical_episode($1) historical FROM local_identity.episode_storage_location($1) s",[episodeId])).rows[0],roots=await readMediaDeployment(client,mediaRoot);let localAssetRoot='';try{localAssetRoot=mappedAssetPath(mediaRoot,b?.root,roots);}catch{/* No unsafe fallback to a logical source path. */}
  const localDirectoryPath=localAssetRoot&&typeof b?.directory_relative_path==='string'&&safeRelative(b.directory_relative_path)?join(localAssetRoot,b.directory_relative_path):'';
  const hash=createHash('sha256').update(localAssetRoot+localDirectoryPath+String(Boolean(b?.historical))).digest('hex');return{...row.result,hashes:{...row.result.hashes,localAssetRoot:hash},sections:{...row.result.sections,...(known.localAssetRoot===hash?{}:{localAssetRoot,localDirectoryPath,historicalReadOnly:Boolean(b?.historical)})}};
 });
}
export async function findOwnedArtifact(pool:Pool,ownerId:string,id:string,mediaRoot?:string){
 return ownerTransaction(pool,ownerId,true,async client=>{
  const {rows:[artifact]}=await client.query(`SELECT a.episode_id,a.relative_path,a.sha256,a.file_size,local_identity.episode_asset_root(e.id) AS source_asset_root,coalesce(r.source_media_root,local_identity.media_deployment()->>'targetRoot') source_media_root,local_identity.media_deployment()->'sourceRoots' AS source_media_roots,local_identity.media_deployment()->>'targetRoot' AS expected_media_root FROM public.artifacts a JOIN public.episodes e ON e.id=a.episode_id JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id LEFT JOIN local_identity.import_record r ON true JOIN public.account_memberships m ON m.account_id=e.account_id WHERE a.id=$1 AND m.user_id=$2 AND m.role='owner'`,[id,ownerId]);if(!artifact)return artifact;
  const location=await resolveEpisodeStorageLocation(client,mediaRoot??artifact.expected_media_root??artifact.source_media_root,artifact.episode_id);await requireEpisodeStorageDirectory(client,location);return{...artifact,storage_location:location,resolved_file_path:await resolveEpisodeFileReference(client,location,artifact.relative_path)};
 });
}
export async function findOwnedInputFile(pool:Pool,ownerId:string,episodeId:string,path:string,mediaRoot?:string){
 return ownerTransaction(pool,ownerId,true,async c=>{
  const existing=(await c.query(`SELECT f.relative_path,f.sha256,f.file_size,local_identity.episode_asset_root(e.id) source_asset_root,coalesce(r.source_media_root,local_identity.media_deployment()->>'targetRoot') source_media_root,local_identity.media_deployment()->'sourceRoots' AS source_media_roots,local_identity.media_deployment()->>'targetRoot' AS expected_media_root FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id LEFT JOIN local_identity.import_record r ON true JOIN LATERAL(SELECT relative_path,sha256,file_size FROM public.artifacts WHERE episode_id=e.id UNION ALL SELECT storage_path,sha256,file_size FROM public.production_material_revisions WHERE episode_id=e.id)f ON true WHERE e.id=$1 AND m.user_id=$2 AND m.role='owner' AND f.relative_path=$3 LIMIT 1`,[episodeId,ownerId,path])).rows[0];
  const withLocation=async(file:typeof existing)=>{if(!file)return null;const location=await resolveEpisodeStorageLocation(c,mediaRoot??file.expected_media_root??file.source_media_root,episodeId);await requireEpisodeStorageDirectory(c,location);return{...file,storage_location:location,resolved_file_path:await resolveEpisodeFileReference(c,location,file.relative_path)};};
  if(existing)return withLocation(existing);
  if(!(await c.query("SELECT to_regclass('local_identity.workspace_exports') present")).rows[0].present)return null;
  return withLocation((await c.query(`SELECT f->>'relativePath' relative_path,f->>'sha256' sha256,f->>'fileSize' file_size,local_identity.episode_asset_root(e.id) source_asset_root,coalesce(r.source_media_root,local_identity.media_deployment()->>'targetRoot') source_media_root,local_identity.media_deployment()->'sourceRoots' AS source_media_roots,local_identity.media_deployment()->>'targetRoot' AS expected_media_root
   FROM local_identity.workspace_exports x JOIN public.episodes e ON e.id=x.episode_id JOIN public.account_memberships m ON m.account_id=e.account_id JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id LEFT JOIN local_identity.import_record r ON true CROSS JOIN LATERAL jsonb_array_elements(jsonb_build_array(x.artifact,x.project)) f
   WHERE e.id=$1 AND m.user_id=$2 AND m.role='owner' AND f->>'relativePath'=$3 LIMIT 1`,[episodeId,ownerId,path])).rows[0]??null);
 });
}
