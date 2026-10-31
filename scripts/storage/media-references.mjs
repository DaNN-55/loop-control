import {join} from 'node:path';
import {episodeStorageLocationAtRoot} from '../../dist/local-app/local-app/episodeStorageLocation.js';
import {resolveEpisodeFileReference} from '../../dist/local-app/local-app/episodeFiles.js';
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
export function storageReferences(query,extended=true){
 const root=query("SELECT to_regprocedure('local_identity.account_mapped_asset_root(text)') IS NOT NULL")==='t'?"local_identity.episode_asset_root(e.id)":query("SELECT to_regclass('local_identity.episode_asset_locations') IS NOT NULL")==='t'?"coalesce((SELECT l.asset_root FROM local_identity.episode_asset_locations l WHERE l.episode_id=e.id),b.policy->>'asset_root')":"b.policy->>'asset_root'";
 const selections=[];
 const add=(table,id,path,sha,size,from=`${table} a`,episode='a.episode_id',where='')=>selections.push(`SELECT (${id})::text reference_id,e.id episode_id,${quote(table.split('.').at(-1))} reference_table,${root} source_asset_root,(SELECT source_media_root FROM local_identity.import_record) source_media_root,${path} relative_path,${sha} sha256,(${size})::bigint file_size FROM ${from} JOIN public.episodes e ON e.id=${episode} JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id ${where}`);
 add('public.artifacts','a.id','a.relative_path','a.sha256','a.file_size');add('public.production_material_revisions','a.id','a.storage_path','a.sha256','a.file_size');add('public.audio_tracks','a.id','a.relative_path','a.sha256','a.file_size');
 if(extended){
  for(const table of ['production_workspaces','production_workspace_versions'])if(query(`SELECT to_regclass('local_identity.${table}') IS NOT NULL`)==='t')add('local_identity.'+table,table==='production_workspaces'?'a.id':"a.workspace_id::text||':'||a.project_sha256",'a.project_path','a.project_sha256','a.project_size');
  if(query("SELECT to_regclass('local_identity.workspace_legacy_recoveries') IS NOT NULL")==='t')add('local_identity.workspace_legacy_recoveries','a.workspace_id','a.relative_path','a.sha256','a.file_size','local_identity.workspace_legacy_recoveries a JOIN local_identity.production_workspaces w ON w.id=a.workspace_id','w.episode_id');
  if(query("SELECT to_regclass('local_identity.workspace_exports') IS NOT NULL")==='t'){
   add('local_identity.workspace_exports','a.id',"a.artifact->>'relativePath'","a.artifact->>'sha256'","a.artifact->>'fileSize'",undefined,undefined,"WHERE a.status='ready' AND a.artifact IS NOT NULL");
   add('local_identity.workspace_exports',"a.id::text||':'||(check_artifact->>'sha256')","check_artifact->>'relativePath'","check_artifact->>'sha256'","check_artifact->>'fileSize'","local_identity.workspace_exports a CROSS JOIN LATERAL jsonb_array_elements(a.checks) checks CROSS JOIN LATERAL (SELECT checks->'artifact' check_artifact) artifact",undefined,"WHERE check_artifact IS NOT NULL AND check_artifact<>'null'::jsonb");
  }
 }
 return JSON.parse(query(`SELECT coalesce(jsonb_agg(r),'[]') FROM(${selections.join(' UNION ALL ')})r`));
}
/** Same persisted episode I/O seam as HTTP/native. Source coordinates remain evidence keys. */
export function storageReferenceResolver(query){
 const registered=query("SELECT to_regprocedure('local_identity.episode_storage_location(uuid)') IS NOT NULL")==='t',locations=new Map();
 const client={query:async(text,values=[])=>{if(!/^SELECT\b/i.test(text))throw Error('Storage reference adapter is read-only');const statement=text.replace(/\$(\d+)/g,(_,index)=>{const value=values[Number(index)-1];if(value===null)return'NULL';if(!['string','number'].includes(typeof value))throw Error('Unsupported storage reference parameter');return quote(value);});return{rows:JSON.parse(query(`SELECT coalesce(jsonb_agg(r),'[]') FROM(${statement})r`))};}};
 return async(assetRoot,episodeId,reference)=>{if(!registered)return join(assetRoot,reference);const key=assetRoot+'\0'+episodeId;let location=locations.get(key);if(!location){location=await episodeStorageLocationAtRoot(client,assetRoot,episodeId);locations.set(key,location);}return resolveEpisodeFileReference(client,location,reference);};
}
