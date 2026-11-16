// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('201 atomically closes SQL writes while retaining populated history, original ledgers and full native restore',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),c=runtimeContext();
 if(c.dailyRuntime!==false||c.isolatedFixtureNative!==true||!c.nativeConnection)throw Error('Only an owned native fixture is permitted');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const suffix=randomBytes(6).toString('hex'),source='loop_retire_old_'+suffix,restored='loop_retire_restore_'+suffix,created:string[]=[];
 // This historical migration acceptance deliberately ends at 201.
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(file=>file.version<'202-')},previous={...catalog,current:catalog.current.filter(file=>file.version<'201-')};
 try{
  for(const db of [source,restored]){c.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  c.sql(freshSchemaTransaction(previous),source);
  const owner=randomUUID(),account=randomUUID(),episode=randomUUID(),task=randomUUID();
  c.sql(`BEGIN; SET LOCAL session_replication_role=replica;
   INSERT INTO local_identity.owners(id,email) VALUES('${owner}','${owner}@example.invalid');
   INSERT INTO public.accounts(id,slug,name,timezone) VALUES('${account}','old-${account}','Retained legacy order','UTC');
   INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('${account}','${owner}','owner');
   INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES('${account}','${account}',1,'{}',true);
   INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES('${episode}','${account}','${account}','Retained original order','qc_review');
   INSERT INTO local_identity.input_episodes(episode_id,owner_id,enabled,media_enabled,studio_enabled) VALUES('${episode}','${owner}',true,true,true);
   INSERT INTO public.tasks(id,episode_id,task_type,status,provider,model,prompt_version,input_snapshot) VALUES('${task}','${episode}','generate_review_render','ready','openchatcut','openchatcut','review-render-v1','{"marker":"immutable original input"}');
   COMMIT;`,source);
  const snapshot=()=>databaseSnapshot(c,source,process.cwd()),before=snapshot();
  const ledger=Object.fromEntries(Object.entries(before.ledger).map(([version,row])=>[version,(row as {sha256:string}).sha256]));
  const pending=schemaMigrationPlan(ledger,catalog);expect(pending.map(m=>m.version)).toEqual(['201-close-retired-manual-execution.sql']);
  const transaction=migrationTransaction(pending);
  expect(()=>c.sql(transaction.replace(/COMMIT;$/,'SELECT 1/0;COMMIT;'),source)).toThrow(/division by zero/);assertRestored(before,snapshot());
  c.sql(transaction,source);const after=snapshot();
  for(const key of ['rows','sequenceRows','roles'])expect(after[key],key).toEqual(before[key]);
  for(const [version,row] of Object.entries(before.ledger))expect(after.ledger[version]).toEqual(row);
  const modified=new Set(['current_worker_task','assert_current_worker_execution','claim_scheduled_worker_task','claim_next_worker_task','input_task_connection','input_media_connection','reserve_wan_generation']);
  for(const [kind,objects] of Object.entries(before.catalog))expect(kind==='functions'?(after.catalog[kind] as any[]).filter(o=>!modified.has(o.name)):after.catalog[kind],kind).toEqual(kind==='functions'?(objects as any[]).filter(o=>!modified.has(o.name)):objects);
  const body=await readFile('db/current/201-close-retired-manual-execution.sql','utf8');
  const revoked=[...body.matchAll(/^REVOKE ALL ON FUNCTION ([^(]+\([^;]+?\)) FROM /gm)].map(m=>m[1]).filter(s=>!s.startsWith('local_identity.assert_current_worker_execution'));
  expect(revoked).toHaveLength(41);
  for(const signature of revoked)for(const role of ['loop_app','loop_owner','loop_worker','loop_anonymous'])expect(c.sql(`SELECT has_function_privilege('${role}','${signature}','EXECUTE')`,source),role+signature).toBe('f');
  // Permissions are enforced by PostgreSQL before any retired function body runs.
  for(const signature of revoked){const [name,args]=signature.slice(0,-1).split('('),call=name+'('+args.split(',').map(t=>'NULL::'+t).join(',')+')';expect(()=>c.sql('BEGIN;SET LOCAL ROLE loop_app;SELECT '+call+';ROLLBACK;',source),signature).toThrow(/permission denied/);}
  c.sql(pending[0].body,source);assertRestored(after,snapshot());
  const currentLedger=Object.fromEntries(Object.entries(after.ledger).map(([version,row])=>[version,(row as {sha256:string}).sha256]));expect(schemaMigrationPlan(currentLedger,catalog)).toEqual([]);
  c.sql(c.execTool('pg_dump',['-U','postgres','-d',source]),restored);assertRestored(after,databaseSnapshot(c,restored,process.cwd()));
  expect(c.sql(`SELECT local_identity.current_worker_task(t) FROM public.tasks t WHERE id='${task}'`,restored)).toBe('f');
 }finally{for(const db of created.reverse())c.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}
},90000);
