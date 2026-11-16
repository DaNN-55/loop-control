import type {PoolClient} from 'pg';
import {parseProductionScript} from '../reviews/productionScript.js';
import {productionTemplateInputs,type TemplateMaterial} from '../workspaceTemplateInputs.js';
import {verifyEpisodeFile} from './episodeFiles.js';

/** Read from the workspace's frozen script, never a newly edited or unrelated script. */
export async function readWorkspaceTemplateInputs(c:PoolClient,root:string,row:{episode_id:string;script_revision_id:string}){
 const source=(await c.query("SELECT storage_path,sha256,file_size FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type='script'",[row.script_revision_id,row.episode_id])).rows[0];
 if(!source)return;
 const script=parseProductionScript((await verifyEpisodeFile(c,root,row.episode_id,source.storage_path,source.sha256,Number(source.file_size))).toString('utf8'));
 if(!script||script.version!==3)return;
 const records=(await c.query(`SELECT DISTINCT ON (m.source_path,m.material_type) m.*,n.name alias FROM public.production_material_revisions m
 LEFT JOIN local_identity.material_reference_names n ON n.material_id=m.id AND n.owner_id=local_identity.owner_id()
 WHERE m.episode_id=$1 AND NOT m.is_main_script ORDER BY m.source_path,m.material_type,m.revision_number DESC,m.created_at DESC,m.id`,[row.episode_id])).rows;
 const materials:TemplateMaterial[]=records.map(m=>({id:m.id,name:m.source_path,alias:m.alias??undefined,type:m.material_type,purpose:m.material_purpose,sha256:m.sha256,relativePath:m.storage_path,fileSize:Number(m.file_size)}));
 return productionTemplateInputs(script,materials);
}
