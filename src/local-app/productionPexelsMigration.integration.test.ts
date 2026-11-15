// @vitest-environment node
import {expect,it} from 'vitest';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';
import {seedHistoricalPreparation} from './historicalPreparation.fixture';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('192 preserves nonempty historical workspaces, audio, frozen tasks and permissions through atomic upgrade, rollback and full restore',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=runtimeContext();if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only isolated migration fixtures');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(f=>f.version<'193-')},previous={...catalog,current:catalog.current.filter(f=>f.version<'192-')},seedCatalog={...previous,current:previous.current.filter(f=>f.version<'188-')};
 const suffix=randomBytes(6).toString('hex'),database='loop_pexels_import_'+suffix,restored='loop_pexels_restore_'+suffix,created:string[]=[];const sql=(q:string,db=database)=>context.sql(q,db),snapshot=()=>databaseSnapshot(context,database,process.cwd());
 try{
  for(const db of [database,restored]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  sql(freshSchemaTransaction(seedCatalog));const ids=seedHistoricalPreparation(sql);sql(migrationTransaction(previous.current.filter(f=>f.version>='188-')));
  const before=snapshot(),ledger=Object.fromEntries(Object.entries(before.ledger).map(([n,v])=>[n,(v as {sha256:string}).sha256])),pending=schemaMigrationPlan(ledger,catalog);expect(pending.map(f=>f.version)).toEqual(['192-independent-workspace-pexels-inputs.sql']);const migration=migrationTransaction(pending);
  expect(()=>sql(migration.replace(/COMMIT;$/,'SELECT 1/0;COMMIT;'))).toThrow(/division by zero/);assertRestored(before,snapshot());sql(migration);const after=snapshot();
  expect(after.rows).toEqual(before.rows);expect(after.sequenceRows).toEqual(before.sequenceRows);expect(after.roles).toEqual(before.roles);for(const item of before.security)expect(after.security).toContainEqual(item);for(const [version,row]of Object.entries(before.ledger))expect(after.ledger[version]).toEqual(row);
  expect(sql(`SELECT storyboard_package_id::text FROM local_identity.production_workspaces WHERE id='${ids.workspace}'`)).toBe(ids.board);
  const applied=Object.fromEntries(Object.entries(after.ledger).map(([n,v])=>[n,(v as {sha256:string}).sha256]));expect(schemaMigrationPlan(applied,catalog)).toEqual([]);
  sql(context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',database]),restored);assertRestored(after,databaseSnapshot(context,restored,process.cwd()));
  expect(sql(`SELECT current_audio_track_id::text FROM public.shot_preparation_drafts WHERE episode_id='${ids.episode}'`,restored)).toBe(ids.audio);
 }finally{for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}
},120000);
