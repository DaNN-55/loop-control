// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID,randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {loadSchemaCatalog,freshSchemaTransaction,schemaMigrationPlan,migrationTransaction} from './schemaMigrations';
const changedFunctions=new Set(["local_identity.claim_scheduled_worker_task", "local_identity.claim_managed_worker_task", "public.claim_next_worker_task", "local_identity.claim_input_task", "local_identity.claim_input_task_pre_lease", "public.claim_next_worker_task_pre_lease", "public.claim_next_worker_task_legacy", "local_identity.input_task_allowed", "local_identity.input_task_allowed_before_images", "local_identity.input_task_allowed_before_workspace_delivery", "local_identity.input_media_connection", "local_identity.input_media_connection_before_audio_selection", "local_identity.input_media_connection_before_video_selection", "local_identity.input_media_connection_before_images", "local_identity.record_workspace_narration_submission", "local_identity.record_workspace_narration_submission_before_dispatch_facts", "local_identity.record_workspace_visual_submission", "local_identity.record_workspace_visual_submission_before_dispatch_facts", "local_identity.reserve_workspace_narration_submission_legacy", "local_identity.reject_unsupported_narration_submission", "local_identity.reserve_workspace_narration_submission", "local_identity.execute_managed_worker_command", "local_identity.input_worker_call", "local_identity.input_worker_call_before_publication_fence", "local_identity.input_worker_call_before_workspace_delivery", "local_identity.initialize_historical_shot_inputs", "public.seed_shot_preparation_drafts_after_storyboard_approval", "public.reuse_shot_preparation_history_after_storyboard_approval", "local_identity.validate_historical_visual_receipt", "local_identity.project_historical_visual_receipt", "local_identity.register_historical_visual_receipt", "public.create_visual_review_package", "local_identity.validate_historical_storyboard_receipt", "local_identity.project_historical_storyboard_receipt", "local_identity.register_historical_storyboard_receipt", "public.create_storyboard_review_package"]);
const changedTriggers=new Set(['seed_shot_preparation_drafts_after_storyboard_approval','zz_reuse_shot_preparation_history_after_storyboard_approval','initialize_historical_shot_inputs_after_approval','create_visual_review_package_after_task_completion','create_storyboard_review_package_after_task_completion']);
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('199 preserves nonempty history, unrelated objects and ACLs through dependency refusal, rollback and full restore',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only an isolated schema fixture is permitted');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const suffix=randomBytes(6).toString('hex'),database='loop_create_old_'+suffix,restored='loop_create_restore_'+suffix,created:string[]=[];
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(file=>file.version<'200-')},previous={...catalog,current:catalog.current.filter(file=>file.version<'199-')};
 const sql=(query:string,db=database)=>context.sql(query,db),snapshot=()=>databaseSnapshot(context,database,process.cwd());
 try{
  for(const db of [database,restored]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  sql(freshSchemaTransaction(previous));
  const owner=randomUUID(),account=randomUUID(),episode=randomUUID(),script=randomUUID();
  sql(`BEGIN;SET LOCAL session_replication_role=replica;INSERT INTO local_identity.owners(id,email) VALUES('${owner}','${owner}@example.invalid');INSERT INTO public.accounts(id,slug,name,timezone) VALUES('${account}','old-create-history','Retained historical account','Asia/Shanghai');INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('${account}','${owner}','owner');INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES('${account}','${account}',1,'{}',true);INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES('${episode}','${account}','${account}','Original historical order','script_approved');INSERT INTO public.production_material_revisions(id,episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,is_main_script,created_by,material_purpose) VALUES('${script}','${episode}',1,'script','file','original.md','original.md','text/markdown',repeat('a',64),7,true,'${owner}','main_script');UPDATE public.episodes SET main_script_revision_id='${script}' WHERE id='${episode}';COMMIT;`);
  const before=snapshot(),applied=Object.fromEntries(Object.entries(before.ledger).map(([version,value])=>[version,(value as {sha256:string}).sha256]));
  const pending=schemaMigrationPlan(applied,catalog);expect(pending.map(file=>file.version)).toEqual(['199-worker-responsibility-boundaries.sql']);
  const migration=migrationTransaction(pending);
  sql("CREATE VIEW public.fixture_retired_workflow_dependency AS SELECT * FROM local_identity.claim_input_task(NULL,1)");
  expect(()=>sql(migration)).toThrow(/depend/);expect(sql("SELECT to_regprocedure('local_identity.claim_input_task(uuid,integer)') IS NOT NULL")).toBe('t');
  sql('DROP VIEW public.fixture_retired_workflow_dependency');assertRestored(before,snapshot());
  expect(()=>sql(migration.replace(/COMMIT;$/,'SELECT 1/0;COMMIT;'))).toThrow(/division by zero/);assertRestored(before,snapshot());
  sql(migration);const after=snapshot();
  for(const key of ['rows','sequenceRows','roles'])expect(after[key],key).toEqual(before[key]);
  for(const [kind,objects]of Object.entries(before.catalog))expect(kind==='functions'?after.catalog[kind].filter((item:any)=>!changedFunctions.has(item.schema+'.'+item.name)):kind==='triggers'?after.catalog[kind].filter((item:any)=>!changedTriggers.has(item.name)):after.catalog[kind],kind).toEqual(kind==='functions'?(objects as any[]).filter(item=>!changedFunctions.has(item.schema+'.'+item.name)):kind==='triggers'?(objects as any[]).filter(item=>!changedTriggers.has(item.name)):objects);
  expect(after.security.filter((item:any)=>!changedFunctions.has(item.identity.split('(')[0]))).toEqual(before.security.filter((item:any)=>!changedFunctions.has(item.identity.split('(')[0])));
  const ledger=Object.fromEntries(Object.entries(after.ledger).map(([version,value])=>[version,(value as {sha256:string}).sha256]));expect(schemaMigrationPlan(ledger,catalog)).toEqual([]);
  const dump=context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',database]);sql(dump,restored);
  assertRestored(after,databaseSnapshot(context,restored,process.cwd()));
  expect(sql(`SELECT main_script_revision_id::text FROM public.episodes WHERE id='${episode}'`,restored)).toBe(script);
  expect(sql("SELECT to_regprocedure('local_identity.claim_input_task(uuid,integer)') IS NULL",restored)).toBe('t');
 }finally{for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}
},90000);
