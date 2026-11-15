// @vitest-environment node
import {expect,it} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';
import {seedHistoricalPreparation} from './historicalPreparation.fixture';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('195 keeps nonempty 194 business and collected facts unchanged, rolls back atomically, and fully restores the candidate without backfilling',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=runtimeContext();if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only isolated milestone migration');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const catalog=loadSchemaCatalog(process.cwd()),old={...catalog,current:catalog.current.filter(m=>m.version<'188-')},suffix=randomBytes(6).toString('hex'),source='loop_milestones_'+suffix,restored=source+'_restored',databases:string[]=[],sql=(q:string,db=source)=>context.sql(q,db),off=randomUUID();
 try{
  for(const db of [source,restored]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');databases.push(db);}
  sql(freshSchemaTransaction(old));const ids=seedHistoricalPreparation(sql);sql(migrationTransaction(catalog.current.filter(m=>m.version>='188-'&&m.version<'195-')));
  sql(`INSERT INTO local_identity.owners(id,email)VALUES('${off}','off@example.invalid');INSERT INTO local_identity.production_metric_controls(owner_id,enabled)VALUES('${off}',false);
   SET SESSION AUTHORIZATION loop_app;BEGIN;SELECT set_config('loop.owner_id','${ids.owner}',true);SELECT local_identity.set_production_metrics_enabled(true);
   SELECT local_identity.record_owned_production_metric('${ids.episode}','retry_relation','retained-before-milestones',jsonb_build_object('workspace_id','${ids.workspace}','reason_code','retained_fact'));
   SELECT local_identity.record_production_metric_resource(jsonb_build_object('sampled_at',clock_timestamp(),'queue_count',0,'running_count',0,'resource_wait_count',0));COMMIT;RESET SESSION AUTHORIZATION;`);
  const before=databaseSnapshot(context,source,process.cwd()),migration=catalog.current.find(m=>m.version.startsWith('195-'))!;expect(before.rows['local_identity.production_metric_events'].rows).toBe(2);
  expect(()=>sql('BEGIN;'+migration.body+'SELECT 1/0;COMMIT;')).toThrow(/division by zero/);expect(databaseSnapshot(context,source,process.cwd())).toEqual(before);
  sql(migrationTransaction([migration]));const after=databaseSnapshot(context,source,process.cwd());
  const table='local_identity.production_metric_export_resources';expect(after.rows[table].rows).toBe(0);
  expect(Object.fromEntries(Object.entries(after.rows).filter(([key])=>key!==table))).toEqual(before.rows);expect(after.sequenceRows).toEqual(before.sequenceRows);expect(after.roles).toEqual(before.roles);
  const addedFunctions=['record_workspace_local_export','record_production_metric_resource_with_exports'],addedTriggers:string[]=[];
  for(const key of Object.keys(before.catalog)){
   const observedBefore=key==='functions'?before.catalog[key].filter((item:any)=>item.name!=='set_production_metrics_enabled'):before.catalog[key];
   const filtered=after.catalog[key].filter((item:any)=>key==='tables'?!(item.schema==='local_identity'&&item.name==='production_metric_export_resources'):item.table===table?false:key==='functions'?!addedFunctions.includes(item.name)&&item.name!=='set_production_metrics_enabled':key==='triggers'?!addedTriggers.includes(item.name):true);expect(filtered,key).toEqual(observedBefore);
  }
  expect(after.catalog.functions.length-before.catalog.functions.length).toBe(2);expect(after.catalog.triggers.length-before.catalog.triggers.length).toBe(0);
  expect(after.security.filter((item:any)=>!addedFunctions.some(name=>item.kind==='function'&&item.identity.startsWith('local_identity.'+name+'('))&&!item.identity.startsWith(table))).toEqual(before.security);
  for(const [version,value]of Object.entries(before.ledger))expect(after.ledger[version]).toEqual(value);
  expect(schemaMigrationPlan(Object.fromEntries(Object.entries(after.ledger).map(([key,value])=>[key,(value as {sha256:string}).sha256])),{...catalog,current:catalog.current.filter(m=>m.version<'196-')})).toEqual([]);
  expect(sql("SELECT count(*) FROM local_identity.production_metric_events WHERE event_type LIKE 'local_export_%'")).toBe('0');expect(sql(`SELECT enabled::text FROM local_identity.production_metric_controls WHERE owner_id='${off}'`)).toBe('false');
  sql(context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',source]),restored);assertRestored(after,databaseSnapshot(context,restored,process.cwd()));
  expect(sql(`SELECT current_audio_track_id::text FROM public.shot_preparation_drafts WHERE episode_id='${ids.episode}'`,restored)).toBe(ids.audio);
  expect(sql("SELECT count(*) FROM local_identity.production_metric_events WHERE event_type LIKE 'local_export_%'",restored)).toBe('0');
 }finally{for(const db of databases.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}
},120000);
