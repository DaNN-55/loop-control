// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,realpath,lstat,rm} from 'node:fs/promises';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('removes old orchestration shells and their last Studio caller after full restore, preserving history and dependency rollback',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Shell cleanup requires an isolated fixture container');
 const suffix=randomBytes(6).toString('hex'),source='loop_shell_source_'+suffix,restored='loop_shell_restore_'+suffix,created:string[]=[];
 const assetRoot=await realpath(await mkdtemp('/private/tmp/loop-shell-history-')),assetStat=await lstat(assetRoot,{bigint:true});
 const available=loadSchemaCatalog(process.cwd()),catalog={...available,current:available.current.filter(f=>Number(f.version.slice(0,3))<=172)},previous={...catalog,current:catalog.current.filter(f=>Number(f.version.slice(0,3))<172)};
 const cleanup=catalog.current.find(f=>f.version==='172-remove-disconnected-orchestration-shells.sql')!;
 const removed=[...cleanup.body.matchAll(/^DROP FUNCTION (public\.[a-z_]+\([^;]*\));$/gm)].map(m=>m[1]);expect(removed).toHaveLength(19);
 const sql=(q:string,db=restored)=>context.sql('\\set VERBOSITY verbose\n'+q,db);
 const functions=(db:string)=>JSON.parse(sql("SELECT jsonb_agg(jsonb_build_object('signature',n.nspname||'.'||p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',p.proacl) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f' AND n.nspname IN('public','local_identity','loop_internal','extensions')",db));
 const history=(db:string)=>JSON.parse(sql("SELECT jsonb_build_object('episodes',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.episodes t),'tasks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tasks t),'packages',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.review_packages t),'transitions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.state_transitions t),'audit',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.audit_events t),'defaults',(SELECT jsonb_agg(to_jsonb(t)) FROM local_identity.historical_planning_defaults t),'harnesses',(SELECT jsonb_agg(to_jsonb(t)) FROM local_identity.historical_planning_harnesses t))",db));
 try{
  for(const db of [source,restored]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  sql(freshSchemaTransaction(previous),source);
  const owner=randomUUID(),account=randomUUID(),episode=randomUUID(),board=randomUUID(),pre=randomUUID(),qc=randomUUID();
  sql(`BEGIN;
   INSERT INTO local_identity.owners(id,email) VALUES('${owner}','shell-history@example.invalid');
   INSERT INTO public.accounts(id,slug,name,timezone) VALUES('${account}','shell-history','Historical shell fixture','Asia/Shanghai');
   INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('${account}','${owner}','owner');
   INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES('${account}','${account}',1,'{}',true);
   INSERT INTO local_identity.account_asset_directories(account_id,actual_root,device_id,inode_id) VALUES('${account}','${assetRoot}','${assetStat.dev}','${assetStat.ino}');
   INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES('${episode}','${account}','${account}','Retained historical input','qc_review');
   INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,provider,model,prompt_version) VALUES('${episode}','draft_storyboard','failed','{"marker":"retained old task"}','codex','historical','historical-v1');
   INSERT INTO public.review_packages(id,episode_id,stage,revision_number,context_snapshot) VALUES
    ('${board}','${episode}','storyboard_review',1,'{}'),
    ('${pre}','${episode}','production_ready',1,jsonb_build_object('storyboard_review_package_id','${board}')),
    ('${qc}','${episode}','qc_review',1,jsonb_build_object('review_kind','openchatcut_review_render','pre_render_review_package_id','${pre}'));
   COMMIT;`,source);
  const oldFunctions=functions(source),oldHistory=history(source),oldLedger=JSON.parse(sql("SELECT jsonb_object_agg(version,sha256) FROM local_identity.schema_migrations",source));
  const dump=context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',source]);sql(dump);
  expect(functions(restored)).toEqual(oldFunctions);expect(history(restored)).toEqual(oldHistory);
  // A catalog dependency must prevent deletion and roll back earlier DROPs in the transaction.
  sql('CREATE VIEW public.shell_dependency_probe AS SELECT id FROM public.orchestrate_a_roll_tasks_for_episode(NULL::uuid)');
  expect(()=>sql(migrationTransaction([cleanup]))).toThrow(/2BP01/);
  for(const name of removed)expect(sql(`SELECT to_regprocedure('${name}') IS NOT NULL`)).toBe('t');
  expect(JSON.parse(sql("SELECT jsonb_object_agg(version,sha256) FROM local_identity.schema_migrations"))).toEqual(oldLedger);
  sql('DROP VIEW public.shell_dependency_probe');
  expect(()=>sql(migrationTransaction([cleanup]).replace(/COMMIT;$/,'SELECT 1/0; COMMIT;'))).toThrow(/22012/);
  expect(functions(restored)).toEqual(oldFunctions);expect(history(restored)).toEqual(oldHistory);
  sql(migrationTransaction(schemaMigrationPlan(oldLedger,catalog)));
  for(const name of removed)expect(sql(`SELECT to_regprocedure('${name}') IS NULL`)).toBe('t');
  expect(functions(restored)).toEqual(oldFunctions.filter((f:{signature:string})=>!removed.includes(f.signature)));
  expect(history(restored)).toEqual(oldHistory);
  const ledger=JSON.parse(sql("SELECT jsonb_object_agg(version,sha256) FROM local_identity.schema_migrations"));
  expect(ledger).toEqual({...oldLedger,[cleanup.version]:cleanup.sha256});expect(schemaMigrationPlan(ledger,catalog)).toEqual([]);
  expect(()=>sql(`SET SESSION AUTHORIZATION loop_worker; SELECT * FROM public.orchestrate_storyboard_tasks_for_episode('${episode}');`)).toThrow(/42501/);
  expect(()=>sql(`SET SESSION AUTHORIZATION loop_app; SELECT public.request_studio_storyboard_revision('${qc}','Rejected direct SQL');`)).toThrow(/42501/);
  // Only this disposable database gets a fixed privileged probe. Product ACLs stay
  // unchanged; session_user remains loop_app, so owner_id cannot be spoofed by admin.
  sql(`CREATE FUNCTION local_identity.shell_revision_probe() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$BEGIN PERFORM public.request_studio_storyboard_revision('${qc}','Retained old structural request'); END;$$;
   REVOKE ALL ON FUNCTION local_identity.shell_revision_probe() FROM PUBLIC;
   GRANT EXECUTE ON FUNCTION local_identity.shell_revision_probe() TO loop_app;`);
  try{
   expect(()=>sql(`BEGIN; SELECT set_config('loop.owner_id','${owner}',true); SET SESSION AUTHORIZATION loop_app; SELECT local_identity.shell_revision_probe(); COMMIT;`)).toThrow(/0A000/);
   expect(history(restored)).toEqual(oldHistory);
  }finally{sql('DROP FUNCTION local_identity.shell_revision_probe()');}
  expect(functions(restored)).toEqual(oldFunctions.filter((f:{signature:string})=>!removed.includes(f.signature)));
  // 173 removes the obsolete caller as well, so the final rejection shell is no
  // longer needed. Restore and verify the previous boundary before removing it.
  const studioCleanup=available.current.find(f=>f.version==='173-remove-retired-studio-storyboard-entry.sql')!;
  const studioRemoved=['public.request_studio_storyboard_revision(uuid,text)','public.orchestrate_storyboard_tasks_for_episode(uuid)'];
  const beforeStudio=functions(restored),studioLedger=JSON.parse(sql("SELECT jsonb_object_agg(version,sha256) FROM local_identity.schema_migrations"));
  sql("CREATE VIEW public.studio_dependency_probe AS SELECT id FROM public.request_studio_storyboard_revision(NULL::uuid,'dependency probe')");
  expect(()=>sql(migrationTransaction([studioCleanup]))).toThrow(/2BP01/);
  expect(functions(restored)).toEqual(beforeStudio);expect(history(restored)).toEqual(oldHistory);
  expect(JSON.parse(sql("SELECT jsonb_object_agg(version,sha256) FROM local_identity.schema_migrations"))).toEqual(studioLedger);
  sql('DROP VIEW public.studio_dependency_probe');
  expect(()=>sql(migrationTransaction([studioCleanup]).replace(/COMMIT;$/,'SELECT 1/0; COMMIT;'))).toThrow(/22012/);
  expect(functions(restored)).toEqual(beforeStudio);expect(history(restored)).toEqual(oldHistory);
  sql(migrationTransaction([studioCleanup]));
  for(const name of studioRemoved)expect(sql(`SELECT to_regprocedure('${name}') IS NULL`)).toBe('t');
  expect(functions(restored)).toEqual(beforeStudio.filter((f:{signature:string})=>!studioRemoved.includes(f.signature)));
  expect(history(restored)).toEqual(oldHistory);
  for(const actor of ['loop_app','loop_worker']){
   expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT public.request_studio_storyboard_revision('${qc}','Retired request');`)).toThrow(/42883/);
   expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT * FROM public.orchestrate_storyboard_tasks_for_episode('${episode}');`)).toThrow(/42883/);
  }
  expect(history(restored)).toEqual(oldHistory);
  const finalLedger=JSON.parse(sql("SELECT jsonb_object_agg(version,sha256) FROM local_identity.schema_migrations"));
  expect(finalLedger).toEqual({...studioLedger,[studioCleanup.version]:studioCleanup.sha256});
  expect(schemaMigrationPlan(finalLedger,{...available,current:available.current.filter(f=>Number(f.version.slice(0,3))<=173)})).toEqual([]);
 }finally{try{for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}finally{await rm(assetRoot,{recursive:true,force:true});}}
},120000);
