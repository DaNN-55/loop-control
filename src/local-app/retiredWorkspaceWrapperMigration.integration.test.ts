// @vitest-environment node
import {expect,it} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('205 removes unused workspace wrappers while preserving history, ACLs, current controls and exact restoration',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),c=runtimeContext();
 if(c.dailyRuntime!==false||c.isolatedFixtureNative!==true||!c.nativeConnection)throw Error('An owned isolated native fixture is required');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const suffix=randomBytes(6).toString('hex'),source='loop_wrappers_old_'+suffix,restored='loop_wrappers_restore_'+suffix,fresh='loop_wrappers_fresh_'+suffix,created:string[]=[];
 const loaded=loadSchemaCatalog(process.cwd()),catalog={...loaded,current:loaded.current.filter(m=>m.version<'206-')},previous={...catalog,current:catalog.current.filter(m=>m.version<'205-')};
 try{
  for(const db of [source,restored,fresh]){c.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  c.sql(freshSchemaTransaction(previous),source);
  const owner=randomUUID(),account=randomUUID(),episode=randomUUID(),task=randomUUID();
  c.sql(`BEGIN;SET LOCAL session_replication_role=replica;
   INSERT INTO local_identity.owners(id,email) VALUES('${owner}','${owner}@example.invalid');
   INSERT INTO public.accounts(id,slug,name,timezone) VALUES('${account}','retained-${account}','Retained history','UTC');
   INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('${account}','${owner}','owner');
   INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES('${account}','${account}',1,'{}',true);
   INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES('${episode}','${account}','${account}','Historical order','qc_review');
   INSERT INTO local_identity.input_episodes(episode_id,owner_id,enabled,studio_enabled) VALUES('${episode}','${owner}',true,true);
   INSERT INTO public.tasks(id,episode_id,task_type,status,provider,model,prompt_version,input_snapshot) VALUES('${task}','${episode}','generate_final_render','ready','openchatcut','openchatcut','final-render-v1','{"retained":"original bytes"}');COMMIT;`,source);
  const snapshot=()=>databaseSnapshot(c,source,process.cwd()),before=snapshot();
  const ledger=Object.fromEntries(Object.entries(before.ledger).map(([version,row])=>[version,(row as {sha256:string}).sha256]));
  const pending=schemaMigrationPlan(ledger,catalog);expect(pending.map(m=>m.version)).toEqual(['205-remove-disconnected-workspace-wrappers.sql']);
  const body=pending[0].body,transaction=migrationTransaction(pending),targets=[...body.matchAll(/^DROP FUNCTION IF EXISTS (.+) RESTRICT;$/gm)].map(m=>m[1]);expect(targets).toHaveLength(10);
  for(const signature of targets)expect(c.sql(`SELECT to_regprocedure('${signature}') IS NOT NULL`,source),signature).toBe('t');
  const acl=()=>JSON.parse(c.sql("SELECT jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'acl',p.proacl) ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','local_identity','loop_internal') AND p.prokind='f'",source));
  const removedIdentities=new Set(targets.map(signature=>c.sql(`SELECT '${signature}'::regprocedure::text`,source))),beforeAcl=acl();
  for(const definition of [
   'CREATE FUNCTION local_identity.cleanup_test_consumer() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM local_identity.register_workspace_preparation(NULL::uuid,NULL::uuid,NULL::uuid,NULL::jsonb,NULL::jsonb,NULL::text);END $$;',
   'CREATE FUNCTION local_identity.cleanup_test_consumer() RETURNS void LANGUAGE SQL BEGIN ATOMIC SELECT local_identity.register_workspace_preparation(NULL::uuid,NULL::uuid,NULL::uuid,NULL::jsonb,NULL::jsonb,NULL::text); END;',
  ]){
   c.sql(definition,source);const withConsumer=snapshot();expect(()=>c.sql(transaction,source)).toThrow(/consumer|depend/);assertRestored(withConsumer,snapshot());
   c.sql('DROP FUNCTION local_identity.cleanup_test_consumer() RESTRICT',source);assertRestored(before,snapshot());
  }
  expect(()=>c.sql(transaction.replace(/COMMIT;$/,'SELECT 1/0;COMMIT;'),source)).toThrow(/division by zero/);assertRestored(before,snapshot());
  c.sql(transaction,source);const after=snapshot();
  for(const key of ['rows','sequenceRows','roles'])expect(after[key],key).toEqual(before[key]);
  for(const [version,row]of Object.entries(before.ledger))expect(after.ledger[version]).toEqual(row);
  for(const signature of targets)expect(c.sql(`SELECT to_regprocedure('${signature}') IS NULL`,source),signature).toBe('t');
  expect(before.catalog.functions.length-after.catalog.functions.length).toBe(10);
  const removedNames=new Set(targets.map(s=>s.slice(0,s.indexOf('(')))),unchanged=(items:any[])=>items.filter(f=>!removedNames.has(f.schema+'.'+f.name));
  for(const [kind,objects]of Object.entries(before.catalog))expect(kind==='functions'?unchanged(after.catalog.functions):after.catalog[kind],kind).toEqual(kind==='functions'?unchanged(objects as any[]):objects);
  expect(acl()).toEqual(beforeAcl.filter((f:any)=>!removedIdentities.has(f.identity)));
  expect(c.sql(`SET SESSION AUTHORIZATION loop_app;BEGIN;SELECT set_config('loop.owner_id','${owner}',true);SELECT local_identity.set_production_metrics_enabled(false)->>'enabled';ROLLBACK;RESET SESSION AUTHORIZATION;`,source).split('\n').at(-1)).toBe('false');assertRestored(after,snapshot());
  for(const validator of ['public.is_valid_shot_audio_mix(jsonb)','public.is_valid_shot_composition(jsonb,integer)'])expect(c.sql(`SELECT EXISTS(SELECT 1 FROM pg_depend WHERE refclassid='pg_proc'::regclass AND refobjid='${validator}'::regprocedure AND classid='pg_constraint'::regclass)`,source)).toBe('t');
  c.sql(body,source);assertRestored(after,snapshot());expect(c.sql(`SELECT local_identity.current_worker_task(t) FROM public.tasks t WHERE id='${task}'`,source)).toBe('f');
  c.sql(c.execTool('pg_dump',['-U','postgres','-d',source]),restored);assertRestored(after,databaseSnapshot(c,restored,process.cwd()));
  c.sql(freshSchemaTransaction(catalog),fresh);expect(databaseSnapshot(c,fresh,process.cwd()).catalog).toEqual(after.catalog);
 }finally{for(const db of created.reverse())c.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}
},120000);
