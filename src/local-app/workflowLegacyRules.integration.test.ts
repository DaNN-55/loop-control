// @vitest-environment node
// Real Owner HTTP, isolated PostgreSQL, immutable native files and local SDK only.
import {it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {reviewRenderFromSnapshot} from '../worker/codexRunner';
import {buildOpenChatCutProject} from '../worker/openchatcutProject';
import {defaultShotComposition} from '../shotComposition';
import {defaultShotCaptionContract,shotCaptionContractToDatabase} from '../shotCaptions';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
import {ownerTransaction} from './ownerTransaction';

const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

async function legacyFixture(){
 const volume=await workspaceAudioVolume();let f:Awaited<ReturnType<typeof embeddedStudioFixture>>|undefined;
 try{
  f=await embeddedStudioFixture({testRootParent:volume.mountPath,migrations:['db/local/158-workspace-unused-queued-tasks.sql','db/local/159-owned-studio-freeze-registration.sql'],runtime:{mountPath:volume.mountPath,postReady:async()=>{},localClipReady:async()=>{},mediaReady:async()=>{},wake(){}}});
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
  // The old editable shot record exists before a QC input revision is requested.
  await base.c.query("SELECT set_config('loop.owner_id',$1,true)",[base.owner]);
  await base.c.query('SET SESSION AUTHORIZATION loop_app');
  await base.c.query("SELECT public.save_shot_preparation_draft($1,$2,'shot-1','none','Original retained input',false,NULL,NULL,NULL)",[base.episode,base.board]);
  await base.c.query('SET SESSION AUTHORIZATION DEFAULT');
  await base.c.query('COMMIT');
  const original=async()=>({qc:(await base.c.query('SELECT context_snapshot FROM public.review_packages WHERE id=$1',[qc])).rows[0].context_snapshot,pre:(await base.c.query('SELECT context_snapshot FROM public.review_packages WHERE id=$1',[pre])).rows[0].context_snapshot,task:(await base.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[base.task])).rows[0].input_snapshot,files:await Promise.all([...base.files.map(f=>f.relativePath),base.boardPath,projectPath].map(async path=>({path,sha:sha(await readFile(join(base.assetRoot,path)))})))});
  return{...base,qc,pre,material,projectPath,original,close:async()=>{try{await base.close();}finally{await volume.close();}}};
 }catch(error){try{await f?.close();}finally{await volume.close();}throw error;}
}

