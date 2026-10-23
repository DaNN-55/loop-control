import type {Pool} from 'pg';
export async function readLocalEpisode(pool:Pool,ownerId:string,episodeId:string,known:Record<string,string>={}){
 const client=await pool.connect();
 try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SELECT set_config('loop.owner_id',$1,true)",[ownerId]);
  const {rows:[row]}=await client.query('SELECT public.read_episode_production($1,$2) AS result',[episodeId,known]);await client.query('COMMIT');return row.result;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function findOwnedArtifact(pool:Pool,ownerId:string,id:string){
 const client=await pool.connect();
 try{await client.query('BEGIN READ ONLY');await client.query("SELECT set_config('loop.owner_id',$1,true)",[ownerId]);
  const {rows:[artifact]}=await client.query(`SELECT a.relative_path,a.sha256,a.file_size,b.policy->>'asset_root' AS source_asset_root,r.source_media_root FROM public.artifacts a JOIN public.episodes e ON e.id=a.episode_id JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id CROSS JOIN local_identity.import_record r JOIN public.account_memberships m ON m.account_id=e.account_id WHERE a.id=$1 AND m.user_id=$2 AND m.role='owner'`,[id,ownerId]);await client.query('COMMIT');return artifact;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
