// @vitest-environment node
// Real Owner HTTP, isolated PostgreSQL, immutable native files and local SDK only.
import {it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {reviewRenderFromSnapshot} from '../worker/history/reviewRenderV1';
import {buildOpenChatCutProject} from '../worker/openchatcutProject';
import {defaultShotComposition} from '../shotComposition';
import {defaultShotCaptionContract,shotCaptionContractToDatabase} from '../shotCaptions';
import {nativeWorkerPort} from './workerDatabase';
import {ownerTransaction} from './ownerTransaction';

const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

async function legacyFixture(){
 const volume=await workspaceAudioVolume();let f:Awaited<ReturnType<typeof embeddedStudioFixture>>|undefined;
 try{
  f=await embeddedStudioFixture({testRootParent:volume.mountPath,migrations:['db/archive/legacy-v1/158-workspace-unused-queued-tasks.sql','db/archive/legacy-v1/159-owned-studio-freeze-registration.sql'],runtime:{mountPath:volume.mountPath,postReady:async()=>{},mediaReady:async()=>{},wake(){}}});
  const base=f,pre=randomUUID(),material=randomUUID();
  const qc=(await base.c.query("SELECT id FROM public.review_packages WHERE episode_id=$1 AND stage='qc_review'",[base.episode])).rows[0].id;
  const snapshot=(await base.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[base.task])).rows[0].input_snapshot;
  const projectPath=`${base.episodeRelativePath}/review-render/legacy/project.json`;
  snapshot.review_render.pre_render_review_package_id=pre;snapshot.review_render.project_relative_path=projectPath;
  const render=reviewRenderFromSnapshot(snapshot)!;
  const native=Buffer.from(JSON.stringify(buildOpenChatCutProject(render,`production-${base.episode}`),null,2)+'\n');
  await mkdir(dirname(join(base.assetRoot,projectPath)),{recursive:true});await writeFile(join(base.assetRoot,projectPath),native);
  await base.c.query('BEGIN');
  await base.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,1) ON CONFLICT(singleton) DO NOTHING');
  await base.c.query('UPDATE local_identity.input_episodes SET enabled=true WHERE episode_id=$1',[base.episode]);
  await base.c.query('UPDATE public.tasks SET input_snapshot=$2 WHERE id=$1',[base.task,snapshot]);
  await base.c.query("INSERT INTO public.artifacts(episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,'review_render_project',$3,$4,$5)",[base.episode,base.task,projectPath,sha(native),native.length]);
  const context={storyboard_review_package_id:base.board,confirmation_mode:snapshot.review_render.confirmation_mode,confirmed_shots:snapshot.review_render.confirmed_shots,storyboard:snapshot.review_render.storyboard};
  await base.c.query("INSERT INTO public.review_packages(id,episode_id,stage,revision_number,context_snapshot) VALUES($1,$2,'production_ready',1,$3)",[pre,base.episode,context]);
  await base.c.query("UPDATE public.review_packages SET context_snapshot=$2 WHERE id=$1",[qc,{review_kind:'openchatcut_review_render',pre_render_review_package_id:pre,project_relative_path:projectPath}]);
  await base.c.query("INSERT INTO public.approvals(episode_id,review_package_id,stage,decision,reason,actor_id) VALUES($1,$2,'storyboard_approved','approved','Immutable legacy fixture',$3)",[base.episode,base.board,base.owner]);
  for(const member of snapshot.review_render.members){
   const file=base.files.find(file=>file.relativePath===member.relative_path)!;
   let artifact=(await base.c.query('SELECT * FROM public.artifacts WHERE episode_id=$1 AND relative_path=$2',[base.episode,file.relativePath])).rows[0];
   if(!artifact)artifact=(await base.c.query('INSERT INTO public.artifacts(episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[base.episode,base.task,file.artifactType,file.relativePath,file.sha256,file.fileSize])).rows[0];
   const evidence={...member,artifact:{artifact_type:artifact.artifact_type,relative_path:file.relativePath,sha256:file.sha256,file_size:file.fileSize}};
   await base.c.query('INSERT INTO public.pre_render_review_members(review_package_id,member_key,member_kind,source_task_id,artifact_id,evidence_snapshot) VALUES($1,$2,$3,$4,$5,$6)',[pre,member.member_key,member.member_kind,base.task,artifact.id,evidence]);
   await base.c.query("INSERT INTO public.pre_render_review_member_decisions(review_package_id,member_key,decision,reason,actor_id) VALUES($1,$2,'approved','Frozen approved input',$3)",[pre,member.member_key,base.owner]);
  }
  const video=base.files.find(file=>file.relativePath===base.videoPath)!;
  await base.c.query("INSERT INTO public.production_material_revisions(id,episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,is_main_script,created_by,material_purpose) VALUES($1,$2,1,'video','file',$3,$3,'video/mp4',$4,$5,false,$6,'a_roll')",[material,base.episode,video.relativePath,video.sha256,video.fileSize,base.owner]);
  await base.c.query('INSERT INTO public.material_revision_approvals(material_revision_id,approved_by) VALUES($1,$2)',[material,base.owner]);
  // Admin-only fixture seeding records the pre-retirement editable shot.
  await base.c.query("SELECT set_config('loop.owner_id',$1,true)",[base.owner]);
  await base.c.query("INSERT INTO public.shot_preparation_drafts(episode_id,review_package_id,shot_id,audio_mode,subtitle_text,subtitles_enabled,tts_text,tts_language_code,audio_status) VALUES($1,$2,'shot-1','none','Original retained input',false,'Original retained input','zh-CN','ready')",[base.episode,base.board]);
  await base.c.query('COMMIT');
  const original=async()=>({qc:(await base.c.query('SELECT context_snapshot FROM public.review_packages WHERE id=$1',[qc])).rows[0].context_snapshot,pre:(await base.c.query('SELECT context_snapshot FROM public.review_packages WHERE id=$1',[pre])).rows[0].context_snapshot,task:(await base.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[base.task])).rows[0].input_snapshot,files:await Promise.all([...base.files.map(f=>f.relativePath),base.boardPath,projectPath].map(async path=>({path,sha:sha(await readFile(join(base.assetRoot,path)))})))});
  const state=async()=>(await base.c.query("SELECT jsonb_build_object('episode',(SELECT to_jsonb(e) FROM public.episodes e WHERE id=$1),'packages',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.review_packages p WHERE episode_id=$1),'tasks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tasks t WHERE episode_id=$1),'drafts',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.shot_preparation_drafts d WHERE episode_id=$1),'artifacts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.artifacts a WHERE episode_id=$1),'approvals',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.approvals a WHERE episode_id=$1),'transitions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.state_transitions t WHERE episode_id=$1),'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.audit_events a WHERE episode_id=$1),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY idempotency_key) FROM local_identity.command_receipts r WHERE owner_id=$2)) value",[base.episode,base.owner])).rows[0].value;
  return{...base,qc,pre,material,projectPath,original,state,close:async()=>{try{await base.close();}finally{await volume.close();}}};
 }catch(error){try{await f?.close();}finally{await volume.close();}throw error;}
}