it.skipIf(!enabled)('48 composition revision freezes the current QC edit, fences permission/stale/running requests and preserves prior evidence',async()=>{
 const f=await legacyFixture();try{
  const before=await f.original(),data={reviewPackageId:f.qc,reason:'Only revise native composition'};
  expect((await f.request('requestStudioCompositionRevision',data,{token:f.otherToken})).status).toBe(404);
  expect((await f.request('requestStudioCompositionRevision',data,{csrf:false})).status).toBe(403);
  expect((await f.request('requestStudioCompositionRevision',{...data,reviewPackageId:randomUUID()})).status).toBe(409);
  const running=randomUUID();await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_review_render','running','{}')",[running,f.episode]);
  const conflict=await f.request('requestStudioCompositionRevision',data);expect(conflict.status,JSON.stringify(conflict.body)).toBe(409);
  expect(await f.original()).toEqual(before);
  expect(await readdir(join(f.assetRoot,f.episodeRelativePath,'openchatcut-frozen')).catch(()=>[])).toEqual([]);
  expect((await f.c.query("SELECT has_table_privilege('loop_app','public.tasks','UPDATE') allowed")).rows[0].allowed).toBe(false);
  await f.c.query("UPDATE public.tasks SET status='failed',invalidated_at=now(),invalidated_reason='Controlled conflict finished' WHERE id=$1",[running]);
  const revised=await f.request('requestStudioCompositionRevision',data);expect(revised.status,JSON.stringify(revised.body)).toBe(200);
  expect(revised.body).toMatchObject({task_type:'generate_review_render',status:'ready'});
  const frozen=revised.body.input_snapshot.review_render.adjustments.studio_project;
  expect(frozen.relative_path).toContain('/openchatcut-frozen/');expect(sha(await readFile(join(f.assetRoot,frozen.relative_path)))).toBe(frozen.sha256);
  const register=(owner:string,basis:string,reference:unknown)=>ownerTransaction(f.pool,owner,false,c=>c.query('SELECT local_identity.register_owned_studio_freeze($1,$2,$3)',[f.episode,basis,reference]));
  await expect(register(f.other,f.qc,frozen)).rejects.toMatchObject({code:'42501'});
  await expect(register(f.owner,randomUUID(),frozen)).rejects.toMatchObject({code:'55000'});
  for(const reference of [{...frozen,relative_path:'../outside/openchatcut-frozen/'+randomUUID()+'/project.json'},{...frozen,sha256:'invalid'},{...frozen,file_size:0}])await expect(register(f.owner,f.qc,reference)).rejects.toMatchObject({code:'22023'});
  await expect(register(f.owner,f.qc,{...frozen,sha256:'0'.repeat(64)})).rejects.toMatchObject({code:'55000'});
  await register(f.owner,f.qc,frozen);
  expect((await f.c.query("SELECT producer_task_id FROM public.artifacts WHERE episode_id=$1 AND relative_path=$2 AND artifact_type='studio_frozen_project'",[f.episode,frozen.relative_path])).rows).toEqual([{producer_task_id:revised.body.id}]);
  expect((await f.c.query('SELECT count(*)::int n FROM public.review_render_composition_revisions WHERE pre_render_review_package_id=$1',[f.pre])).rows[0].n).toBe(1);
  expect((await f.c.query('SELECT stage FROM public.episodes WHERE id=$1',[f.episode])).rows[0].stage).toBe('render_ready');
  expect(await f.original()).toEqual(before);
  expect((await f.request('requestStudioCompositionRevision',data)).status).toBe(409);
 }finally{await f.close();}
},180000);

