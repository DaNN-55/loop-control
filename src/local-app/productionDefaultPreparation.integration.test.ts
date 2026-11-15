// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID,randomBytes} from 'node:crypto';
import {ownerTransaction} from './ownerTransaction';
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {workspaceImageGenerationFixture} from './workspaceImageGeneration.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {formalWorkflowFixture} from './formalWorkflow.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('new production prepares directly from an independent baseline without old packages, classifications, approvals or drafts and survives reopen',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:'# 当前制作\n\n## 正文\n\n新镜头直接保存独立基准。\n\n第二镜头不建立旧审核记录。'});
 try{
  expect((await f.send('start')).status).toBe(200);const prepared=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);const w=prepared.body;
  for(const table of ['review_packages','shot_preparation_drafts','approvals'])expect((await f.c.query(`SELECT count(*)::int n FROM public.${table} WHERE episode_id=$1`,[f.newEpisode])).rows[0].n,table).toBe(0);
  expect(w.preparationRevisionId).toMatch(/^[a-f0-9-]{36}$/);expect(w.storyboardPackageId).toBeNull();
  const basis=(await f.c.query('SELECT source_format,source_reference_id,manifest,file_reference FROM local_identity.production_preparation_revisions WHERE episode_id=$1 AND id=$2',[f.newEpisode,w.preparationRevisionId])).rows[0];
  expect(basis.source_format).toBe('production-preparation/v1');expect(basis.source_reference_id).toBeNull();expect(basis.manifest.version).toBe('production-preparation/v1');expect(basis.manifest.shots).toHaveLength(2);for(const shot of basis.manifest.shots)expect(shot).not.toHaveProperty('shotType');
  expect(JSON.parse((await readFile(join(f.assetRoot,basis.file_reference.relativePath))).toString())).toEqual(basis.manifest);expect(w.clips).toHaveLength(2);expect(w.stale).toBe(false);
  const replay=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(replay.status).toBe(200);expect(replay.body.id).toBe(w.id);expect(replay.body.project.sha256).toBe(w.project.sha256);expect(replay.body.preparationRevisionId).toBe(w.preparationRevisionId);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_preparation_revisions WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(1);
  await f.restart();const response=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const reopened=(await response.json()).workspace;expect(reopened.preparationRevisionId).toBe(w.preparationRevisionId);expect(reopened.clips).toEqual(w.clips);expect(reopened.project.sha256).toBe(w.project.sha256);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('format-only continuation keeps an independent baseline, exact project and all input versions without creating a legacy child package',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:'# 排版接续\n\n## 正文\n\n当前原文保持。'});
 try{
  expect((await f.send('start')).status).toBe(200);const made=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(made.status).toBe(200);const w=made.body;
  const revision=await f.send('reconfirmScript',{expectedScriptRevisionId:f.main,text:'# 排版接续\n## 正文\n> 当前原文保持。',reason:'仅调整格式，保留工程'});expect(revision.status,JSON.stringify(revision.body)).toBe(200);
  const args={workspaceId:w.id,expectedRevision:w.revision,expectedScriptRevisionId:revision.body.id,expectedProjectSha256:w.project.sha256};
  expect((await f.send('resumeWorkspaceEditing',{...args,expectedProjectSha256:'0'.repeat(64)})).status).toBe(409);
  const original=(await f.c.query('SELECT manifest,file_reference FROM local_identity.production_preparation_revisions WHERE id=$1',[w.preparationRevisionId])).rows[0];
  const reuse=(owner:string)=>ownerTransaction(f.pool,owner,false,c=>c.query('SELECT local_identity.resume_production_formatting_revision($1,$2,$3,$4,$5,$6,$7)',[w.id,w.revision,revision.body.id,w.project.sha256,w.preparationRevisionId,original.file_reference,original.manifest]));
  await expect(reuse(f.other)).rejects.toMatchObject({code:'42501'});await expect(reuse(f.owner)).rejects.toMatchObject({code:'40001'});
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_preparation_revisions WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(1);
  const resumed=await f.send('resumeWorkspaceEditing',args);expect(resumed.status,JSON.stringify(resumed.body)).toBe(200);const next=resumed.body;
  expect(next.project).toEqual(w.project);expect(next.clips).toEqual(w.clips);expect(next.scriptRevisionId).toBe(revision.body.id);expect(next.preparationRevisionId).not.toBe(w.preparationRevisionId);expect(next.storyboardPackageId).toBeNull();expect(next.stale).toBe(false);
  expect((await f.c.query('SELECT parent_preparation_revision_id FROM local_identity.production_preparation_revisions WHERE id=$1',[next.preparationRevisionId])).rows[0].parent_preparation_revision_id).toBe(w.preparationRevisionId);
  await expect(f.c.query('UPDATE local_identity.production_workspaces SET preparation_revision_id=$2 WHERE id=$1',[w.id,w.preparationRevisionId])).rejects.toMatchObject({code:'23503'});expect((await f.c.query('SELECT preparation_revision_id FROM local_identity.production_workspaces WHERE id=$1',[w.id])).rows[0].preparation_revision_id).toBe(next.preparationRevisionId);
  for(const table of ['review_packages','shot_preparation_drafts','approvals'])expect((await f.c.query(`SELECT count(*)::int n FROM public.${table} WHERE episode_id=$1`,[f.newEpisode])).rows[0].n,table).toBe(0);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_workspace_versions WHERE workspace_id=$1',[w.id])).rows[0].n).toBeGreaterThan(1);
 }finally{await f.close();}
},120000);


