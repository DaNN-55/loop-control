// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,realpath,lstat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';

const removed=['public.record_external_connection_verification(uuid,text,text)','public.worker_retry_delay_ms()'];

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('181 removes only unused verification and retry helpers after full history restore while preserving probe evidence, delayed tasks and all guards',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Compatibility acceptance requires an isolated cluster');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(f=>Number(f.version.slice(0,3))<=181)},previous={...catalog,current:catalog.current.filter(f=>Number(f.version.slice(0,3))<181)},cleanup=catalog.current.find(f=>f.version==='181-remove-unused-connection-retry-helpers.sql')!;
 expect([...cleanup.body.matchAll(/^DROP FUNCTION ([^;]+);$/gm)].map(m=>m[1])).toEqual(removed);
 const names=new Set(removed.map(s=>s.slice(0,s.indexOf('(')))),suffix=randomBytes(6).toString('hex'),source='loop_compat_source_'+suffix,restored='loop_compat_restore_'+suffix,created:string[]=[];
 const root=await realpath(await mkdtemp('/private/tmp/loop-compat-history-')),stat=await lstat(root,{bigint:true});
 const sql=(q:string,db=restored)=>context.sql('\\set VERBOSITY verbose\n'+q,db),snapshot=(db=restored)=>databaseSnapshot(context,db,process.cwd());
 const owner=randomUUID(),account=randomUUID(),episode=randomUUID(),script=randomUUID(),connection=randomUUID(),oldVersion=randomUUID(),version=randomUUID(),secret=randomUUID(),delayed=randomUUID();
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
   INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,provider,model,prompt_version) VALUES('${episode}','draft_storyboard','failed',jsonb_build_object('marker','retained old task','credential_ref','${oldVersion}','production_selection',jsonb_build_object('connectionVersionId','${oldVersion}')),'codex','historical','historical-v1');
   INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES('${connection}','openai','openai_images','Restored historical connection','${owner}','${version}',public.official_external_connection_endpoint('openai','openai_images'));
   INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES('${oldVersion}','${connection}',1,'openai','openai_images',public.official_external_connection_endpoint('openai','openai_images'),'${oldVersion}'),('${version}','${connection}',2,'openai','openai_images',public.official_external_connection_endpoint('openai','openai_images'),'${secret}');
   INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES('${version}','${owner}','${secret}','keychain');
   INSERT INTO local_identity.connection_intents(owner_id,idempotency_key,metadata,connection_id,version_id,secret_ref,store_mode,applied_at,result) VALUES('${owner}','${secret}','{"command":"rotate","provider":"openai","adapter":"openai_images"}','${connection}','${version}','${secret}','keychain','2026-10-01T01:02:03Z','{"historical":true}');
   UPDATE public.external_connection_versions SET revoked_at='2026-10-01T01:02:03.123456Z' WHERE id='${oldVersion}';
   UPDATE public.external_connections SET status='verified',last_verification_detail='Retained verification',last_verified_at='2026-10-02T01:02:03.123456Z' WHERE id='${connection}';
   INSERT INTO public.external_connection_verifications(connection_id,connection_version_id,status,detail,created_at) VALUES('${connection}','${oldVersion}','invalid','Retained old-version failure','2026-10-01T01:02:03.123456Z'),('${connection}','${version}','verified','Retained current-version verification','2026-10-02T01:02:03.123456Z');
   INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome,created_at) VALUES('${version}','${owner}','live','verified','2026-10-02T01:02:03.123456Z');
   INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified,updated_at) VALUES('${version}','${owner}',true,'2026-10-02T01:02:03.123456Z');
   INSERT INTO public.tasks(id,episode_id,task_type,status,attempt,max_attempts,provider,model,prompt_version,available_at,input_snapshot,last_result) VALUES('${delayed}','${episode}','generate_review_render','ready',1,3,'ffmpeg','local','retained-retry-v1','2099-01-01T01:02:03.123456Z','{"capability":"review_rendering","marker":"retained delayed request"}','{"retry":{"shouldRetry":true,"retryAfterMs":30000,"reason":"retained backoff"}}');
   INSERT INTO public.task_runs(task_id,attempt,status,task_package,completed_at) VALUES('${delayed}',1,'failed',jsonb_build_object('version','worker-task/v1','task_id','${delayed}','episode_id','${episode}','marker','retained failed attempt'),'2026-10-01T01:02:03.123456Z');
   COMMIT;`,source);
  const before=snapshot(source);expect(before.rows['local_identity.script_productions'].rows).toBe(1);expect(before.rows['local_identity.episode_planning_selections'].rows).toBe(1);expect(before.rows['public.external_connection_versions'].rows).toBe(2);expect(before.rows['local_identity.connection_bindings'].rows).toBe(1);expect(before.rows['local_identity.connection_intents'].rows).toBe(1);
  const dump=context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',source]);sql(dump);assertRestored(before,snapshot());
  expect(before.rows['public.external_connection_verifications'].rows).toBe(2);expect(before.rows['local_identity.connection_probe_evidence'].rows).toBe(1);expect(before.rows['local_identity.connection_qualifications'].rows).toBe(1);expect(before.rows['public.task_runs'].rows).toBe(1);
  expect(sql('SELECT public.worker_retry_delay_ms()')).toBe('30000');assertRestored(before,snapshot());
  const calls=[`public.record_external_connection_verification('${version}','verified','retained')`,'public.worker_retry_delay_ms()'];
  for(const call of calls){
   for(const actor of ['loop_app','loop_owner','loop_worker','loop_anonymous'])expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT ${call}`)).toThrow(/42501/);
   sql('CREATE VIEW public.compat_dependency_probe AS SELECT ('+call+' IS NULL) value');
   expect(()=>sql(migrationTransaction([cleanup]))).toThrow(/2BP01/);sql('DROP VIEW public.compat_dependency_probe');assertRestored(before,snapshot());
  }
  expect(()=>sql(migrationTransaction([cleanup]).replace(/COMMIT;$/,'SELECT 1/0; COMMIT;'))).toThrow(/22012/);assertRestored(before,snapshot());
  sql(migrationTransaction([cleanup]));const after=snapshot();
  for(const key of ['rows','sequenceRows','roles'])expect(after[key]).toEqual(before[key]);
  const dropped=before.catalog.functions.filter((f:{schema:string;name:string})=>names.has(f.schema+'.'+f.name));expect(dropped).toHaveLength(2);
  expect(after.catalog).toEqual({...before.catalog,functions:before.catalog.functions.filter((f:{schema:string;name:string})=>!names.has(f.schema+'.'+f.name))});
  const acl=new Set(dropped.map((f:{schema:string;name:string;arguments:string})=>`${f.schema}.${f.name}(${f.arguments})`));expect(after.security).toEqual(before.security.filter((s:{identity:string})=>!acl.has(s.identity)));
  for(const [version,row]of Object.entries(before.ledger))expect(after.ledger[version]).toEqual(row);
  const ledger=Object.fromEntries(Object.entries(after.ledger).map(([k,v])=>[k,(v as {sha256:string}).sha256]));expect(ledger[cleanup.version]).toBe(cleanup.sha256);expect(Object.keys(after.ledger)).toHaveLength(Object.keys(before.ledger).length+1);expect(schemaMigrationPlan(ledger,catalog)).toEqual([]);
  for(const name of removed)expect(sql(`SELECT to_regprocedure('${name}') IS NULL`)).toBe('t');
  for(const actor of ['postgres','loop_app','loop_owner','loop_worker','loop_anonymous'])for(const call of calls)expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT ${call}`)).toThrow(/42883/);
  expect(sql(`SELECT available_at='2099-01-01T01:02:03.123456Z'::timestamptz AND available_at>clock_timestamp() AND attempt=1 AND max_attempts=3 FROM public.tasks WHERE id='${delayed}'`)).toBe('t');
  expect(sql(`SELECT status='verified' AND current_version_id='${version}'::uuid FROM public.external_connections WHERE id='${connection}'`)).toBe('t');assertRestored(after,snapshot());
 }finally{try{for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}finally{await rm(root,{recursive:true,force:true});}}
},120000);

