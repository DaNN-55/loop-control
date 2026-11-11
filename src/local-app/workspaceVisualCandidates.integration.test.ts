import {adoptInitialNarration} from './workspaceNarration.fixture';
// @vitest-environment node
import {editStudioDocument} from './studioDocument.fixture';
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner registers a local visual candidate and replaces only one source instance',async()=>{
 const f=await productionWorkspaceFixture({migrations:['db/local/091-workspace-visual-candidates.sql']});try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  for(const clip of w.clips){const r=await f.request('matchWorkspaceMaterial',{workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id,materialRevisionId:f.material});expect(r.status).toBe(200);w=r.body;}
  const beforeSha=w.project.sha256;const before=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),target=w.clips[0];
  const r=await f.request('registerWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:target.itemId,materialRevisionId:f.material,usage:'video',durationSeconds:2});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;
  const candidate=w.visualCandidates[0];expect(candidate.status).toBe('available');expect(w.project.sha256).toBe(beforeSha);
  const prepared=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'keep-target'});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  const adopted=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:prepared.body.adoptionId});expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);
  const after=JSON.parse(await readFile(join(f.assetRoot,adopted.body.project.relativePath),'utf8'));expect(after.timelines[0].items[1]).toEqual(before.timelines[0].items[1]);expect(after.timelines[0].items[0].sourceAssetId).toBe('candidate-'+candidate.id);expect(after.timelines[0].items[0].id).toBe(target.itemId);expect(after.timelines[0].tracks).toEqual(before.timelines[0].tracks);
 }finally{await f.close();}
},120000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['still','pan-zoom'])('Owner locally fills a placeholder with a registered %s image without video generation',async usage=>{
 const f=await productionWorkspaceFixture();try{
  const {promisify}=await import('node:util'),{execFile}=await import('node:child_process');const file=join(f.root,'visual.png');await promisify(execFile)('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=640x360','-frames:v','1',file]);
  const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'visual.png',mimeType:'image/png',contentBase64:(await readFile(file)).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(image.status).toBe(200);
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;const original=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));
  const registered=await f.request('registerWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,materialRevisionId:image.body.id,usage,durationSeconds:3});expect(registered.status,JSON.stringify(registered.body)).toBe(200);w=registered.body;
  const candidate=w.visualCandidates[0],prepared=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'keep-target',motionPolicy:usage==='pan-zoom'?'replace-motion':'preserve-target'});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  const adopted=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:prepared.body.adoptionId});expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);
  const doc=JSON.parse(await readFile(join(f.assetRoot,adopted.body.project.relativePath),'utf8')),item=doc.timelines[0].items[0];expect(item.kind).toBe('image');expect(item.durationInFrames).toBe(60);expect(item.width).toBe(640);expect(item.height).toBe(360);expect(item.id).toBe(w.clips[0].itemId);expect(doc.timelines[0].items[1]).toEqual(original.timelines[0].items[1]);if(usage==='pan-zoom')expect(item.keyframes.scale[1]).toMatchObject({frame:59,value:1.15});
  w=adopted.body;
  const cleared=await f.request('clearWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:item.id,candidateId:candidate.id,sourcePath:item.src,sourceSha256:item.sourceContentHash});
  expect(cleared.status,JSON.stringify(cleared.body)).toBe(200);
  expect(cleared.body.readiness.placeholders).toContain(item.id);
  expect(cleared.body.visualCandidates).toContainEqual(expect.objectContaining({id:candidate.id,status:'available',materialRevisionId:image.body.id}));
  expect((await f.c.query('SELECT id FROM public.tasks WHERE episode_id=$1 AND status<>\'completed\'',[f.episode])).rowCount).toBe(0);
 }finally{await f.close();}
},120000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner registers new media into the existing live pool and can save and reopen it',async()=>{
 const f=await productionWorkspaceFixture();try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);w=await f.fillVisuals(w);const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status).toBe(200);w=opened.body.productionWorkspace;
  const imported=await f.request('importMaterial',{materialType:'video',sourceKind:'file',sourcePath:'added.mp4',mimeType:'video/mp4',contentBase64:(await readFile(join(f.assetRoot,f.videoPath))).toString('base64'),isMainScript:false,materialPurpose:'a_roll'});expect(imported.status).toBe(200);
  const prepared=await f.request('prepareWorkspaceVisualPool',{workspaceId:w.id,expectedRevision:w.revision,materialRevisionId:imported.body.id});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);expect(prepared.body.asset.src).toMatch(/^\/media\/uploads\/[a-f0-9]+\.mp4$/);
  const src=await fetch(new URL(opened.body.studioUrl).origin+prepared.body.asset.src);expect(src.status).toBe(200);const {createHash}=await import('node:crypto');expect(createHash('sha256').update(Buffer.from(await src.arrayBuffer())).digest('hex')).toBe(imported.body.sha256);
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{doc.assets.push(prepared.body.asset);});
  const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});
  const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(project.assets.find((a:{id:string})=>a.id===prepared.body.asset.id).src).toBe(imported.body.storage_path);
  const reopened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(reopened.status).toBe(200);expect(new URL(reopened.body.studioUrl).origin).not.toBe('');
 }finally{await f.close();}
},120000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner creates a controlled Provider visual candidate during editing without changing Episode stage',async()=>{
 const {narrationFixture}=await import('./workspaceNarration.fixture'),{workspaceTestMedia}=await import('./workspaceTestMedia.fixture');const f=await narrationFixture(undefined,undefined,true);try{
  await f.authorize();let w=f.made;
  const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'first.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(image.status).toBe(200);
  await f.c.query("UPDATE public.episodes SET stage='qc_review' WHERE id=$1",[f.episode]);let sha=w.project.sha256;
  const r=await f.chosenRequest('requestWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,firstFrameMaterialRevisionId:image.body.id,prompt:'转身',durationSeconds:4,reservationCents:90});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;expect(w.project.sha256).toBe(sha);expect(w.visualTasks).toHaveLength(1);expect(w.visualTasks[0].shotId).toBe(w.clips[0].shotId);
  const other=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'appearance',itemId:w.clips[1].itemId,focusX:23}});expect(other.status).toBe(200);w=other.body;sha=w.project.sha256;expect(w.nativeEditRevision).toBeGreaterThan(0);
  expect((await f.execute(w.visualTasks[0].taskId))?.status).toBe('completed');w=await f.read();expect(w.visualCandidates[0].kind).toBe('video');expect(w.visualCandidates[0].generation).toMatchObject({prompt:'转身',firstFrameMaterialRevisionId:image.body.id,durationSeconds:4,selection:f.videoSelection});expect(w.visualCandidates[0].durationSeconds).toBeGreaterThanOrEqual(4);expect(w.project.sha256).toBe(sha);
  expect((await readFile(f.videoSubmissions,'utf8')).trim().split('\n')).toHaveLength(1);expect((await f.c.query('SELECT stage FROM public.episodes WHERE id=$1',[f.episode])).rows[0].stage).toBe('qc_review');
  const target=w.clips[0].itemId,candidate=w.visualCandidates[0],args={workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id};
  const plan=await f.request('prepareWorkspaceVisualCandidate',{...args,durationPolicy:'use-candidate',acceptTimelineImpact:true});
  expect(plan.status,JSON.stringify(plan.body)).toBe(200);
  expect(plan.body.edit.videoSound.mode).toBe('separate');
  const adopted=await f.request('adoptWorkspaceVisualCandidate',{...args,adoptionId:plan.body.adoptionId});
  expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);
  const project=JSON.parse(await readFile(join(f.assetRoot,adopted.body.project.relativePath),'utf8'));
  const timeline=project.timelines[0],video=timeline.items.find((i:any)=>i.id===target);
  const linked=timeline.linkGroups.find((g:any)=>g.anchorItemId===target);
  const audio=timeline.items.find((i:any)=>linked.itemIds.includes(i.id)&&i.kind==='audio');
  expect(video.volume).toBe(0);
  expect(audio).toMatchObject({startFrame:video.startFrame,durationInFrames:video.durationInFrames,volume:1});
  expect(linked.mode).toBe('linked');
 }finally{await f.close();}
},120000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('visual generation freezes the actual source voice window instead of retained muted TTS and rejects a later route change',async()=>{
 const {narrationFixture}=await import('./workspaceNarration.fixture'),{workspaceTestMedia}=await import('./workspaceTestMedia.fixture'),{writeFile}=await import('node:fs/promises'),{promisify}=await import('node:util'),{execFile}=await import('node:child_process');const f=await narrationFixture(undefined,undefined,true);try{
  await f.authorize();let w=f.made;const send=async(name:string,data:Record<string,unknown>)=>{const r=await f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;return r.body;};
  const clip=w.clips[0];await send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',...f.narrationSettings,text:'旧口播二点四秒。'});await send('confirmWorkspaceNarration',{clipId:clip.id});await send('generateWorkspaceNarration',{reservationCents:100,clipId:clip.id});await f.execute(w.narration[0].taskId);await send('refreshWorkspaceNarration',{});
  const videoFile=join(f.root,'source-six.mp4');await promisify(execFile)('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=128x128:r=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','6','-c:v','libx264','-c:a','aac','-pix_fmt','yuv420p',videoFile]);
  const video=await f.request('importMaterial',{materialType:'video',sourceKind:'file',sourcePath:'source-six.mp4',mimeType:'video/mp4',contentBase64:(await readFile(videoFile)).toString('base64'),isMainScript:false,materialPurpose:'a_roll'});expect(video.status).toBe(200);
  await send('saveWorkspaceVideoRanges',{shotId:clip.shotId,ranges:[{clipId:clip.id,materialRevisionId:video.body.id,sourceInFrame:15,durationInFrames:150,durationLocked:false}]});w=await adoptInitialNarration(f,w);const initial=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),oldTts=initial.timelines[0].items.find((i:{id:string})=>i.id.startsWith('workspace-narration-'));await send('prepareWorkspaceAudio',{kind:'source',shotId:clip.shotId,sourceItemId:clip.itemId});const prep=w.audio.preparations[0];await f.execute(prep.taskId);await send('adoptWorkspaceAudio',{preparationId:prep.id});
  w=await f.fillVisuals(w);w=await f.fillVisuals(w);const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status).toBe(200);w=opened.body.productionWorkspace;await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{const asset=doc.assets.find((a:{id:string})=>a.id===oldTts.sourceAssetId);doc.timelines[0].tracks['retained-muted']={kind:'audio',name:'保留旧口播',muted:true};doc.timelines[0].trackOrder.push('retained-muted');doc.timelines[0].items.push({...oldTts,src:asset.src,track:'retained-muted',volume:0});});
  const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});
  const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'first.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});
  await send('requestWorkspaceVisualCandidate',{selection:f.videoSelection,targetItemId:clip.itemId,firstFrameMaterialRevisionId:image.body.id,prompt:'沿当前原声缓慢移动',durationSeconds:12,reservationCents:90});const taskId=w.visualTasks[0].taskId,snapshot=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[taskId])).rows[0].input_snapshot;expect(snapshot.workspace_visual.mode).toBe('source');expect(snapshot.workspace_visual.windowDurationSeconds).toBe(5);expect(snapshot.workspace_visual.source.sha256).not.toBe(oldTts.sourceContentHash);expect(snapshot.media.video.duration_seconds).toBe(5);
  const modulePath=join(f.root,'controlled-video.mjs');await writeFile(modulePath,(await readFile(modulePath,'utf8')).replace(workspaceTestMedia('landscape-red-blue.mp4'),videoFile));await f.execute(taskId);w=await f.read();const body=JSON.parse((await readFile(f.videoSubmissions,'utf8')).trim());expect(body.duration).toBe(5);
  const candidate=w.visualCandidates[0],prepared=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'keep-target'});expect(prepared.status).toBe(200);await send('mixWorkspaceAudio',{edit:{kind:'voice',workspaceId:w.id,shotId:clip.shotId,visualItemIds:[clip.itemId],mode:'none',gainDb:0,ambienceGainDb:null}});const sha=w.project.sha256;
  const denied=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:prepared.body.adoptionId});expect(denied.status).toBe(409);expect((await f.read()).project.sha256).toBe(sha);if(process.env.LOOP_T09_EVIDENCE_DIR)await writeFile(join(process.env.LOOP_T09_EVIDENCE_DIR,'source-main-voice-provider.json'),JSON.stringify({inputSnapshot:snapshot,actualProviderPost:body,retainedMutedTts:{sourceSha256:oldTts.sourceContentHash,durationSeconds:oldTts.durationInFrames/30},lateRouteAdoptionStatus:denied.status,unchangedProjectSha256:sha,episodeStage:(await f.c.query('SELECT stage FROM public.episodes WHERE id=$1',[f.episode])).rows[0].stage},null,2));
 }finally{await f.close();}
},180000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('unknown paid visual submissions cannot be bypassed by retry or a new prompt',async()=>{
 const {narrationFixture}=await import('./workspaceNarration.fixture'),{workspaceTestMedia}=await import('./workspaceTestMedia.fixture'),{writeFile}=await import('node:fs/promises');const f=await narrationFixture(undefined,undefined,true);try{
  await f.authorize();let w=f.made;
  const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'unknown.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'}),payload={workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,firstFrameMaterialRevisionId:image.body.id,prompt:'未知提交',durationSeconds:4,reservationCents:90};
  const module=join(f.root,'controlled-video.mjs');await writeFile(module,(await readFile(module,'utf8')).replace("return Response.json({id:'controlled-t05-video',task_id:'controlled-t05-video',code:0,data:{task_id:'controlled-t05-video'},output:{task_id:'controlled-t05-video'}});","throw Error('Controlled submission outcome unknown');"));
  expect(await readFile(module,'utf8')).toContain("throw Error('Controlled submission outcome unknown')");
  const requested=await f.chosenRequest('requestWorkspaceVisualCandidate',payload);expect(requested.status).toBe(200);w=requested.body;expect((await f.execute(w.visualTasks[0].taskId,false))?.status).toBe('blocked');
  const retry=await f.request('retryWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:w.visualTasks[0].id});expect(retry.status).toBe(409);const changed=await f.chosenRequest('requestWorkspaceVisualCandidate',{...payload,prompt:'换描述也不能绕过'});expect(changed.status).toBe(409);expect(changed.body.error).toContain('未知');
  expect((await readFile(f.videoSubmissions,'utf8')).trim().split('\n')).toHaveLength(1);expect((await f.c.query("SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1 AND provider='volcengine'",[f.episode])).rows[0].n).toBe(1);
 }finally{await f.close();}
},120000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['current','legacy'])('a visual task with a saved Provider ID resumes polling without a second paid submission (%s protocol)',async protocol=>{
 const {narrationFixture}=await import('./workspaceNarration.fixture'),{workspaceTestMedia}=await import('./workspaceTestMedia.fixture'),{writeFile}=await import('node:fs/promises');const f=await narrationFixture(undefined,undefined,true);try{
  await f.authorize();let w=f.made;const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'resume.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'}),mode=join(f.root,'poll-mode'),module=join(f.root,'controlled-video.mjs');await writeFile(mode,'fail');await writeFile(module,(await readFile(module,'utf8')).replace("if(host==='ark.cn-beijing.volces.com')return",`if(host==='ark.cn-beijing.volces.com'&&readFileSync(${JSON.stringify(mode)},'utf8')==='fail')throw Error('Controlled poll interruption');if(host==='ark.cn-beijing.volces.com')return`));
  expect(await readFile(module,'utf8')).toContain("throw Error('Controlled poll interruption')");
  // Simulate a task frozen before migration; this trigger is disabled only in
  // this test-owned database while the original queue builds its old snapshot.
  if(protocol==='legacy')await f.c.query('ALTER TABLE public.tasks DISABLE TRIGGER aaa_workspace_shot_video_protocol');
  const requested=await f.chosenRequest('requestWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,firstFrameMaterialRevisionId:image.body.id,prompt:'可恢复视频',durationSeconds:4,reservationCents:90});expect(requested.status).toBe(200);w=requested.body;const job=w.visualTasks[0];
  if(protocol==='legacy')await f.c.query('ALTER TABLE public.tasks ENABLE TRIGGER aaa_workspace_shot_video_protocol');
  const frozen=(await f.c.query('SELECT task_type,input_snapshot FROM public.tasks WHERE id=$1',[job.taskId])).rows[0];expect(frozen.task_type).toBe(protocol==='legacy'?'generate_b_roll':'generate_shot_video');expect(frozen.input_snapshot.capability).toBe(protocol==='legacy'?'b_roll_generation':'shot_video_generation');
await f.execute(job.taskId,false);w=await f.read();expect(w.visualTasks[0].canResume).toBe(true);expect(w.project.sha256).toBe(f.made.project.sha256);
  // A second legitimate workspace owned by the same Owner cannot resume this episode's task.
  const {randomUUID}=await import('node:crypto'),{mkdir,copyFile}=await import('node:fs/promises');const otherEpisode=randomUUID(),otherScript=randomUUID(),otherBoard=randomUUID(),otherTask=randomUUID(),otherArtifact=randomUUID();
  await mkdir(join(f.assetRoot,'episodes',otherEpisode),{recursive:true});await copyFile(join(f.assetRoot,`episodes/${f.episode}/script.md`),join(f.assetRoot,`episodes/${otherEpisode}/script.md`));await copyFile(join(f.assetRoot,f.boardPath),join(f.assetRoot,`episodes/${otherEpisode}/board.json`));
  await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) SELECT $2,account_id,blueprint_version_id,'Other owned workspace','storyboard_approved' FROM public.episodes WHERE id=$1",[f.episode,otherEpisode]);
  await f.c.query('INSERT INTO local_identity.input_episodes(episode_id,owner_id,storyboard_enabled) VALUES($1,$2,true)',[otherEpisode,f.owner]);
  await f.c.query("INSERT INTO public.production_material_revisions SELECT (jsonb_populate_record(null::public.production_material_revisions,to_jsonb(m)||jsonb_build_object('id',$2::text,'episode_id',$3::text,'source_path',$4::text,'storage_path',$4::text))).* FROM public.production_material_revisions m WHERE id=$1",[f.script,otherScript,otherEpisode,`episodes/${otherEpisode}/script.md`]);
  await f.c.query('UPDATE public.episodes SET main_script_revision_id=$2 WHERE id=$1',[otherEpisode,otherScript]);
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_review_render','completed','{}')",[otherTask,otherEpisode]);
  await f.c.query("INSERT INTO public.artifacts SELECT (jsonb_populate_record(null::public.artifacts,to_jsonb(a)||jsonb_build_object('id',$2::text,'episode_id',$3::text,'producer_task_id',$4::text,'relative_path',$5::text))).* FROM public.artifacts a JOIN public.review_packages p ON p.artifact_id=a.id WHERE p.id=$1",[f.board,otherArtifact,otherEpisode,otherTask,`episodes/${otherEpisode}/board.json`]);
  await f.c.query("INSERT INTO public.review_packages(id,episode_id,stage,revision_number,artifact_id,task_id,context_snapshot) SELECT $2,$3,'storyboard_review',1,$4,$5,context_snapshot FROM public.review_packages WHERE id=$1",[f.board,otherBoard,otherEpisode,otherArtifact,otherTask]);
  const other=await f.request('prepareWorkspace',{episodeId:otherEpisode,reviewPackageId:otherBoard,expectedScriptRevisionId:otherScript});expect(other.status,JSON.stringify(other.body)).toBe(200);
  const taskBeforeForeign=(await f.c.query('SELECT status,attempt,max_attempts,claimed_at,completed_at FROM public.tasks WHERE id=$1',[job.taskId])).rows[0];
  const foreignRetry=await f.request('retryWorkspaceVisualCandidate',{episodeId:otherEpisode,workspaceId:other.body.id,expectedRevision:other.body.revision,candidateId:job.id});expect(foreignRetry.status,JSON.stringify(foreignRetry.body)).toBe(404);expect((await f.c.query('SELECT status,attempt,max_attempts,claimed_at,completed_at FROM public.tasks WHERE id=$1',[job.taskId])).rows[0]).toEqual(taskBeforeForeign);
  const unrelated=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'appearance',itemId:w.clips[1].itemId,focusX:19}});expect(unrelated.status).toBe(200);w=unrelated.body;
  const resume=await f.request('retryWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:job.id});expect(resume.status,JSON.stringify(resume.body)).toBe(200);await writeFile(mode,'success');expect((await f.execute(job.taskId))?.status).toBe('completed');expect((await readFile(f.videoSubmissions,'utf8')).trim().split('\n')).toHaveLength(1);expect((await f.read()).visualCandidates).toHaveLength(1);const recovered=(await f.c.query('SELECT task_type,input_snapshot FROM public.tasks WHERE id=$1',[job.taskId])).rows[0];expect(recovered.input_snapshot.runtime_constraints.effective_concurrency).toBe(1);delete recovered.input_snapshot.runtime_constraints;delete frozen.input_snapshot.runtime_constraints;expect(recovered).toEqual(frozen);
 }finally{await f.close();}
},120000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('short visual source requires an explicit duration decision without repeating or moving other clips',async()=>{
 const {workspaceTestMedia}=await import('./workspaceTestMedia.fixture');const f=await productionWorkspaceFixture();try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;const item=w.clips[0].itemId;
  const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'long-still.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});
  const matched=await f.request('matchWorkspaceImage',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,materialRevisionId:image.body.id,usage:'pan-zoom',durationSeconds:3,fit:'contain',focusX:17,focusY:0});expect(matched.status).toBe(200);w=matched.body;const before=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));
  const r=await f.request('registerWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:item,materialRevisionId:f.material,usage:'video',durationSeconds:2});expect(r.status).toBe(200);w=r.body;expect(w.visualCandidates[0].durationImpact).toEqual({deltaSeconds:-1,overlapItemIds:[]});const id=w.visualCandidates[0].id,base={workspaceId:w.id,expectedRevision:w.revision,candidateId:id};
  const short=await f.request('prepareWorkspaceVisualCandidate',{...base,durationPolicy:'keep-target'});expect(short.status).toBe(409);expect(short.body.error).toContain('短于');
  expect((await f.request('prepareWorkspaceVisualCandidate',{...base,durationPolicy:'use-candidate'})).status).toBe(409);
  const prepared=await f.request('prepareWorkspaceVisualCandidate',{...base,durationPolicy:'use-candidate',acceptTimelineImpact:true});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  const adopted=await f.request('adoptWorkspaceVisualCandidate',{...base,adoptionId:prepared.body.adoptionId});expect(adopted.status).toBe(200);
  const project=JSON.parse(await readFile(join(f.assetRoot,adopted.body.project.relativePath),'utf8'));expect(project.timelines[0].items[0].durationInFrames).toBe(60);expect(project.timelines[0].items[0].playbackRate??1).toBe(1);expect(project.timelines[0].items[0].transform).toEqual(before.timelines[0].items[0].transform);expect(project.timelines[0].items[0].keyframes).toEqual(before.timelines[0].items[0].keyframes);expect(project.timelines[0].items[1]).toEqual(before.timelines[0].items[1]);
 }finally{await f.close();}
},120000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('voice gain and BGM edits do not stale a visual request or overwrite the new mix',async()=>{
 const {narrationFixture}=await import('./workspaceNarration.fixture'),{workspaceTestMedia}=await import('./workspaceTestMedia.fixture');const f=await narrationFixture(undefined,undefined,true);try{
  await f.authorize();let w=f.made;const clip=w.clips[0],send=async(name:string,data:Record<string,unknown>)=>{const r=await f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;return r.body;};
  await send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',...f.narrationSettings,text:'实际采用的口播。'});await send('confirmWorkspaceNarration',{clipId:clip.id});await send('generateWorkspaceNarration',{reservationCents:100,clipId:clip.id});await f.execute(w.narration[0].taskId);await send('refreshWorkspaceNarration',{});w=await adoptInitialNarration(f,w);
  const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'gain.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});
  await send('mixWorkspaceAudio',{edit:{kind:'voice',workspaceId:w.id,shotId:clip.shotId,visualItemIds:[clip.itemId],mode:'tts',gainDb:-6,ambienceGainDb:null}});
  await send('requestWorkspaceVisualCandidate',{selection:f.videoSelection,targetItemId:clip.itemId,firstFrameMaterialRevisionId:image.body.id,prompt:'声音不变，仅换画面',durationSeconds:12,reservationCents:90});const job=w.visualTasks[0];
  const {promisify}=await import('node:util'),{execFile}=await import('node:child_process');const bgmPath=join(f.root,'bgm.mp3');await promisify(execFile)('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=110:sample_rate=48000','-t','8','-c:a','libmp3lame',bgmPath]);const bgm=await f.request('importMaterial',{materialType:'audio',sourceKind:'file',sourcePath:'bgm.mp3',mimeType:'audio/mpeg',contentBase64:(await readFile(bgmPath)).toString('base64'),isMainScript:false,materialPurpose:'background_music'});await send('prepareWorkspaceAudio',{kind:'bgm',materialRevisionId:bgm.body.id,description:'本地配乐',anchor:'absolute',offsetSeconds:0,durationSeconds:8});await send('adoptWorkspaceAudio',{preparationId:w.audio.preparations[0].id});await send('mixWorkspaceAudio',{edit:{kind:'sound',workspaceId:w.id,itemId:'workspace-bgm',gainDb:-12,duckDepthDb:8}});
  await send('mixWorkspaceAudio',{edit:{kind:'voice',workspaceId:w.id,shotId:clip.shotId,visualItemIds:[clip.itemId],mode:'tts',gainDb:-3,ambienceGainDb:null}});expect((await f.execute(job.taskId))?.status).toBe('completed');w=await f.read();const candidate=w.visualCandidates[0];expect(candidate.status).toBe('available');
  const prepared=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'keep-target'});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:prepared.body.adoptionId});const doc=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),voice=doc.timelines[0].items.find((i:{id:string})=>i.id===`workspace-narration-shot-${clip.shotId}`);expect(voice.volume).toBeCloseTo(10**(-3/20),6);const bgmItem=doc.timelines[0].items.find((i:{id:string})=>i.id==='workspace-bgm');expect(bgmItem.volume).toBeCloseTo(10**(-12/20),6);expect(doc.timelines[0].tracks[bgmItem.track].audioRouting.duckDepthDb).toBe(-8);
 }finally{await f.close();}
},120000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('an unavailable unused visual candidate does not prevent editing and cannot be adopted',async()=>{
 const {workspaceTestMedia}=await import('./workspaceTestMedia.fixture'),{unlink}=await import('node:fs/promises');const f=await productionWorkspaceFixture();try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;const imported=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'missing.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});
  const registered=await f.request('registerWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,materialRevisionId:imported.body.id,usage:'still',durationSeconds:2});expect(registered.status).toBe(200);w=registered.body;await unlink(join(f.assetRoot,imported.body.storage_path));const response=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);w=(await response.json()).workspace;expect(w.visualCandidates[0].status).toBe('stale');expect((await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:w.visualCandidates[0].id,durationPolicy:'keep-target'})).status).toBe(409);
 }finally{await f.close();}
},120000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('added shots accept registered local visuals and explicitly selected generation and changed target input blocks a new paid POST',async()=>{
 const {narrationFixture}=await import('./workspaceNarration.fixture'),{workspaceTestMedia}=await import('./workspaceTestMedia.fixture');const f=await narrationFixture(undefined,undefined,true);try{
  await f.authorize();let w=f.made;const first=w.clips[0],send=async(name:string,data:Record<string,unknown>)=>{const r=await f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);if(name!=='prepareWorkspaceVisualCandidate')w=r.body;return r.body;};const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'local-added.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});
  await send('requestWorkspaceVisualCandidate',{selection:f.videoSelection,targetItemId:first.itemId,firstFrameMaterialRevisionId:image.body.id,prompt:'原目标',durationSeconds:4,reservationCents:90});const job=w.visualTasks[0];await send('editWorkspaceStructure',{operation:{kind:'insert',afterShotId:w.clips[1].shotId,text:'新增本地镜头'}});const added=w.clips.find((c:{shotId:string})=>c.shotId.startsWith('added-'));
  const denied=await f.chosenRequest('requestWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:added.itemId,firstFrameMaterialRevisionId:image.body.id,prompt:'新增无分镜依据',durationSeconds:4,reservationCents:90});expect(denied.status,JSON.stringify(denied.body)).toBe(200);w=denied.body;expect(w.visualTasks.some((t:any)=>t.shotId===added.shotId)).toBe(true);await send('registerWorkspaceVisualCandidate',{targetItemId:added.itemId,materialRevisionId:image.body.id,usage:'still',durationSeconds:3});const candidate=w.visualCandidates[0],prepared=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target'});await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:prepared.adoptionId});
  await send('matchWorkspaceMaterial',{clipId:first.id,materialRevisionId:f.material});expect((await f.execute(job.taskId,false))?.status).not.toBe('completed');await expect(readFile(f.videoSubmissions)).rejects.toMatchObject({code:'ENOENT'});expect((await f.c.query('SELECT count(*)::int n FROM public.paid_generation_reservations WHERE task_id=$1',[job.taskId])).rows[0].n).toBe(0);
 }finally{await f.close();}
},120000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('manual video adoption preserves the selected source interval and refuses a short range',async()=>{
 const f=await productionWorkspaceFixture();try{
 let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
 const {workspaceTestMedia}=await import('./workspaceTestMedia.fixture');
 const upload=await f.request('importMaterial',{materialType:'video',sourceKind:'file',sourcePath:'uploaded-with-sound.mp4',mimeType:'video/mp4',contentBase64:(await readFile(workspaceTestMedia('landscape-red-blue.mp4'))).toString('base64'),isMainScript:false,materialPurpose:'a_roll'});
 expect(upload.status,JSON.stringify(upload.body)).toBe(200);
 const added=await f.request('registerWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,materialRevisionId:upload.body.id,usage:'video',durationSeconds:2});expect(added.status).toBe(200);w=added.body;
 const args={workspaceId:w.id,expectedRevision:w.revision,candidateId:w.visualCandidates[0].id,sourceInSeconds:0.5,sourceOutSeconds:1.5};
 expect((await f.request('prepareWorkspaceVisualCandidate',{...args,durationPolicy:'keep-target'})).status).toBe(409);
 const prepared=await f.request('prepareWorkspaceVisualCandidate',{...args,durationPolicy:'use-candidate',acceptTimelineImpact:true});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
 const adopted=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:w.visualCandidates[0].id,adoptionId:prepared.body.adoptionId});expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);
 const doc=JSON.parse(await readFile(join(f.assetRoot,adopted.body.project.relativePath),'utf8')),t=doc.timelines[0],item=t.items.find((i:{id:string})=>i.id===w.clips[0].itemId);
 expect(item.srcInFrame).toBe(Math.round(0.5*t.fps));expect(item.durationInFrames).toBe(t.fps);expect(doc.assets.find((a:{id:string})=>a.id===item.sourceAssetId).durationInFrames).toBeGreaterThanOrEqual(2*t.fps);
 const pair=t.linkGroups.find((g:any)=>g.anchorItemId===item.id);
 const audio=t.items.find((i:any)=>pair.itemIds.includes(i.id)&&i.kind==='audio');
 expect(audio).toMatchObject({startFrame:item.startFrame,durationInFrames:t.fps,srcInFrame:0,volume:1});
 expect(item.volume).toBe(0);
 const {probeMp3Artifact}=await import('../worker/mediaTools');
 expect(await probeMp3Artifact(join(f.assetRoot,audio.src))).toBeCloseTo(1,1);
 }finally{await f.close();}
},120000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('video generation freezes and applies the first-frame composition without changing the source image',async()=>{
 const {narrationFixture}=await import('./workspaceNarration.fixture'),{workspaceTestMedia}=await import('./workspaceTestMedia.fixture'),{createHash}=await import('node:crypto');const f=await narrationFixture(undefined,undefined,true);try{
 await f.authorize();let w=f.made;
 const bytes=await readFile(workspaceTestMedia('still-striped.png')),image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'composition.png',mimeType:'image/png',contentBase64:bytes.toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(image.status).toBe(200);
 const queued=await f.chosenRequest('requestWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,firstFrameMaterialRevisionId:image.body.id,prompt:'缓慢推进',durationSeconds:4,reservationCents:90,firstFrameFit:'cover'});expect(queued.status,JSON.stringify(queued.body)).toBe(200);w=queued.body;
 const task=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[w.visualTasks[0].taskId])).rows[0];expect(task.input_snapshot.media.video.composition.fit).toBe('cover');await f.execute(w.visualTasks[0].taskId);
 const body=JSON.parse((await readFile(f.videoSubmissions,'utf8')).trim()),sent=body.content.find((v:{type:string})=>v.type==='image_url').image_url.url,generated=Buffer.from(sent.split(',')[1],'base64');expect(generated.readUInt32BE(16)).toBe(task.input_snapshot.media.video.composition.width);expect(generated.readUInt32BE(20)).toBe(task.input_snapshot.media.video.composition.height);
 expect(createHash('sha256').update(await readFile(join(f.assetRoot,image.body.storage_path))).digest('hex')).toBe(image.body.sha256);expect((await f.read()).visualCandidates[0].generation.firstFrameFit).toBe('cover');
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('returns the used video to candidates without moving the shot and allows re-adoption',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const target=w.clips[0],send=(command:string,data:Record<string,unknown>)=>f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});
  const matched=await send('matchWorkspaceMaterial',{clipId:target.id,materialRevisionId:f.material});
  expect(matched.status,JSON.stringify(matched.body)).toBe(200);w=matched.body;
  const before=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));
  const timeline=before.timelines[0],item=timeline.items.find((i:{id:string})=>i.id===target.itemId);
  const clear={targetItemId:target.itemId,sourcePath:item.src,sourceSha256:item.sourceContentHash};
  expect((await send('clearWorkspaceVisualCandidate',{...clear,sourceSha256:'0'.repeat(64)})).status).toBe(409);
  const cleared=await send('clearWorkspaceVisualCandidate',clear);
  expect(cleared.status,JSON.stringify(cleared.body)).toBe(200);w=cleared.body;
  expect(w.readiness.placeholders).toContain(target.itemId);
  expect(w.clips.find((b:{id:string})=>b.id===target.id).source).toBeNull();
  const after=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));
  const placeholder=after.timelines[0].items.find((i:{id:string})=>i.id===target.itemId);
  expect(placeholder).toMatchObject({kind:'text',track:item.track,startFrame:item.startFrame,durationInFrames:item.durationInFrames});
  expect(placeholder.src).toBeUndefined();
  const otherItems=(items:Array<{id:string}>)=>items.filter(i=>i.id!==target.itemId);
  expect(otherItems(after.timelines[0].items)).toEqual(otherItems(timeline.items));
  const candidate=w.visualCandidates.find((v:{relativePath:string})=>v.relativePath===item.src);
  expect(candidate).toMatchObject({materialRevisionId:f.material,status:'available'});
  const prepared=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target'});
  expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  const adopted=await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:prepared.body.adoptionId});
  expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);w=adopted.body;
  expect(w.readiness.placeholders).not.toContain(target.itemId);
  expect(w.visualCandidates).toContainEqual(expect.objectContaining({id:candidate.id,status:'adopted'}));
  expect((await send('rejectWorkspaceVisualCandidate',{candidateId:candidate.id})).status).toBe(409);
  const clearedAgain=await send('clearWorkspaceVisualCandidate',{...clear,candidateId:candidate.id});
  expect(clearedAgain.status,JSON.stringify(clearedAgain.body)).toBe(200);w=clearedAgain.body;
  expect(w.visualCandidates.filter((v:{relativePath:string})=>v.relativePath===item.src)).toEqual([expect.objectContaining({id:candidate.id,status:'available'})]);
  const dismissed=await send('rejectWorkspaceVisualCandidate',{candidateId:candidate.id});
  expect(dismissed.status,JSON.stringify(dismissed.body)).toBe(200);
  expect(dismissed.body.visualCandidates).toContainEqual(expect.objectContaining({id:candidate.id,status:'rejected'}));
  expect(await readFile(join(f.assetRoot,item.src))).toEqual(await readFile(join(f.assetRoot,f.videoPath)));
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each([
 ['volcengine','keyframes'],['volcengine','references'],['minimax','keyframes'],['minimax','references'],['kling','keyframes'],['kling','references'],['bailian','references'],
] as const)('freezes %s %s inputs and sends the right roles to a simulated provider',async (provider,videoMode)=>{
 const {narrationFixture}=await import('./workspaceNarration.fixture');
 const {workspaceTestMedia}=await import('./workspaceTestMedia.fixture');
 const isOmni=provider==='kling'&&videoMode==='references';
 const f=await narrationFixture(undefined,undefined,provider==='bailian'?{provider,model:'wan2.6-r2v'}:isOmni?{provider,model:'kling-v3-omni'}:provider);
 try{
  const w=f.made;
  const importMaterial=async(kind:'image'|'video',sourcePath:string,file:string)=>{
   const result=await f.request('importMaterial',{materialType:kind,sourceKind:'file',sourcePath,mimeType:kind==='image'?'image/png':'video/mp4',
    contentBase64:(await readFile(file)).toString('base64'),isMainScript:false,materialPurpose:kind==='image'?'visual_reference':'b_roll'});
   expect(result.status,JSON.stringify(result.body)).toBe(200);
   return result.body;
  };
  const image=await importMaterial('image','参考图.png',workspaceTestMedia('still-striped.png'));
  const second=videoMode==='references'?await importMaterial('video','参考视频.mp4',workspaceTestMedia('landscape-red-blue.mp4')):image;
  const videoSource=provider==='volcengine'?'asset://controlled-reference':isOmni||provider==='bailian'?'https://media.example.com/reference.mp4':undefined;
  const imageSource='https://media.example.com/reference.png';
  const visualInputs=videoMode==='keyframes'?
   [{role:'firstFrame',materialRevisionId:image.id},{role:'lastFrame',materialRevisionId:second.id}]:
   [{role:'referenceImages',materialRevisionId:image.id,...(provider==='bailian'?{source:imageSource}:{})},{role:'referenceVideos',materialRevisionId:second.id,...(videoSource?{source:videoSource}:{})}];
  if(provider==='bailian')visualInputs.reverse();
  const selection={...f.videoSelection,model:provider==='volcengine'&&videoMode==='references'?'doubao-seedance-2-5-260628':f.videoSelection.model};
  const data={selection,workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,videoMode,visualInputs,prompt:'缓慢推进',durationSeconds:4,reservationCents:90};
  const invalid=await f.chosenRequest('requestWorkspaceVisualCandidate',{...data,visualInputs:[...visualInputs,{role:videoMode==='references'?'firstFrame':'referenceImages',materialRevisionId:image.id}]});
  expect(invalid.status).toBe(400);
  const requested=await f.chosenRequest('requestWorkspaceVisualCandidate',data);
  expect(requested.status,JSON.stringify(requested.body)).toBe(200);
  const taskId=requested.body.visualTasks[0].taskId;
  const snapshot=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[taskId])).rows[0].input_snapshot;
  expect(snapshot.media.video.visual_mode).toBe(videoMode);
  expect(snapshot.media.video.visual_inputs.map((input:{role:string})=>input.role)).toEqual(visualInputs.map(input=>input.role));
  expect(snapshot.input_artifacts).toHaveLength(2);
  expect((await f.execute(taskId))?.status).toBe('completed');
  const request=JSON.parse((await readFile(f.videoSubmissions,'utf8')).trim());
  if(isOmni||provider==='bailian'){
   const {createWorkspaceGenerationFetcher}=await import('./providerNetwork');
   const {vi}=await import('vitest');
   const transport=vi.fn(async()=>Response.json({}));
   const fetcher=createWorkspaceGenerationFetcher(provider,{reserve:async()=>{},videoTaskId:()=>undefined},transport);
   const url=isOmni?'https://api-singapore.klingai.com/v1/videos/omni-video':'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';
   expect((await fetcher(url,{method:'POST',body:JSON.stringify(request)})).ok).toBe(true);
   if(isOmni){
    expect(request).toMatchObject({model_name:selection.model,mode:'pro',aspect_ratio:'9:16',image_list:[{image_url:expect.stringMatching(/^iVBOR/)}],video_list:[{video_url:videoSource,refer_type:'feature',keep_original_sound:'no'}]});
    expect(request).not.toHaveProperty('image');
   }else{
    expect(request).toMatchObject({model:selection.model,input:{reference_urls:[videoSource,imageSource]},parameters:{size:'720*1280',duration:4}});
    expect(request.input).not.toHaveProperty('img_url');
    expect(request.parameters).not.toHaveProperty('resolution');
   }
  }else if(provider==='kling'){
   expect(request).toMatchObject({model_name:selection.model,image:expect.stringMatching(/^iVBOR/),image_tail:expect.stringMatching(/^iVBOR/)});
  }else{
   expect(request.model).toBe(selection.model);
   expect(request.content.map((entry:{role?:string})=>entry.role)).toEqual(videoMode==='keyframes'?[undefined,'first_frame','last_frame']:[undefined,'reference_image','reference_video']);
   expect(request.content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
   if(videoMode==='references')expect(request.content[2].video_url.url).toMatch(videoSource??/^data:video\/mp4;base64,/);
  }
  expect((await f.read()).visualCandidates[0].status).toBe('available');
 }finally{await f.close();}
},120000);