it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a fresh independent order queues and executes an image from its own frozen baseline without consulting any review package',async()=>{
 const f=await formalWorkflowFixture({controlled:true,freshAccount:true,scriptText:'# 独立图片\n\n## 正文\n\n当前图片由当前基准生成。\n\n另一个真实镜头不能冒充当前镜头。'});
 try{
  await workspaceImageGenerationFixture([],undefined,f.controlled!);
  expect((await f.send('start')).status).toBe(200);const made=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(made.status,JSON.stringify(made.body)).toBe(200);let w=made.body;
  const ref=await f.send('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'reference.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(ref.status).toBe(200);
  const version=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='openai_images'")).rows[0].id;
  const args={workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection:{capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:version},prompt:'保留参考图主体。',imageBrief:{references:[{materialRevisionId:ref.body.id,purpose:'subject',preserve:'产品图案',change:'背景'}],framing:'full',captionSpace:'bottom',crop:'protect'},settings:{size:'1152x2048',quality:'high',count:1},referenceMaterialRevisionIds:[ref.body.id],reservationCents:100};
  const queued=await f.send('requestWorkspaceImageCandidates',args);expect(queued.status,JSON.stringify(queued.body)).toBe(200);w=queued.body;const id=w.visualTasks.find((v:any)=>v.kind==='image').taskId;
  const snapshot=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[id])).rows[0].input_snapshot;
  expect(snapshot.production_preparation).toMatchObject({version:'production-preparation-ref/v1',workspace_id:w.id,preparation_revision_id:w.preparationRevisionId,script_revision_id:f.main});expect(snapshot).not.toHaveProperty('storyboard_review_package_id');
  const current=async()=>(await f.c.query("SELECT local_identity.provider_dispatch_context_current($1,'image') valid",[id])).rows[0].valid;expect(await current()).toBe(true);
  for(const patch of [{version:'production-preparation-ref/future'},{preparation_revision_id:randomUUID()},{script_revision_id:randomUUID()},{workspace_id:randomUUID()},{shot_id:'another-shot'},{shot_id:w.clips[1].shotId}]){
   await f.c.query('BEGIN');try{await f.c.query("UPDATE public.tasks SET input_snapshot=jsonb_set(input_snapshot,'{production_preparation}',(input_snapshot->'production_preparation')||$2::jsonb) WHERE id=$1",[id,JSON.stringify(patch)]);expect(await current()).toBe(false);}finally{await f.c.query('ROLLBACK');}
  }
  await f.c.query('BEGIN');try{await f.c.query("UPDATE public.tasks SET input_snapshot=input_snapshot#-'{production_preparation,shot_id}' WHERE id=$1",[id]);expect(await current()).toBe(false);}finally{await f.c.query('ROLLBACK');}
  expect(await current()).toBe(true);

  await f.controlled!.execute(id);const result=(await f.c.query('SELECT status FROM public.tasks WHERE id=$1',[id])).rows[0];expect(result.status).toBe('completed');
  expect((await f.c.query('SELECT count(*)::int n FROM public.review_packages WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT count(*)::int n FROM public.paid_generation_reservations WHERE task_id=$1',[id])).rows[0].n).toBe(1);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('independent source extraction and sound search register preparation-bound audio while retired review evidence remains untouched',async()=>{
 const {workspaceAudioFixture}=await import('./workspaceAudio.fixture');const f=await workspaceAudioFixture({skipWorkspace:true});
 try{
  await f.c.query("UPDATE public.review_packages SET invalidated_at=clock_timestamp(),invalidated_reason='Original historical source retained' WHERE id=$1",[f.board]);
  const text='# 当前声音\n\n## 制作设置\n- 模板版本：3\n- 字幕：关闭\n\n## 正文\n### 段落 01\n- 口播：保留完整声音。\n- 画面来源：已有素材\n- 镜头时长（秒）：2\n';
  const script=await f.request('reconfirmScript',{expectedScriptRevisionId:f.script,text,reason:'建立明确两秒的声音测试镜头'});expect(script.status,JSON.stringify(script.body)).toBe(200);
  // Reconfirmation records Owner approval; this historical media-volume fixture predates the current start preflight root. Set its confirmed stage; prepare and actual Worker/file guards still run.
  expect((await f.c.query('SELECT approved_by FROM public.material_revision_approvals WHERE material_revision_id=$1',[script.body.id])).rows[0].approved_by).toBe(f.owner);await f.c.query("UPDATE public.episodes SET stage='script_approved' WHERE id=$1",[f.episode]);
  const old=(await f.c.query('SELECT * FROM public.review_packages WHERE episode_id=$1',[f.episode])).rows;const oldDrafts=(await f.c.query('SELECT * FROM public.shot_preparation_drafts WHERE episode_id=$1',[f.episode])).rows;
  const made=await f.request('prepareWorkspace',{expectedScriptRevisionId:script.body.id});expect(made.status,JSON.stringify(made.body)).toBe(200);let w=made.body;expect(w.storyboardPackageId).toBeNull();
  const send=async(command:string,data:Record<string,unknown>={})=>{const result=await f.chosenRequest(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(result.status,`${command}: ${JSON.stringify(result.body)}`).toBe(200);w=result.body;};
  const video=await f.request('importMaterial',{materialType:'video',sourceKind:'file',sourcePath:'source.mp4',mimeType:'video/mp4',contentBase64:(await readFile(f.media.video)).toString('base64'),isMainScript:false,materialPurpose:'a_roll'});expect(video.status).toBe(200);
  await send('matchWorkspaceMaterial',{clipId:w.clips[0].id,materialRevisionId:video.body.id});
  await send('prepareWorkspaceAudio',{kind:'source',shotId:w.clips[0].shotId,sourceItemId:w.clips[0].itemId});const source=w.audio.preparations[0];expect((await f.executeAudio(source.taskId)).status).toBe('completed');
  await send('adoptWorkspaceAudio',{preparationId:source.id});expect(w.audio.mix.voices[0].mode).toBe('source');
  const version=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='freesound_preview'")).rows[0].id;
  await send('prepareWorkspaceAudio',{kind:'bgm',selection:{capability:'music_sound',provider:'freesound',adapter:'freesound_preview',connectionVersionId:version},description:'当前配乐',query:'tone',anchor:'absolute',offsetSeconds:0,durationSeconds:2});const music=w.audio.preparations.find((p:any)=>p.kind==='bgm');expect((await f.executeAudio(music.taskId)).status).toBe('completed');await send('adoptWorkspaceAudio',{preparationId:music.id});expect(w.audio.mix.sounds[0].kind).toBe('bgm');
  for(const id of [source.taskId,music.taskId]){
   const track=(await f.c.query('SELECT preparation_revision_id,source_review_package_id FROM public.audio_tracks WHERE source_task_id=$1',[id])).rows[0];expect(track).toEqual({preparation_revision_id:w.preparationRevisionId,source_review_package_id:null});
   const snapshot=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[id])).rows[0].input_snapshot;expect(snapshot.production_preparation).toMatchObject({version:'production-preparation-ref/v1',preparation_revision_id:w.preparationRevisionId});expect(snapshot).not.toHaveProperty('storyboard_review_package_id');
  }
  const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=runtimeContext();if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Only isolated backup fixtures');
  const {databaseSnapshot,assertRestored}=await import(join(process.cwd(),'scripts/runtime/clean-sql-cutover.mjs')),restored='loop_default_restore_'+randomBytes(6).toString('hex');context.sql('CREATE DATABASE '+restored+' TEMPLATE template0','postgres');
  try{const before=databaseSnapshot(context,f.database,process.cwd());context.sql(context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',f.database]),restored);assertRestored(before,databaseSnapshot(context,restored,process.cwd()));expect(context.sql(`SELECT count(*) FROM public.audio_tracks WHERE preparation_revision_id='${w.preparationRevisionId}'`,restored)).toBe('2');}finally{context.sql('DROP DATABASE '+restored+' WITH (FORCE)','postgres');}
  expect((await f.c.query('SELECT * FROM public.review_packages WHERE episode_id=$1',[f.episode])).rows).toEqual(old);
  expect((await f.c.query('SELECT * FROM public.shot_preparation_drafts WHERE episode_id=$1',[f.episode])).rows).toEqual(oldDrafts);
 }finally{await f.close();}
},180000);


it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('exact deletion includes registered independent preparation files and preserves unregistered user files',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:'# 删除范围\n\n## 正文\n\n只清理明确确认的测试文件。'});
 try{
  expect((await f.send('start')).status).toBe(200);const made=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(made.status).toBe(200);const w=made.body;
  const basis=(await f.c.query('SELECT file_reference FROM local_identity.production_preparation_revisions WHERE id=$1',[w.preparationRevisionId])).rows[0].file_reference,path=join(f.assetRoot,basis.relativePath),manual=join(dirname(path),'keep-user.txt');await writeFile(manual,'用户手工文件，保留。');
  const lifecycle=(command:string,data:Record<string,unknown>={},token=f.token)=>f.post('episode-lifecycle',command,{episodeId:f.newEpisode,...data},{token});expect((await lifecycle('archiveEpisode',{archived:true})).status).toBe(200);
  const plan=await lifecycle('planDeletion');expect(plan.status,JSON.stringify(plan.body)).toBe(200);expect(plan.body.files.map((f:any)=>f.path)).toContain(path);expect(plan.body.files.map((f:any)=>f.path)).not.toContain(manual);
  const data={confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision};expect((await lifecycle('deleteEpisode',data,f.otherToken)).status).toBe(404);expect((await lifecycle('deleteEpisode',{...data,confirmation:'incorrect'})).status).toBe(409);
  const deleted=await lifecycle('deleteEpisode',data);expect(deleted.status,JSON.stringify(deleted.body)).toBe(200);await expect(lstat(path)).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(manual,'utf8')).toBe('用户手工文件，保留。');
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['volcengine','bailian'] as const)('a new independent %s video request freezes its real basis and executes controlled transport without retired shot classification',async provider=>{
 const f=await formalWorkflowFixture({controlled:true,videoConfiguration:provider==='bailian'?{provider,model:'wan2.6-i2v-flash'}:provider,freshAccount:true,scriptText:'# 当前视频\n\n## 正文\n\n当前镜头使用明确的视频请求。'});
 try{
  expect((await f.send('start')).status).toBe(200);const made=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(made.status).toBe(200);let w=made.body;
  const image=await f.send('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'first.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(image.status).toBe(200);
  const queued=await f.send('requestWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,selection:f.controlled!.videoSelection,targetItemId:w.clips[0].itemId,firstFrameMaterialRevisionId:image.body.id,prompt:'当前镜头缓慢移动。',durationSeconds:4,reservationCents:100});expect(queued.status,JSON.stringify(queued.body)).toBe(200);w=queued.body;const id=w.visualTasks[0].taskId;
  const snapshot=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[id])).rows[0].input_snapshot;expect(snapshot.production_preparation).toMatchObject({version:'production-preparation-ref/v1',workspace_id:w.id,preparation_revision_id:w.preparationRevisionId});expect(snapshot).not.toHaveProperty('storyboard_review_package_id');expect(snapshot.shot).not.toHaveProperty('shotType');
  expect((await f.controlled!.execute(id)).status).toBe('completed');expect((await f.c.query('SELECT count(*)::int n FROM public.review_packages WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT count(*)::int n FROM public.paid_generation_reservations WHERE task_id=$1',[id])).rows[0].n).toBe(1);
 }finally{await f.close();}
},120000);
