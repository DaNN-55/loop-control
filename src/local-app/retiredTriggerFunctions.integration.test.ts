// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,realpath,writeFile,readFile,rm,mkdir,lstat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';
import {pathToFileURL} from 'node:url';
import {executeConfiguration} from './configurationCommands';
import {readLocalCatalog} from './catalog';
import {ownerTransaction} from './ownerTransaction';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';

const removed=['public.create_script_revision_task_after_changes_requested()','public.create_visual_revision_task_after_changes_requested()','public.seed_account_prompt_versions()'];
const removedTriggers=['create_script_revision_task_after_changes_requested','create_visual_revision_task_after_changes_requested','accounts_seed_prompt_versions'];

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('184 removes only three retired trigger pairs after nonempty full history restore while preserving frozen evidence and the storyboard completion guard',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Shot history acceptance requires an isolated cluster');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(f=>Number(f.version.slice(0,3))<=184)},previous={...catalog,current:catalog.current.filter(f=>Number(f.version.slice(0,3))<184)},cleanup=catalog.current.find(f=>f.version==='184-remove-retired-revision-and-prompt-triggers.sql')!;
 expect([...cleanup.body.matchAll(/^DROP FUNCTION ([^;]+);$/gm)].map(m=>m[1])).toEqual(removed);
 const names=new Set(removed.map(s=>s.slice(0,s.indexOf('(')))),suffix=randomBytes(6).toString('hex'),base='loop_shot_base_'+suffix,restored='loop_shot_restore_'+suffix,created:string[]=[];
 const root=await realpath(await mkdtemp('/private/tmp/loop-shot-history-'));
 const sql=(q:string,db=restored)=>context.sql('\\set VERBOSITY verbose\n'+q,db),snapshot=(db=restored)=>databaseSnapshot(context,db,process.cwd());
 let fixture:Awaited<ReturnType<typeof productionWorkspaceFixture>>|undefined;
 try{
  for(const db of [base,restored]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  sql(freshSchemaTransaction(previous),base);
  const oldContext=join(root,'context-183.mjs');
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
  for(const [stage,taskType,capability]of [['script_review','draft_script','script_writing'],['visual_review','prepare_visual_brief','visual_planning']]as const){
   const originalTask=randomUUID(),originalPackage=randomUUID(),prompt=(await f.c.query('SELECT p.* FROM public.prompt_versions p JOIN public.episodes e ON e.account_id=p.account_id WHERE e.id=$1 AND p.capability=$2 ORDER BY p.version LIMIT 1',[f.episode,capability])).rows[0];expect(prompt?.id).toBeTruthy();
   const frozenInput={capability,harness:{id:prompt.id,instructions:prompt.instructions,content_hash:prompt.content_hash},input_artifacts:[{relative_path:f.videoPath,sha256:f.files[0].sha256}],output:{relative_path:f.episodeRelativePath+'/original-'+stage+'.md',required_artifact_types:['visual_brief']}};
   await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,provider,model,prompt_version,input_snapshot) VALUES($1,$2,$3,'completed','codex','historical',$4,$5)",[originalTask,f.episode,taskType,prompt.slug,frozenInput]);
   await f.c.query("INSERT INTO public.task_runs(task_id,attempt,status,task_package,result,completed_at) VALUES($1,0,'completed',$2,$3,'2026-10-01T01:02:03.123456Z')",[originalTask,frozenInput,{marker:'original '+stage+' evidence'}]);
   await f.c.query('INSERT INTO public.review_packages(id,episode_id,stage,revision_number,task_id,artifact_id,context_snapshot) SELECT $1,$2,$3,1,$4,artifact_id,$5 FROM public.review_packages WHERE id=$6',[originalPackage,f.episode,stage,originalTask,{marker:'original '+stage+' review',input_snapshot:frozenInput},f.board]);
   await f.c.query("INSERT INTO public.approvals(episode_id,stage,decision,reason,actor_id,review_package_id) VALUES($1,$2,'changes_requested','Original historical revision feedback',$3,$4)",[f.episode,stage,f.owner,originalPackage]);
  }
  expect((await f.c.query("SELECT count(*)::int n,bool_and(NOT local_identity.current_worker_task(t)) denied FROM public.tasks t WHERE t.episode_id=$1 AND input_snapshot?'review_feedback'",[f.episode])).rows[0]).toEqual({n:2,denied:true});
  await f.c.query('COMMIT');
  const before=snapshot(f.database);expect(before.rows['public.shot_preparation_drafts'].rows).toBeGreaterThanOrEqual(2);expect(before.rows['public.audio_tracks'].rows).toBeGreaterThanOrEqual(1);
  const frozen=(await f.c.query('SELECT * FROM public.shot_preparation_drafts WHERE id=$1',[draft.id])).rows[0];expect(frozen.frozen_at).toBeTruthy();expect(frozen.confirmation_status).toBe('confirmed');expect(frozen.current_audio_track_id).toBe(track);expect(frozen.audio_mode).toBe('source');expect(frozen.current_tts_task_id).toBeNull();expect(frozen.preparation_input_fingerprint).toMatch(/^[a-f0-9]{32}$/);
  const dump=context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',f.database]);sql(dump);assertRestored(before,snapshot());
  expect(before.rows['public.prompt_versions'].rows).toBeGreaterThanOrEqual(3);
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
  const dropped=before.catalog.functions.filter((f:{schema:string;name:string})=>names.has(f.schema+'.'+f.name));expect(dropped).toHaveLength(3);
  expect(after.catalog).toEqual({...before.catalog,functions:before.catalog.functions.filter((f:{schema:string;name:string})=>!names.has(f.schema+'.'+f.name)),triggers:before.catalog.triggers.filter((t:{name:string})=>!removedTriggers.includes(t.name))});
  const acl=new Set(dropped.map((f:{schema:string;name:string;arguments:string})=>`${f.schema}.${f.name}(${f.arguments})`));expect(after.security).toEqual(before.security.filter((s:{identity:string})=>!acl.has(s.identity)));
  for(const [version,row]of Object.entries(before.ledger))expect(after.ledger[version]).toEqual(row);
  const ledger=Object.fromEntries(Object.entries(after.ledger).map(([k,v])=>[k,(v as {sha256:string}).sha256]));expect(ledger[cleanup.version]).toBe(cleanup.sha256);expect(Object.keys(after.ledger)).toHaveLength(Object.keys(before.ledger).length+1);expect(schemaMigrationPlan(ledger,catalog)).toEqual([]);
  for(const name of removed)expect(sql(`SELECT to_regprocedure('${name}') IS NULL`)).toBe('t');
  for(const actor of ['postgres','loop_app','loop_owner','loop_worker','loop_anonymous'])for(const name of removed)expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT ${name}`)).toThrow(/42883/);
  expect(sql("SELECT to_regprocedure('public.create_storyboard_review_package()') IS NOT NULL")).toBe('t');
  expect(()=>sql(`BEGIN;UPDATE public.episodes SET stage='qc_passed' WHERE id='${f.episode}';UPDATE public.shot_preparation_drafts SET subtitle_text='forbidden overwrite' WHERE id='${draft.id}';COMMIT;`)).toThrow(/Frozen shot drafts cannot be edited/);assertRestored(after,snapshot());
  expect(()=>sql("UPDATE public.prompt_versions SET instructions='forbidden replacement' WHERE id=(SELECT id FROM public.prompt_versions LIMIT 1)")).toThrow(/Prompt Harness content is immutable/);assertRestored(after,snapshot());
  expect(await readFile(historyFile)).toEqual(historyBytes);expect(sql(`SELECT result->>'marker' FROM local_identity.command_receipts WHERE idempotency_key='${receipt}'`)).toBe('retained original pending receipt');
  for(const [table,count]of [['history_sources',2],['history_versions',2],['history_files',2],['history_retained_files',1],['historical_episodes',1],['historical_tasks',1]]as const)expect(after.rows['local_identity.'+table].rows).toBe(count);
  for(const media of [f.files[0],f.files[1]])expect(createHash('sha256').update(await readFile(join(f.assetRoot,media.relativePath))).digest('hex')).toBe(media.sha256);
 }finally{try{await fixture?.close();for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}finally{await rm(root,{recursive:true,force:true});}}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('retained storyboard completion validates historical frozen inputs through a real saved Worker port and produces its original review without approving it',async()=>{
 const copied=process.env.LOOP_TEST_COMPAT_RELEASES_ROOT;if(!copied)throw Error('Explicit copied runtime packages required');
 const manifest=JSON.parse(await readFile(join(copied,'compatibility.json'),'utf8'));
 const release=manifest.releases[0],entry=release.workerFiles[0],modulePath=join(copied,release.id,entry.file);expect(createHash('sha256').update(await readFile(modulePath)).digest('hex')).toBe(entry.sha256);
 const old=await import(pathToFileURL(modulePath).href),f=await productionWorkspaceFixture(),worker=f.workerPool();try{
  const task=randomUUID(),lease=randomUUID(),path=`${f.episodeRelativePath}/native-tasks/${task}/legacy-storyboard.json`,script=(await f.c.query('SELECT storage_path,sha256,file_size FROM public.production_material_revisions WHERE id=$1',[f.script])).rows[0];
  const inputs=[{artifactType:'main_script',relativePath:script.storage_path,sha256:script.sha256,fileSize:Number(script.file_size)},{artifactType:'approved_visual',relativePath:f.files[0].relativePath,sha256:f.files[0].sha256,fileSize:f.files[0].fileSize}];
  const storyboard={version:'storyboard/v1',shots:[{id:'legacy-S01',scriptSegment:'原冻结脚本证据。',durationSeconds:2,shotType:'b_roll',productionMethod:'retained original input',targetSpec:'9:16',inputBasis:inputs.map(({relativePath,sha256})=>({relativePath,sha256}))}],audioCues:[]},bytes=Buffer.from(JSON.stringify(storyboard)),sha=createHash('sha256').update(bytes).digest('hex');
  await mkdir(dirname(join(f.assetRoot,path)),{recursive:true});await writeFile(join(f.assetRoot,path),bytes);
  await f.c.query('UPDATE local_identity.input_episodes SET enabled=true,storyboard_enabled=true WHERE episode_id=$1',[f.episode]);await f.c.query("UPDATE public.episodes SET stage='storyboard_draft' WHERE id=$1",[f.episode]);
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,attempt,max_attempts,claimed_at,lease_token,provider,model,prompt_version,input_snapshot) VALUES($1,$2,'draft_storyboard','running',1,1,clock_timestamp(),$3,'codex','historical','storyboard-planning-v1',$4)",[task,f.episode,lease,{capability:'storyboard_planning',native_episode_relative_path:f.episodeRelativePath,native_output_namespace:task,input_artifacts:inputs,output:{required_artifact_types:['storyboard'],relative_path:path,content_type:'application/json',review_stage:'storyboard_review'}}]);
  await f.c.query("INSERT INTO public.task_runs(task_id,attempt,status,task_package,started_at,lease_token) VALUES($1,0,'running',$2,clock_timestamp(),$3)",[task,{marker:'original historical task package',input_artifacts:inputs},lease]);
  expect((await f.c.query('SELECT local_identity.current_worker_task(t) allowed FROM public.tasks t WHERE id=$1',[task])).rows[0].allowed).toBe(false);
  await old.assertNativeWorkerDatabase(worker,f.database);const port=old.nativeWorkerPort(worker);
  const artifact={artifactType:'storyboard',relativePath:path,sha256:sha,fileSize:bytes.length},result={version:'worker-result/v1',taskId:task,status:'completed',storyboard,artifacts:[artifact],validation:{passed:true,checks:[{name:'historical_evidence',passed:true,detail:'Original frozen input and review evidence.'}]},actualCostCents:0,retry:{shouldRetry:false,reason:'Original result only.'},blockers:[],nextStep:'Retain original review.'};
  const report=(p_result:unknown,p_lease_token=lease)=>port.rpc('report_worker_result',{p_task_id:task,p_attempt:0,p_lease_token,p_result});
  await expect(report(result,randomUUID())).rejects.toMatchObject({code:'42501'});
  const bad={...result,storyboard:{...storyboard,shots:[{...storyboard.shots[0],inputBasis:[{relativePath:script.storage_path,sha256:'0'.repeat(64)},storyboard.shots[0].inputBasis[1]]}]}};
  await expect(report(bad)).rejects.toMatchObject({code:'22023'});
  expect((await f.c.query('SELECT status,(SELECT count(*)::int FROM public.artifacts WHERE producer_task_id=$1) artifacts FROM public.tasks WHERE id=$1',[task])).rows[0]).toEqual({status:'running',artifacts:0});
  await report(result);const review=(await f.c.query("SELECT p.*,e.stage current_stage FROM public.review_packages p JOIN public.episodes e ON e.id=p.episode_id WHERE p.task_id=$1",[task])).rows[0];
  expect(review).toBeTruthy();expect(review.current_stage).toBe('storyboard_review');expect(review.context_snapshot.worker_result).toEqual(result);expect((await f.c.query('SELECT count(*)::int n FROM public.approvals WHERE review_package_id=$1',[review.id])).rows[0].n).toBe(0);expect((await f.c.query('SELECT count(*)::int n FROM public.storyboard_review_shots WHERE review_package_id=$1',[review.id])).rows[0].n).toBe(1);
  expect(createHash('sha256').update(await readFile(join(f.assetRoot,path))).digest('hex')).toBe(sha);
 }finally{await worker.end();await f.close();}
},120000);


it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('current and all saved account creation commands own real directories and replay without obsolete prompt seeds; original prompt rows stay immutable',async()=>{
 const copied=process.env.LOOP_TEST_COMPAT_RELEASES_ROOT;if(!copied)throw Error('Explicit copied runtime packages required');
 const manifest=JSON.parse(await readFile(join(copied,'configurations.json'),'utf8')) as {releases:Array<{id:string;file:string;sha256:string}>};
 expect(manifest.releases).toHaveLength(23);
 const f=await productionWorkspaceFixture();try{
  const session={id:f.owner,email:f.email,token:f.token},account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  const original=(await f.c.query('SELECT * FROM public.prompt_versions ORDER BY id')).rows;
  const commands=[{id:'current',run:executeConfiguration}];
  for(const release of manifest.releases){const path=join(copied,release.id,release.file);expect(createHash('sha256').update(await readFile(path)).digest('hex')).toBe(release.sha256);commands.push({id:release.id,run:(await import(pathToFileURL(path).href)).executeConfiguration});}
  for(const [i,command]of commands.entries()){
   const body={command:'createAccount',data:{name:'无旧模板账号 '+i,slug:'no-legacy-prompt-'+i,timezone:'Asia/Shanghai',policy:{}},idempotencyKey:randomUUID()};
   const created=await command.run(f.pool,session,body,f.root);expect(created.id,command.id).toBeTruthy();expect(await command.run(f.pool,session,body,f.root)).toEqual(created);
   const directory=(await f.c.query('SELECT actual_root FROM local_identity.account_asset_directories WHERE account_id=$1',[created.id])).rows[0];expect(directory.actual_root).toContain(created.id);expect((await lstat(directory.actual_root)).isDirectory()).toBe(true);
   expect((await f.c.query('SELECT count(*)::int n FROM public.prompt_versions WHERE account_id=$1',[created.id])).rows[0].n,command.id).toBe(0);
   expect((await readLocalCatalog(f.pool,f.owner)).accounts.some(a=>a.id===created.id)).toBe(true);
   await expect(ownerTransaction(f.pool,f.other,false,c=>c.query('SELECT * FROM public.accounts WHERE id=$1',[created.id])).then(r=>r.rows)).resolves.toEqual([]);
  }
  expect((await f.c.query('SELECT * FROM public.prompt_versions ORDER BY id')).rows).toEqual(original);
  for(const capability of ['script_writing','visual_planning','storyboard_planning'])await expect(executeConfiguration(f.pool,session,{command:'createPromptVersion',idempotencyKey:randomUUID(),data:{accountId:account,capability,name:'forbidden legacy template',summary:'',instructions:'old flow'}},f.root)).rejects.toMatchObject({status:410});
  expect((await f.c.query('SELECT * FROM public.prompt_versions ORDER BY id')).rows).toEqual(original);
  await expect(ownerTransaction(f.pool,f.owner,false,c=>c.query("INSERT INTO public.approvals(episode_id,stage,decision,reason,actor_id,review_package_id) VALUES($1,'script_review','changes_requested','forbidden raw review',$2,$3)",[f.episode,f.owner,f.board]))).rejects.toMatchObject({code:'42501'});
 }finally{await f.close();}
},180000);
