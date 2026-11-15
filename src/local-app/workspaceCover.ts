import type {PoolClient} from 'pg';
import {basename} from 'node:path';
import {parseWorkspaceCoverSource,type WorkspaceCoverInput,type WorkspaceCoverSource} from '../workspaceCover.js';
import {ConfigurationError} from './configurationCommands.js';

/** Cover inputs are optional candidates, never an adopted cover or file authority. */
export async function readWorkspaceCoverInputs(c:PoolClient,row:{episode_id:string;preparation_revision_id:string}):Promise<WorkspaceCoverInput[]>{
 const declared=(await c.query('SELECT manifest->\'coverInputs\' inputs FROM local_identity.production_preparation_revisions WHERE id=$1 AND episode_id=$2',[row.preparation_revision_id,row.episode_id])).rows[0]?.inputs??[];
 let sources:WorkspaceCoverSource[];
 try{if(!Array.isArray(declared))throw Error();sources=declared.map(parseWorkspaceCoverSource);}catch{throw new ConfigurationError(409,'制作基准的封面输入协议无法核验。');}
 const materialIds=sources.filter(s=>s.kind==='material').map(s=>s.id);
 const records=(await c.query(`SELECT 'material'::text kind,id,source_path name,storage_path path,sha256,file_size FROM public.production_material_revisions WHERE episode_id=$1 AND material_type='image' AND (material_purpose='cover' OR id=ANY($2::uuid[]))
 UNION ALL SELECT 'artifact',id,relative_path,relative_path,sha256,file_size FROM public.artifacts WHERE episode_id=$1 AND artifact_type='cover'`,[row.episode_id,materialIds])).rows;
 for(const record of records)if(!sources.some(s=>s.kind===record.kind&&s.id===record.id))sources.push({version:'workspace-cover-source/v1',kind:record.kind,id:record.id,sha256:record.sha256});
 return sources.map(source=>{
  const record=records.find(r=>r.kind===source.kind&&r.id===source.id),size=Number(record?.file_size);
  const unavailableReason=!record||record.sha256!==source.sha256?'原封面登记或指纹已变化，请核对原版本。':!Number.isSafeInteger(size)||size<1||size>20*1024*1024?'原封面大小不符合当前交付要求，请另选封面。':undefined;
  return{source,name:record?basename(record.name):'原封面',...(unavailableReason?{unavailableReason}:{file:{relativePath:record.path,sha256:record.sha256,fileSize:size}})};
 });
}
