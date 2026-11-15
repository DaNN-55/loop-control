// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID,randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {loadSchemaCatalog,freshSchemaTransaction,schemaMigrationPlan,migrationTransaction} from './schemaMigrations';
const removed=[
 'local_identity.generate_input_shot_tts(uuid,uuid,text,boolean)',
 'local_identity.plan_input_tasks(uuid)',
 'public.apply_episode_configuration_repair_v2(uuid,jsonb,text,text)',
 'public.apply_external_connection_repair(uuid,uuid,text,text)',
 'local_identity.queue_workspace_planning(uuid,uuid,uuid)',
 'local_identity.replan_workspace_planning(uuid,uuid,uuid)',
 'local_identity.save_planning_selection(uuid,jsonb,integer)',
 'local_identity.script_production_scopes()',
 'public.record_episode_worker_preflight(uuid,uuid)',
];
const removedNames=new Set(removed.map(name=>name.split('(')[0]));
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('retired workflow contracts have no current execution entry while saved plans remain readable',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true});try{
  for(const signature of removed)expect((await f.c.query('SELECT to_regprocedure($1) target',[signature])).rows[0].target,signature).toBeNull();
  for(const command of ['configureScriptProduction','pauseScriptProduction','applyScriptSettings','bindScriptVideo','renderScriptReview','prepareScriptPublish']){
   expect((await f.send(command,{enabled:false})).status,command).toBe(400);
  }
  const before=(await f.c.query('SELECT to_jsonb(e) value FROM public.episodes e WHERE id=$1',[f.newEpisode])).rows[0].value;
  const get=async(token=f.token)=>fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/saved-plan`,{headers:{Cookie:'loop_owner_session='+token}});
  const read=await get();expect(read.status).toBe(200);expect(await read.json()).toMatchObject({readOnly:true,plan:null,enabled:false});expect((await get(f.otherToken)).status).toBe(404);
  expect((await fetch(`${f.origin}/api/local/script-production?episode=${f.newEpisode}`,{headers:{Cookie:'loop_owner_session='+f.token}})).status).toBe(404);
  expect((await f.c.query('SELECT to_jsonb(e) value FROM public.episodes e WHERE id=$1',[f.newEpisode])).rows[0].value).toEqual(before);
  expect((await f.send('start')).status).toBe(200);const made=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(made.status,JSON.stringify(made.body)).toBe(200);expect(made.body.storyboardPackageId).toBeNull();
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('198 removes retired workflow contracts atomically and preserves nonempty history, ACLs and restore',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only an isolated schema fixture is permitted');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const suffix=randomBytes(6).toString('hex'),database='loop_create_old_'+suffix,restored='loop_create_restore_'+suffix,created:string[]=[];
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(file=>file.version<'199-')},previous={...catalog,current:catalog.current.filter(file=>file.version<'198-')};
 const sql=(query:string,db=database)=>context.sql(query,db),snapshot=()=>databaseSnapshot(context,database,process.cwd());
 try{
  for(const db of [database,restored]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  sql(freshSchemaTransaction(previous));
  const owner=randomUUID(),account=randomUUID(),episode=randomUUID(),script=randomUUID();
  sql(`BEGIN;SET LOCAL session_replication_role=replica;INSERT INTO local_identity.owners(id,email) VALUES('${owner}','${owner}@example.invalid');INSERT INTO public.accounts(id,slug,name,timezone) VALUES('${account}','old-create-history','Retained historical account','Asia/Shanghai');INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('${account}','${owner}','owner');INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES('${account}','${account}',1,'{}',true);INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES('${episode}','${account}','${account}','Original historical order','script_approved');INSERT INTO public.production_material_revisions(id,episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,is_main_script,created_by,material_purpose) VALUES('${script}','${episode}',1,'script','file','original.md','original.md','text/markdown',repeat('a',64),7,true,'${owner}','main_script');UPDATE public.episodes SET main_script_revision_id='${script}' WHERE id='${episode}';COMMIT;`);
  const before=snapshot(),applied=Object.fromEntries(Object.entries(before.ledger).map(([version,value])=>[version,(value as {sha256:string}).sha256]));
  const pending=schemaMigrationPlan(applied,catalog);expect(pending.map(file=>file.version)).toEqual(['198-remove-retired-workflow-contracts.sql']);
  const migration=migrationTransaction(pending);
  sql("CREATE VIEW public.fixture_retired_workflow_dependency AS SELECT * FROM local_identity.script_production_scopes()");
  expect(()=>sql(migration)).toThrow(/depend/);expect(sql("SELECT to_regprocedure('local_identity.script_production_scopes()') IS NOT NULL")).toBe('t');
  sql('DROP VIEW public.fixture_retired_workflow_dependency');assertRestored(before,snapshot());
  expect(()=>sql(migration.replace(/COMMIT;$/,'SELECT 1/0;COMMIT;'))).toThrow(/division by zero/);assertRestored(before,snapshot());
  sql(migration);for(const signature of removed)expect(sql(`SELECT to_regprocedure('${signature}') IS NULL`)).toBe('t');const after=snapshot();
  for(const key of ['rows','sequenceRows','roles'])expect(after[key],key).toEqual(before[key]);
  for(const [kind,objects]of Object.entries(before.catalog))expect(after.catalog[kind],kind).toEqual(kind==='functions'?(objects as any[]).filter(item=>!removedNames.has(item.schema+'.'+item.name)):objects);
  expect(after.security).toEqual(before.security.filter((item:any)=>!removedNames.has(item.identity.split('(')[0])));
  const ledger=Object.fromEntries(Object.entries(after.ledger).map(([version,value])=>[version,(value as {sha256:string}).sha256]));expect(schemaMigrationPlan(ledger,catalog)).toEqual([]);
  const dump=context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',database]);sql(dump,restored);
  assertRestored(after,databaseSnapshot(context,restored,process.cwd()));
  expect(sql(`SELECT main_script_revision_id::text FROM public.episodes WHERE id='${episode}'`,restored)).toBe(script);
  expect(sql("SELECT to_regprocedure('local_identity.script_production_scopes()') IS NULL",restored)).toBe('t');
 }finally{for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}
},90000);
