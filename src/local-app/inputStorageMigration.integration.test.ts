// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {copyFixtureSchema,type FixtureSchemaContext} from './fixtureSchema';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('input and visual storage migrations compose in either supported incremental order on isolated real schemas',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext() as FixtureSchemaContext,names:string[]=[],definitions:string[]=[];
 try{
  for(const order of [['117-input-storage-locations.sql','118-visual-storage-locations.sql'],['118-visual-storage-locations.sql','117-input-storage-locations.sql']]){
   const database='loop_input_178_'+randomBytes(6).toString('hex');context.sql('CREATE DATABASE '+database+' TEMPLATE template0','postgres');names.push(database);
   await copyFixtureSchema(context,database,['db/local/110-episode-storage-locations.sql']);
   for(const name of order){const body=await readFile('db/local/'+name,'utf8'),sha=createHash('sha256').update(body).digest('hex');context.sql(`BEGIN;${body}\nINSERT INTO local_identity.schema_migrations(version,sha256) VALUES('${name}','${sha}');COMMIT;`,database);}
   definitions.push(context.sql("SELECT pg_get_functiondef('public.import_production_material(uuid,text,text,text,text,text,text,bigint,boolean,text)'::regprocedure)",database));
   expect(context.sql("SELECT to_regclass('local_identity.material_import_origins') IS NOT NULL",database)).toBe('t');
   expect(context.sql("SELECT count(*) FROM local_identity.credentials",database)).toBe('0');
   expect(context.sql("SELECT count(*) FROM local_identity.schema_migrations WHERE version IN ('117-input-storage-locations.sql','118-visual-storage-locations.sql')",database)).toBe('2');
  }
  expect(definitions[0]).toBe(definitions[1]);expect(definitions[0]).toContain('local_identity.episode_storage_location(p_episode_id)');
  const unknown='loop_input_178_'+randomBytes(6).toString('hex');context.sql('CREATE DATABASE '+unknown+' TEMPLATE template0','postgres');names.push(unknown);await copyFixtureSchema(context,unknown,['db/local/110-episode-storage-locations.sql','db/local/118-visual-storage-locations.sql']);
  const definition=context.sql("SELECT pg_get_functiondef('public.import_production_material(uuid,text,text,text,text,text,text,bigint,boolean,text)'::regprocedure)",unknown),changed=definition.replace('IS DISTINCT FROM (SELECT directory_relative_path','IS NOT DISTINCT FROM (SELECT directory_relative_path');expect(changed).not.toBe(definition);context.sql(changed,unknown);
  const inputMigration=await readFile('db/local/117-input-storage-locations.sql','utf8');expect(()=>context.sql('BEGIN;'+inputMigration+'COMMIT;',unknown)).toThrow(/Input path guard contract changed/);expect(context.sql("SELECT to_regclass('local_identity.material_import_origins') IS NULL",unknown)).toBe('t');
 }finally{for(const name of names)context.sql('DROP DATABASE '+name+' WITH (FORCE)','postgres');}
},300000);
