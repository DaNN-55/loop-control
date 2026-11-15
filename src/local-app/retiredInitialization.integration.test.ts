// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,realpath,lstat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {csrfFor} from './sessions';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';

const removed=['public.bootstrap_platform(text,text,text,jsonb)','public.commission_script(uuid,text,text)','public.set_episode_script_source(uuid,text)','public.apply_blueprint_to_episode(uuid,uuid,text,text)','public.deactivate_blueprint_version(uuid,uuid)'];

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('180 removes only unused initialization entries after restoring account, rule and delegated-task history without altering bindings or guards',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Compatibility acceptance requires an isolated cluster');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(f=>Number(f.version.slice(0,3))<=180)},previous={...catalog,current:catalog.current.filter(f=>Number(f.version.slice(0,3))<180)},cleanup=catalog.current.find(f=>f.version==='180-remove-unused-initialization-entries.sql')!;
 expect([...cleanup.body.matchAll(/^DROP FUNCTION ([^;]+);$/gm)].map(m=>m[1])).toEqual(removed);
 const names=new Set(removed.map(s=>s.slice(0,s.indexOf('(')))),suffix=randomBytes(6).toString('hex'),source='loop_compat_source_'+suffix,restored='loop_compat_restore_'+suffix,created:string[]=[];
 const root=await realpath(await mkdtemp('/private/tmp/loop-compat-history-')),stat=await lstat(root,{bigint:true});
 const sql=(q:string,db=restored)=>context.sql('\\set VERBOSITY verbose\n'+q,db),snapshot=(db=restored)=>databaseSnapshot(context,db,process.cwd());
 const owner=randomUUID(),other=randomUUID(),account=randomUUID(),foreignAccount=randomUUID(),episode=randomUUID(),provided=randomUUID(),script=randomUUID(),oldRule=randomUUID(),currentRule=randomUUID(),inactiveRule=randomUUID(),harness=randomUUID(),task=randomUUID(),queued=randomUUID();
 try{
  for(const db of [source,restored]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  sql(freshSchemaTransaction(previous),source);
  sql(`BEGIN;
   INSERT INTO local_identity.owners(id,email) VALUES('${owner}','init-history@example.invalid'),('${other}','foreign-init-history@example.invalid');
   INSERT INTO public.accounts(id,slug,name,timezone) VALUES('${account}','init-history','Preserved account','Asia/Shanghai'),('${foreignAccount}','foreign-init-history','Other account','UTC');
   INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('${account}','${owner}','owner'),('${foreignAccount}','${other}','owner');
   INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active,is_snapshot,archived_at) VALUES('${oldRule}','${account}',1,'{"positioning":"原规则","tone":"保留历史"}',false,true,'2026-10-01T01:02:03.123456Z'),('${currentRule}','${account}',2,'{"positioning":"当前规则"}',true,false,NULL),('${inactiveRule}','${account}',3,'{"positioning":"未激活规则"}',false,false,NULL),('${foreignAccount}','${foreignAccount}',1,'{}',true,false,NULL);
   UPDATE public.accounts SET current_blueprint_version_id='${currentRule}' WHERE id='${account}';UPDATE public.accounts SET current_blueprint_version_id='${foreignAccount}' WHERE id='${foreignAccount}';
   INSERT INTO local_identity.account_asset_directories(account_id,actual_root,device_id,inode_id) VALUES('${account}','${root}','${stat.dev}','${stat.ino}');
   INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage,script_source) VALUES('${episode}','${account}','${oldRule}','Preserved delegated script','script_review','delegated'),('${provided}','${account}','${currentRule}','Provided script history','waiting_input','provided');
   INSERT INTO public.production_material_revisions(id,episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,is_main_script,created_by,material_purpose) VALUES('${script}','${episode}',1,'script','paste','historical.md','episodes/${episode}/historical.md','text/markdown',repeat('a',64),123,true,'${owner}','main_script');
   UPDATE public.episodes SET main_script_revision_id='${script}' WHERE id='${episode}';
   INSERT INTO public.prompt_versions(id,account_id,capability,version,slug,name,summary,instructions,content_hash,created_by) VALUES('${harness}','${account}','script_writing',(SELECT coalesce(max(version),0)+1 FROM public.prompt_versions WHERE account_id='${account}' AND capability='script_writing'),'historical-writer','Historical writer','Retained evidence','Keep the original writing evidence',encode(extensions.digest('Keep the original writing evidence','sha256'),'hex'),'${owner}');
   INSERT INTO public.tasks(id,episode_id,task_type,status,attempt,input_snapshot,provider,model,prompt_version) VALUES('${task}','${episode}','draft_script','failed',1,jsonb_build_object('marker','original failed commission','blueprint_version_id','${oldRule}','commission',jsonb_build_object('creative_direction','保留的旧委托','core_content','原稿不改'),'prompt_harness',jsonb_build_object('id','${harness}','version',(SELECT version FROM public.prompt_versions WHERE id='${harness}'))),'codex','historical-model','historical-v1'),('${queued}','${episode}','draft_script','ready',0,'{"marker":"old ready commission must remain excluded"}','codex','historical-model','historical-v1');
   INSERT INTO public.task_runs(task_id,attempt,status,task_package,completed_at) VALUES('${task}',1,'failed',jsonb_build_object('version','worker-task/v1','task_id','${task}','episode_id','${episode}','blueprint_version_id','${oldRule}','commission',jsonb_build_object('creative_direction','原始委托'),'frozen_marker','original-run-package'),'2026-10-01T01:02:03.123456Z');
   COMMIT;`,source);
  const before=snapshot(source);expect(before.rows['public.accounts'].rows).toBe(2);expect(before.rows['public.account_blueprint_versions'].rows).toBe(4);expect(before.rows['public.episodes'].rows).toBe(2);expect(before.rows['public.tasks'].rows).toBe(2);expect(before.rows['public.task_runs'].rows).toBe(1);expect(before.rows['public.prompt_versions'].rows).toBeGreaterThanOrEqual(1);expect(before.rows['public.production_material_revisions'].rows).toBe(1);
  const dump=context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',source]);sql(dump);assertRestored(before,snapshot());
  const calls=["public.bootstrap_platform('old','old','UTC','{}')",`public.commission_script('${episode}','old','evidence')`,`public.set_episode_script_source('${episode}','provided')`,`public.apply_blueprint_to_episode('${episode}','${currentRule}',NULL,NULL)`,`public.deactivate_blueprint_version('${account}','${currentRule}')`];
  for(const call of calls){
   for(const actor of ['loop_app','loop_owner','loop_worker','loop_anonymous'])expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT ${call}`)).toThrow(/42501/);
   sql('CREATE VIEW public.compat_dependency_probe AS SELECT ('+call+' IS NULL) value');
   expect(()=>sql(migrationTransaction([cleanup]))).toThrow(/2BP01/);sql('DROP VIEW public.compat_dependency_probe');assertRestored(before,snapshot());
  }
  expect(()=>sql(migrationTransaction([cleanup]).replace(/COMMIT;$/,'SELECT 1/0; COMMIT;'))).toThrow(/22012/);assertRestored(before,snapshot());
  sql(migrationTransaction([cleanup]));const after=snapshot();
  for(const key of ['rows','sequenceRows','roles'])expect(after[key]).toEqual(before[key]);
  const dropped=before.catalog.functions.filter((f:{schema:string;name:string})=>names.has(f.schema+'.'+f.name));expect(dropped).toHaveLength(5);
  expect(after.catalog).toEqual({...before.catalog,functions:before.catalog.functions.filter((f:{schema:string;name:string})=>!names.has(f.schema+'.'+f.name))});
  const acl=new Set(dropped.map((f:{schema:string;name:string;arguments:string})=>`${f.schema}.${f.name}(${f.arguments})`));expect(after.security).toEqual(before.security.filter((s:{identity:string})=>!acl.has(s.identity)));
  for(const [version,row]of Object.entries(before.ledger))expect(after.ledger[version]).toEqual(row);
  const ledger=Object.fromEntries(Object.entries(after.ledger).map(([k,v])=>[k,(v as {sha256:string}).sha256]));expect(ledger[cleanup.version]).toBe(cleanup.sha256);expect(Object.keys(after.ledger)).toHaveLength(Object.keys(before.ledger).length+1);expect(schemaMigrationPlan(ledger,catalog)).toEqual([]);
  for(const name of removed)expect(sql(`SELECT to_regprocedure('${name}') IS NULL`)).toBe('t');
  for(const actor of ['postgres','loop_app','loop_owner','loop_worker','loop_anonymous'])for(const call of calls)expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT ${call}`)).toThrow(/42883/);
  expect(sql(`SELECT bool_and(NOT local_identity.current_worker_task(t)) FROM public.tasks t WHERE id IN('${task}','${queued}')`)).toBe('t');
  expect(()=>sql(`UPDATE public.prompt_versions SET instructions='forbidden rewrite' WHERE id='${harness}'`)).toThrow(/Prompt Harness content is immutable/);assertRestored(after,snapshot());
  expect(sql(`SELECT current_blueprint_version_id='${currentRule}'::uuid FROM public.accounts WHERE id='${account}'`)).toBe('t');
  expect(sql(`SELECT blueprint_version_id='${oldRule}'::uuid AND script_source='delegated' FROM public.episodes WHERE id='${episode}'`)).toBe('t');
 }finally{try{for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}finally{await rm(root,{recursive:true,force:true});}}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('current Owner rule save, draft creation and activation preserve frozen Episode bindings after 180',async()=>{
 const f=await productionWorkspaceFixture();try{
  const original=(await f.c.query('SELECT b.*,md5(b.policy::text) revision FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[f.episode])).rows[0];
  const tasks=async()=>(await f.c.query('SELECT id,input_snapshot FROM public.tasks WHERE episode_id=$1 ORDER BY id',[f.episode])).rows;const frozenTasks=await tasks();
  const legacyTasks=async()=>(await f.c.query("SELECT to_jsonb(t) value FROM public.tasks t WHERE provider='codex' OR task_type='draft_script' ORDER BY id")).rows,originalLegacyTasks=await legacyTasks();
  const send=async(command:string,data:Record<string,unknown>,options:{revision?:string;token?:string;csrf?:boolean;key?:string}={})=>{const token=options.token??f.token,r=await fetch(f.origin+'/api/local/configuration',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+token,...(options.csrf===false?{}:{'X-CSRF-Token':csrfFor(token)})},body:JSON.stringify({command,data,idempotencyKey:options.key??randomUUID(),...(options.revision?{expectedRevision:options.revision}:{})})});return{status:r.status,body:await r.json()};};
  const data={accountId:original.account_id,policy:{positioning:'新的规则'}};
  expect((await send('updateBlueprint',data,{revision:original.revision,csrf:false})).status).toBe(403);
  expect((await send('updateBlueprint',data,{revision:original.revision,token:f.otherToken})).status).toBe(404);
  const saved=await send('updateBlueprint',data,{revision:original.revision});expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect(saved.body.id).not.toBe(original.id);
  expect((await send('updateBlueprint',{...data,policy:{positioning:'stale overwrite'}},{revision:original.revision})).status).toBe(409);
  const current=(await f.c.query('SELECT *,md5(policy::text) revision FROM public.account_blueprint_versions WHERE id=$1',[saved.body.id])).rows[0],count=(await f.c.query('SELECT count(*)::int n FROM public.account_blueprint_versions WHERE account_id=$1',[original.account_id])).rows[0].n;
  const edited=await send('updateBlueprint',{...data,policy:{positioning:'当前草稿修改',tone:'克制'}},{revision:current.revision});expect(edited.status).toBe(200);expect(edited.body.id).toBe(current.id);expect((await f.c.query('SELECT count(*)::int n FROM public.account_blueprint_versions WHERE account_id=$1',[original.account_id])).rows[0].n).toBe(count);
  const inactive=await send('createBlueprint',{accountId:original.account_id,policy:{positioning:'已保存待激活'}});expect(inactive.status).toBe(200);expect(inactive.body.is_active).toBe(false);
  const activate={accountId:original.account_id,blueprintId:inactive.body.id},key=randomUUID();
  expect((await send('activateBlueprint',activate,{csrf:false})).status).toBe(403);expect((await send('activateBlueprint',activate,{token:f.otherToken})).status).toBe(404);
  const activated=await send('activateBlueprint',activate,{key});expect(activated.status).toBe(200);expect(activated.body.id).toBe(inactive.body.id);expect(await send('activateBlueprint',activate,{key})).toEqual(activated);
  expect((await f.c.query('SELECT current_blueprint_version_id FROM public.accounts WHERE id=$1',[original.account_id])).rows[0].current_blueprint_version_id).toBe(inactive.body.id);
  const retained=(await f.c.query('SELECT e.blueprint_version_id,b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[f.episode])).rows[0];expect(retained).toEqual({blueprint_version_id:original.id,policy:original.policy});expect(await tasks()).toEqual(frozenTasks);
  expect(await legacyTasks()).toEqual(originalLegacyTasks);
 }finally{await f.close();}
},60000);
