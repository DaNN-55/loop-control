// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {copyFixtureSchema,type FixtureSchemaContext} from './fixtureSchema';
const enabled=process.env.LOOP_FIXTURE_SCHEMA_ACCEPTANCE==='1';
/** Rebuild the versioned 083 schema, independent of the installed daily schema version. */
async function create083Source(context:FixtureSchemaContext,database:string){
 const {adaptBusinessSchema}=await import(pathToFileURL(join(process.cwd(),'scripts/storage/schema-import.mjs')).href);
 const identity=await readFile('db/local/identity.sql','utf8'),baseline=adaptBusinessSchema(await readFile('db/local/c-baseline.sql','utf8')).sql;
 // Installed test roles already exist. Do not change cluster-wide role membership.
 const access=(await readFile('db/local/read-access.sql','utf8')).replace('GRANT loop_owner TO loop_app;','');
 const names=(await readdir('db/local')).filter(name=>/^[0-9]{3}-[a-z0-9-]+\.sql$/.test(name)&&Number(name.slice(0,3))>=2&&Number(name.slice(0,3))<=83).sort();
 const migrations=await Promise.all(names.map(async version=>{const body=await readFile(join('db/local',version),'utf8');return `${body}\nINSERT INTO local_identity.schema_migrations(version,sha256) VALUES('${version}','${createHash('sha256').update(body).digest('hex')}');`;}));
 context.sql(`BEGIN;${identity}\n${baseline}\nSET search_path=public;\n${access}\nCREATE TABLE local_identity.schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL);\n${migrations.join('\n')}\nCOMMIT;`,database);
}
async function databases(){
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext() as FixtureSchemaContext;
 const source='loop_schema_165_'+randomBytes(6).toString('hex'),before=source+'_before',after=source+'_after',names=[source,before,after],created:string[]=[];
 try{for(const name of names){context.sql('CREATE DATABASE '+name+' TEMPLATE template0','postgres');created.push(name);}await create083Source(context,source);}catch(error){for(const name of created)context.sql('DROP DATABASE '+name+' WITH (FORCE)','postgres');throw error;}
 return{context,source,before,after,sourceContext:{...context,database:source},close(){for(const name of created)context.sql('DROP DATABASE '+name+' WITH (FORCE)','postgres');}};
}
async function upgrade(context:FixtureSchemaContext,source:string){
 const body=await readFile('db/local/084-four-step-workspace.sql','utf8'),sha=createHash('sha256').update(body).digest('hex');
 context.sql(`BEGIN;${body}INSERT INTO local_identity.schema_migrations(version,sha256) VALUES('084-four-step-workspace.sql','${sha}');COMMIT;`,source);
}
it.skipIf(!enabled)('schema provisioning accepts both the pre-workspace and upgraded sources without replaying applied DDL',async()=>{
 const f=await databases();try{
  expect(f.context.sql("SELECT count(*) FROM local_identity.schema_migrations WHERE version LIKE '083-%'",f.source)).toBe('2');
  await copyFixtureSchema(f.sourceContext,f.before,['db/local/084-four-step-workspace.sql']);
  await upgrade(f.context,f.source);
  await copyFixtureSchema(f.sourceContext,f.after,['db/local/084-four-step-workspace.sql']);
  for(const target of [f.before,f.after]){
   expect(f.context.sql("SELECT to_regclass('local_identity.production_workspaces') IS NOT NULL",target)).toBe('t');
   expect(f.context.sql("SELECT count(*) FROM local_identity.schema_migrations WHERE version='084-four-step-workspace.sql'",target)).toBe('1');
   expect(f.context.sql('SELECT count(*) FROM local_identity.credentials',target)).toBe('0');
  }
 }finally{f.close();}
},120000);
it.skipIf(!enabled)('an applied migration SHA mismatch refuses provisioning before writing the target schema',async()=>{
 const f=await databases();try{
  f.context.sql("UPDATE local_identity.schema_migrations SET sha256=repeat('0',64) WHERE version='083-legacy-episode-archive.sql'",f.source);
  await expect(copyFixtureSchema(f.sourceContext,f.before,['db/local/084-four-step-workspace.sql'])).rejects.toThrow('Applied fixture migration changed: 083-legacy-episode-archive.sql');
  expect(f.context.sql("SELECT to_regclass('local_identity.schema_migrations') IS NULL",f.before)).toBe('t');
 }finally{f.close();}
},120000);
it.skipIf(!enabled)('schema and migration metadata retain one snapshot when the source upgrades during export',async()=>{
 const f=await databases();try{
  let upgraded=false;
  const body=await readFile('db/local/084-four-step-workspace.sql','utf8'),sha=createHash('sha256').update(body).digest('hex');
  const context={...f.sourceContext,docker(args:string[],input?:string){if(args.includes('--schema-only')&&!upgraded){f.context.sql(`BEGIN;${body}INSERT INTO local_identity.schema_migrations(version,sha256) VALUES('084-four-step-workspace.sql','${sha}');COMMIT;`,f.source);upgraded=true;}return f.context.docker(args,input);}};
  await copyFixtureSchema(context,f.before,[]);
  expect(upgraded).toBe(true);
  expect(f.context.sql("SELECT to_regclass('local_identity.production_workspaces') IS NULL",f.before)).toBe('t');
  expect(f.context.sql("SELECT count(*) FROM local_identity.schema_migrations WHERE version='084-four-step-workspace.sql'",f.before)).toBe('0');
  expect(f.context.sql("SELECT to_regclass('local_identity.production_workspaces') IS NOT NULL",f.source)).toBe('t');
  await copyFixtureSchema(f.sourceContext,f.after,['db/local/084-four-step-workspace.sql']);
  expect(f.context.sql("SELECT to_regclass('local_identity.production_workspaces') IS NOT NULL",f.after)).toBe('t');
  expect(f.context.sql("SELECT count(*) FROM local_identity.schema_migrations WHERE version='084-four-step-workspace.sql'",f.after)).toBe('1');
 }finally{f.close();}
},120000);