it.skipIf(!enabled)('48 storyboard return invalidates downstream packages while retaining the approved storyboard and immutable QC files',async()=>{
 const f=await legacyFixture();try{
  const before=await f.original(),data={reviewPackageId:f.qc,reason:'Return to approved storyboard structure'};
  expect((await f.request('requestStudioStoryboardRevision',{...data,reviewPackageId:randomUUID()})).status).toBe(409);
  const revised=await f.request('requestStudioStoryboardRevision',data);expect(revised.status,JSON.stringify(revised.body)).toBe(200);
  expect((await f.c.query('SELECT stage FROM public.episodes WHERE id=$1',[f.episode])).rows[0].stage).toBe('visual_approved');
  expect((await f.c.query('SELECT id,invalidated_at FROM public.review_packages WHERE id=ANY($1::uuid[])',[ [f.qc,f.pre] ])).rows.every(row=>row.invalidated_at)).toBe(true);
  expect((await f.c.query('SELECT invalidated_at FROM public.review_packages WHERE id=$1',[f.board])).rows[0].invalidated_at).toBeNull();
  expect(await f.original()).toEqual(before);
  expect((await f.request('requestStudioStoryboardRevision',data)).status).toBe(409);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('48 a running storyboard revision blocks a QC structural return before any downstream evidence changes',async()=>{
 const f=await legacyFixture();try{
  const before=await f.original();await f.c.query("INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot) VALUES($1,'draft_storyboard_revision','running','{}')",[f.episode]);
  const revised=await f.request('requestStudioStoryboardRevision',{reviewPackageId:f.qc,reason:'Conflicting current storyboard edit'});
  expect(revised.status,JSON.stringify(revised.body)).toBe(409);
  expect((await f.c.query('SELECT stage FROM public.episodes WHERE id=$1',[f.episode])).rows[0].stage).toBe('qc_review');
  expect(await f.original()).toEqual(before);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('48 per-shot input changes remain drafts until a new local preview is confirmed and a new review snapshot is frozen',async()=>{
 const f=await legacyFixture(),worker=f.workerPool();try{
  const before=await f.original(),data={reviewPackageId:f.board,shotId:'shot-1',materialRevisionId:f.material,clipSegments:[{start_seconds:0,end_seconds:1}],composition:defaultShotComposition('full',1),sourceVideoDurationSeconds:2,audioMode:'none',subtitleText:'Owner revised shot input',subtitlesEnabled:false,captionContract:shotCaptionContractToDatabase(defaultShotCaptionContract('Owner revised shot input','independent',false))};
  expect((await f.request('saveMediaDraft',{...data,reviewPackageId:randomUUID()})).status).toBe(409);
  expect((await f.request('saveMediaDraft',data,{token:f.otherToken})).status).toBe(404);
  expect((await f.request('saveMediaDraft',data,{csrf:false})).status).toBe(403);
  const saved=await f.request('saveMediaDraft',data);expect(saved.status,JSON.stringify(saved.body)).toBe(200);
  expect(saved.body.confirmation_status).toBe('pending');expect(await f.original()).toEqual(before);
  expect((await f.request('openStudio',{projectRelativePath:f.boardPath})).status).toBe(409);
  const queued=await f.request('generateSyncPreview',{reviewPackageId:f.board,shotId:'shot-1'});expect(queued.status,JSON.stringify(queued.body)).toBe(200);
  const claim=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:queued.body.id,p_worker_capacity:1}) as any[])[0];expect(claim?.task_id).toBe(queued.body.id);
  const result=await runWorkspaceDeliveryProcess(f,claim,{mountPath:dirname(f.root),media:{mode:'local'},shotPreview:true,visualCommand:[process.execPath,'--version']});expect(result.status,JSON.stringify((await f.c.query('SELECT last_result FROM public.tasks WHERE id=$1',[queued.body.id])).rows[0])).toBe('completed');
  const confirmed=await f.request('confirmSyncPreview',{reviewPackageId:f.board,shotId:'shot-1',deviationResolution:'none'});expect(confirmed.status,JSON.stringify(confirmed.body)).toBe(200);
  const opened=await f.request('openStudio',{projectRelativePath:f.boardPath});expect(opened.status,JSON.stringify(opened.body)).toBe(200);
  const reviewed=await f.request('generateReviewVideo',{reviewPackageId:f.board,sourceProjectRelativePath:f.boardPath,workspaceRelativePath:opened.body.workspace.relativePath});
  if(reviewed.status!==200){
   // Explain a fixture-only SQL precondition instead of hiding it behind HTTP's safe message.
   const prefix=f.episodeRelativePath+'/openchatcut-frozen',revision=(await readdir(join(f.assetRoot,prefix)))[0],path=prefix+'/'+revision+'/project.json',bytes=await readFile(join(f.assetRoot,path));let diagnostic='';
   await f.c.query('BEGIN');await f.c.query('SET SESSION AUTHORIZATION loop_app');await f.c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);
   try{await f.c.query('SELECT public.generate_shot_review_video($1,$2,$3,false,NULL)',[f.episode,f.board,{relative_path:path,sha256:sha(bytes),file_size:bytes.length}]);}catch(error){diagnostic=String(error);}finally{await f.c.query('ROLLBACK');await f.c.query('SET SESSION AUTHORIZATION DEFAULT');}
   throw Error(JSON.stringify(reviewed.body)+' '+diagnostic);
  }
  const snapshot=reviewed.body.input_snapshot.review_render;
  expect(snapshot.pre_render_review_package_id).not.toBe(f.pre);expect(snapshot.confirmed_shots[0]).toMatchObject({shot_id:'shot-1',audio_mode:'none',subtitles_enabled:false});
  expect(snapshot.members.find((member:any)=>member.member_key==='shot:shot-1').clip_segments).toEqual([{start_seconds:0,end_seconds:1}]);
  expect(await f.original()).toEqual(before);
  expect((await f.request('requestStudioCompositionRevision',{reviewPackageId:f.qc,reason:'The earlier QC cannot approve newer shot inputs'})).status).toBe(409);
 }finally{await worker.end();await f.close();}
},240000);
