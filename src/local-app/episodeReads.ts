import {ownerTransaction} from './ownerTransaction.js';
import type {Pool} from 'pg';
export async function readLocalEpisode(pool:Pool,ownerId:string,episodeId:string,known:Record<string,string>={}){
 return ownerTransaction(pool,ownerId,true,async client=>{
  const {rows:[row]}=await client.query('SELECT public.read_episode_production($1,$2) AS result',[episodeId,known]);return row.result;
 });
}
export async function findOwnedArtifact(pool:Pool,ownerId:string,id:string){
 return ownerTransaction(pool,ownerId,true,async client=>{
  const {rows:[artifact]}=await client.query(`SELECT a.relative_path,a.sha256,a.file_size,b.policy->>'asset_root' AS source_asset_root,r.source_media_root FROM public.artifacts a JOIN public.episodes e ON e.id=a.episode_id JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id CROSS JOIN local_identity.import_record r JOIN public.account_memberships m ON m.account_id=e.account_id WHERE a.id=$1 AND m.user_id=$2 AND m.role='owner'`,[id,ownerId]);return artifact;
 });
}
export async function findOwnedInputFile(pool:Pool,ownerId:string,episodeId:string,path:string){
 return ownerTransaction(pool,ownerId,true,async c=>(await c.query(`SELECT f.relative_path,f.sha256,f.file_size,b.policy->>'asset_root' source_asset_root,r.source_media_root FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id CROSS JOIN local_identity.import_record r JOIN LATERAL(SELECT relative_path,sha256,file_size FROM public.artifacts WHERE episode_id=e.id UNION ALL SELECT storage_path,sha256,file_size FROM public.production_material_revisions WHERE episode_id=e.id)f ON true WHERE e.id=$1 AND m.user_id=$2 AND m.role='owner' AND f.relative_path=$3 LIMIT 1`,[episodeId,ownerId,path])).rows[0]??null);
}
