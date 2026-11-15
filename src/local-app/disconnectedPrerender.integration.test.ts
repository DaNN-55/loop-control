// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,realpath,lstat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';

const removed=['public.confirm_frozen_shot_when_ready()','public.queue_source_audio_after_frozen_clip()','public.guard_b_roll_task_claim()','public.create_pre_render_review_packages()','public.create_pre_render_review_packages_for_episode(uuid)','public.advance_production_ready_episodes(uuid)','public.recover_duration_decision_review_render_tasks()'];

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('178 removes only seven disconnected functions after nonempty historical pre-render restore and preserves all other data, triggers and ACL',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Compatibility acceptance requires an isolated cluster');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(f=>Number(f.version.slice(0,3))<=178)},previous={...catalog,current:catalog.current.filter(f=>Number(f.version.slice(0,3))<178)},cleanup=catalog.current.find(f=>f.version==='178-remove-disconnected-prerender-functions.sql')!;
 expect([...cleanup.body.matchAll(/^DROP FUNCTION ([^;]+);$/gm)].map(m=>m[1])).toEqual(removed);
 const names=new Set(removed.map(s=>s.slice(0,s.indexOf('(')))),suffix=randomBytes(6).toString('hex'),source='loop_compat_source_'+suffix,restored='loop_compat_restore_'+suffix,created:string[]=[];
 const root=await realpath(await mkdtemp('/private/tmp/loop-compat-history-')),stat=await lstat(root,{bigint:true});
 const sql=(q:string,db=restored)=>context.sql('\\set VERBOSITY verbose\n'+q,db),snapshot=(db=restored)=>databaseSnapshot(context,db,process.cwd());
 const owner=randomUUID(),account=randomUUID(),episode=randomUUID(),script=randomUUID(),connection=randomUUID(),oldVersion=randomUUID(),version=randomUUID(),secret=randomUUID(),render=randomUUID(),preRender=randomUUID();
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
   INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES('${render}','${episode}','generate_review_render','completed','{"capability":"review_rendering","marker":"retained render history"}');
   INSERT INTO public.artifacts(id,episode_id,artifact_type,relative_path,sha256,file_size) VALUES('${render}','${episode}','render','episodes/${episode}/retained-render.mp4',repeat('c',64),456);
   INSERT INTO public.review_packages(id,episode_id,stage,revision_number,artifact_id,context_snapshot) VALUES('${preRender}','${episode}','production_ready',1,'${render}',jsonb_build_object('review_kind','pre_render','approval_mode','qc_only','frozen',true,'render',jsonb_build_object('relative_path','episodes/${episode}/retained-render.mp4','sha256',repeat('c',64),'file_size',456)));
   INSERT INTO public.pre_render_review_members(review_package_id,member_key,member_kind,source_task_id,artifact_id,evidence_snapshot) VALUES('${preRender}','shot:historical','shot_media','${render}','${render}',jsonb_build_object('relative_path','episodes/${episode}/retained-render.mp4','sha256',repeat('c',64),'file_size',456));
   COMMIT;`,source);
  const before=snapshot(source);expect(before.rows['local_identity.script_productions'].rows).toBe(1);expect(before.rows['local_identity.episode_planning_selections'].rows).toBe(1);expect(before.rows['public.external_connection_versions'].rows).toBe(2);expect(before.rows['local_identity.connection_bindings'].rows).toBe(1);expect(before.rows['local_identity.connection_intents'].rows).toBe(1);
  const dump=context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',source]);sql(dump);assertRestored(before,snapshot());
  expect(before.rows['public.review_packages'].rows).toBe(1);expect(before.rows['public.pre_render_review_members'].rows).toBe(1);
  const calls=['public.confirm_frozen_shot_when_ready()','public.queue_source_audio_after_frozen_clip()','public.guard_b_roll_task_claim()','public.create_pre_render_review_packages()',`public.create_pre_render_review_packages_for_episode('${episode}')`,`public.advance_production_ready_episodes('${episode}')`,'public.recover_duration_decision_review_render_tasks()'];
  for(const [index,call] of calls.entries()){
   for(const actor of ['loop_app','loop_owner','loop_worker','loop_anonymous'])expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT ${call}`)).toThrow(/42501/);
   if(index<3){
    sql('CREATE TABLE public.compat_dependency_probe(id integer)');
    sql('CREATE TRIGGER unexpected_dependency BEFORE UPDATE ON public.compat_dependency_probe FOR EACH ROW EXECUTE FUNCTION '+call);
   }else sql('CREATE VIEW public.compat_dependency_probe AS SELECT ('+call+' IS NULL) value');
   expect(()=>sql(migrationTransaction([cleanup]))).toThrow(/2BP01/);
   sql(index<3?'DROP TABLE public.compat_dependency_probe':'DROP VIEW public.compat_dependency_probe');assertRestored(before,snapshot());
  }
  expect(()=>sql(migrationTransaction([cleanup]).replace(/COMMIT;$/,'SELECT 1/0; COMMIT;'))).toThrow(/22012/);assertRestored(before,snapshot());
  sql(migrationTransaction([cleanup]));const after=snapshot();
  for(const key of ['rows','sequenceRows','roles'])expect(after[key]).toEqual(before[key]);
  const dropped=before.catalog.functions.filter((f:{schema:string;name:string})=>names.has(f.schema+'.'+f.name));expect(dropped).toHaveLength(7);
  expect(after.catalog).toEqual({...before.catalog,functions:before.catalog.functions.filter((f:{schema:string;name:string})=>!names.has(f.schema+'.'+f.name))});
  const acl=new Set(dropped.map((f:{schema:string;name:string;arguments:string})=>`${f.schema}.${f.name}(${f.arguments})`));expect(after.security).toEqual(before.security.filter((s:{identity:string})=>!acl.has(s.identity)));
  for(const [version,row]of Object.entries(before.ledger))expect(after.ledger[version]).toEqual(row);
  const ledger=Object.fromEntries(Object.entries(after.ledger).map(([k,v])=>[k,(v as {sha256:string}).sha256]));expect(ledger[cleanup.version]).toBe(cleanup.sha256);expect(Object.keys(after.ledger)).toHaveLength(Object.keys(before.ledger).length+1);expect(schemaMigrationPlan(ledger,catalog)).toEqual([]);
  for(const name of removed)expect(sql(`SELECT to_regprocedure('${name}') IS NULL`)).toBe('t');
  for(const actor of ['postgres','loop_app','loop_owner','loop_worker','loop_anonymous'])for(const call of calls)expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT ${call}`)).toThrow(/42883/);
  expect(sql('SET SESSION AUTHORIZATION loop_app; SELECT count(*) FROM local_identity.script_production_scopes()')).toBe('0');assertRestored(after,snapshot());
 }finally{try{for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}finally{await rm(root,{recursive:true,force:true});}}
},120000);

