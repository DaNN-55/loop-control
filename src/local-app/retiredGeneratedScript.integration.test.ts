// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,realpath,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';
import {pathToFileURL} from 'node:url';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';

const removed=['public.create_script_review_package()','public.materialize_approved_script_revision()'];
const removedTriggers=['create_script_review_package_after_task_completion','materialize_approved_script_revision_after_approval'];
const transitionGuard="  -- ADR-0065: generated-script events cannot succeed without their retired projections.\n  IF current_episode.stage IN ('brief_draft','script_draft','script_review')\n    OR p_to_stage IN ('brief_draft','script_draft','script_review','script_approved') THEN\n    RAISE EXCEPTION 'Generated script transitions are retired; confirm an uploaded script in the current workspace' USING ERRCODE='0A000';\n  END IF;\n";

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('185 retires only the generated-script pair with a fail-closed Owner transition and preserves full original evidence and real history projection',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Shot history acceptance requires an isolated cluster');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(f=>Number(f.version.slice(0,3))<=185)},previous={...catalog,current:catalog.current.filter(f=>Number(f.version.slice(0,3))<185)},cleanup=catalog.current.find(f=>f.version==='185-remove-retired-generated-script-chain.sql')!;
 expect([...cleanup.body.matchAll(/^DROP FUNCTION ([^;]+);$/gm)].map(m=>m[1])).toEqual(removed);
 const names=new Set(removed.map(s=>s.slice(0,s.indexOf('(')))),suffix=randomBytes(6).toString('hex'),base='loop_shot_base_'+suffix,restored='loop_shot_restore_'+suffix,created:string[]=[];
 const root=await realpath(await mkdtemp('/private/tmp/loop-shot-history-'));
 const sql=(q:string,db=restored)=>context.sql('\\set VERBOSITY verbose\n'+q,db),snapshot=(db=restored)=>databaseSnapshot(context,db,process.cwd());
 let fixture:Awaited<ReturnType<typeof productionWorkspaceFixture>>|undefined;
 try{
  for(const db of [base,restored]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  sql(freshSchemaTransaction(previous),base);
  const oldContext=join(root,'context-184.mjs');
  await writeFile(oldContext,`import {runtimeContext as original} from ${JSON.stringify(process.env.LOOP_TEST_CONTEXT_MODULE)};export function runtimeContext(){const c=original();return {...c,database:${JSON.stringify(base)},sql:(q,db=${JSON.stringify(base)})=>c.sql(q,db)};}`,{mode:0o600});
  const f=fixture=await productionWorkspaceFixture({testContextModule:oldContext});
  const tts=randomUUID(),failed=randomUUID(),voiceArtifact=randomUUID(),track=randomUUID(),receipt=randomUUID(),text='已确认的第一镜。',voicePath=f.episodeRelativePath+'/voice.mp3';
  await f.c.query('BEGIN');
  await f.c.query("INSERT INTO public.approvals(episode_id,stage,decision,reason,actor_id,review_package_id) VALUES($1,'storyboard_approved','approved','Retained historical approval',$2,$3)",[f.episode,f.owner,f.board]);
  const draft=(await f.c.query("SELECT id FROM public.shot_preparation_drafts WHERE episode_id=$1 AND review_package_id=$2 AND shot_id='shot-1'",[f.episode,f.board])).rows[0];expect(draft?.id).toBeTruthy();
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,provider,model,prompt_version,input_snapshot) VALUES($1,$2,'extract_embedded_audio','completed','ffmpeg','ffmpeg','legacy-frozen-source-v1',$3)",[tts,f.episode,{capability:'embedded_audio_extraction',shot_preparation:{draft_id:draft.id,shot_id:'shot-1'},media:{source:'retained native video'}}]);
  await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'audio',$4,$5,$6)",[voiceArtifact,f.episode,tts,voicePath,f.files[1].sha256,f.files[1].fileSize]);
  await f.c.query("INSERT INTO public.audio_tracks(id,episode_id,source_task_id,source_artifact_id,source_review_package_id,track_kind,cue_id,relative_path,sha256,file_size,duration_seconds) VALUES($1,$2,$3,$4,$5,'source','shot-1',$6,$7,$8,2)",[track,f.episode,tts,voiceArtifact,f.board,voicePath,f.files[1].sha256,f.files[1].fileSize]);
  await f.c.query("UPDATE public.shot_preparation_drafts SET audio_mode='source',subtitle_text=$2,tts_text=$2,tts_voice='retained-historical-voice',tts_speaking_rate=1,selected_material_revision_id=$3,clip_start_seconds=0,clip_end_seconds=2,clip_segments='[{\"start_seconds\":0,\"end_seconds\":2}]',video_status='ready',audio_status='ready',video_duration_seconds=2,current_video_task_id=$4,current_video_artifact_id=(SELECT id FROM public.artifacts WHERE episode_id=$5 AND relative_path=$6 LIMIT 1),current_audio_track_id=$7,current_tts_task_id=NULL,source_audio_duration_seconds=2 WHERE id=$1",[draft.id,text,f.material,f.task,f.episode,f.videoPath,track]);
  // A new source clip correctly invalidates its old audio; publish the completed result afterwards.
  expect((await f.c.query('SELECT current_audio_track_id,audio_status FROM public.shot_preparation_drafts WHERE id=$1',[draft.id])).rows[0]).toEqual({current_audio_track_id:null,audio_status:'pending'});
  await f.c.query("UPDATE public.shot_preparation_drafts SET current_audio_track_id=$2,audio_status='ready',source_audio_duration_seconds=2 WHERE id=$1",[draft.id,track]);
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='confirmed',confirmation_reason='Original frozen evidence',confirmed_at='2026-10-01T01:02:03.123456Z',confirmed_by=$2,frozen_at='2026-10-01T01:02:03.123456Z',frozen_by=$2 WHERE id=$1",[draft.id,f.owner]);
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,provider,model,prompt_version) VALUES($1,$2,'extract_embedded_audio','failed',$3,'ffmpeg','ffmpeg','old-source-retry-v1')",[failed,f.episode,{capability:'embedded_audio_extraction',shot_preparation:{draft_id:draft.id},marker:'frozen failed source attempt'}]);
  await f.c.query("INSERT INTO public.task_runs(task_id,attempt,status,task_package,completed_at) VALUES($1,1,'failed',$2,'2026-10-01T01:02:03.123456Z')",[failed,{task_id:failed,episode_id:f.episode,marker:'original failed source run'}]);
  const historyBytes=Buffer.from('retained original history bytes'),historySha=createHash('sha256').update(historyBytes).digest('hex'),historyFile=join(root,historySha);await writeFile(historyFile,historyBytes);
  await f.c.query(`INSERT INTO local_identity.history_sources(id,owner_id,kind,label,imported_at) VALUES(repeat('a',64),$1,'backup','original source','2026-10-01T01:02:03.123456Z'),(repeat('b',64),$1,'backup','shared source','2026-10-02T01:02:03.123456Z');`,[f.owner]);
  for(const [table,id,payload]of [['public.episodes',f.episode,{id:f.episode,title:'original historical title'}],['public.tasks',failed,{id:failed,episode_id:f.episode,marker:'original historical task'}]]as const){const sha=createHash('sha256').update(JSON.stringify(payload)).digest('hex');await f.c.query('INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload) VALUES($1,$2,$3,$4,$5)',[table,{id},sha,f.owner,payload]);}
  await f.c.query("INSERT INTO local_identity.history_source_rows(source_id,table_name,row_key,payload_sha256) SELECT repeat('a',64),table_name,row_key,payload_sha256 FROM local_identity.history_versions");
  await f.c.query("INSERT INTO local_identity.history_projection_results(table_name,row_key,payload_sha256,status,detail,applied_at) SELECT table_name,row_key,payload_sha256,'current-preserved','retain projection','2026-10-01T01:02:03.123456Z' FROM local_identity.history_versions");
  await f.c.query("INSERT INTO local_identity.history_files(source_id,logical_path,sha256,bytes,kind,metadata) VALUES(repeat('a',64),$1,$2,$3,'historical',$4),(repeat('b',64),'shared/original.txt',$2,$3,'historical','{}')",['episodes/'+f.episode+'/history.txt',historySha,historyBytes.length,{episode_id:f.episode}]);
  await f.c.query("INSERT INTO local_identity.history_file_protections(original_sha256,protected_sha256,protected_bytes,replacements,verified_at) VALUES($1,$1,$2,'[]','2026-10-01T01:02:03.123456Z')",[historySha,historyBytes.length]);
  await f.c.query("INSERT INTO local_identity.history_retained_files(owner_id,logical_path,sha256,bytes,kind,retention_reason) VALUES($1,'retained/original.txt',$2,$3,'historical','business-dependency')",[f.owner,historySha,historyBytes.length]);
  await f.c.query("INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,repeat('e',64),$3)",[f.owner,receipt,{episodeId:f.episode,cleanupPending:true,historyCleanupTargets:[{sha:historySha,path:historyFile,bytes:historyBytes.length}],marker:'retained original pending receipt'}]);
  await f.c.query('INSERT INTO local_identity.historical_episodes(episode_id) VALUES($1)',[f.episode]);await f.c.query('INSERT INTO local_identity.historical_tasks(task_id) VALUES($1)',[failed]);
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id,prompt=randomUUID(),generatedEpisodes:string[]=[];
  await f.c.query("INSERT INTO public.prompt_versions(id,account_id,capability,version,slug,name,summary,instructions,content_hash) VALUES($1,$2,'script_writing',1,'original-script','Original frozen script prompt','Retained original evidence','Retain original script',$3)",[prompt,account,createHash('sha256').update('Retain original script').digest('hex')]);
  for(const approved of [true,false]){
   const episode=randomUUID(),task=randomUUID(),artifact=randomUUID(),lease=randomUUID(),path=`episodes/${episode}/generated-script.md`,bytes=Buffer.from('原生成脚本，保留冻结版本与批准证据。');generatedEpisodes.push(episode);
   await mkdir(dirname(join(f.assetRoot,path)),{recursive:true});await writeFile(join(f.assetRoot,path),bytes);
   const artifactResult={artifactType:'script',relativePath:path,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length},input={capability:'script_writing',harness:{id:prompt,instructions:'Retain original script',content_hash:createHash('sha256').update('Retain original script').digest('hex')},output:{relative_path:path,required_artifact_types:['script']}};
   await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage,script_source) VALUES($1,$2,$2,$3,'script_draft','delegated')",[episode,account,approved?'Original approved generated script':'Original pending generated script']);
   await f.c.query('INSERT INTO local_identity.input_episodes(episode_id,owner_id,enabled) VALUES($1,$2,true)',[episode,f.owner]);
   await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,attempt,max_attempts,provider,model,prompt_version,claimed_at,lease_token,input_snapshot) VALUES($1,$2,'draft_script','running',1,1,'codex','historical','original-script',clock_timestamp(),$3,$4)",[task,episode,lease,input]);
   await f.c.query("INSERT INTO public.task_runs(task_id,attempt,status,lease_token,task_package,result,completed_at) VALUES($1,0,'completed',$2,$3,$4,'2026-10-01T01:02:03.123456Z')",[task,lease,input,{marker:'original frozen script result',artifacts:[artifactResult]}]);
   await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'script',$4,$5,$6)",[artifact,episode,task,path,artifactResult.sha256,bytes.length]);
   await f.c.query("UPDATE public.tasks SET status='completed' WHERE id=$1",[task]);
   expect((await f.c.query('SELECT count(*)::int n FROM public.review_packages WHERE task_id=$1',[task])).rows[0].n).toBe(1);
   if(approved){await f.c.query("SET LOCAL SESSION AUTHORIZATION loop_app");await f.c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);await f.c.query("SELECT public.transition_episode($1,'script_approved','Original frozen approval')",[episode]);await f.c.query('RESET SESSION AUTHORIZATION');expect((await f.c.query('SELECT main_script_revision_id FROM public.episodes WHERE id=$1',[episode])).rows[0].main_script_revision_id).toBeTruthy();}
  }
  const generatedRows:Array<{table:string;payload:Record<string,unknown>}>=[];
  for(const table of ['episodes','tasks','task_runs','artifacts','review_packages','production_material_revisions','approvals']){
   const where=table==='episodes'?'id=ANY($1::uuid[])':table==='task_runs'?'task_id IN(SELECT id FROM public.tasks WHERE episode_id=ANY($1::uuid[]))':'episode_id=ANY($1::uuid[])';
   for(const {payload}of(await f.c.query(`SELECT to_jsonb(t) payload FROM public.${table} t WHERE ${where}`, [generatedEpisodes])).rows){generatedRows.push({table,payload});const sha=createHash('sha256').update(JSON.stringify(payload)).digest('hex');await f.c.query('INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload) VALUES($1,$2,$3,$4,$5)',['public.'+table,{id:payload.id},sha,f.owner,payload]);}
  }
  await f.c.query("INSERT INTO local_identity.history_source_rows(source_id,table_name,row_key,payload_sha256) SELECT repeat('a',64),table_name,row_key,payload_sha256 FROM local_identity.history_versions ON CONFLICT DO NOTHING");
  await f.c.query('COMMIT');
  const before=snapshot(f.database);expect(before.rows['public.shot_preparation_drafts'].rows).toBeGreaterThanOrEqual(2);expect(before.rows['public.audio_tracks'].rows).toBeGreaterThanOrEqual(1);
  const frozen=(await f.c.query('SELECT * FROM public.shot_preparation_drafts WHERE id=$1',[draft.id])).rows[0];expect(frozen.frozen_at).toBeTruthy();expect(frozen.confirmation_status).toBe('confirmed');expect(frozen.current_audio_track_id).toBe(track);expect(frozen.audio_mode).toBe('source');expect(frozen.current_tts_task_id).toBeNull();expect(frozen.preparation_input_fingerprint).toMatch(/^[a-f0-9]{32}$/);
  const dump=context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',f.database]);sql(dump);assertRestored(before,snapshot());
  expect(before.rows['public.prompt_versions'].rows).toBeGreaterThanOrEqual(1);
  expect(before.rows['public.approvals'].rows).toBeGreaterThan(0);
  for(const name of removed){
   for(const actor of ['loop_app','loop_owner','loop_worker','loop_anonymous'])expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT ${name}`)).toThrow(/42501/);
   sql(`CREATE TRIGGER retired_dependency_probe AFTER INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION ${name}`);
   expect(()=>sql(migrationTransaction([cleanup]))).toThrow(/2BP01/);
   sql('DROP TRIGGER retired_dependency_probe ON public.accounts');assertRestored(before,snapshot());
  }
  expect(()=>sql(migrationTransaction([cleanup]).replace(/COMMIT;$/,'SELECT 1/0; COMMIT;'))).toThrow(/22012/);assertRestored(before,snapshot());
  sql(migrationTransaction([cleanup]));const after=snapshot();
  for(const key of ['rows','sequenceRows','roles'])expect(after[key]).toEqual(before[key]);
  const dropped=before.catalog.functions.filter((f:{schema:string;name:string})=>names.has(f.schema+'.'+f.name));expect(dropped).toHaveLength(2);
  expect(after.catalog).toEqual({...before.catalog,functions:before.catalog.functions.filter((f:{schema:string;name:string})=>!names.has(f.schema+'.'+f.name)).map((fn:{name:string;definition:string})=>fn.name==='transition_episode'?{...fn,definition:fn.definition.replace('  previous_stage := current_episode.stage;',transitionGuard+'  previous_stage := current_episode.stage;')}:fn),triggers:before.catalog.triggers.filter((t:{name:string})=>!removedTriggers.includes(t.name))});
  const acl=new Set(dropped.map((f:{schema:string;name:string;arguments:string})=>`${f.schema}.${f.name}(${f.arguments})`));expect(after.security).toEqual(before.security.filter((s:{identity:string})=>!acl.has(s.identity)));
  for(const [version,row]of Object.entries(before.ledger))expect(after.ledger[version]).toEqual(row);
  const ledger=Object.fromEntries(Object.entries(after.ledger).map(([k,v])=>[k,(v as {sha256:string}).sha256]));expect(ledger[cleanup.version]).toBe(cleanup.sha256);expect(Object.keys(after.ledger)).toHaveLength(Object.keys(before.ledger).length+1);expect(schemaMigrationPlan(ledger,catalog)).toEqual([]);
  for(const name of removed)expect(sql(`SELECT to_regprocedure('${name}') IS NULL`)).toBe('t');
  for(const actor of ['postgres','loop_app','loop_owner','loop_worker','loop_anonymous'])for(const name of removed)expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT ${name}`)).toThrow(/42883/);
  expect(sql("SELECT to_regprocedure('public.create_storyboard_review_package()') IS NOT NULL")).toBe('t');
  expect(()=>sql(`BEGIN;UPDATE public.episodes SET stage='qc_passed' WHERE id='${f.episode}';UPDATE public.shot_preparation_drafts SET subtitle_text='forbidden overwrite' WHERE id='${draft.id}';COMMIT;`)).toThrow(/Frozen shot drafts cannot be edited/);assertRestored(after,snapshot());
  expect(()=>sql("UPDATE public.prompt_versions SET instructions='forbidden replacement' WHERE id=(SELECT id FROM public.prompt_versions LIMIT 1)")).toThrow(/Prompt Harness content is immutable/);assertRestored(after,snapshot());
  expect(await readFile(historyFile)).toEqual(historyBytes);expect(sql(`SELECT result->>'marker' FROM local_identity.command_receipts WHERE idempotency_key='${receipt}'`)).toBe('retained original pending receipt');
  for(const [table,count]of [['history_sources',2],['history_versions',2+generatedRows.length],['history_files',2],['history_retained_files',1],['historical_episodes',1],['historical_tasks',1]]as const)expect(after.rows['local_identity.'+table].rows).toBe(count);
  const pending=generatedEpisodes[1],owned=(owner:string,query:string)=>`BEGIN;SET LOCAL SESSION AUTHORIZATION loop_app;SELECT set_config('loop.owner_id','${owner}',true);${query};COMMIT;`;
  expect(()=>sql(owned(f.other,`SELECT public.transition_episode('${pending}','script_approved','forbidden')`))).toThrow(/42501/);
  for(const stage of ['script_approved','script_draft'])expect(()=>sql(owned(f.owner,`SELECT public.transition_episode('${pending}','${stage}','Retired generated script')`))).toThrow(/0A000/);
  assertRestored(after,snapshot());
  // Exercise the actual append-only history projector on both schemas, including missing
  // completed generated tasks, original approvals, main-script versions and pending review.
  const {projectHistory}=await import(join(process.cwd(),'scripts/runtime/project-history.mjs'));
  const quoted=generatedEpisodes.map(id=>`'${id}'`).join(',');
  for(const database of [f.database,restored]){
   const deletes=['approvals','review_packages','production_material_revisions','artifacts','task_runs','tasks','episodes'].map(table=>`DELETE FROM public.${table} WHERE ${table==='episodes'?`id IN(${quoted})`:table==='task_runs'?`task_id IN(SELECT id FROM public.tasks WHERE episode_id IN(${quoted}))`:`episode_id IN(${quoted})`};`).join('\n');
   sql('BEGIN;SET LOCAL session_replication_role=replica;'+deletes+'COMMIT;',database);
   projectHistory({sql:(q:string)=>context.sql(q,database)});
   expect(sql("SELECT current_setting('session_replication_role')",database)).toBe('origin');
   expect(sql(`SELECT count(*) FROM public.tasks WHERE episode_id IN(${quoted}) AND status='completed'`,database)).toBe('2');
   expect(sql(`SELECT count(*) FROM public.approvals WHERE episode_id IN(${quoted})`,database)).toBe('1');
   expect(sql(`SELECT count(*) FROM local_identity.historical_tasks WHERE task_id IN(SELECT id FROM public.tasks WHERE episode_id IN(${quoted}))`,database)).toBe('2');
  }
  const projectedBefore=snapshot(f.database),projectedAfter=snapshot();
  for(const [table,row]of Object.entries(projectedBefore.rows))if(table!=='local_identity.history_projection_results')expect(projectedAfter.rows[table],table).toEqual(row);
  expect(sql("SELECT jsonb_agg(to_jsonb(p)-'applied_at' ORDER BY table_name,row_key::text,payload_sha256) FROM local_identity.history_projection_results p")).toBe(sql("SELECT jsonb_agg(to_jsonb(p)-'applied_at' ORDER BY table_name,row_key::text,payload_sha256) FROM local_identity.history_projection_results p",f.database));
  for(const {table,payload}of generatedRows)expect(sql(`SELECT payload->>'id' FROM local_identity.history_versions WHERE table_name='public.${table}' AND row_key='${JSON.stringify({id:payload.id})}'`)).toBe(payload.id);
  for(const media of [f.files[0],f.files[1]])expect(createHash('sha256').update(await readFile(join(f.assetRoot,media.relativePath))).digest('hex')).toBe(media.sha256);
 }finally{try{await fixture?.close();for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}finally{await rm(root,{recursive:true,force:true});}}
},120000);


