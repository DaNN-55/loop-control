// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,realpath,lstat,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {ownerTransaction} from './ownerTransaction';

const removed=['local_identity.plan_input_tasks_before_workspace_audio(uuid)','public.apply_episode_configuration_repair(uuid,jsonb,text,text)','public.generate_shot_tts(uuid,uuid,text,boolean)','public.generate_confirmed_shot_tts_batch(uuid,uuid)'];

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('175 removes only four unused rejection entries after full history restore and preserves every retained definition and ACL',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Compatibility acceptance requires an isolated cluster');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(f=>Number(f.version.slice(0,3))<=175)},previous={...catalog,current:catalog.current.filter(f=>Number(f.version.slice(0,3))<175)},cleanup=catalog.current.find(f=>f.version==='175-remove-unreferenced-retired-sql-entries.sql')!;
 expect([...cleanup.body.matchAll(/^DROP FUNCTION ([^;]+);$/gm)].map(m=>m[1])).toEqual(removed);
 const names=new Set(removed.map(s=>s.slice(0,s.indexOf('(')))),suffix=randomBytes(6).toString('hex'),source='loop_compat_source_'+suffix,restored='loop_compat_restore_'+suffix,created:string[]=[];
 const root=await realpath(await mkdtemp('/private/tmp/loop-compat-history-')),stat=await lstat(root,{bigint:true});
 const sql=(q:string,db=restored)=>context.sql('\\set VERBOSITY verbose\n'+q,db),snapshot=(db=restored)=>databaseSnapshot(context,db,process.cwd());
 const owner=randomUUID(),account=randomUUID(),episode=randomUUID(),script=randomUUID();
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
   INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,provider,model,prompt_version) VALUES('${episode}','draft_storyboard','failed','{"marker":"retained old task"}','codex','historical','historical-v1');
   COMMIT;`,source);
  const before=snapshot(source);expect(before.rows['local_identity.script_productions'].rows).toBe(1);expect(before.rows['local_identity.episode_planning_selections'].rows).toBe(1);
  const dump=context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',source]);sql(dump);assertRestored(before,snapshot());
  sql('CREATE VIEW public.compat_dependency_probe AS SELECT id FROM local_identity.plan_input_tasks_before_workspace_audio(NULL::uuid)');
  expect(()=>sql(migrationTransaction([cleanup]))).toThrow(/2BP01/);sql('DROP VIEW public.compat_dependency_probe');assertRestored(before,snapshot());
  expect(()=>sql(migrationTransaction([cleanup]).replace(/COMMIT;$/,'SELECT 1/0; COMMIT;'))).toThrow(/22012/);assertRestored(before,snapshot());
  sql(migrationTransaction([cleanup]));const after=snapshot();
  for(const key of ['rows','sequenceRows','roles'])expect(after[key]).toEqual(before[key]);
  const dropped=before.catalog.functions.filter((f:{schema:string;name:string})=>names.has(f.schema+'.'+f.name));expect(dropped).toHaveLength(4);
  expect(after.catalog).toEqual({...before.catalog,functions:before.catalog.functions.filter((f:{schema:string;name:string})=>!names.has(f.schema+'.'+f.name))});
  const acl=new Set(dropped.map((f:{schema:string;name:string;arguments:string})=>`${f.schema}.${f.name}(${f.arguments})`));expect(after.security).toEqual(before.security.filter((s:{identity:string})=>!acl.has(s.identity)));
  for(const [version,row]of Object.entries(before.ledger))expect(after.ledger[version]).toEqual(row);
  const ledger=Object.fromEntries(Object.entries(after.ledger).map(([k,v])=>[k,(v as {sha256:string}).sha256]));expect(ledger[cleanup.version]).toBe(cleanup.sha256);expect(Object.keys(after.ledger)).toHaveLength(Object.keys(before.ledger).length+1);expect(schemaMigrationPlan(ledger,catalog)).toEqual([]);
  for(const name of removed)expect(sql(`SELECT to_regprocedure('${name}') IS NULL`)).toBe('t');
  for(const actor of ['loop_app','loop_worker'])for(const call of [
   `local_identity.plan_input_tasks_before_workspace_audio('${episode}')`,
   `public.apply_episode_configuration_repair('${episode}','{}','old','retained')`,
   `public.generate_shot_tts('${episode}','${script}','old-shot',false)`,
   `public.generate_confirmed_shot_tts_batch('${episode}','${script}')`,
  ])expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT * FROM ${call}`)).toThrow(/42883/);
  expect(sql('SET SESSION AUTHORIZATION loop_app; SELECT count(*) FROM local_identity.script_production_scopes()')).toBe('0');assertRestored(after,snapshot());
 }finally{try{for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}finally{await rm(root,{recursive:true,force:true});}}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('real saved runtime modules still pass Worker startup, reject old planning and scan no enabled history after 175',async()=>{
 const compatibilityRoot=process.env.LOOP_TEST_COMPAT_RELEASES_ROOT;if(!compatibilityRoot)throw Error('Explicit copied runtime packages are required');
 const manifest=JSON.parse(await readFile(join(compatibilityRoot,'compatibility.json'),'utf8')) as {releases:Array<{id:string;workerFiles:Array<{file:string;sha256:string;requiresPlanner:boolean}>;scanner:{file:string;sha256:string}}>};
 expect(manifest.releases.length).toBeGreaterThan(0);
 const f=await productionWorkspaceFixture(),worker=f.workerPool();try{
  await f.c.query("INSERT INTO local_identity.script_productions(episode_id,owner_id,script_revision_id,script_sha256,plan,enabled,authorization_hash,authorized_at) SELECT $1,$2,id,sha256,'{}',true,repeat('b',64),clock_timestamp() FROM public.production_material_revisions WHERE id=$3",[f.episode,f.owner,f.script]);
  const state=async()=>({tasks:(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t ORDER BY id')).rows,authorization:(await f.c.query('SELECT to_jsonb(t) value FROM local_identity.script_productions t ORDER BY episode_id')).rows});const before=await state();
  let oldWorkers=0,currentWorkers=0,scanners=0,actions=0;const scanErrors:unknown[]=[],scanRows:number[]=[];
  const load=async(id:string,file:{file:string;sha256:string})=>{const path=join(compatibilityRoot,id,file.file),bytes=await readFile(path);expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);return import(pathToFileURL(path).href);};
  for(const release of manifest.releases){
   for(const file of release.workerFiles){const module=await load(release.id,file);await module.assertNativeWorkerDatabase(worker,f.database);const port=module.nativeWorkerPort(worker);if(file.requiresPlanner){oldWorkers++;await expect(port.plan({episodeId:f.episode})).rejects.toMatchObject({code:'0A000'});}else{currentWorkers++;expect(await port.plan({episodeId:f.episode})).toBe(0);}}
   const module=await load(release.id,release.scanner),observedPool={query:async(text:string,values?:unknown[])=>{try{const result=await f.pool.query(text,values);scanRows.push(result.rows.length);return result;}catch(error){scanErrors.push(error);throw error;}}};
   const runner=module.startScriptProductionRunner(observedPool,async()=>{actions++;},2_147_483_647);try{await runner.wake();scanners++;}finally{await runner.stop();}
  }
  expect(oldWorkers).toBeGreaterThan(0);expect(currentWorkers).toBeGreaterThan(0);expect(scanners).toBe(manifest.releases.length);expect(scanRows).toHaveLength(scanners);expect(scanRows.every(n=>n===0)).toBe(true);expect(scanErrors).toEqual([]);expect(actions).toBe(0);expect(await state()).toEqual(before);
  for(const [call,args]of [
   ['local_identity.queue_workspace_planning($1,$2)',[f.episode,f.script]],
   ['local_identity.replan_workspace_planning($1,$2,$3)',[f.episode,f.script,randomUUID()]],
   ['local_identity.save_planning_selection($1,$2,0)',[f.episode,{provider:'codex'}]],
   ['local_identity.generate_input_shot_tts($1,$2,$3,false)',[f.episode,f.board,'old-shot']],
   ['public.apply_episode_configuration_repair_v2($1,$2)',[f.episode,{}]],
   ['public.apply_external_connection_repair($1,$2)',[f.episode,randomUUID()]],
  ]as const){await expect(ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT '+call,[...args]))).rejects.toMatchObject({code:'0A000'});await expect(ownerTransaction(f.pool,f.other,false,c=>c.query('SELECT '+call,[...args]))).rejects.toMatchObject({code:'42501'});}
  expect(await nativeWorkerPort(worker).plan({episodeId:f.episode})).toBe(0);expect(await state()).toEqual(before);
 }finally{await worker.end();await f.close();}
},120000);
