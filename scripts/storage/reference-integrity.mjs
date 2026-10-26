import{resolve}from'node:path';
export function assertReferenceIntegrity(reference,file,history=null){
 if(file&&file.sha256===reference.sha256&&file.bytes===Number(reference.file_size))return false;
 if(file&&history?.version===1&&/^[a-f0-9]{64}$/.test(history.approvalSha256)&&Array.isArray(history.exceptions)&&history.exceptions.some(e=>
  reference.reference_table==='artifacts'&&e.table==='artifacts'&&e.id===reference.reference_id&&e.episodeId===reference.episode_id&&
  e.path===resolve(reference.source_asset_root,reference.relative_path)&&e.expectedSha256===reference.sha256&&e.expectedBytes===Number(reference.file_size)&&
  e.actualSha256===file.sha256&&e.actualBytes===file.bytes))return true;
 throw Error('Referenced media missing or changed');
}
