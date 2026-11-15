// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,realpath,lstat,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';
import {connectionCatalogFixture} from './connectionCatalog.fixture';

const removed=['public.create_external_connection(text,text,text,text)','public.rotate_external_connection(uuid,text,text,text)','public.delete_external_connection_version(uuid)','public.resolve_external_connection_secret(uuid)','public.resolve_external_connection_secret(uuid,uuid)'];

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('176 removes only five unused cloud connection RPCs after nonempty history restore and preserves all other data, definitions and ACL',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Compatibility acceptance requires an isolated cluster');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(f=>Number(f.version.slice(0,3))<=176)},previous={...catalog,current:catalog.current.filter(f=>Number(f.version.slice(0,3))<176)},cleanup=catalog.current.find(f=>f.version==='176-remove-retired-cloud-connection-rpcs.sql')!;
 expect([...cleanup.body.matchAll(/^DROP FUNCTION ([^;]+);$/gm)].map(m=>m[1])).toEqual(removed);
 const names=new Set(removed.map(s=>s.slice(0,s.indexOf('(')))),suffix=randomBytes(6).toString('hex'),source='loop_compat_source_'+suffix,restored='loop_compat_restore_'+suffix,created:string[]=[];
 const root=await realpath(await mkdtemp('/private/tmp/loop-compat-history-')),stat=await lstat(root,{bigint:true});
 const sql=(q:string,db=restored)=>context.sql('\\set VERBOSITY verbose\n'+q,db),snapshot=(db=restored)=>databaseSnapshot(context,db,process.cwd());
 const owner=randomUUID(),account=randomUUID(),episode=randomUUID(),script=randomUUID(),connection=randomUUID(),oldVersion=randomUUID(),version=randomUUID(),secret=randomUUID();
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
   INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,provider,model,prompt_version) VALUES('${episode}','draft_storyboard','failed',jsonb_build_object('marker','retained old task','credential_ref','${oldVersion}','production_selection',jsonb_build_object('connectionVersionId','${oldVersion}')),'codex','historical','historical-v1');
   INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES('${connection}','openai','openai_images','Restored historical connection','${owner}','${version}',public.official_external_connection_endpoint('openai','openai_images'));
   INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES('${oldVersion}','${connection}',1,'openai','openai_images',public.official_external_connection_endpoint('openai','openai_images'),'${oldVersion}'),('${version}','${connection}',2,'openai','openai_images',public.official_external_connection_endpoint('openai','openai_images'),'${secret}');
   INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES('${version}','${owner}','${secret}','keychain');
   INSERT INTO local_identity.connection_intents(owner_id,idempotency_key,metadata,connection_id,version_id,secret_ref,store_mode,applied_at,result) VALUES('${owner}','${secret}','{"command":"rotate","provider":"openai","adapter":"openai_images"}','${connection}','${version}','${secret}','keychain','2026-10-01T01:02:03Z','{"historical":true}');
   COMMIT;`,source);
  const before=snapshot(source);expect(before.rows['local_identity.script_productions'].rows).toBe(1);expect(before.rows['local_identity.episode_planning_selections'].rows).toBe(1);expect(before.rows['public.external_connection_versions'].rows).toBe(2);expect(before.rows['local_identity.connection_bindings'].rows).toBe(1);expect(before.rows['local_identity.connection_intents'].rows).toBe(1);
  const dump=context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',source]);sql(dump);assertRestored(before,snapshot());
  const calls=["public.create_external_connection('openai','openai_images','old','synthetic-unused')",`public.rotate_external_connection('${connection}','openai','openai_images','synthetic-unused')`,`public.delete_external_connection_version('${version}')`,`public.resolve_external_connection_secret('${connection}')`,`public.resolve_external_connection_secret('${connection}','${account}')`];
  for(const call of calls){
   expect(()=>sql('SELECT '+call)).toThrow(/0A000/);
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
  expect(sql('SET SESSION AUTHORIZATION loop_app; SELECT count(*) FROM local_identity.script_production_scopes()')).toBe('0');assertRestored(after,snapshot());
 }finally{try{for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}finally{await rm(root,{recursive:true,force:true});}}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('current Owner HTTP rebinds an unbound restored version with exact IDs and frozen history after 176',async()=>{
 const f=await connectionCatalogFixture();try{
  const connection=randomUUID(),version=randomUUID(),vault=randomUUID(),episode=randomUUID(),task=randomUUID();
  const account=(await f.admin.query('SELECT account_id FROM public.account_memberships WHERE user_id=$1',[f.owner])).rows[0].account_id;
  await f.admin.query('BEGIN');
  await f.admin.query("INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,'openai','openai_images','Restored unbound',$2,$3,public.official_external_connection_endpoint('openai','openai_images'))",[connection,f.owner,version]);
  await f.admin.query("INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES($1,$2,1,'openai','openai_images',public.official_external_connection_endpoint('openai','openai_images'),$3)",[version,connection,vault]);
  await f.admin.query("INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES($1,$1,1,'{}',true)",[account]);
  await f.admin.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES($1,$2,$2,'Frozen restored credential','production_ready')",[episode,account]);
  await f.admin.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_b_roll','failed',$3)",[task,episode,{credential_ref:version,production_selection:{connectionVersionId:version},historical:true}]);
  await f.admin.query('COMMIT');
  const history=async()=>(await f.admin.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=$1',[task])).rows;
  const before=await history(),unbound=await f.request();expect(unbound.body.versions.find((v:{id:string})=>v.id===version).secretState).toBe('unbound');
  expect((await f.command('verify',{connectionId:connection})).status).not.toBe(200);expect(f.secretReads).toBe(0);
  expect((await f.command('rebind',{versionId:version,secret:'synthetic-openai-key'},f.otherToken)).status).toBe(404);
  expect((await f.command('rebind',{versionId:version,secret:'synthetic-openai-key'},f.token,false)).status).toBe(403);expect(f.secrets.size).toBe(0);
  const data={versionId:version,secret:'synthetic-openai-key'},key=randomUUID();
  const bound=await f.request({command:'rebind',data,idempotencyKey:key});expect(bound.status).toBe(200);expect(bound.body.connection.id).toBe(connection);expect(bound.body.connection.current_version_id).toBe(version);
  const binding=(await f.admin.query('SELECT * FROM local_identity.connection_bindings WHERE version_id=$1',[version])).rows[0];expect(binding.owner_id).toBe(f.owner);expect(f.secrets.get(binding.secret_ref)).toBe(data.secret);
  expect((await f.request({command:'rebind',data,idempotencyKey:key})).body.replayed).toBe(true);expect(f.secrets.size).toBe(1);
  expect((await f.command('verify',{connectionId:connection})).body.ready).toBe(true);expect(f.secretReads).toBeGreaterThan(0);
  const after=await f.request();expect(JSON.stringify(after.body)).not.toContain(data.secret);expect(after.body.connections[0].current_version_id).toBe(version);expect((await f.admin.query('SELECT count(*)::int n FROM public.external_connection_versions')).rows[0].n).toBe(1);expect(await history()).toEqual(before);
  expect((await f.command('revoke',{versionId:version})).status).toBe(200);expect((await f.command('rebind',data)).status).toBe(404);expect(await history()).toEqual(before);
 }finally{await f.close();}
},60000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('real saved connection modules create, rotate, verify and revoke through retained local contracts after 176',async()=>{
 const compatibilityRoot=process.env.LOOP_TEST_COMPAT_RELEASES_ROOT;if(!compatibilityRoot)throw Error('Explicit copied runtime packages are required');
 const manifest=JSON.parse(await readFile(join(compatibilityRoot,'connections.json'),'utf8')) as {releases:Array<{id:string;file:string;sha256:string}>};expect(manifest.releases).toHaveLength(23);
 const f=await connectionCatalogFixture();try{
  let reads=0,verified=0;const values=new Map<string,string>(),store={mode:'keychain',async putImmutable(id:string,value:string){const old=values.get(id);if(old&&old!==value)throw Error('Immutable secret');values.set(id,value);},async get(id:string){reads++;const v=values.get(id);if(!v)throw Error('Missing synthetic secret');return v;}},probe={mode:'live',networkAvailable:false,async verify(){verified++;return 'verified';}};
  const session={id:f.owner,email:f.email,token:f.token};
  for(const r of manifest.releases){
   const path=join(compatibilityRoot,r.id,r.file);expect(createHash('sha256').update(await readFile(path)).digest('hex')).toBe(r.sha256);
   const module=await import(pathToFileURL(path).href),service=new module.LocalConnections(f.pool,store,probe),secret='synthetic-old-package-'+r.id,send=(command:string,data:unknown)=>service.command(session,{command,data,idempotencyKey:randomUUID()});
   const c=(await send('create',{name:r.id,provider:'openai',adapter:'openai_images',secret})).connection;
   const rotated=(await send('rotate',{connectionId:c.id,provider:'openai',adapter:'openai_images',secret:secret+'-rotated'})).connection;expect(rotated.current_version_id).not.toBe(c.current_version_id);
   expect((await send('verify',{connectionId:c.id})).ready).toBe(true);
   const b=(await f.admin.query('SELECT secret_ref FROM local_identity.connection_bindings WHERE version_id=$1',[rotated.current_version_id])).rows[0];expect(values.get(b.secret_ref)).toBe(secret+'-rotated');
   const state=await service.read(f.owner);expect(JSON.stringify(state)).not.toContain('synthetic-old-package-');expect((await service.read(f.other)).connections).toEqual([]);
   await send('revoke',{versionId:c.current_version_id});
   expect((await f.admin.query('SELECT revoked_at IS NOT NULL revoked FROM public.external_connection_versions WHERE id=$1',[c.current_version_id])).rows[0].revoked).toBe(true);
  }
  expect(reads).toBe(23);expect(verified).toBe(23);expect(values.size).toBe(46);
  expect((await f.admin.query('SELECT count(*)::int n FROM public.external_connections')).rows[0].n).toBe(23);expect((await f.admin.query('SELECT count(*)::int n FROM public.external_connection_versions')).rows[0].n).toBe(46);
 }finally{await f.close();}
},120000);