it.skipIf(!enabled)('retired composition revisions cannot freeze a QC edit or change its historical evidence',async()=>{
 const f=await legacyFixture();try{
  const before=await f.original(),data={reviewPackageId:f.qc,reason:'Only revise native composition'};
  const originalState=await f.state();
  expect((await f.request('requestStudioCompositionRevision',data,{token:f.otherToken})).status).toBe(404);
  expect((await f.request('requestStudioCompositionRevision',data,{csrf:false})).status).toBe(403);
  expect((await f.request('requestStudioCompositionRevision',{...data,reviewPackageId:randomUUID()})).status).toBe(410);
  expect((await f.request('requestStudioCompositionRevision',data)).status).toBe(410);
  expect(await f.state()).toEqual(originalState);
  const running=randomUUID();await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_review_render','running','{}')",[running,f.episode]);
  const protectedState=await f.state();
  expect((await f.request('requestStudioCompositionRevision',data)).status).toBe(410);
  expect(await f.state()).toEqual(protectedState);
  expect(await f.original()).toEqual(before);
  expect(await readdir(join(f.assetRoot,f.episodeRelativePath,'openchatcut-frozen')).catch(()=>[])).toEqual([]);
  expect((await f.c.query("SELECT has_table_privilege('loop_app','public.tasks','UPDATE') allowed")).rows[0].allowed).toBe(false);
  const register=(owner:string,basis:string,reference:unknown)=>ownerTransaction(f.pool,owner,false,c=>c.query('SELECT local_identity.register_owned_studio_freeze($1,$2,$3)',[f.episode,basis,reference]));
  const frozen={relative_path:f.projectPath,sha256:sha(await readFile(join(f.assetRoot,f.projectPath))),file_size:(await readFile(join(f.assetRoot,f.projectPath))).length};
  expect((await f.c.query("SELECT to_regprocedure('local_identity.register_owned_studio_freeze(uuid,uuid,jsonb)') IS NULL absent")).rows[0].absent).toBe(true);
  await expect(register(f.other,f.qc,frozen)).rejects.toMatchObject({code:'42883'});
  await expect(register(f.owner,f.qc,frozen)).rejects.toMatchObject({code:'42883'});
  expect((await f.c.query("SELECT count(*)::int n FROM public.artifacts WHERE episode_id=$1 AND artifact_type='studio_frozen_project'",[f.episode])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT count(*)::int n FROM public.review_render_composition_revisions WHERE pre_render_review_package_id=$1',[f.pre])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT stage FROM public.episodes WHERE id=$1',[f.episode])).rows[0].stage).toBe('qc_review');
  expect(await f.state()).toEqual(protectedState);expect(await f.original()).toEqual(before);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('retired Studio structural return preserves all packages, stage and immutable QC files behind Owner and CSRF checks',async()=>{
 const f=await legacyFixture();try{
  const before=await f.original(),data={reviewPackageId:f.qc,reason:'Return to approved storyboard structure'};
  const state=async()=>(await f.c.query("SELECT jsonb_build_object('episode',(SELECT to_jsonb(e) FROM public.episodes e WHERE id=$1),'packages',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.review_packages p WHERE episode_id=$1),'tasks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tasks t WHERE episode_id=$1),'transitions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.state_transitions t WHERE episode_id=$1),'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.audit_events a WHERE episode_id=$1)) value",[f.episode])).rows[0].value;
  const originalState=await state();
  expect((await f.request('requestStudioStoryboardRevision',data,{token:f.otherToken})).status).toBe(404);
  expect((await f.request('requestStudioStoryboardRevision',data,{csrf:false})).status).toBe(403);
  expect((await f.request('requestStudioStoryboardRevision',{...data,reviewPackageId:randomUUID()})).status).toBe(410);
  const revised=await f.request('requestStudioStoryboardRevision',data);expect(revised.status,JSON.stringify(revised.body)).toBe(410);
  expect(await state()).toEqual(originalState);
  expect(await f.original()).toEqual(before);
  expect((await f.request('requestStudioStoryboardRevision',data)).status).toBe(410);expect(await state()).toEqual(originalState);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('a running historical storyboard revision cannot reactivate the retired Studio structural return',async()=>{
 const f=await legacyFixture();try{
  const before=await f.original();await f.c.query("INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot) VALUES($1,'draft_storyboard_revision','running','{}')",[f.episode]);
  const revised=await f.request('requestStudioStoryboardRevision',{reviewPackageId:f.qc,reason:'Conflicting current storyboard edit'});
  expect(revised.status,JSON.stringify(revised.body)).toBe(410);
  expect((await f.c.query('SELECT stage FROM public.episodes WHERE id=$1',[f.episode])).rows[0].stage).toBe('qc_review');
  expect(await f.original()).toEqual(before);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('retired per-shot editing, preview and review commands preserve original drafts and cannot queue work',async()=>{
 const f=await legacyFixture(),worker=f.workerPool();try{
  const before=await f.original(),data={reviewPackageId:f.board,shotId:'shot-1',materialRevisionId:f.material,clipSegments:[{start_seconds:0,end_seconds:1}],composition:defaultShotComposition('full',1),sourceVideoDurationSeconds:2,audioMode:'none',subtitleText:'Owner revised shot input',subtitlesEnabled:false,captionContract:shotCaptionContractToDatabase(defaultShotCaptionContract('Owner revised shot input','independent',false))};
  const state=await f.state();
  expect((await f.request('saveMediaDraft',{...data,reviewPackageId:randomUUID()})).status).toBe(410);
  expect((await f.request('saveMediaDraft',data,{token:f.otherToken})).status).toBe(404);
  expect((await f.request('saveMediaDraft',data,{csrf:false})).status).toBe(403);
  for(const [command,input]of [
   ['saveMediaDraft',data],['planMedia',{reviewPackageId:f.board}],['generateClip',{reviewPackageId:f.board,shotId:'shot-1'}],
   ['openStudio',{projectRelativePath:f.boardPath}],['generateSyncPreview',{reviewPackageId:f.board,shotId:'shot-1'}],
   ['confirmSyncPreview',{reviewPackageId:f.board,shotId:'shot-1',deviationResolution:'none'}],
   ['generateReviewVideo',{reviewPackageId:f.board,sourceProjectRelativePath:f.boardPath,workspaceRelativePath:f.projectPath}],
   ['requestStudioCompositionRevision',{reviewPackageId:f.qc,reason:'Earlier QC cannot approve new inputs'}],
  ]as const){const result=await f.request(command,input);expect(result.status,command+': '+JSON.stringify(result.body)).toBe(410);expect(await f.state()).toEqual(state);}
  expect(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_worker_capacity:1})).toEqual([]);
  expect(await f.state()).toEqual(state);expect(await f.original()).toEqual(before);
 }finally{await worker.end();await f.close();}
},120000);