it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('all real saved Worker and Owner command ports reject generated-script execution while retaining old storyboard approval and its projections',async()=>{
 const copied=process.env.LOOP_TEST_COMPAT_RELEASES_ROOT;if(!copied)throw Error('Explicit copied runtime packages required');
 const workers=JSON.parse(await readFile(join(copied,'compatibility.json'),'utf8')),episodes=JSON.parse(await readFile(join(copied,'episodes.json'),'utf8'));
 const supported=JSON.parse(await readFile(join(process.cwd(),'docs/runtime/runtime-support.json'),'utf8'));
 expect(episodes.releases.map((release:{id:string})=>release.id).sort()).toEqual(supported.releases.map((release:{id:string})=>release.id).sort());
 expect(workers.releases.map((release:{id:string})=>release.id).sort()).toEqual(supported.releases.map((release:{id:string})=>release.id).sort());
 expect(supported.verification.savedPackages).toBe(23);
 for(const release of supported.releases){
  expect(workers.releases.find((worker:{id:string})=>worker.id===release.id).workerFiles).toEqual(release.workerEntries);
  const entry=episodes.releases.find((episode:{id:string})=>episode.id===release.id);expect({file:entry.file,sha256:entry.sha256}).toEqual(release.ownerCommandEntry);
  expect(release.references.create_episode).toBeUndefined();
 }
 const f=await productionWorkspaceFixture(),worker=f.workerPool();try{
  const session={id:f.owner,email:f.email,token:f.token},task=randomUUID(),lease=randomUUID(),legacyEpisode=randomUUID();
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,1)');
  await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) SELECT $1,account_id,blueprint_version_id,'Separate retained generated task','script_draft' FROM public.episodes WHERE id=$2",[legacyEpisode,f.episode]);
  await f.c.query('INSERT INTO local_identity.input_episodes(episode_id,owner_id,enabled) VALUES($1,$2,true)',[legacyEpisode,f.owner]);
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,attempt,max_attempts,provider,model,prompt_version,lease_token,claimed_at,input_snapshot) VALUES($1,$2,'draft_script','running',1,1,'codex','historical','original-script',$3,clock_timestamp(),$4)",[task,legacyEpisode,lease,{capability:'script_writing',output:{relative_path:`episodes/${f.episode}/generated.md`,required_artifact_types:['script']}}]);
  await f.c.query("INSERT INTO public.task_runs(task_id,attempt,status,lease_token,task_package) VALUES($1,0,'running',$2,'{\"marker\":\"original blocked generated script\"}')",[task,lease]);
  const original=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=$1',[task])).rows[0].value;
  const load=async(id:string,entry:{file:string;sha256:string})=>{const path=join(copied,id,entry.file);expect(createHash('sha256').update(await readFile(path)).digest('hex')).toBe(entry.sha256);return import(pathToFileURL(path).href);};
  let ports=0;
  for(const release of workers.releases)for(const entry of release.workerFiles){
   const old=await load(release.id,entry);await old.assertNativeWorkerDatabase(worker,f.database);const port=old.nativeWorkerPort(worker);
   expect(await port.rpc('claim_next_worker_task',{p_task_id:task,p_worker_capacity:1})).toEqual([]);
   await expect(port.rpc('report_worker_result',{p_task_id:task,p_attempt:0,p_lease_token:lease,p_result:{version:'worker-result/v1',taskId:task,status:'failed',artifacts:[],actualCostCents:0,validation:{passed:false,checks:[]},retry:{shouldRetry:false,reason:'retired'},blockers:[],nextStep:'Keep history.'}})).rejects.toMatchObject({code:'42501'});ports++;
  }
  expect(ports).toBe(46);expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=$1',[task])).rows[0].value).toEqual(original);
  const visualPackage=randomUUID(),visualTask=randomUUID(),visualArtifact=randomUUID(),visualPath=f.episodeRelativePath+'/original-visual.md',visualBytes=Buffer.from('原视觉依据，保留旧包批准合同。');
  await writeFile(join(f.assetRoot,visualPath),visualBytes);
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,provider,model,prompt_version,input_snapshot) VALUES($1,$2,'prepare_visual_brief','completed','codex','historical','original-visual','{\"capability\":\"visual_planning\"}')",[visualTask,f.episode]);
  await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'visual_brief',$4,$5,$6)",[visualArtifact,f.episode,visualTask,visualPath,createHash('sha256').update(visualBytes).digest('hex'),visualBytes.length]);
  await f.c.query("INSERT INTO public.review_packages(id,episode_id,task_id,artifact_id,stage,revision_number,context_snapshot) VALUES($1,$2,$3,$4,'visual_review',1,'{\"marker\":\"Original visual review\"}')",[visualPackage,f.episode,visualTask,visualArtifact]);
  const script=(await f.c.query('SELECT storage_path,sha256,file_size FROM public.production_material_revisions WHERE id=$1',[f.script])).rows[0],frozenInputs=[{artifactType:'main_script',relativePath:script.storage_path,sha256:script.sha256,fileSize:Number(script.file_size)},{artifactType:'approved_visual',relativePath:f.files[0].relativePath,sha256:f.files[0].sha256,fileSize:f.files[0].fileSize}];
  const board=JSON.parse(await readFile(join(f.assetRoot,f.boardPath),'utf8'));board.shots=board.shots.map((shot:Record<string,unknown>)=>({...shot,inputBasis:frozenInputs.map(({relativePath,sha256})=>({relativePath,sha256}))}));
  const boardBytes=Buffer.from(JSON.stringify(board));await writeFile(join(f.assetRoot,f.boardPath),boardBytes);
  await f.c.query('UPDATE public.artifacts SET sha256=$2,file_size=$3 WHERE id=(SELECT artifact_id FROM public.review_packages WHERE id=$1)',[f.board,createHash('sha256').update(boardBytes).digest('hex'),boardBytes.length]);
  await f.c.query('UPDATE public.review_packages SET context_snapshot=$2 WHERE id=$1',[f.board,{input_artifacts:frozenInputs,worker_result:{storyboard:board}}]);
  let oldApprovals=0,retiredApprovals=0,wakes=0,revision=1;
  for(const release of episodes.releases){
   const old=await load(release.id,release),commands=new old.LocalEpisodeCommands(f.pool,f.root,{ready:async()=>{throw Error('No Provider or preflight permitted');},wake(){wakes++;},mountPath:f.root,minimumFreeBytes:0,studioRuntime:async()=>f.runtime});
   try{
    await f.c.query("UPDATE public.episodes SET stage='visual_review' WHERE id=$1",[f.episode]);
    const operation={command:'review',idempotencyKey:randomUUID(),data:{episodeId:f.episode,reviewPackageId:visualPackage,toStage:'script_approved',reason:'Retired generated-script transition'}};
    const rejected=await commands.execute(session,operation).then(()=>({status:200}),(error:unknown)=>error);expect([400,410],JSON.stringify({package:release.id,message:(rejected as Error).message})).toContain((rejected as {status:number}).status);
    await expect(commands.execute({id:f.other,email:f.other+'@example.invalid',token:f.otherToken},{...operation,idempotencyKey:randomUUID()})).rejects.toMatchObject({status:404});
    const review=randomUUID();await f.c.query("INSERT INTO public.review_packages(id,episode_id,task_id,artifact_id,stage,revision_number,context_snapshot) SELECT $1,episode_id,task_id,artifact_id,stage,$2,context_snapshot FROM public.review_packages WHERE id=$3",[review,++revision,f.board]);
    await f.c.query("UPDATE public.episodes SET stage='storyboard_review' WHERE id=$1",[f.episode]);
    try{await commands.execute(session,{command:'review',idempotencyKey:randomUUID(),data:{episodeId:f.episode,reviewPackageId:review,toStage:'storyboard_approved',reason:'Retained old package storyboard approval'}});oldApprovals++;}
    catch(error){expect(error).toMatchObject({status:410});retiredApprovals++;}
   }finally{await commands.close();}
  }
  expect(wakes).toBeGreaterThan(0);expect((await f.c.query('SELECT count(*)::int n FROM public.tasks')).rows[0].n).toBe(3);expect((await f.c.query('SELECT count(*)::int n FROM public.paid_generation_reservations')).rows[0].n).toBe(0);
  expect({oldApprovals,retiredApprovals}).toEqual({oldApprovals:16,retiredApprovals:7});
  expect((await f.c.query("SELECT count(*)::int n FROM public.approvals WHERE episode_id=$1 AND stage='storyboard_approved'",[f.episode])).rows[0].n).toBe(16);
  expect((await f.c.query('SELECT count(*)::int n FROM public.shot_preparation_drafts WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(32);
  expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=$1',[task])).rows[0].value).toEqual(original);
  for(const media of f.files)expect(createHash('sha256').update(await readFile(join(f.assetRoot,media.relativePath))).digest('hex')).toBe(media.sha256);
 }finally{await worker.end();await f.close();}
},180000);
