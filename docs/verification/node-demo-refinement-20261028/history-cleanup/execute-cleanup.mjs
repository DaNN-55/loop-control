import{runtimeContext,readSettings}from'../../../../scripts/runtime/environment.mjs';
import{readFileSync,writeFileSync}from'node:fs';import{createHash}from'node:crypto';import{dirname,join}from'node:path';import{fileURLToPath}from'node:url';
const out=dirname(fileURLToPath(import.meta.url)),mode=process.argv[2];if(!['--rehearse','--apply'].includes(mode))throw Error('Use --rehearse or --apply');
const read=name=>JSON.parse(readFileSync(join(out,name))),manifestBytes=readFileSync(join(out,'manifest.json')),manifest=JSON.parse(manifestBytes),closure=read('retention-version-closure.json'),physical=read('eligible-physical.json'),hash=b=>createHash('sha256').update(b).digest('hex'),q=x=>"'"+String(x).replaceAll("'","''")+"'",c=runtimeContext(),owner=manifest.owner;
if(manifest.sourceCount!==119||manifest.sources.length!==119||new Set(manifest.sources.map(s=>s.id)).size!==119||manifest.sources.some(s=>! /^[a-f0-9]{64}$/.test(s.id)||s.owner_id!==owner)||manifest.database!==c.database||closure.owner!==owner||closure.versionCount!==closure.versions.length||closure.manifestSha256!==hash(manifestBytes)||owner!==readSettings().secretAdministration.adminOwnerId)throw Error('Fixed scope changed');
const retained=read('final-retained-shas.json');
const retainShas=Array.isArray(retained)?retained:retained.retainedShas;
if(!Array.isArray(retainShas)||new Set(retainShas).size!==retainShas.length||retainShas.some(x=>!/^[a-f0-9]{64}$/.test(x)))throw Error('Invalid retained file closure');
if(retained.summary?.auditMethodVersion!==2||physical.summary?.auditMethodVersion!==2||!Array.isArray(physical.files))throw Error('Final method-2 closure evidence required');
const keepShaSet=new Set(retainShas),physicalShas=new Set;for(const file of physical.files){if(! /^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<0||physicalShas.has(file.sha256)||keepShaSet.has(file.sha256))throw Error('Invalid, duplicate or retained physical deletion candidate');physicalShas.add(file.sha256);}
if(read('retention-files-direct.json').some(f=>!keepShaSet.has(f.sha256)))throw Error('Retained closure omitted a direct production/protection/business seed');
for(const key of['recordLinks','fileLinks','distinctVersions'])if(!Number.isSafeInteger(manifest.summary[key])||manifest.summary[key]<0)throw Error('Invalid manifest counts');
if(manifest.summary.distinctVersions!==manifest.versions.length)throw Error('Version count manifest mismatch');
const evidenceHashes=()=>({directFilesSha256:hash(readFileSync(join(out,'retention-files-direct.json'))),fileLinksSha256:hash(readFileSync(join(out,'file-links.json'))),beforeFingerprintsSha256:hash(readFileSync(join(out,'before/table-fingerprints.json'))),versionClosureSha256:hash(readFileSync(join(out,'retention-version-closure.json'))),closureSha256:hash(readFileSync(join(out,'final-retained-shas.json'))),physicalEvidenceSha256:hash(readFileSync(join(out,'eligible-physical.json'))),executionScriptSha256:hash(readFileSync(fileURLToPath(import.meta.url)))});
const initialEvidence=evidenceHashes();
const runtimeHash=()=>Object.fromEntries(['deployment.json','secret-index.json','keychain/loop-control.keychain-db'].map(n=>[n,hash(readFileSync(join(c.root,n)))]));
const beforeRuntime=runtimeHash(),baselineRuntime=read('before/runtime-file-hashes.json');if(JSON.stringify(beforeRuntime)!==JSON.stringify(baselineRuntime))throw Error('Runtime file drift; inspect before cleanup');
for(const migration of['075-history-production-retention.sql','076-history-retained-file-variants.sql']){const migrationBody=readFileSync(join(c.projectRoot,'db/local',migration));if(c.sql('SELECT sha256 FROM local_identity.schema_migrations WHERE version='+q(migration))!==hash(migrationBody))throw Error('Required retention migration not applied: '+migration);}
const links=read('file-links.json');
// PostgreSQL column declarations and select lists are kept separate for simple fixed manifests.
const temp=(name,decl,cols,items)=>`CREATE TEMP TABLE ${name} AS SELECT ${cols} FROM jsonb_to_recordset(${q(JSON.stringify(items))}::jsonb) AS r(${decl});`;
const sourceIds=manifest.sources.map(s=>s.id);
const excluded=new Set(['history_sources','history_source_preferences','history_source_rows','history_files','history_retained_files','history_versions','history_projection_results']);
const names=JSON.parse(c.sql("SELECT jsonb_agg(schemaname||'.'||tablename ORDER BY schemaname,tablename) FROM pg_tables WHERE schemaname IN('public','local_identity')"));
const protectedNames=names.filter(n=>n.startsWith('public.')||!excluded.has(n.split('.')[1]));
if(names.some(n=>! /^(public|local_identity)\.[a-z_][a-z0-9_]*$/.test(n)))throw Error('Unexpected table identifier');
const fingerprintSql=protectedNames.map(n=>`SELECT ${q(n)} name,count(*) rows,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) digest FROM ${n} t`).join(' UNION ALL ');
const semanticFiles=`SELECT DISTINCT owner_id,logical_path,sha256,bytes,kind,episode_id FROM local_identity.history_episode_files WHERE owner_id=${q(owner)}`;
const semanticRecords=`SELECT DISTINCT owner_id,table_name,row_key,payload_sha256,episode_id FROM local_identity.history_episode_records WHERE owner_id=${q(owner)}`;
const sourceTemp=temp('cleanup_sources','id text','id',sourceIds.map(id=>({id})));
const versionTemp=temp('cleanup_versions','table_name text,row_key jsonb,payload_sha256 text','table_name,row_key,payload_sha256',manifest.versions);
const keepTemp=temp('keep_versions','table_name text,row_key jsonb,payload_sha256 text','table_name,row_key,payload_sha256',closure.versions);
const linkTemp=temp('expected_links','source_id text,logical_path text,sha256 text,bytes bigint,kind text,metadata_hash text','source_id,logical_path,sha256,bytes,kind,metadata_hash',links);
const shaTemp=temp('keep_content','sha256 text','sha256',retainShas.map(sha256=>({sha256})));
const remainderFilters={
 'local_identity.history_sources':`NOT EXISTS(SELECT 1 FROM cleanup_sources z WHERE z.id=t.id)`,
 'local_identity.history_source_preferences':`NOT EXISTS(SELECT 1 FROM cleanup_sources z WHERE z.id=t.source_id)`,
 'local_identity.history_source_rows':`NOT EXISTS(SELECT 1 FROM cleanup_sources z WHERE z.id=t.source_id)`,
 'local_identity.history_files':`NOT EXISTS(SELECT 1 FROM cleanup_sources z WHERE z.id=t.source_id)`,
 'local_identity.history_versions':`NOT EXISTS(SELECT 1 FROM remove_versions z WHERE(z.table_name,z.row_key,z.payload_sha256)=(t.table_name,t.row_key,t.payload_sha256))`,
 'local_identity.history_projection_results':`NOT EXISTS(SELECT 1 FROM remove_versions z WHERE(z.table_name,z.row_key,z.payload_sha256)=(t.table_name,t.row_key,t.payload_sha256))`,
 'local_identity.history_retained_files':`NOT EXISTS(SELECT 1 FROM keep_files z WHERE(z.owner_id,z.logical_path,z.sha256,z.retention_variant)=(t.owner_id,t.logical_path,t.sha256,t.retention_variant))`
};
const remainderSql=Object.entries(remainderFilters).map(([name,where])=>`SELECT ${q(name)}name,count(*)rows,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),''))digest FROM ${name} t WHERE ${where}`).join(' UNION ALL ');
const expectedHistory=read('before/table-fingerprints.json').filter(x=>['local_identity.history_sources','local_identity.history_source_preferences','local_identity.history_source_rows','local_identity.history_files','local_identity.history_versions','local_identity.history_projection_results'].includes(x.name));
if(expectedHistory.length!==6)throw Error('Missing immutable history fingerprints');
const historyBaseline=temp('expected_history_before','name text,rows bigint,hash text','name,rows,hash',expectedHistory);
const historyCurrent=expectedHistory.map(x=>`SELECT ${q(x.name)}name,count(*)rows,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),''))hash FROM ${x.name} t`).join(' UNION ALL ');
const setup=`BEGIN ISOLATION LEVEL SERIALIZABLE;SET LOCAL statement_timeout='90s';SET LOCAL lock_timeout='5s';${sourceTemp}${versionTemp}${keepTemp}${linkTemp}${shaTemp}${historyBaseline}
CREATE UNIQUE INDEX ON cleanup_versions(table_name,row_key,payload_sha256);CREATE UNIQUE INDEX ON keep_versions(table_name,row_key,payload_sha256);CREATE UNIQUE INDEX ON keep_content(sha256);CREATE UNIQUE INDEX ON cleanup_sources(id);CREATE UNIQUE INDEX ON expected_links(source_id,logical_path,sha256);
CREATE TEMP TABLE history_files_before AS ${semanticFiles};CREATE INDEX ON history_files_before(owner_id,logical_path,sha256);CREATE TEMP TABLE history_records_before AS ${semanticRecords};
CREATE TEMP TABLE remove_versions AS SELECT v.table_name,v.row_key,v.payload_sha256 FROM local_identity.history_versions v JOIN cleanup_versions t USING(table_name,row_key,payload_sha256)WHERE v.owner_id=${q(owner)} AND NOT EXISTS(SELECT 1 FROM keep_versions k WHERE(k.table_name,k.row_key,k.payload_sha256)=(v.table_name,v.row_key,v.payload_sha256))AND NOT EXISTS(SELECT 1 FROM local_identity.history_source_rows r WHERE(r.table_name,r.row_key,r.payload_sha256)=(v.table_name,v.row_key,v.payload_sha256)AND r.source_id NOT IN(SELECT id FROM cleanup_sources));
CREATE TEMP TABLE keep_files AS SELECT DISTINCT ON(s.owner_id,f.logical_path,f.sha256,md5(f.bytes::text||':'||length(f.kind)::text||':'||f.kind||':'||f.metadata::text)) s.owner_id,f.logical_path,f.sha256,f.bytes,f.kind,f.metadata,CASE WHEN EXISTS(SELECT 1 FROM history_files_before e WHERE(e.owner_id,e.logical_path,e.sha256)=(s.owner_id,f.logical_path,f.sha256))THEN 'production-history' WHEN EXISTS(SELECT 1 FROM local_identity.history_file_protections p WHERE p.original_sha256=f.sha256)OR f.kind IN('ordinary-template-configuration','ordinary-history-literals')OR f.metadata?'currentPath' OR f.metadata?'formerRuntimePath' OR (CASE WHEN jsonb_typeof(f.metadata->'replacements')='array' THEN jsonb_array_length(f.metadata->'replacements')>0 ELSE false END) THEN 'protected-reference' ELSE 'business-dependency' END retention_reason,md5(f.bytes::text||':'||length(f.kind)::text||':'||f.kind||':'||f.metadata::text)retention_variant FROM local_identity.history_files f JOIN local_identity.history_sources s ON s.id=f.source_id JOIN cleanup_sources t ON t.id=s.id JOIN keep_content k USING(sha256)ORDER BY s.owner_id,f.logical_path,f.sha256,md5(f.bytes::text||':'||length(f.kind)::text||':'||f.kind||':'||f.metadata::text),s.id;
CREATE UNIQUE INDEX ON keep_files(owner_id,logical_path,sha256,retention_variant);
CREATE TEMP TABLE protected_before AS ${fingerprintSql};CREATE TEMP TABLE remainder_before AS ${remainderSql};
CREATE TEMP TABLE catalog_before AS SELECT v.owner_id,v.table_name,v.row_key,v.payload_sha256,v.payload FROM local_identity.history_versions v JOIN keep_versions k USING(table_name,row_key,payload_sha256) WHERE v.owner_id=${q(owner)};
CREATE TEMP TABLE current_history_before AS ${historyCurrent};
DO $$BEGIN
IF EXISTS((SELECT s.id FROM local_identity.history_sources s LEFT JOIN local_identity.history_source_preferences p ON p.source_id=s.id WHERE s.owner_id=${q(owner)} AND p.archived_at IS NULL EXCEPT SELECT id FROM cleanup_sources)UNION ALL(SELECT id FROM cleanup_sources EXCEPT SELECT s.id FROM local_identity.history_sources s LEFT JOIN local_identity.history_source_preferences p ON p.source_id=s.id WHERE s.owner_id=${q(owner)} AND p.archived_at IS NULL))THEN RAISE EXCEPTION 'Unarchived source set changed';END IF;
IF EXISTS((SELECT * FROM expected_history_before EXCEPT SELECT * FROM current_history_before)UNION ALL(SELECT * FROM current_history_before EXCEPT SELECT * FROM expected_history_before))THEN RAISE EXCEPTION 'Immutable history fingerprint drift';END IF;
IF(SELECT count(*) FROM local_identity.history_source_rows WHERE source_id IN(SELECT id FROM cleanup_sources))<>${manifest.summary.recordLinks} OR(SELECT count(*) FROM local_identity.history_files WHERE source_id IN(SELECT id FROM cleanup_sources))<>${manifest.summary.fileLinks} THEN RAISE EXCEPTION 'Source link counts changed';END IF;
IF EXISTS(SELECT * FROM keep_versions EXCEPT SELECT * FROM cleanup_versions)OR EXISTS(SELECT table_name,row_key,payload_sha256 FROM history_records_before EXCEPT SELECT * FROM keep_versions)THEN RAISE EXCEPTION 'Version retention closure missing or outside fixed scope';END IF;
IF(SELECT count(*)FROM local_identity.history_sources s JOIN cleanup_sources t ON t.id=s.id LEFT JOIN local_identity.history_source_preferences p ON p.source_id=s.id WHERE s.owner_id=${q(owner)} AND p.archived_at IS NULL)<>119 THEN RAISE EXCEPTION 'Source scope drift';END IF;
IF EXISTS((SELECT table_name,row_key,payload_sha256 FROM local_identity.history_versions WHERE owner_id=${q(owner)} EXCEPT SELECT * FROM cleanup_versions)UNION ALL(SELECT * FROM cleanup_versions EXCEPT SELECT table_name,row_key,payload_sha256 FROM local_identity.history_versions WHERE owner_id=${q(owner)}))THEN RAISE EXCEPTION 'Version manifest drift';END IF;
IF EXISTS((SELECT source_id,logical_path,sha256,bytes,kind,md5(metadata::text) FROM local_identity.history_files WHERE source_id IN(SELECT id FROM cleanup_sources)EXCEPT SELECT * FROM expected_links)UNION ALL(SELECT * FROM expected_links EXCEPT SELECT source_id,logical_path,sha256,bytes,kind,md5(metadata::text)FROM local_identity.history_files WHERE source_id IN(SELECT id FROM cleanup_sources)))THEN RAISE EXCEPTION 'File manifest drift';END IF;
IF EXISTS(SELECT 1 FROM local_identity.history_files f JOIN cleanup_sources s ON s.id=f.source_id JOIN keep_content k USING(sha256)GROUP BY f.logical_path,f.sha256,md5(f.bytes::text||':'||length(f.kind)::text||':'||f.kind||':'||f.metadata::text) HAVING count(DISTINCT(f.bytes,f.kind,f.metadata))>1)THEN RAISE EXCEPTION 'Retained variant digest collision';END IF;
IF(SELECT count(*) FROM history_records_before)<>5775 OR(SELECT count(*)FROM history_files_before)<>744 THEN RAISE EXCEPTION 'Production navigation drift';END IF;
END $$;

INSERT INTO local_identity.history_retained_files(owner_id,logical_path,sha256,bytes,kind,metadata,retention_reason)SELECT owner_id,logical_path,sha256,bytes,kind,metadata,retention_reason FROM keep_files;

DELETE FROM local_identity.history_source_rows WHERE source_id IN(SELECT id FROM cleanup_sources);
DELETE FROM local_identity.history_files WHERE source_id IN(SELECT id FROM cleanup_sources);
DELETE FROM local_identity.history_source_preferences WHERE source_id IN(SELECT id FROM cleanup_sources);
DELETE FROM local_identity.history_projection_results p USING remove_versions v WHERE(p.table_name,p.row_key,p.payload_sha256)=(v.table_name,v.row_key,v.payload_sha256);
DELETE FROM local_identity.history_versions p USING remove_versions v WHERE(p.table_name,p.row_key,p.payload_sha256)=(v.table_name,v.row_key,v.payload_sha256);
DELETE FROM local_identity.history_sources WHERE id IN(SELECT id FROM cleanup_sources)AND owner_id=${q(owner)};
CREATE TEMP TABLE protected_after AS ${fingerprintSql};CREATE TEMP TABLE remainder_after AS ${remainderSql};
DO $$BEGIN
IF EXISTS((SELECT * FROM remainder_before EXCEPT SELECT * FROM remainder_after)UNION ALL(SELECT * FROM remainder_after EXCEPT SELECT * FROM remainder_before))THEN RAISE EXCEPTION 'Retained or other Owner history changed';END IF;
IF EXISTS((SELECT * FROM catalog_before EXCEPT SELECT v.owner_id,v.table_name,v.row_key,v.payload_sha256,v.payload FROM local_identity.history_versions v JOIN keep_versions k USING(table_name,row_key,payload_sha256) WHERE v.owner_id=${q(owner)})UNION ALL(SELECT v.owner_id,v.table_name,v.row_key,v.payload_sha256,v.payload FROM local_identity.history_versions v JOIN keep_versions k USING(table_name,row_key,payload_sha256) WHERE v.owner_id=${q(owner)} EXCEPT SELECT * FROM catalog_before))THEN RAISE EXCEPTION 'Retained historical payload changed';END IF;
IF EXISTS((SELECT * FROM protected_before EXCEPT SELECT * FROM protected_after)UNION ALL(SELECT * FROM protected_after EXCEPT SELECT * FROM protected_before)) THEN RAISE EXCEPTION 'Protected table changed';END IF;
IF EXISTS((SELECT * FROM history_files_before EXCEPT ${semanticFiles})UNION ALL(${semanticFiles} EXCEPT SELECT * FROM history_files_before))THEN RAISE EXCEPTION 'Production file navigation changed';END IF;
IF EXISTS((SELECT * FROM history_records_before EXCEPT ${semanticRecords})UNION ALL(${semanticRecords} EXCEPT SELECT * FROM history_records_before))THEN RAISE EXCEPTION 'Production record navigation changed';END IF;
IF EXISTS((SELECT * FROM keep_files EXCEPT SELECT owner_id,logical_path,sha256,bytes,kind,metadata,retention_reason,retention_variant FROM local_identity.history_retained_files WHERE(owner_id,logical_path,sha256,retention_variant)IN(SELECT owner_id,logical_path,sha256,retention_variant FROM keep_files))UNION ALL(SELECT owner_id,logical_path,sha256,bytes,kind,metadata,retention_reason,retention_variant FROM local_identity.history_retained_files WHERE(owner_id,logical_path,sha256,retention_variant)IN(SELECT owner_id,logical_path,sha256,retention_variant FROM keep_files)EXCEPT SELECT * FROM keep_files))THEN RAISE EXCEPTION 'Retained file payload changed';END IF;
IF EXISTS(SELECT 1 FROM local_identity.history_sources WHERE id IN(SELECT id FROM cleanup_sources))THEN RAISE EXCEPTION 'Target source remains';END IF;
END $$;
SELECT jsonb_build_object('mode',${q(mode)},'database',${q(c.database)},'sourcesDeleted',119,'sourceRecordLinksDeleted',${manifest.summary.recordLinks},'sourceFileLinksDeleted',${manifest.summary.fileLinks},'historicalVersionsDeleted',(SELECT count(*)FROM remove_versions),'historicalVersionsRetained',(SELECT count(*)FROM local_identity.history_versions WHERE owner_id=${q(owner)}),'retainedFileKeys',(SELECT count(DISTINCT(owner_id,logical_path,sha256))FROM keep_files),'retainedFileVariants',(SELECT count(*)FROM keep_files),'retainedContents',(SELECT count(DISTINCT sha256)FROM keep_files),'productionHistoryRecords',(SELECT count(*)FROM history_records_before),'productionHistoryFiles',(SELECT count(*)FROM history_files_before),'protectedFingerprintGroups',(SELECT count(*)FROM protected_before),'sourcesRemaining',(SELECT count(*)FROM local_identity.history_sources WHERE owner_id=${q(owner)}),'protectedTablesUnchanged',true,'productionHistoryUnchanged',true);
${mode==='--apply'?'COMMIT':'ROLLBACK'};`;
if(mode==='--apply'){
const rehearsal=read('transaction-rehearsal.json');if(rehearsal.mode!=='--rehearse'||rehearsal.databaseCommitted!==false||rehearsal.manifestSha256!==hash(manifestBytes)||Object.entries(initialEvidence).some(([key,value])=>rehearsal[key]!==value)||rehearsal.passed!==true)throw Error('Matching rollback rehearsal required');
}
if(JSON.stringify(evidenceHashes())!==JSON.stringify(initialEvidence))throw Error('Cleanup evidence changed before transaction');
const result=JSON.parse(c.sql(setup)),runtimeFilesUnchanged=JSON.stringify(runtimeHash())===JSON.stringify(beforeRuntime);
const receipt={...result,at:new Date().toISOString(),passed:runtimeFilesUnchanged,databaseCommitted:mode==='--apply',manifestSha256:hash(manifestBytes),...initialEvidence,runtimeFilesUnchanged};
writeFileSync(join(out,mode==='--apply'?'database-cleanup-result.json':'transaction-rehearsal.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
if(!runtimeFilesUnchanged)throw Error('Runtime files changed; transaction outcome recorded in receipt (databaseCommitted='+receipt.databaseCommitted+')');
