import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {parseProductionScript} from '../reviews/productionScript';
import {snapshotInput} from './localFiles';
import {episodeStorageLocationAtRoot} from './episodeStorageLocation';

/** Reconstruct an already registered v2 record; never reopen the retired HTTP write path. */
export async function installHistoricalMainScriptFixture(c:PoolClient,root:string,episodeId:string,ownerId:string,text:string){
 if(parseProductionScript(text)?.version!==2)throw Error('Historical script fixture requires v2');
 await c.query('BEGIN');
 try{
  await c.query("SELECT set_config('loop.owner_id',$1,true)",[ownerId]);
  const location=await episodeStorageLocationAtRoot(c,root,episodeId);
  const source=await snapshotInput(root,episodeId,{sourceKind:'file',sourcePath:'historical-v2.md',contentBase64:Buffer.from(text).toString('base64')},location.relativePath),id=randomUUID();
  const record=(await c.query("INSERT INTO public.production_material_revisions(id,episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,is_main_script,created_by,material_purpose) VALUES($1,$2,1,'script','file',$3,$4,'text/markdown',$5,$6,true,$7,'main_script') RETURNING *",[id,episodeId,source.sourcePath,source.storagePath,source.sha256,source.fileSize,ownerId])).rows[0];
  await c.query('UPDATE public.episodes SET main_script_revision_id=$2 WHERE id=$1',[episodeId,id]);
  await c.query('UPDATE local_identity.input_episodes SET script_template_version=2 WHERE episode_id=$1',[episodeId]);
  await c.query('COMMIT');return record;
 }catch(error){await c.query('ROLLBACK');throw error;}
}
