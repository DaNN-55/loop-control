// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('202 and 203 remove only the reviewed legacy closure, reject new consumers and preserve populated history through rollback and restore',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),c=runtimeContext();
 if(c.dailyRuntime!==false||c.isolatedFixtureNative!==true||!c.nativeConnection)throw Error('An owned isolated native fixture is required');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const suffix=randomBytes(6).toString('hex'),source='loop_cleanup_old_'+suffix,restored='loop_cleanup_restore_'+suffix,created:string[]=[];
 const loaded=loadSchemaCatalog(process.cwd()),catalog={...loaded,current:loaded.current.filter(m=>m.version<'204-')},previous={...catalog,current:catalog.current.filter(m=>m.version<'202-')};
 try{
  for(const db of [source,restored]){c.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  c.sql(freshSchemaTransaction(previous),source);
  const owner=randomUUID(),account=randomUUID(),episode=randomUUID(),task=randomUUID();
  c.sql(`BEGIN;SET LOCAL session_replication_role=replica;
   INSERT INTO local_identity.owners(id,email) VALUES('${owner}','${owner}@example.invalid');
   INSERT INTO public.accounts(id,slug,name,timezone) VALUES('${account}','retained-${account}','Retained history','UTC');
   INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('${account}','${owner}','owner');
   INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES('${account}','${account}',1,'{}',true);
   INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES('${episode}','${account}','${account}','Historical order','qc_review');
   INSERT INTO local_identity.input_episodes(episode_id,owner_id,enabled,studio_enabled) VALUES('${episode}','${owner}',true,true);
   INSERT INTO public.tasks(id,episode_id,task_type,status,provider,model,prompt_version,input_snapshot) VALUES('${task}','${episode}','generate_review_render','ready','openchatcut','openchatcut','review-render-v1','{"retained":"original bytes"}');COMMIT;`,source);
  const snapshot=()=>databaseSnapshot(c,source,process.cwd()),before=snapshot();
  const ledger=Object.fromEntries(Object.entries(before.ledger).map(([version,row])=>[version,(row as {sha256:string}).sha256]));
  const pending=schemaMigrationPlan(ledger,catalog);expect(pending.map(m=>m.version)).toEqual(['202-remove-retired-manual-functions.sql','203-remove-unused-legacy-draft-writes.sql']);
  const transaction=migrationTransaction(pending),body=(await Promise.all(pending.map(file=>readFile('db/current/'+file.version,'utf8')))).join('\n');
  const targets=[...body.matchAll(/^DROP FUNCTION IF EXISTS (.+) RESTRICT;$/gm)].map(m=>m[1]);expect(targets).toHaveLength(47);
  for(const signature of targets)expect(c.sql(`SELECT to_regprocedure('${signature}') IS NOT NULL`,source),signature).toBe('t');
  // PostgreSQL does not track PL/pgSQL body calls in pg_depend: the migration
  // must reject a newly introduced consumer before removing its target.
  c.sql("CREATE FUNCTION local_identity.cleanup_test_consumer() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM public.resume_wan_video_task(NULL::uuid);END $$;",source);
  const withConsumer=snapshot();expect(()=>c.sql(transaction,source)).toThrow(/still have consumers/);assertRestored(withConsumer,snapshot());
  c.sql('DROP FUNCTION local_identity.cleanup_test_consumer() RESTRICT',source);assertRestored(before,snapshot());
  // A later 203 consumer must roll back the earlier 202 drops and ledger too.
  c.sql("CREATE FUNCTION local_identity.cleanup_test_consumer() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM local_identity.use_workspace_narration_track(NULL::uuid,NULL::uuid,NULL::text,NULL::uuid);END $$;",source);
  const withDraftConsumer=snapshot();expect(()=>c.sql(transaction,source)).toThrow(/still have consumers/);assertRestored(withDraftConsumer,snapshot());
  c.sql('DROP FUNCTION local_identity.cleanup_test_consumer() RESTRICT',source);assertRestored(before,snapshot());
  // An actual tracked SQL dependency also aborts the transaction.
  c.sql('CREATE FUNCTION local_identity.cleanup_test_consumer() RETURNS void LANGUAGE SQL BEGIN ATOMIC SELECT public.resume_wan_video_task(NULL::uuid); END;',source);
  const withTracked=snapshot();expect(()=>c.sql(transaction,source)).toThrow(/depend|consumer/);assertRestored(withTracked,snapshot());
  c.sql('DROP FUNCTION local_identity.cleanup_test_consumer() RESTRICT',source);assertRestored(before,snapshot());
  expect(()=>c.sql(transaction.replace(/COMMIT;$/,'SELECT 1/0;COMMIT;'),source)).toThrow(/division by zero/);assertRestored(before,snapshot());
  c.sql(transaction,source);const after=snapshot();
  for(const key of ['rows','sequenceRows','roles'])expect(after[key],key).toEqual(before[key]);
  for(const [version,row]of Object.entries(before.ledger))expect(after.ledger[version]).toEqual(row);
  for(const signature of targets)expect(c.sql(`SELECT to_regprocedure('${signature}') IS NULL`,source),signature).toBe('t');
  const beforeFunctions=before.catalog.functions,afterFunctions=after.catalog.functions;
  expect(beforeFunctions.length-afterFunctions.length).toBe(47);
  const removedNames=new Set(targets.map(s=>s.slice(0,s.indexOf('('))));
  for(const [kind,objects]of Object.entries(before.catalog))expect(after.catalog[kind],kind).toEqual(kind==='functions'?(objects as any[]).filter(o=>!removedNames.has(o.schema+'.'+o.name)):objects);
  // Reapplying SQL remains harmless; old ready tasks stay non-executable.
  c.sql(body,source);assertRestored(after,snapshot());
  expect(c.sql(`SELECT local_identity.current_worker_task(t) FROM public.tasks t WHERE id='${task}'`,source)).toBe('f');
  c.sql(c.execTool('pg_dump',['-U','postgres','-d',source]),restored);assertRestored(after,databaseSnapshot(c,restored,process.cwd()));
 }finally{for(const db of created.reverse())c.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}
},90000);
