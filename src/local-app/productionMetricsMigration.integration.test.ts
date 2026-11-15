// @vitest-environment node
import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {ownerTransaction} from './ownerTransaction';
import {readProductionMetricsV2} from './productionMetricsCollected';

const contextPath=process.env.LOOP_METRICS_PRE_C_CONTEXT;
it.skipIf(!contextPath)('upgrades a nonempty latest-parallel 176 fixture to 177 atomically while keeping collection off and original data and ACLs intact',async()=>{
 const {runtimeContext}=await import(contextPath!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true||context.database!=='loop_metrics_pre_c')throw Error('Only an explicit pre-C isolated fixture');
 const f=await productionWorkspaceFixture({testContextModule:contextPath});
 try{
  const prepared=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  expect((await f.c.query(`SELECT to_regclass('local_identity.production_metric_controls') value`)).rows[0].value).toBeNull();
  const tables=(await f.c.query(`SELECT n.nspname AS "schema",c.relname AS "name" FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname IN ('public','local_identity') AND c.relname<>'schema_migrations' ORDER BY 1,2`)).rows as Array<{schema:string;name:string}>;
  const data=async()=>{
   const result:Record<string,unknown>={};for(const t of tables){
    if(!/^[a-z_][a-z0-9_]*$/.test(t.schema)||!/^[a-z_][a-z0-9_]*$/.test(t.name))throw Error('Unexpected fixture identifier');
    result[t.schema+'.'+t.name]=(await f.c.query(`SELECT count(*)::int AS "rows",md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) digest FROM ${t.schema}.${t.name} t`)).rows[0];
   }return result;
  };
  const catalog=async()=>{
   const functions=(await f.c.query(`SELECT p.oid::text AS "id",pg_get_functiondef(p.oid) AS "definition",p.proacl AS "acl",p.proowner AS "owner" FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','local_identity') ORDER BY p.oid`)).rows;
   const relations=(await f.c.query(`SELECT c.oid::text AS "id",c.relacl AS "acl",c.relowner AS "owner" FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','local_identity') ORDER BY c.oid`)).rows;
   const sequences=(await f.c.query(`SELECT schemaname,sequencename,last_value FROM pg_sequences WHERE schemaname IN ('public','local_identity') ORDER BY 1,2`)).rows;
   const roles=(await f.c.query(`SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles ORDER BY rolname`)).rows;
   return{functions,relations,sequences,roles};
  };
  const before=await data(),oldCatalog=await catalog(),ledger=(await f.c.query('SELECT version,sha256 FROM local_identity.schema_migrations ORDER BY version')).rows;
  expect(ledger.some(r=>r.version==='175-remove-unreferenced-retired-sql-entries.sql')).toBe(true);expect(ledger.some(r=>r.version==='176-remove-retired-cloud-connection-rpcs.sql')).toBe(true);
  const body=await readFile(new URL('../../db/current/177-production-metrics-collection.sql',import.meta.url),'utf8'),digest=createHash('sha256').update(body).digest('hex');
  await f.c.query('BEGIN');try{await f.c.query(body);await expect(f.c.query('SELECT 1/0')).rejects.toMatchObject({code:'22012'});}finally{await f.c.query('ROLLBACK');}
  expect((await f.c.query(`SELECT to_regclass('local_identity.production_metric_controls') value`)).rows[0].value).toBeNull();expect(await data()).toEqual(before);expect(await catalog()).toEqual(oldCatalog);
  await f.c.query('BEGIN');try{await f.c.query(body);await f.c.query('INSERT INTO local_identity.schema_migrations(version,sha256) VALUES($1,$2)',['177-production-metrics-collection.sql',digest]);await f.c.query('COMMIT');}catch(error){await f.c.query('ROLLBACK');throw error;}
  expect(await data()).toEqual(before);
  const updated=await catalog();expect(updated.roles).toEqual(oldCatalog.roles);
  for(const family of ['functions','relations']as const){const ids=new Set(oldCatalog[family].map(r=>r.id));expect(updated[family].filter(r=>ids.has(r.id))).toEqual(oldCatalog[family]);}
  const oldSequences=new Set(oldCatalog.sequences.map(r=>r.schemaname+'.'+r.sequencename));expect(updated.sequences.filter(r=>oldSequences.has(r.schemaname+'.'+r.sequencename))).toEqual(oldCatalog.sequences);
  expect((await f.c.query('SELECT version,sha256 FROM local_identity.schema_migrations WHERE version<>$1 ORDER BY version',['177-production-metrics-collection.sql'])).rows).toEqual(ledger);
  expect((await ownerTransaction(f.pool,f.owner,true,c=>c.query('SELECT local_identity.production_metrics_enabled() enabled'))).rows[0].enabled).toBe(false);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_metric_controls')).rows[0].n).toBe(0);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_metric_events')).rows[0].n).toBe(0);
  const date=new Date(Date.now()+8*3600000).toISOString().slice(0,10),to=new Date(Date.parse(date+'T00:00:00+08:00')+86400000+8*3600000).toISOString().slice(0,10);
  expect((await readProductionMetricsV2(f.pool,f.owner,{from:date,toExclusive:to,includeTestEpisodes:true})).collected?.enabled).toBe(false);
  expect(await data()).toEqual(before);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_metric_events')).rows[0].n).toBe(0);
  for(const signature of ['public.generate_shot_tts(uuid,uuid,text,boolean)','public.create_external_connection(text,text,text,text)','public.resolve_external_connection_secret(uuid)'])expect((await f.c.query('SELECT to_regprocedure($1) value',[signature])).rows[0].value).toBeNull();
 }finally{await f.close();}
},120000);
