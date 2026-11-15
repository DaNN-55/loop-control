// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,realpath,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {loadSchemaCatalog,freshSchemaTransaction,migrationTransaction,schemaMigrationPlan} from './schemaMigrations';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';

const removed=['public.confirm_shot_preparation(uuid,uuid,text,text,boolean)','public.freeze_shot_preparation_batch(uuid,uuid)','public.replace_manual_shot_media(uuid,uuid,text,uuid,text)','public.save_shot_clip_draft(uuid,uuid,text,uuid,numeric,numeric)','public.set_shot_tts_confirmation(uuid,uuid,text,boolean)','public.skip_shot_preparation(uuid,uuid,text,text)','public.restore_completed_shot_tts_track(uuid,uuid)'];

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('179 removes only unused shot entries after full restore of real historical drafts, audio and frozen evidence while retaining freeze protection',async()=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Shot history acceptance requires an isolated cluster');
 const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs'));
 const all=loadSchemaCatalog(process.cwd()),catalog={...all,current:all.current.filter(f=>Number(f.version.slice(0,3))<=179)},previous={...catalog,current:catalog.current.filter(f=>Number(f.version.slice(0,3))<179)},cleanup=catalog.current.find(f=>f.version==='179-remove-unused-shot-preparation-entries.sql')!;
 expect([...cleanup.body.matchAll(/^DROP FUNCTION ([^;]+);$/gm)].map(m=>m[1])).toEqual(removed);
 const names=new Set(removed.map(s=>s.slice(0,s.indexOf('(')))),suffix=randomBytes(6).toString('hex'),base='loop_shot_base_'+suffix,restored='loop_shot_restore_'+suffix,created:string[]=[];
 const root=await realpath(await mkdtemp('/private/tmp/loop-shot-history-'));
 const sql=(q:string,db=restored)=>context.sql('\\set VERBOSITY verbose\n'+q,db),snapshot=(db=restored)=>databaseSnapshot(context,db,process.cwd());
 let fixture:Awaited<ReturnType<typeof productionWorkspaceFixture>>|undefined;
 try{
  for(const db of [base,restored]){context.sql('CREATE DATABASE '+db+' TEMPLATE template0','postgres');created.push(db);}
  sql(freshSchemaTransaction(previous),base);
  const oldContext=join(root,'context-178.mjs');
  await writeFile(oldContext,`import {runtimeContext as original} from ${JSON.stringify(process.env.LOOP_TEST_CONTEXT_MODULE)};export function runtimeContext(){const c=original();return {...c,database:${JSON.stringify(base)},sql:(q,db=${JSON.stringify(base)})=>c.sql(q,db)};}`,{mode:0o600});
  const f=fixture=await productionWorkspaceFixture({testContextModule:oldContext});
  const tts=randomUUID(),voiceArtifact=randomUUID(),track=randomUUID(),text='已确认的第一镜。',voicePath=f.episodeRelativePath+'/voice.mp3';
  await f.c.query('BEGIN');
  await f.c.query("INSERT INTO public.approvals(episode_id,stage,decision,reason,actor_id,review_package_id) VALUES($1,'storyboard_approved','approved','Retained historical approval',$2,$3)",[f.episode,f.owner,f.board]);
  const draft=(await f.c.query("SELECT id FROM public.shot_preparation_drafts WHERE episode_id=$1 AND review_package_id=$2 AND shot_id='shot-1'",[f.episode,f.board])).rows[0];expect(draft?.id).toBeTruthy();
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,provider,model,prompt_version,input_snapshot) VALUES($1,$2,'generate_narration','completed','volcengine_tts','seed-tts-2.0','legacy-frozen-v1',$3)",[tts,f.episode,{capability:'narration_generation',shot_preparation:{draft_id:draft.id,shot_id:'shot-1'},media:{narration:{text}}}]);
  await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'audio',$4,$5,$6)",[voiceArtifact,f.episode,tts,voicePath,f.files[1].sha256,f.files[1].fileSize]);
  await f.c.query("INSERT INTO public.audio_tracks(id,episode_id,source_task_id,source_artifact_id,source_review_package_id,track_kind,cue_id,relative_path,sha256,file_size,duration_seconds) VALUES($1,$2,$3,$4,$5,'narration','shot-1',$6,$7,$8,2)",[track,f.episode,tts,voiceArtifact,f.board,voicePath,f.files[1].sha256,f.files[1].fileSize]);
  await f.c.query("UPDATE public.shot_preparation_drafts SET audio_mode='tts',subtitle_text=$2,tts_text=$2,tts_voice='retained-historical-voice',tts_speaking_rate=1,selected_material_revision_id=$3,clip_start_seconds=0,clip_end_seconds=2,clip_segments='[{\"start_seconds\":0,\"end_seconds\":2}]',video_status='ready',audio_status='ready',video_duration_seconds=2,current_video_task_id=$4,current_video_artifact_id=(SELECT id FROM public.artifacts WHERE episode_id=$5 AND relative_path=$6 LIMIT 1),current_audio_track_id=$7,current_tts_task_id=$8,tts_actual_duration_seconds=2 WHERE id=$1",[draft.id,text,f.material,f.task,f.episode,f.videoPath,track,tts]);
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='confirmed',confirmation_reason='Original frozen evidence',confirmed_at='2026-10-01T01:02:03.123456Z',confirmed_by=$2,frozen_at='2026-10-01T01:02:03.123456Z',frozen_by=$2 WHERE id=$1",[draft.id,f.owner]);
  await f.c.query('COMMIT');
  const before=snapshot(f.database);expect(before.rows['public.shot_preparation_drafts'].rows).toBeGreaterThanOrEqual(2);expect(before.rows['public.audio_tracks'].rows).toBeGreaterThanOrEqual(1);
  const frozen=(await f.c.query('SELECT * FROM public.shot_preparation_drafts WHERE id=$1',[draft.id])).rows[0];expect(frozen.frozen_at).toBeTruthy();expect(frozen.confirmation_status).toBe('confirmed');expect(frozen.current_audio_track_id).toBe(track);expect(frozen.preparation_input_fingerprint).toMatch(/^[a-f0-9]{32}$/);
  const dump=context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',f.database]);sql(dump);assertRestored(before,snapshot());
  const calls=[`public.confirm_shot_preparation('${f.episode}','${f.board}','shot-1','old',false)`,`public.freeze_shot_preparation_batch('${f.episode}','${f.board}')`,`public.replace_manual_shot_media('${f.episode}','${f.material}','shot-1','${f.board}','b_roll')`,`public.save_shot_clip_draft('${f.episode}','${f.board}','shot-1','${f.material}',0,2)`,`public.set_shot_tts_confirmation('${f.episode}','${f.board}','shot-1',true)`,`public.skip_shot_preparation('${f.episode}','${f.board}','shot-1','old')`,`public.restore_completed_shot_tts_track('${draft.id}','${tts}')`];
  for(const call of calls){
   for(const actor of ['loop_app','loop_owner','loop_worker','loop_anonymous'])expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT ${call}`)).toThrow(/42501/);
   sql('CREATE VIEW public.shot_dependency_probe AS SELECT ('+call+' IS NULL) value');
   expect(()=>sql(migrationTransaction([cleanup]))).toThrow(/2BP01/);sql('DROP VIEW public.shot_dependency_probe');assertRestored(before,snapshot());
  }
  expect(()=>sql(migrationTransaction([cleanup]).replace(/COMMIT;$/,'SELECT 1/0; COMMIT;'))).toThrow(/22012/);assertRestored(before,snapshot());
  sql(migrationTransaction([cleanup]));const after=snapshot();
  for(const key of ['rows','sequenceRows','roles'])expect(after[key]).toEqual(before[key]);
  const dropped=before.catalog.functions.filter((f:{schema:string;name:string})=>names.has(f.schema+'.'+f.name));expect(dropped).toHaveLength(7);
  expect(after.catalog).toEqual({...before.catalog,functions:before.catalog.functions.filter((f:{schema:string;name:string})=>!names.has(f.schema+'.'+f.name))});
  const acl=new Set(dropped.map((f:{schema:string;name:string;arguments:string})=>`${f.schema}.${f.name}(${f.arguments})`));expect(after.security).toEqual(before.security.filter((s:{identity:string})=>!acl.has(s.identity)));
  for(const [version,row]of Object.entries(before.ledger))expect(after.ledger[version]).toEqual(row);
  const ledger=Object.fromEntries(Object.entries(after.ledger).map(([k,v])=>[k,(v as {sha256:string}).sha256]));expect(ledger[cleanup.version]).toBe(cleanup.sha256);expect(Object.keys(after.ledger)).toHaveLength(Object.keys(before.ledger).length+1);expect(schemaMigrationPlan(ledger,catalog)).toEqual([]);
  for(const name of removed)expect(sql(`SELECT to_regprocedure('${name}') IS NULL`)).toBe('t');
  for(const actor of ['postgres','loop_app','loop_owner','loop_worker','loop_anonymous'])for(const call of calls)expect(()=>sql(`SET SESSION AUTHORIZATION ${actor}; SELECT ${call}`)).toThrow(/42883/);
  expect(()=>sql(`BEGIN;UPDATE public.episodes SET stage='qc_passed' WHERE id='${f.episode}';UPDATE public.shot_preparation_drafts SET subtitle_text='forbidden overwrite' WHERE id='${draft.id}';COMMIT;`)).toThrow(/Frozen shot drafts cannot be edited/);assertRestored(after,snapshot());
  for(const media of [f.files[0],f.files[1]])expect(createHash('sha256').update(await readFile(join(f.assetRoot,media.relativePath))).digest('hex')).toBe(media.sha256);
 }finally{try{await fixture?.close();for(const db of created.reverse())context.sql('DROP DATABASE '+db+' WITH (FORCE)','postgres');}finally{await rm(root,{recursive:true,force:true});}}
},120000);
