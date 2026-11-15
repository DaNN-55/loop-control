// @vitest-environment node
import {expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,verifySchemaLedger} from './schemaMigrations';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('clean-v3 and immutable forwards expose identical generated contracts and preserve nonempty full restores',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only an isolated schema fixture is permitted');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const suffix=randomBytes(6).toString('hex'),fresh='loop_schema_fresh_'+suffix,forward='loop_schema_forward_'+suffix,restored='loop_schema_restore_'+suffix,fault='loop_schema_fault_'+suffix,created:string[]=[],temp=mkdtempSync(join(tmpdir(),'loop-effective-types-'));
 const catalog=loadSchemaCatalog(process.cwd()),query=readFileSync('scripts/schema/current-catalog.sql','utf8');
 const sql=(q:string,db=fresh)=>context.sql(q,db);
 try{
  for(const db of [fresh,forward,restored,fault]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  const freshSql=freshSchemaTransaction(catalog);
  expect(()=>sql(freshSql.replace(/COMMIT;$/,'SELECT 1/0;COMMIT;'),fault)).toThrow(/division by zero/);
  expect(sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('local_identity','loop_internal')",fault)).toBe('0');
  sql(freshSql);sql(migrationTransaction([catalog.baseline,...catalog.current]),forward);
  const current=sql(query),upgraded=sql(query,forward);expect(JSON.parse(current)).toEqual(JSON.parse(upgraded));
  const input=join(temp,'catalog.json');writeFileSync(input,current);
  execFileSync(process.execPath,['scripts/schema/generate-types.mjs',input,'src/lib/database.types.ts','--check'],{cwd:process.cwd(),stdio:'pipe'});
  const schemaInput=join(temp,'schema.sql');writeFileSync(schemaInput,context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',fresh,'--schema-only','--no-owner']));
  execFileSync(process.execPath,['scripts/schema/generate-baseline.mjs',schemaInput,'db/current','--check'],{cwd:process.cwd(),stdio:'pipe'});
  // Real directory observations, independent of the formatter implementation.
  const observed=JSON.parse(current);
  expect(observed.functions.some((f:any)=>f.name==='create_episode')).toBe(false);
  expect(observed.functions.some((f:any)=>f.name==='claim_scheduled_worker_task')).toBe(false);
  expect(observed.functions.some((f:any)=>f.name==='execute_managed_worker_command')).toBe(true);
  expect(observed.relations.find((r:any)=>r.schema==='public'&&r.name==='tasks').columns.find((c:any)=>c.name==='available_at')).toMatchObject({nullable:false,default:true});
  const before=databaseSnapshot(context,fresh,process.cwd()),other=databaseSnapshot(context,forward,process.cwd());
  for(const key of ['catalog','security','rows','sequenceRows','roles'])expect(before[key],key).toEqual(other[key]);
  expect(verifySchemaLedger(Object.fromEntries(Object.entries(before.ledger).map(([v,row])=>[v,(row as {sha256:string}).sha256])),catalog)).toBe('clean-v3');
  expect(Object.keys(before.ledger)).toEqual(['clean-v3.sql']);
  const owner=randomUUID(),account=randomUUID(),episode=randomUUID(),script=randomUUID();
  sql(`BEGIN;SET LOCAL session_replication_role=replica;INSERT INTO local_identity.owners(id,email)VALUES('${owner}','retained@example.invalid');INSERT INTO public.accounts(id,slug,name,timezone)VALUES('${account}','effective-history','原始账户','Asia/Shanghai');INSERT INTO public.account_memberships(account_id,user_id,role)VALUES('${account}','${owner}','owner');INSERT INTO public.account_blueprint_versions(id,account_id,version,policy)VALUES('${account}','${account}',1,'{}');INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage)VALUES('${episode}','${account}','${account}','原始生产单','script_approved');INSERT INTO public.production_material_revisions(id,episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,is_main_script,created_by,material_purpose)VALUES('${script}','${episode}',1,'script','file','original.md','original.md','text/markdown',repeat('a',64),7,true,'${owner}','main_script');UPDATE public.episodes SET main_script_revision_id='${script}' WHERE id='${episode}';COMMIT;`);
  const nonempty=databaseSnapshot(context,fresh,process.cwd()),dump=context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',fresh]);sql(dump,restored);assertRestored(nonempty,databaseSnapshot(context,restored,process.cwd()));
  expect(sql(`SELECT title||':'||main_script_revision_id::text FROM public.episodes WHERE id='${episode}'`,restored)).toBe('原始生产单:'+script);
 }finally{rmSync(temp,{recursive:true,force:true});for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}
},90000);
