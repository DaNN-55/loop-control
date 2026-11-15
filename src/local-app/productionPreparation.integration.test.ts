// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {ownerTransaction} from './ownerTransaction';
import {seedHistoricalPreparation} from './historicalPreparation.fixture';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';
import {registerProductionPreparation} from './productionPreparationStore';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('registers an independent preparation with stable shot identities, immutable retries and Owner-only access without legacy review records',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true});
 try{
  expect((await f.send('start')).status).toBe(200);
  const location=(await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[f.newEpisode])).rows[0];
  const id=randomUUID(),manifest={version:'production-preparation/v1',shots:[
   {id:'shot-01',scriptSegment:'第一镜头沿用稳定身份。',durationSeconds:2,targetSpec:'9:16',visualSource:'image'},
   {id:'shot-02',scriptSegment:'第二镜头不要求视频参数。',durationSeconds:3,targetSpec:'9:16',visualSource:'unassigned'},
  ]};
  const bytes=Buffer.from(JSON.stringify(manifest)+'\n'),reference={relativePath:`${location.directory_relative_path}/preparation/${id}.json`,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length};
  await mkdir(dirname(join(f.assetRoot,reference.relativePath)),{recursive:true});await writeFile(join(f.assetRoot,reference.relativePath),bytes,{flag:'wx'});
  const register=(value=manifest,file=reference,script=f.main!,identity=id,owner=f.owner)=>ownerTransaction(f.pool,owner,false,async c=>(await c.query('SELECT local_identity.register_production_preparation($1,$2,$3,$4,$5) id',[f.newEpisode,script,identity,file,value])).rows[0].id);
  expect(await register()).toBe(id);expect(await register()).toBe(id);
  for(const table of ['review_packages','shot_preparation_drafts','approvals'])expect((await f.c.query(`SELECT count(*)::int n FROM public.${table} WHERE episode_id=$1`,[f.newEpisode])).rows[0].n).toBe(0);
  const preparation=(await f.c.query('SELECT * FROM local_identity.production_preparation_revisions WHERE id=$1',[id])).rows[0];
  expect(preparation).toMatchObject({episode_id:f.newEpisode,script_revision_id:f.main,source_format:'production-preparation/v1',origin:'script',file_reference:reference,manifest});
  expect(preparation.source_evidence).toBeNull();
  expect((await f.c.query('SELECT shot_id,baseline_text FROM local_identity.production_shot_versions WHERE preparation_revision_id=$1 ORDER BY position',[id])).rows).toEqual([
   {shot_id:'shot-01',baseline_text:'第一镜头沿用稳定身份。'},
   {shot_id:'shot-02',baseline_text:'第二镜头不要求视频参数。'},
  ]);
  const revised=randomUUID(),revisedFile={...reference,relativePath:reference.relativePath.replace(id,revised)};
  await writeFile(join(f.assetRoot,revisedFile.relativePath),bytes,{flag:'wx'});
  expect(await register(manifest,revisedFile,f.main!,revised)).toBe(revised);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_shots WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(2);
  await expect(register({...manifest,shots:[{...manifest.shots[0],scriptSegment:'不能覆盖原版本。'},manifest.shots[1]]})).rejects.toMatchObject({code:'40001'});
  await expect(register(manifest,reference,f.main!,id,f.other)).rejects.toMatchObject({code:'42501'});
  expect(await ownerTransaction(f.pool,f.other,true,async c=>(await c.query('SELECT id FROM local_identity.production_preparation_revisions WHERE id=$1',[id])).rows)).toEqual([]);
  await expect(ownerTransaction(f.pool,f.owner,false,c=>c.query('UPDATE local_identity.production_preparation_revisions SET manifest=$2 WHERE id=$1',[id,{}]))).rejects.toMatchObject({code:'42501'});
  const worker=f.workerPool();try{await expect(worker.query('SELECT local_identity.register_production_preparation($1,$2,$3,$4,$5)',[f.newEpisode,f.main,id,reference,manifest])).rejects.toMatchObject({code:'42501'});}finally{await worker.end();}
  for(const invalid of [
   {...manifest,shots:[manifest.shots[0],manifest.shots[0]]},
   {...manifest,shots:[{...manifest.shots[0],id:' shot-01 '}]},
   {...manifest,shots:[{...manifest.shots[0],shotType:'b_roll'}]},
   {...manifest,shots:[{...manifest.shots[0],visualSource:'unknown'}]},
   {...manifest,shots:[{...manifest.shots[0],durationSeconds:0}]},
  ])await expect(register(invalid as typeof manifest,reference,f.main!,randomUUID())).rejects.toMatchObject({code:'22023'});
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_preparation_revisions WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(2);
  await expect(f.c.query('INSERT INTO local_identity.production_preparation_revisions SELECT (jsonb_populate_record(NULL::local_identity.production_preparation_revisions,to_jsonb(p)||jsonb_build_object(\'id\',$2::uuid,\'episode_id\',$3::uuid,\'revision_number\',999))).* FROM local_identity.production_preparation_revisions p WHERE p.id=$1',[id,randomUUID(),f.episode])).rejects.toMatchObject({code:'23503'});
  await expect(register(manifest,{...reference,relativePath:'another-order/preparation/'+id+'.json'})).rejects.toMatchObject({code:'22023'});
  await expect(register(manifest,reference,randomUUID())).rejects.toMatchObject({code:'40001'});
  await f.c.query('INSERT INTO local_identity.historical_episodes(episode_id) VALUES($1)',[f.newEpisode]);
  await expect(register()).rejects.toMatchObject({code:'40001'});
  // A populated current baseline must survive a real whole-database dump, not just schema creation.
  const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=runtimeContext();
  if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only an isolated restore fixture');
  const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
  const restored='loop_preparation_current_'+randomBytes(6).toString('hex');context.sql('CREATE DATABASE '+restored+' TEMPLATE template0','postgres');
  try{
   const before=databaseSnapshot(context,f.database,process.cwd());
   context.sql(context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',f.database]),restored);
   assertRestored(before,databaseSnapshot(context,restored,process.cwd()));
   expect(JSON.parse(context.sql(`SELECT jsonb_agg(jsonb_build_object('shot_id',shot_id,'text',baseline_text) ORDER BY position) FROM local_identity.production_shot_versions WHERE preparation_revision_id='${id}'`,restored))).toEqual([
    {shot_id:'shot-01',text:'第一镜头沿用稳定身份。'},{shot_id:'shot-02',text:'第二镜头不要求视频参数。'},
   ]);
  }finally{context.sql('DROP DATABASE '+restored+' WITH (FORCE)','postgres');}
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('the local preparation file boundary rejects missing files, wrong SHA or size and a manifest different from the actual bytes before registration',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true});
 try{
  expect((await f.send('start')).status).toBe(200);
  const id=randomUUID(),location=(await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[f.newEpisode])).rows[0];
  const manifest={version:'production-preparation/v1',shots:[{id:'shot-01',scriptSegment:'以实际文件内容为准。',durationSeconds:2,targetSpec:'9:16',visualSource:'image'}]},bytes=Buffer.from(JSON.stringify(manifest)+'\n');
  const file={relativePath:`${location.directory_relative_path}/preparation/${id}.json`,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length};
  const register=(reference=file,value:unknown=manifest)=>ownerTransaction(f.pool,f.owner,false,c=>registerProductionPreparation(c,f.assetRoot,{episodeId:f.newEpisode,scriptRevisionId:f.main!,preparationRevisionId:id,file:reference,manifest:value}));
  await expect(register()).rejects.toMatchObject({status:409});
  await mkdir(dirname(join(f.assetRoot,file.relativePath)),{recursive:true});await writeFile(join(f.assetRoot,file.relativePath),bytes,{flag:'wx'});
  await expect(register({...file,sha256:'f'.repeat(64)})).rejects.toMatchObject({status:409});
  await expect(register({...file,fileSize:file.fileSize+1})).rejects.toMatchObject({status:409});
  await expect(register(file,{...manifest,shots:[{...manifest.shots[0],scriptSegment:'声明与文件不同。'}]})).rejects.toMatchObject({status:409});
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_preparation_revisions WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
  expect(await register()).toBe(id);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('Owner permanent deletion removes an independently registered preparation only after the existing archive and exact-file confirmation gates',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true});
 try{
  expect((await f.send('start')).status).toBe(200);
  const id=randomUUID(),location=(await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[f.newEpisode])).rows[0];
  const manifest={version:'production-preparation/v1',shots:[{id:'shot-01',scriptSegment:'只删除明确确认的测试生产单。',durationSeconds:2,targetSpec:'9:16',visualSource:'image'}]};
  const bytes=Buffer.from(JSON.stringify(manifest)+'\n'),file={relativePath:`${location.directory_relative_path}/preparation/${id}.json`,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length};
  await mkdir(dirname(join(f.assetRoot,file.relativePath)),{recursive:true});await writeFile(join(f.assetRoot,file.relativePath),bytes,{flag:'wx'});
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.register_production_preparation($1,$2,$3,$4,$5)',[f.newEpisode,f.main,id,file,manifest]));
  const lifecycle=(command:string,data:Record<string,unknown>={},token=f.token)=>f.post('episode-lifecycle',command,{episodeId:f.newEpisode,...data},{token});
  expect((await lifecycle('archiveEpisode',{archived:true})).status).toBe(200);
  const plan=await lifecycle('planDeletion');expect(plan.status,JSON.stringify(plan.body)).toBe(200);
  const data={confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision};
  expect((await lifecycle('deleteEpisode',data,f.otherToken)).status).toBe(404);
  expect((await lifecycle('deleteEpisode',{...data,confirmation:'incorrect title'})).status).toBe(409);
  const deleted=await lifecycle('deleteEpisode',data);expect(deleted.status,JSON.stringify(deleted.body)).toBe(200);expect(deleted.body.cleanupPending).toBe(false);
  for(const table of ['production_preparation_revisions','production_shots','production_shot_versions'])expect((await f.c.query(`SELECT count(*)::int n FROM local_identity.${table} WHERE episode_id=$1`,[f.newEpisode])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT count(*)::int n FROM public.episodes WHERE id=$1',[f.episode])).rows[0].n).toBe(1);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('187 adds independent storage without rewriting a nonempty old project, draft, audio or frozen task and supports atomic upgrade and full restore',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only isolated migration fixtures');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(f=>f.version<'188-')},previous={...catalog,current:catalog.current.filter(f=>f.version<'187-')};
 const suffix=randomBytes(6).toString('hex'),database='loop_preparation_old_'+suffix,restored='loop_preparation_restore_'+suffix,created:string[]=[];
 const sql=(query:string,db=database)=>context.sql(query,db),snapshot=()=>databaseSnapshot(context,database,process.cwd());
 try{
  for(const db of [database,restored]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  sql(freshSchemaTransaction(previous));
  const {episode,task,audio}=seedHistoricalPreparation(sql);
  const before=snapshot(),ledger=Object.fromEntries(Object.entries(before.ledger).map(([name,value])=>[name,(value as {sha256:string}).sha256]));
  const pending=schemaMigrationPlan(ledger,catalog);expect(pending.map(f=>f.version)).toEqual(['187-independent-production-preparation.sql']);const migration=migrationTransaction(pending);
  expect(()=>sql(migration.replace(/COMMIT;$/,'SELECT 1/0;COMMIT;'))).toThrow(/division by zero/);assertRestored(before,snapshot());
  sql(migration);const after=snapshot();
  for(const [name,value]of Object.entries(before.rows))expect(after.rows[name],name).toEqual(value);
  expect(after.sequenceRows).toEqual(before.sequenceRows);expect(after.roles).toEqual(before.roles);
  const preparationCleanup='DELETE FROM local_identity.production_shot_versions WHERE episode_id=p_episode_id;\nDELETE FROM local_identity.production_preparation_revisions WHERE episode_id=p_episode_id;\nDELETE FROM local_identity.production_shots WHERE episode_id=p_episode_id;\n';
  for(const [kind,objects]of Object.entries(before.catalog))for(const object of objects as any[]){
   if(kind==='functions'&&object.schema==='public'&&object.name==='delete_episode'){
    const current=after.catalog.functions.find((f:any)=>f.schema==='public'&&f.name==='delete_episode');
    expect(current).toMatchObject({...object,definition:expect.any(String)});expect(current.definition.replace(preparationCleanup,'')).toBe(object.definition);
   }else expect(after.catalog[kind],`${kind}: ${object.name}`).toContainEqual(object);
  }
  for(const entry of before.security)expect(after.security).toContainEqual(entry);
  expect(sql("SELECT count(*) FROM local_identity.production_preparation_revisions")).toBe('0');
  const applied=Object.fromEntries(Object.entries(after.ledger).map(([name,value])=>[name,(value as {sha256:string}).sha256]));expect(schemaMigrationPlan(applied,catalog)).toEqual([]);
  sql(context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',database]),restored);assertRestored(after,databaseSnapshot(context,restored,process.cwd()));
  expect(sql(`SELECT input_snapshot->>'legacyEvidence' FROM public.tasks WHERE id='${task}'`,restored)).toBe('never resend or rewrite');
  expect(sql(`SELECT current_audio_track_id::text FROM public.shot_preparation_drafts WHERE episode_id='${episode}'`,restored)).toBe(audio);
 }finally{for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}
},120000);
