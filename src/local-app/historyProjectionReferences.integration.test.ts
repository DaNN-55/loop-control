// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('history projection restores a main script inserted later in the same batch without replacing current references',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
  if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only an isolated history fixture is permitted');
  const {projectHistory}=await import(join(process.cwd(),'scripts/runtime/project-history.mjs'));
  const originalEpisode=(await f.c.query('SELECT to_jsonb(e) payload FROM public.episodes e WHERE id=$1',[f.episode])).rows[0].payload;
  const originalScript=(await f.c.query('SELECT to_jsonb(m) payload FROM public.production_material_revisions m WHERE id=$1',[f.script])).rows[0].payload;
  const episode=randomUUID(),script=randomUUID();
  const payloads=[['public.episodes',{...originalEpisode,id:episode,title:'同批恢复脚本关联',main_script_revision_id:script}],['public.production_material_revisions',{...originalScript,id:script,episode_id:episode}]]as const;
  for(const [table,payload]of payloads){
   const sha=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
   await f.c.query('INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload) VALUES($1,$2,$3,$4,$5)',[table,{id:payload.id},sha,f.owner,payload]);
  }
  const before=(await f.c.query('SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY table_name,row_key::text)::text) hash FROM local_identity.history_versions h')).rows;
  projectHistory({sql:(sql:string)=>context.sql(sql,f.database)});
  const projection=(await f.c.query('SELECT table_name,status,detail FROM local_identity.history_projection_results ORDER BY table_name')).rows;
  expect((await f.c.query('SELECT main_script_revision_id FROM public.episodes WHERE id=$1',[episode])).rows[0],JSON.stringify(projection)).toEqual({main_script_revision_id:script});
  expect((await f.c.query('SELECT episode_id FROM public.production_material_revisions WHERE id=$1',[script])).rows[0]).toEqual({episode_id:episode});
  projectHistory({sql:(sql:string)=>context.sql(sql,f.database)});
  expect((await f.c.query('SELECT main_script_revision_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0]).toEqual({main_script_revision_id:f.script});
  expect((await f.c.query('SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY table_name,row_key::text)::text) hash FROM local_identity.history_versions h')).rows).toEqual(before);
  expect(context.sql("SELECT current_setting('session_replication_role')",f.database)).toBe('origin');
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['untouched','edited','series_edited','current_link']as const)('history projection repairs only a proven prior missing reference for an %s historical order',async kind=>{
 const f=await productionWorkspaceFixture();
 try{
  const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
  if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only an isolated history fixture is permitted');
  const {projectHistory}=await import(join(process.cwd(),'scripts/runtime/project-history.mjs'));
  const episode=randomUUID(),script=randomUUID(),alternate=randomUUID();
  const original={...(await f.c.query('SELECT to_jsonb(e) payload FROM public.episodes e WHERE id=$1',[f.episode])).rows[0].payload,id:episode,main_script_revision_id:script};
  const material={...(await f.c.query('SELECT to_jsonb(m) payload FROM public.production_material_revisions m WHERE id=$1',[f.script])).rows[0].payload,id:script,episode_id:episode};
  const sha=createHash('sha256').update(JSON.stringify(original)).digest('hex');
  // A previous projector preserved the original JSON but installed a null main reference.
  await f.c.query('BEGIN');await f.c.query('SET LOCAL session_replication_role=replica');
  await f.c.query('INSERT INTO public.episodes SELECT e.* FROM jsonb_populate_record(NULL::public.episodes,$1) e',[{...original,main_script_revision_id:null,...(kind==='edited'?{title:'已由当前用户修订'}:{})}]);
  await f.c.query('INSERT INTO local_identity.historical_episodes(episode_id) VALUES($1)',[episode]);
  for(const [table,payload]of [['public.episodes',original],['public.production_material_revisions',material]]as const)await f.c.query('INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload) VALUES($1,$2,$3,$4,$5)',[table,{id:payload.id},createHash('sha256').update(JSON.stringify(payload)).digest('hex'),f.owner,payload]);
  await f.c.query("INSERT INTO local_identity.history_projection_results(table_name,row_key,payload_sha256,status,detail) VALUES('public.episodes',$1,$2,'inserted','原始脚本引用在全部来源中缺失，原值保留于历史版本。')",[{id:episode},sha]);
  if(kind==='current_link'){
   await f.c.query('INSERT INTO public.production_material_revisions SELECT m.* FROM jsonb_populate_record(NULL::public.production_material_revisions,$1) m',[{...material,id:alternate,revision_number:2}]);
   await f.c.query('UPDATE public.episodes SET main_script_revision_id=$2 WHERE id=$1',[episode,alternate]);
  }
  if(kind==='series_edited'){
   await f.c.query("INSERT INTO public.series(id,account_id,name) VALUES($1,$2,'Owner changed series')",[alternate,original.account_id]);
   await f.c.query("INSERT INTO public.series_versions(id,series_id,account_id,created_by,version,rules) VALUES($1,$1,$2,$3,1,'{}')",[alternate,original.account_id,f.owner]);
   await f.c.query('UPDATE public.episodes SET series_version_id=$2 WHERE id=$1',[episode,alternate]);
  }
  await f.c.query('COMMIT');
  projectHistory({sql:(sql:string)=>context.sql(sql,f.database)});
  expect((await f.c.query('SELECT main_script_revision_id,title FROM public.episodes WHERE id=$1',[episode])).rows[0]).toEqual({main_script_revision_id:kind==='untouched'?script:kind==='current_link'?alternate:null,title:kind==='edited'?'已由当前用户修订':original.title});
  expect((await f.c.query("SELECT payload FROM local_identity.history_versions WHERE table_name='public.episodes' AND row_key=$1",[{id:episode}])).rows[0].payload).toEqual(original);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['missing','other_episode','other_owner','current']as const)('history projection preserves source evidence and refuses a %s main-script replacement',async kind=>{
 const f=await productionWorkspaceFixture();
 try{
  const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
  if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only an isolated history fixture is permitted');
  const {projectHistory}=await import(join(process.cwd(),'scripts/runtime/project-history.mjs'));
  const current=(await f.c.query('SELECT to_jsonb(e) payload FROM public.episodes e WHERE id=$1',[f.episode])).rows[0].payload;
  const material=(await f.c.query('SELECT to_jsonb(m) payload FROM public.production_material_revisions m WHERE id=$1',[f.script])).rows[0].payload;
  const episode=kind==='current'?f.episode:randomUUID(),script=kind==='other_episode'?f.script:randomUUID();
  const record=async(table:string,payload:Record<string,unknown>,owner=f.owner)=>f.c.query('INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload) VALUES($1,$2,$3,$4,$5)',[table,{id:payload.id},createHash('sha256').update(JSON.stringify(payload)).digest('hex'),owner,payload]);
  await record('public.episodes',{...current,id:episode,title:'不能替换的历史关系',main_script_revision_id:script});
  if(kind==='other_owner')await record('public.production_material_revisions',{...material,id:script,episode_id:episode},f.other);
  const original=(await f.c.query('SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY table_name,row_key::text)::text) hash FROM local_identity.history_versions h')).rows;
  projectHistory({sql:(sql:string)=>context.sql(sql,f.database)});
  expect((await f.c.query('SELECT main_script_revision_id FROM public.episodes WHERE id=$1',[episode])).rows[0]).toEqual({main_script_revision_id:kind==='current'?f.script:null});
  if(kind==='current')expect((await f.c.query('SELECT to_jsonb(e) payload FROM public.episodes e WHERE id=$1',[f.episode])).rows[0].payload).toEqual(current);
  else expect((await f.c.query("SELECT detail FROM local_identity.history_projection_results WHERE table_name='public.episodes' AND row_key=$1",[{id:episode}])).rows[0].detail).toContain('原值保留于历史版本');
  expect((await f.c.query('SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY table_name,row_key::text)::text) hash FROM local_identity.history_versions h')).rows).toEqual(original);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('history projection rolls back recovered references and historical markers when publication fails',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
  if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only an isolated history fixture is permitted');
  const {projectHistory}=await import(join(process.cwd(),'scripts/runtime/project-history.mjs'));
  const episode=randomUUID(),payload={...(await f.c.query('SELECT to_jsonb(e) payload FROM public.episodes e WHERE id=$1',[f.episode])).rows[0].payload,id:episode,main_script_revision_id:null};
  await f.c.query('INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload) VALUES($1,$2,$3,$4,$5)',['public.episodes',{id:episode},createHash('sha256').update(JSON.stringify(payload)).digest('hex'),f.owner,payload]);
  expect(()=>projectHistory({sql:(sql:string)=>context.sql(sql.replace(' COMMIT;',' SELECT 1/0;COMMIT;'),f.database)})).toThrow(/division by zero/);
  expect((await f.c.query('SELECT count(*)::int n FROM public.episodes WHERE id=$1',[episode])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.historical_episodes WHERE episode_id=$1',[episode])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.history_projection_results')).rows[0].n).toBe(0);
  expect(context.sql("SELECT current_setting('session_replication_role')",f.database)).toBe('origin');
 }finally{await f.close();}
},90000);
