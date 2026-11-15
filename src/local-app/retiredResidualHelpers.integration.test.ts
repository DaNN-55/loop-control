// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,realpath,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';

const removed=["local_identity.history_episode_delete_plan(text,text)","local_identity.history_episode_business_revision(text)","local_identity.lock_owned_account(uuid)","public.queue_frozen_shot_source_audio(uuid,boolean)"];

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('183 removes only four unused helpers after full history and frozen source-audio restore while preserving current locks and all guards',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Shot history acceptance requires an isolated cluster');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(f=>Number(f.version.slice(0,3))<=183)},previous={...catalog,current:catalog.current.filter(f=>Number(f.version.slice(0,3))<183)},cleanup=catalog.current.find(f=>f.version==='183-remove-unused-legacy-auxiliary-functions.sql')!;
 expect([...cleanup.body.matchAll(/^DROP FUNCTION ([^;]+);$/gm)].map(m=>m[1])).toEqual(removed);
 const names=new Set(removed.map(s=>s.slice(0,s.indexOf('(')))),suffix=randomBytes(6).toString('hex'),base='loop_shot_base_'+suffix,restored='loop_shot_restore_'+suffix,created:string[]=[];
 const root=await realpath(await mkdtemp('/private/tmp/loop-shot-history-'));
 const sql=(q:string,db=restored)=>context.sql('\\set VERBOSITY verbose\n'+q,db),snapshot=(db=restored)=>databaseSnapshot(context,db,process.cwd());
 let fixture:Awaited<ReturnType<typeof productionWorkspaceFixture>>|undefined;
 try{
  for(const db of [base,restored]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  sql(freshSchemaTransaction(previous),base);
  const oldContext=join(root,'context-182.mjs');
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
  await f.c.query('COMMIT');
  const before=snapshot(f.database);expect(before.rows['public.shot_preparation_drafts'].rows).toBeGreaterThanOrEqual(2);expect(before.rows['public.audio_tracks'].rows).toBeGreaterThanOrEqual(1);
  const frozen=(await f.c.query('SELECT * FROM public.shot_preparation_drafts WHERE id=$1',[draft.id])).rows[0];expect(frozen.frozen_at).toBeTruthy();expect(frozen.confirmation_status).toBe('confirmed');expect(frozen.current_audio_track_id).toBe(track);expect(frozen.audio_mode).toBe('source');expect(frozen.current_tts_task_id).toBeNull();expect(frozen.preparation_input_fingerprint).toMatch(/^[a-f0-9]{32}$/);
  const dump=context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',f.database]);sql(dump);assertRestored(before,snapshot());
  const calls=[`local_identity.history_episode_delete_plan('${f.episode}','invalid-session')`,`local_identity.history_episode_business_revision('${f.episode}')`,`local_identity.lock_owned_account(NULL::uuid)`,`public.queue_frozen_shot_source_audio('${draft.id}',false)`];
  for(const call of calls){
   for(const actor of ['loop_app','loop_owner','loop_worker','loop_anonymous'])expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT ${call}`)).toThrow(/42501/);
   sql('CREATE VIEW public.shot_dependency_probe AS SELECT ('+call+' IS NULL) value');
   expect(()=>sql(migrationTransaction([cleanup]))).toThrow(/2BP01/);sql('DROP VIEW public.shot_dependency_probe');assertRestored(before,snapshot());
  }
  expect(()=>sql(migrationTransaction([cleanup]).replace(/COMMIT;$/,'SELECT 1/0; COMMIT;'))).toThrow(/22012/);assertRestored(before,snapshot());
  sql(migrationTransaction([cleanup]));const after=snapshot();
  for(const key of ['rows','sequenceRows','roles'])expect(after[key]).toEqual(before[key]);
  const dropped=before.catalog.functions.filter((f:{schema:string;name:string})=>names.has(f.schema+'.'+f.name));expect(dropped).toHaveLength(4);
  expect(after.catalog).toEqual({...before.catalog,functions:before.catalog.functions.filter((f:{schema:string;name:string})=>!names.has(f.schema+'.'+f.name))});
  const acl=new Set(dropped.map((f:{schema:string;name:string;arguments:string})=>`${f.schema}.${f.name}(${f.arguments})`));expect(after.security).toEqual(before.security.filter((s:{identity:string})=>!acl.has(s.identity)));
  for(const [version,row]of Object.entries(before.ledger))expect(after.ledger[version]).toEqual(row);
  const ledger=Object.fromEntries(Object.entries(after.ledger).map(([k,v])=>[k,(v as {sha256:string}).sha256]));expect(ledger[cleanup.version]).toBe(cleanup.sha256);expect(Object.keys(after.ledger)).toHaveLength(Object.keys(before.ledger).length+1);expect(schemaMigrationPlan(ledger,catalog)).toEqual([]);
  for(const name of removed)expect(sql(`SELECT to_regprocedure('${name}') IS NULL`)).toBe('t');
  for(const actor of ['postgres','loop_app','loop_owner','loop_worker','loop_anonymous'])for(const call of calls)expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT ${call}`)).toThrow(actor==='loop_anonymous'&&call.startsWith('local_identity.')?/42501/:/42883/);
  expect(()=>sql(`BEGIN;UPDATE public.episodes SET stage='qc_passed' WHERE id='${f.episode}';UPDATE public.shot_preparation_drafts SET subtitle_text='forbidden overwrite' WHERE id='${draft.id}';COMMIT;`)).toThrow(/Frozen shot drafts cannot be edited/);assertRestored(after,snapshot());
  expect(await readFile(historyFile)).toEqual(historyBytes);expect(sql(`SELECT result->>'marker' FROM local_identity.command_receipts WHERE idempotency_key='${receipt}'`)).toBe('retained original pending receipt');
  for(const [table,count]of [['history_sources',2],['history_versions',2],['history_files',2],['history_retained_files',1],['historical_episodes',1],['historical_tasks',1]]as const)expect(after.rows['local_identity.'+table].rows).toBe(count);
  for(const media of [f.files[0],f.files[1]])expect(createHash('sha256').update(await readFile(join(f.assetRoot,media.relativePath))).digest('hex')).toBe(media.sha256);
 }finally{try{await fixture?.close();for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}finally{await rm(root,{recursive:true,force:true});}}
},120000);
