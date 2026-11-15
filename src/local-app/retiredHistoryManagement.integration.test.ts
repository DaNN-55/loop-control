// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,realpath,lstat,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';

const removed=['local_identity.preview_history_cleanup(text,text)','local_identity.preview_history_episode(text,text)','local_identity.delete_history_episode(text,text,text,text[])'];

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('182 removes only unused history management entries after full nonempty restore while preserving receipts, evidence and all guards',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Compatibility acceptance requires an isolated cluster');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(f=>Number(f.version.slice(0,3))<=182)},previous={...catalog,current:catalog.current.filter(f=>Number(f.version.slice(0,3))<182)},cleanup=catalog.current.find(f=>f.version==='182-remove-unused-history-management-entries.sql')!;
 expect([...cleanup.body.matchAll(/^DROP FUNCTION ([^;]+);$/gm)].map(m=>m[1])).toEqual(removed);
 const names=new Set(removed.map(s=>s.slice(0,s.indexOf('(')))),suffix=randomBytes(6).toString('hex'),source='loop_compat_source_'+suffix,restored='loop_compat_restore_'+suffix,created:string[]=[];
 const root=await realpath(await mkdtemp('/private/tmp/loop-compat-history-')),stat=await lstat(root,{bigint:true});
 const sql=(q:string,db=restored)=>context.sql('\\set VERBOSITY verbose\n'+q,db),snapshot=(db=restored)=>databaseSnapshot(context,db,process.cwd());
 const owner=randomUUID(),account=randomUUID(),episode=randomUUID(),script=randomUUID(),task=randomUUID(),receipt=randomUUID();
 const bytes=Buffer.from('retained historical file bytes'),sha=createHash('sha256').update(bytes).digest('hex'),file=join(root,sha);await writeFile(file,bytes);
 try{
  for(const db of [source,restored]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  sql(freshSchemaTransaction(previous),source);
  sql(`BEGIN;
   INSERT INTO local_identity.owners(id,email) VALUES('${owner}','compat-history@example.invalid');
   INSERT INTO public.accounts(id,slug,name,timezone) VALUES('${account}','compat-history','Retained compatibility history','Asia/Shanghai');
   INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('${account}','${owner}','owner');
   INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES('${account}','${account}',1,'{}',true);
   INSERT INTO local_identity.account_asset_directories(account_id,actual_root,device_id,inode_id) VALUES('${account}','${root}','${stat.dev}','${stat.ino}');
   INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES('${episode}','${account}','${account}','Retain original planning and authorization','waiting_input');
   INSERT INTO public.production_material_revisions(id,episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,is_main_script,created_by,material_purpose) VALUES('${script}','${episode}',1,'script','paste','historical.md','episodes/${episode}/historical.md','text/markdown',repeat('a',64),123,true,'${owner}','main_script');
   UPDATE public.episodes SET main_script_revision_id='${script}' WHERE id='${episode}';
   INSERT INTO local_identity.script_productions(episode_id,owner_id,script_revision_id,script_sha256,plan,enabled,authorization_hash,authorized_at) VALUES('${episode}','${owner}','${script}',repeat('a',64),'{"marker":"retained old authorization"}',true,repeat('b',64),'2026-10-01T01:02:03.123456Z');
   INSERT INTO local_identity.episode_planning_selections(episode_id,selection,revision) VALUES('${episode}','{"provider":"codex","marker":"retained old selection"}',3);
   INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,provider,model,prompt_version) VALUES('${task}','${episode}','draft_storyboard','failed','{"marker":"retained old task"}','codex','historical','historical-v1');
   INSERT INTO public.task_runs(task_id,attempt,status,task_package,completed_at) VALUES('${task}',1,'failed',jsonb_build_object('task_id','${task}','episode_id','${episode}','marker','frozen historical package'),'2026-10-01T01:02:03.123456Z');
   INSERT INTO local_identity.historical_episodes(episode_id) VALUES('${episode}');
   INSERT INTO local_identity.historical_tasks(task_id) VALUES('${task}');
   INSERT INTO local_identity.history_sources(id,owner_id,kind,label,metadata,imported_at) VALUES(repeat('a',64),'${owner}','backup','original source','{"marker":"retained origin"}','2026-10-01T01:02:03.123456Z'),(repeat('b',64),'${owner}','backup','shared source','{}','2026-10-02T01:02:03.123456Z');
   INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload) VALUES('public.episodes',jsonb_build_object('id','${episode}'),repeat('c',64),'${owner}',jsonb_build_object('id','${episode}','title','original historical title')),('public.tasks',jsonb_build_object('id','${task}'),repeat('d',64),'${owner}',jsonb_build_object('id','${task}','episode_id','${episode}','marker','original task payload'));
   INSERT INTO local_identity.history_source_rows(source_id,table_name,row_key,payload_sha256) SELECT repeat('a',64),table_name,row_key,payload_sha256 FROM local_identity.history_versions;
   INSERT INTO local_identity.history_projection_results(table_name,row_key,payload_sha256,status,detail,applied_at) SELECT table_name,row_key,payload_sha256,'current-preserved','retain original projection','2026-10-01T01:02:03.123456Z' FROM local_identity.history_versions;
   INSERT INTO local_identity.history_files(source_id,logical_path,sha256,bytes,kind,metadata) VALUES(repeat('a',64),'episodes/${episode}/historical.txt','${sha}',${bytes.length},'historical',jsonb_build_object('episode_id','${episode}')),(repeat('b',64),'shared/original.txt','${sha}',${bytes.length},'historical','{}');
   INSERT INTO local_identity.history_file_protections(original_sha256,protected_sha256,protected_bytes,replacements,verified_at) VALUES('${sha}','${sha}',${bytes.length},'[]','2026-10-01T01:02:03.123456Z');
   INSERT INTO local_identity.history_retained_files(owner_id,logical_path,sha256,bytes,kind,metadata,retention_reason) VALUES('${owner}','retained/original.txt','${sha}',${bytes.length},'historical',jsonb_build_object('episode_id','${episode}'),'business-dependency');
   INSERT INTO local_identity.history_episode_deletions(owner_id,episode_id,deleted_at) VALUES('${owner}','old-deleted-episode','2026-10-01T01:02:03.123456Z');
   INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES('${owner}','${receipt}',repeat('e',64),jsonb_build_object('episodeId','${episode}','cleanupPending',true,'historyCleanupTargets',jsonb_build_array(jsonb_build_object('sha','${sha}','path','${file}','bytes',${bytes.length})),'marker','retained old pending receipt'));
   COMMIT;`,source);
  const before=snapshot(source);
  for(const [table,count]of [['history_sources',2],['history_versions',2],['history_source_rows',2],['history_projection_results',2],['history_files',2],['history_file_protections',1],['history_retained_files',1],['history_episode_deletions',1],['command_receipts',1],['historical_episodes',1],['historical_tasks',1]] as const)expect(before.rows['local_identity.'+table].rows).toBe(count);
  expect(before.rows['public.task_runs'].rows).toBe(1);expect(await readFile(file)).toEqual(bytes);
  const dump=context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',source]);sql(dump);assertRestored(before,snapshot());
  expect(sql(`SELECT count(*) FROM local_identity.history_episode_records WHERE episode_id='${episode}'`)).toBe('2');
  expect(Number(sql(`SELECT count(*) FROM local_identity.history_episode_files WHERE episode_id='${episode}'`))).toBeGreaterThan(0);
  const calls=[`local_identity.preview_history_cleanup(repeat('a',64),'invalid-session')`,`local_identity.preview_history_episode('${episode}','invalid-session')`,`local_identity.delete_history_episode('${episode}','invalid-session','stale-revision',ARRAY[]::text[])`];
  for(const call of calls){
   for(const actor of ['loop_app','loop_owner','loop_worker','loop_anonymous'])expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT ${call}`)).toThrow(/42501/);
   sql('CREATE VIEW public.compat_dependency_probe AS SELECT ('+call+' IS NULL) value');
   expect(()=>sql(migrationTransaction([cleanup]))).toThrow(/2BP01/);sql('DROP VIEW public.compat_dependency_probe');assertRestored(before,snapshot());
  }
  expect(()=>sql(migrationTransaction([cleanup]).replace(/COMMIT;$/,'SELECT 1/0; COMMIT;'))).toThrow(/22012/);assertRestored(before,snapshot());
  sql(migrationTransaction([cleanup]));const after=snapshot();
  for(const key of ['rows','sequenceRows','roles'])expect(after[key]).toEqual(before[key]);
  const dropped=before.catalog.functions.filter((f:{schema:string;name:string})=>names.has(f.schema+'.'+f.name));expect(dropped).toHaveLength(3);
  expect(after.catalog).toEqual({...before.catalog,functions:before.catalog.functions.filter((f:{schema:string;name:string})=>!names.has(f.schema+'.'+f.name))});
  const acl=new Set(dropped.map((f:{schema:string;name:string;arguments:string})=>`${f.schema}.${f.name}(${f.arguments})`));expect(after.security).toEqual(before.security.filter((s:{identity:string})=>!acl.has(s.identity)));
  for(const [version,row]of Object.entries(before.ledger))expect(after.ledger[version]).toEqual(row);
  const ledger=Object.fromEntries(Object.entries(after.ledger).map(([k,v])=>[k,(v as {sha256:string}).sha256]));expect(ledger[cleanup.version]).toBe(cleanup.sha256);expect(Object.keys(after.ledger)).toHaveLength(Object.keys(before.ledger).length+1);expect(schemaMigrationPlan(ledger,catalog)).toEqual([]);
  for(const name of removed)expect(sql(`SELECT to_regprocedure('${name}') IS NULL`)).toBe('t');
  // Anonymous has no schema USAGE; deletion must preserve that earlier boundary.
  for(const actor of ['postgres','loop_app','loop_owner','loop_worker','loop_anonymous'])for(const call of calls)expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT ${call}`)).toThrow(actor==='loop_anonymous'?/42501/:/42883/);
  expect(await readFile(file)).toEqual(bytes);
  expect(sql(`SELECT count(*) FROM local_identity.history_episode_records WHERE episode_id='${episode}'`)).toBe('2');
  expect(Number(sql(`SELECT count(*) FROM local_identity.history_episode_files WHERE episode_id='${episode}'`))).toBeGreaterThan(0);assertRestored(after,snapshot());
 }finally{try{for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}finally{await rm(root,{recursive:true,force:true});}}
},120000);

