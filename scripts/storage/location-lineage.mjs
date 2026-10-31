import {lstatSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {mappedAssetPath} from '../../src/local-app/mediaPaths.ts';
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
/** Exact global-root equality is valid only in a stable episode-owned scope. */
export function episodeSourceRoot(mediaRoot,value,sourceRoots){const logical=typeof value==='string'?value.replace(/\/+$/,''):value;return logical===mediaRoot||sourceRoots.some(root=>root.replace(/\/+$/,'')===logical)?mediaRoot:mappedAssetPath(mediaRoot,value,sourceRoots);}
export function episodeDirectoryIdentities(query,mediaRoot,sourceRoots){
 if(query("SELECT to_regprocedure('local_identity.episode_storage_location(uuid)') IS NOT NULL")!=='t')return[];
 const rows=JSON.parse(query("SELECT coalesce(jsonb_agg(jsonb_build_object('episodeId',e.id,'accountId',e.account_id,'logicalRoot',l.asset_root,'relativePath',l.directory_relative_path,'deviceId',l.directory_device_id,'inodeId',l.directory_inode_id)),'[]') FROM public.episodes e CROSS JOIN LATERAL local_identity.episode_storage_location(e.id) l"));
 return rows.map(row=>{const sourceRoot=episodeSourceRoot(mediaRoot,row.logicalRoot,sourceRoots),path=join(sourceRoot,row.relativePath),s=lstatSync(path,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(path)!==path||row.deviceId!==null&&(String(s.dev)!==row.deviceId||String(s.ino)!==row.inodeId))throw Error('Source episode identity changed');return{...row,sourceRoot,deviceId:String(s.dev),inodeId:String(s.ino)};});
}
/** Called only by the existing audited restore coordinator with postgres, after
 * archive/COPY/file validation and actual target stat. Never accepts HTTP data. */
export function appendRestoreLocationLineage(query,database,archiveSha256,bindings,sourceBinding,binding){
 const operationId='restore:'+archiveSha256+':'+database,proof={database,archiveSha256,sourceBinding,binding,bindings};
 const proofJson=quote(JSON.stringify(proof))+'::jsonb',proofSha256=query(`SELECT encode(sha256(convert_to((${proofJson})::text,'UTF8')),'hex')`);
 query(`BEGIN;INSERT INTO local_identity.storage_location_operations(id,kind,archive_sha256,proof,proof_sha256) VALUES(${quote(operationId)},'restore',${quote(archiveSha256)},${proofJson},${quote(proofSha256)});${bindings.map(row=>`INSERT INTO local_identity.episode_storage_lineage(operation_id,episode_id,account_id,source_root,source_prefix,source_device_id,source_inode_id,target_root,target_prefix,target_device_id,target_inode_id) VALUES(${quote(operationId)},${quote(row.episodeId)}::uuid,${quote(row.accountId)}::uuid,${quote(row.sourceRoot)},${quote(row.relativePath)},${quote(row.sourceDeviceId)},${quote(row.sourceInodeId)},${quote(row.actualRoot)},${quote(row.relativePath)},${quote(row.deviceId)},${quote(row.inodeId)});`).join('')}COMMIT`);
 return{operationId,proofSha256,proof};
}
export function verifyRestoreLocationLineage(query,expected){
 const actual=JSON.parse(query(`SELECT jsonb_build_object('operation',(SELECT to_jsonb(o) FROM local_identity.storage_location_operations o WHERE id=${quote(expected.operationId)}),'edges',(SELECT coalesce(jsonb_agg(to_jsonb(e)-'id' ORDER BY episode_id),'[]') FROM local_identity.episode_storage_lineage e WHERE operation_id=${quote(expected.operationId)}))`));
 if(expected.proofSha256!==query(`SELECT encode(sha256(convert_to((${quote(JSON.stringify(expected.proof))}::jsonb)::text,'UTF8')),'hex')`)||actual.operation?.kind!=='restore'||actual.operation?.archive_sha256!==expected.proof.archiveSha256||actual.operation?.proof_sha256!==expected.proofSha256||actual.edges.length!==expected.proof.bindings.length)throw Error('Restore location operation proof changed');
 for(const row of expected.proof.bindings){const edge=actual.edges.find(e=>e.episode_id===row.episodeId);if(!edge||edge.account_id!==row.accountId||edge.source_root!==row.sourceRoot||edge.source_prefix!==row.relativePath||edge.source_device_id!==row.sourceDeviceId||edge.source_inode_id!==row.sourceInodeId||edge.target_root!==row.actualRoot||edge.target_prefix!==row.relativePath||edge.target_device_id!==row.deviceId||edge.target_inode_id!==row.inodeId)throw Error('Restore episode lineage changed');}
}
