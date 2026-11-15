// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID,randomBytes} from 'node:crypto';
import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {csrfFor} from './sessions';
import {loadSchemaCatalog,freshSchemaTransaction,schemaMigrationPlan,migrationTransaction} from './schemaMigrations';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('retired create_episode is absent while Owner directory creation, replay and isolation remain intact',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,blank:true});
 try{
  expect((await f.c.query("SELECT to_regprocedure('public.create_episode(uuid,uuid,uuid,text,boolean)') target")).rows[0].target).toBeNull();
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.newEpisode])).rows[0].account_id,key=randomUUID();
  const post=async(token=f.token)=>{
   const response=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+token,'X-CSRF-Token':csrfFor(token)},body:JSON.stringify({command:'create',idempotencyKey:key,data:{accountId:account,title:'当前目录意图建单'}})});
   return{status:response.status,body:await response.json()};
  };
  const first=await post();expect(first.status,JSON.stringify(first.body)).toBe(200);
  const location=(await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[first.body.id])).rows[0],path=join(location.asset_root,location.directory_relative_path),before=await stat(path,{bigint:true});
  const replay=await post();expect(replay.status,JSON.stringify(replay.body)).toBe(200);expect(replay.body.id).toBe(first.body.id);
  const after=await stat(path,{bigint:true});expect({dev:after.dev,ino:after.ino}).toEqual({dev:before.dev,ino:before.ino});
  expect((await post(f.otherToken)).status).toBe(404);
  expect((await f.c.query('SELECT count(*)::int n FROM public.episodes WHERE id=$1',[first.body.id])).rows[0].n).toBe(1);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('186 removes only the old creation RPC, refuses dependencies, rolls back failures and fully restores nonempty history',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only an isolated schema fixture is permitted');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const suffix=randomBytes(6).toString('hex'),database='loop_create_old_'+suffix,restored='loop_create_restore_'+suffix,created:string[]=[];
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(file=>file.version<'187-')},previous={...catalog,current:catalog.current.filter(file=>file.version<'186-')};
 const sql=(query:string,db=database)=>context.sql(query,db),snapshot=()=>databaseSnapshot(context,database,process.cwd());
 try{
  for(const db of [database,restored]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  sql(freshSchemaTransaction(previous));
  const owner=randomUUID(),account=randomUUID(),episode=randomUUID(),script=randomUUID();
  sql(`BEGIN;SET LOCAL session_replication_role=replica;INSERT INTO local_identity.owners(id,email) VALUES('${owner}','${owner}@example.invalid');INSERT INTO public.accounts(id,slug,name,timezone) VALUES('${account}','old-create-history','Retained historical account','Asia/Shanghai');INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('${account}','${owner}','owner');INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES('${account}','${account}',1,'{}',true);INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES('${episode}','${account}','${account}','Original historical order','script_approved');INSERT INTO public.production_material_revisions(id,episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,is_main_script,created_by,material_purpose) VALUES('${script}','${episode}',1,'script','file','original.md','original.md','text/markdown',repeat('a',64),7,true,'${owner}','main_script');UPDATE public.episodes SET main_script_revision_id='${script}' WHERE id='${episode}';COMMIT;`);
  const before=snapshot(),applied=Object.fromEntries(Object.entries(before.ledger).map(([version,value])=>[version,(value as {sha256:string}).sha256]));
  const pending=schemaMigrationPlan(applied,catalog);expect(pending.map(file=>file.version)).toEqual(['186-remove-unused-create-episode-rpc.sql']);
  const migration=migrationTransaction(pending);
  sql("CREATE VIEW public.fixture_create_episode_dependency AS SELECT public.create_episode(NULL::uuid,NULL::uuid,NULL::uuid,'not executed',false) value");
  expect(()=>sql(migration)).toThrow(/depend/);expect(sql("SELECT to_regprocedure('public.create_episode(uuid,uuid,uuid,text,boolean)') IS NOT NULL")).toBe('t');
  sql('DROP VIEW public.fixture_create_episode_dependency');assertRestored(before,snapshot());
  expect(()=>sql(migration.replace(/COMMIT;$/,'SELECT 1/0;COMMIT;'))).toThrow(/division by zero/);assertRestored(before,snapshot());
  sql(migration);const after=snapshot();
  for(const key of ['rows','sequenceRows','roles'])expect(after[key],key).toEqual(before[key]);
  for(const [kind,objects]of Object.entries(before.catalog))expect(after.catalog[kind],kind).toEqual(kind==='functions'?(objects as any[]).filter(item=>!(item.schema==='public'&&item.name==='create_episode')):objects);
  expect(after.security).toEqual(before.security.filter((item:any)=>!item.identity.startsWith('public.create_episode(')));
  const ledger=Object.fromEntries(Object.entries(after.ledger).map(([version,value])=>[version,(value as {sha256:string}).sha256]));expect(schemaMigrationPlan(ledger,catalog)).toEqual([]);
  const dump=context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',database]);sql(dump,restored);
  assertRestored(after,databaseSnapshot(context,restored,process.cwd()));
  expect(sql(`SELECT main_script_revision_id::text FROM public.episodes WHERE id='${episode}'`,restored)).toBe(script);
  expect(sql("SELECT to_regprocedure('public.create_episode(uuid,uuid,uuid,text,boolean)') IS NULL",restored)).toBe('t');
 }finally{for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}
},90000);
