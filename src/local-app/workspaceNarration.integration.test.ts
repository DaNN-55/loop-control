// @vitest-environment node
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {it,expect} from 'vitest';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {narrationFixture} from './workspaceNarration.fixture';
import {readWorkspaceNarrationTarget} from './workspaceNarration';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner can prepare disabled narration before editing without queuing external tasks',async()=>{
 const f=await productionWorkspaceFixture({migrations:['db/local/087-workspace-narration.sql']});
 try{
  await f.c.query("INSERT INTO public.approvals(episode_id,review_package_id,stage,decision,reason,actor_id) VALUES($1,$2,'storyboard_approved','approved','Controlled fixture',$3)",[f.episode,f.board,f.owner]);
  const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});
  expect(made.status,JSON.stringify(made.body)).toBe(200);
  const saved=await f.request('saveWorkspaceNarration',{workspaceId:made.body.id,expectedRevision:made.body.revision,clipId:made.body.clips[0].id,mode:'none',text:'保留完整正文。'});
  expect(saved.status,JSON.stringify(saved.body)).toBe(200);
  expect(saved.body.narration[0].mode).toBe('none');
  expect((await f.request('generateWorkspaceNarration',{workspaceId:made.body.id,expectedRevision:saved.body.revision,clipId:made.body.clips[0].id})).status).toBe(409);
 }finally{await f.close();}
},120_000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('confirmed narration uses the real Worker, survives restart and assembles actual duration without duplicate submissions',async()=>{
 const f=await narrationFixture();try{
  const w=f.made,base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  const save=await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:'完整口播不能删词。'});expect(save.status,JSON.stringify(save.body)).toBe(200);
  expect((await f.request('generateWorkspaceNarration',base)).status).toBe(409);
  expect((await f.request('confirmWorkspaceNarration',base)).status).toBe(200);
  expect((await f.request('generateWorkspaceNarration',base)).status).toBe(409);await f.authorize();
  const generated=await f.request('generateWorkspaceNarration',base);expect(generated.status,JSON.stringify(generated.body)).toBe(200);const task=generated.body.narration[0].taskId;
  expect((await f.request('generateWorkspaceNarration',base)).body.narration[0].taskId).toBe(task);
  await f.restart();await f.restartWorker();expect(await f.execute(task)).toEqual({status:'completed',taskId:task});await f.restart();
  const ready=await f.read();expect(ready.narration[0].error).toBeNull();
  expect((await readWorkspaceNarrationTarget(f.c,f.assetRoot,w.id,w.clips[0].id)).durationSeconds).toBe(2.4);expect(ready.narration[0].audioTrackId).toBeTruthy();expect(ready.narration[0].durationSeconds).toBe(2.4);expect(ready.narration[0].durationSeconds).toBeLessThan(2.5);
  const assembled=await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision});expect(assembled.status,JSON.stringify(assembled.body)).toBe(200);expect(assembled.body.narration[0].adoptedAudioTrackId).toBe(ready.narration[0].audioTrackId);
  const project=JSON.parse(await readFile(join(f.assetRoot,assembled.body.project.relativePath),'utf8'));const item=project.timelines[0].items.find((i:any)=>i.id===ready.narration[0].itemId);expect(item.durationInFrames).toBe(72);expect(item.sourceAssetId).toBe('audio-track-'+ready.narration[0].audioTrackId);expect(project.timelines[0].items.find((i:any)=>i.id===w.clips[1].itemId).startFrame).toBe(72);
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:assembled.body.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);await f.closeStudio();
 }finally{await f.close();}
},120_000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('unknown paid submissions stay blocked across restart and input changes; definite rejection allows one explicit retry',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();const w=f.made,base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  expect((await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:'结果未知的完整输入。'})).status).toBe(200);await f.request('confirmWorkspaceNarration',base);
  const queued=await f.request('generateWorkspaceNarration',base);await writeFile(f.responseMode,'unknown');expect((await f.execute(queued.body.narration[0].taskId))?.status).toBe('blocked');await f.restart();await f.restartWorker();
  expect((await f.request('generateWorkspaceNarration',{...base,retry:true})).status).toBe(409);
  expect((await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:'修改输入也不应重复未知请求。'})).status).toBe(200);await f.request('confirmWorkspaceNarration',base);expect((await f.request('generateWorkspaceNarration',{...base,retry:true})).status).toBe(409);
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
  const second={...base,clipId:w.clips[1].id};await f.request('saveWorkspaceNarration',{...second,mode:'tts',text:'明确拒绝可以由 Owner 重试。'});await f.request('confirmWorkspaceNarration',second);const rejected=await f.request('generateWorkspaceNarration',second);await writeFile(f.responseMode,'reject');expect((await f.execute(rejected.body.narration[1].taskId))?.status).toBe('failed');
  await writeFile(f.responseMode,'success');const retry=await f.request('generateWorkspaceNarration',{...second,retry:true});expect(retry.status,JSON.stringify(retry.body)).toBe(200);expect(retry.body.narration[1].taskId).not.toBe(rejected.body.narration[1].taskId);expect((await f.execute(retry.body.narration[1].taskId))?.status).toBe('completed');
 }finally{await f.close();}
},120_000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('both first narration tracks assemble and crop an available source without invalidating the other shot',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();let w=f.made;const jobs:string[]=[];
  for(const clip of w.clips){const base={workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id};await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:clip.text});await f.request('confirmWorkspaceNarration',base);const q=await f.request('generateWorkspaceNarration',base);expect(q.status,JSON.stringify(q.body)).toBe(200);jobs.push(q.body.narration.find((n:any)=>n.clipId===clip.id).taskId);}
  for(const job of jobs)expect((await f.execute(job))?.status).toBe('completed');
  const before=await f.read();
  const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'four-second.mp4',contentBase64:(await readFile(workspaceTestMedia('landscape-red-blue.mp4'))).toString('base64'),materialType:'video',mimeType:'video/mp4',isMainScript:false,materialPurpose:'a_roll'});
  expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  const matched=await f.request('matchWorkspaceMaterial',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,materialRevisionId:imported.body.id});expect(matched.status,JSON.stringify(matched.body)).toBe(200);w=matched.body;
  expect(w.narration[1].inputFingerprint).toBe(before.narration[1].inputFingerprint);expect(w.narration[1].audioTrackId).toBe(before.narration[1].audioTrackId);
  // Matching this shot after speech does not discard its paid output. Confirm only its new visual choice.
  await f.request('confirmWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id});
  for(let i=0;i<2;i++){const next=await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision});expect(next.status,JSON.stringify(next.body)).toBe(200);w=next.body;}
  expect(w.narration.every((n:any)=>n.adoptedAudioTrackId===n.audioTrackId)).toBe(true);
  const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(project.timelines[0].items.find((i:any)=>i.id===w.clips[0].itemId).durationInFrames).toBe(72);expect(project.timelines[0].items.find((i:any)=>i.id===w.clips[1].itemId).startFrame).toBe(72);
 }finally{await f.close();}
},120_000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a running task may register its immutable output but late speech cannot replace changed input or advance delivery',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();const w=f.made,base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:'旧输入。'});await f.request('confirmWorkspaceNarration',base);const q=await f.request('generateWorkspaceNarration',base);await writeFile(f.responseMode,'delay');const running=f.execute(q.body.narration[0].taskId);
  for(let i=0;i<50;i++){if(await readFile(f.submissions,'utf8').catch(()=>''))break;await new Promise(resolve=>setTimeout(resolve,10));}
  const changed=await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:'Owner 已手工修改的新输入。'});expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect((await running)?.status).toBe('completed');
  const refreshed=await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision});expect(refreshed.status).toBe(200);expect(refreshed.body.narration[0].text).toBe('Owner 已手工修改的新输入。');expect(refreshed.body.narration[0].audioTrackId).toBeNull();expect(refreshed.body.project.sha256).toBe(w.project.sha256);expect(refreshed.body.readiness.deliverable).toBe(false);expect((await f.c.query('SELECT stage FROM public.episodes WHERE id=$1',[f.episode])).rows[0].stage).toBe('storyboard_approved');
 }finally{await f.close();}
},120_000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('manual narration and disabled modes never enqueue TTS, while short pictures preserve a recoverable conflict',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();let w=f.made;const base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  const match=await f.request('matchWorkspaceMaterial',{...base,materialRevisionId:f.material});expect(match.status).toBe(200);w=match.body;const current={...base,expectedRevision:w.revision};
  await f.request('saveWorkspaceNarration',{...current,mode:'tts',text:'实际口播长于短画面，不允许循环填充。'});await f.request('confirmWorkspaceNarration',current);const q=await f.request('generateWorkspaceNarration',current);expect((await f.execute(q.body.narration[0].taskId))?.status).toBe('completed');
  const conflict=await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision});expect(conflict.status,JSON.stringify(conflict.body)).toBe(409);expect((await f.read()).project.sha256).toBe(w.project.sha256);
  const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'manual.mp3',contentBase64:(await readFile(workspaceTestMedia('controlled-narration-tone.mp3'))).toString('base64'),materialType:'audio',mimeType:'audio/mpeg',isMainScript:false,materialPurpose:'narration'});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  const registered=await f.request('registerManualMedia',{materialRevisionId:imported.body.id,targetId:w.clips[1].shotId,storyboardReviewPackageId:f.board,kind:'narration'});expect(registered.status,JSON.stringify(registered.body)).toBe(200);
  const registeredTrack=(await f.c.query('SELECT id FROM public.audio_tracks WHERE episode_id=$1 AND source_task_id=$2',[f.episode,registered.body.id])).rows[0];expect(registeredTrack).toBeTruthy();
  const manual={...current,clipId:w.clips[1].id};const saved=await f.request('saveWorkspaceNarration',{...manual,mode:'manual',text:'Owner 人工口播。',audioTrackId:registeredTrack.id});expect(saved.status,JSON.stringify(saved.body)).toBe(200);await f.request('confirmWorkspaceNarration',manual);
  expect((await f.request('generateWorkspaceNarration',manual)).status).toBe(409);
  const disabled=await f.request('saveWorkspaceNarration',{...manual,mode:'none',text:'关闭后保留正文。'});expect(disabled.status).toBe(200);expect((await f.request('generateWorkspaceNarration',manual)).status).toBe(409);
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
 }finally{await f.close();}
},120_000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each([false,true])('actual narration drives the paid video window and freezes speech provenance (changed=%s)',async changed=>{
 const f=await narrationFixture(undefined,undefined,true);try{
  await f.authorize();let w=f.made;let base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  const uploaded=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'first.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(uploaded.status,JSON.stringify(uploaded.body)).toBe(200);await f.request('setWanBudget',{trialCents:100,totalCents:200,full:false});
  await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:'主声音完整保留，画面仅使用实际窗口。'});await f.request('confirmWorkspaceNarration',base);
  const imageData={...base,materialRevisionId:uploaded.body.id,prompt:'画面缓慢推进',durationSeconds:11,reservationCents:90};
  const notReady=await f.request('generateWorkspaceImage',imageData);expect(notReady.status,JSON.stringify(notReady.body)).toBe(409);
  const q=await f.request('generateWorkspaceNarration',base);expect(q.status).toBe(200);await f.execute(q.body.narration[0].taskId);const speech=(await f.read()).narration[0];expect(speech.adoptedAudioTrackId).toBeNull();
  const image=await f.request('generateWorkspaceImage',imageData);expect(image.status,JSON.stringify(image.body)).toBe(200);w=image.body;base={...base,expectedRevision:w.revision};
  expect(w.clips[0].image.durationSeconds).toBe(2.4);expect(w.clips[0].image.providerDurationSeconds).toBe(4);
  const task=w.clips[0].image.taskId,request=(await f.c.query('SELECT * FROM local_identity.workspace_image_requests WHERE task_id=$1',[task])).rows[0];expect(Number(request.duration_seconds)).toBe(2.4);expect(Number(request.provider_duration_seconds)).toBe(4);expect(request.narration_target).toMatchObject({audioTrackId:speech.audioTrackId,sha256:speech.sha256,inputFingerprint:speech.inputFingerprint,durationSeconds:2.4});
  if(changed){const save=await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:'Owner 后来改过口播输入。'});expect(save.status).toBe(200);}
  expect((await f.execute(task))?.status).toBe('completed');const fill=await f.request('fillWorkspaceImageResult',{workspaceId:w.id,expectedRevision:w.revision,taskId:task});
  if(changed){expect(fill.status,JSON.stringify(fill.body)).toBe(409);expect((await f.read()).project.sha256).toBe(w.project.sha256);}else{
   expect(fill.status,JSON.stringify(fill.body)).toBe(200);w=fill.body;
   const refresh=await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision});expect(refresh.status,JSON.stringify(refresh.body)).toBe(200);w=refresh.body;
   const doc=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(doc.timelines[0].items.find((i:any)=>i.id===w.clips[0].itemId).durationInFrames).toBe(72);expect(doc.timelines[0].items.find((i:any)=>i.id===speech.itemId).durationInFrames).toBe(72);
   const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);await f.closeStudio();
   const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{inspectMp4Artifact}=await import('../worker/mediaTools');const spec=join(f.root,'narration-video-render.json'),output=join(f.root,'narration-video.mp4');
   await writeFile(spec,JSON.stringify({openchatcutRoot:f.runtime.root,assetRoot:f.assetRoot,outputPath:output,state:{...doc.timelines[0],width:180,height:320},sources:doc.assets.map((a:{src:string})=>({relativePath:a.src}))}));
   await promisify(execFile)(process.execPath,['scripts/openchatcut-render.mjs',spec],{timeout:120000,maxBuffer:4*1024*1024});const rendered=await inspectMp4Artifact(output);expect(rendered.hasAudio).toBe(true);expect(rendered.durationSeconds).toBeGreaterThanOrEqual(4.4);expect(rendered.durationSeconds).toBeLessThan(4.5);
   if(process.env.LOOP_T05_EVIDENCE_DIR){const {mkdir,copyFile}=await import('node:fs/promises');await mkdir(process.env.LOOP_T05_EVIDENCE_DIR,{recursive:true});await copyFile(output,join(process.env.LOOP_T05_EVIDENCE_DIR,'narration-video.mp4'));await writeFile(join(process.env.LOOP_T05_EVIDENCE_DIR,'render-observation.json'),JSON.stringify({voiceDurationSeconds:2.4,providerDurationSeconds:4,nativeFrames:72,rendered},null,2));}

  }
  const sent=JSON.parse((await readFile(f.videoSubmissions,'utf8')).trim());expect(sent.duration).toBe(4);
 }finally{await f.close();}
},120_000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('first speech remains a candidate after a real native save and never overwrites the edited project',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();let w=f.made;const base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:'手改后保留原工程。'});await f.request('confirmWorkspaceNarration',base);const queued=await f.request('generateWorkspaceNarration',base);
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
  const nativePath=join(f.assetRoot,`episodes/${f.episode}/openchatcut-work/current/runtime/project-store-v1.json`),store=JSON.parse(await readFile(nativePath,'utf8'));store.entries[`project:${w.project.projectId}`].timelines[0].items[0].transform.x=17;await writeFile(nativePath,JSON.stringify(store));
  const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});
  expect((await f.execute(queued.body.narration[0].taskId))?.status).toBe('completed');const refreshed=await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision});expect(refreshed.status).toBe(200);expect(refreshed.body.project.sha256).toBe(w.project.sha256);expect(refreshed.body.narration[0].audioTrackId).toBeTruthy();expect(refreshed.body.narration[0].adoptedAudioTrackId).toBeNull();
  const doc=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(doc.timelines[0].items[0].transform.x).toBe(17);
 }finally{await f.close();}
},120_000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('speech beyond the Provider maximum blocks a video submission without cutting words',async()=>{
 const f=await narrationFixture(undefined,undefined,true);try{
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','sine=frequency=330:sample_rate=48000','-t','16','-c:a','libmp3lame',join(f.assetRoot,`episodes/${f.episode}/voice.mp3`)]);
  await f.authorize();const w=f.made,base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:'超出单次画面服务范围的口播必须明确拆镜，不删词。'});await f.request('confirmWorkspaceNarration',base);const q=await f.request('generateWorkspaceNarration',base);await f.execute(q.body.narration[0].taskId);
  const uploaded=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'first.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});
  const blocked=await f.request('generateWorkspaceImage',{...base,materialRevisionId:uploaded.body.id,prompt:'保持自然运动',durationSeconds:4,reservationCents:90});expect(blocked.status,JSON.stringify(blocked.body)).toBe(409);expect(blocked.body.error).toContain('上限 15 秒');expect((await readFile(f.videoSubmissions,'utf8').catch(()=>''))).toBe('');expect((await f.read()).narration[0].text).toBe('超出单次画面服务范围的口播必须明确拆镜，不删词。');
 }finally{await f.close();}
},120_000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('legacy narration already running before workspace activation cannot promote the new draft or delivery',async()=>{
 const f=await narrationFixture(undefined,undefined,false,true);try{
  const saved=await f.request('saveTtsDraft',{reviewPackageId:f.board,shotId:'shot-1',audioMode:'tts',subtitleText:'旧流程正在运行。',subtitlesEnabled:false,ttsText:'旧流程正在运行。'});expect(saved.status,JSON.stringify(saved.body)).toBe(200);
  // Arrange an already-created legacy task through its real Owner RPC. The legacy
  // HTTP mount preflight is outside this delayed-completion scenario.
  await f.c.query('BEGIN');await f.c.query('SET SESSION AUTHORIZATION loop_app');await f.c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);await f.c.query('UPDATE local_identity.input_episodes SET narration_enabled=true WHERE episode_id=$1',[f.episode]);
  const queued=(await f.c.query('SELECT to_jsonb(local_identity.generate_input_shot_tts($1,$2,$3,false)) task',[f.episode,f.board,'shot-1'])).rows[0].task;await f.c.query('SET SESSION AUTHORIZATION DEFAULT');await f.c.query('COMMIT');
  await writeFile(f.responseMode,'delay');const running=f.execute(queued.id);
  for(let i=0;i<50;i++){if(await readFile(f.submissions,'utf8').catch(()=>''))break;await new Promise(resolve=>setTimeout(resolve,10));}
  const prepared=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(prepared.status).toBe(200);expect((await running)?.status).toBe('completed');
  const w=prepared.body,refreshed=await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision});expect(refreshed.status).toBe(200);expect(refreshed.body.project.sha256).toBe(w.project.sha256);expect(refreshed.body.narration[0].adoptedAudioTrackId).toBeNull();expect(refreshed.body.readiness.deliverable).toBe(false);expect((await f.c.query('SELECT stage FROM public.episodes WHERE id=$1',[f.episode])).rows[0].stage).toBe('storyboard_approved');
 }finally{await f.close();}
},120_000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('one shot with two visual ranges keeps one voice and its original task after deleting the first range',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();let w=f.made;const first=w.clips[0],base={workspaceId:w.id,expectedRevision:w.revision,clipId:first.id};await f.request('saveWorkspaceNarration',{...base,mode:'tts',text:'镜头主声不绑定可删除的画面引用。'});await f.request('confirmWorkspaceNarration',base);const queued=await f.request('generateWorkspaceNarration',base);await f.execute(queued.body.narration[0].taskId);w=(await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision})).body;
  const original=w.narration.find((n:any)=>n.shotId===first.shotId),ranges=await f.request('saveWorkspaceVideoRanges',{workspaceId:w.id,expectedRevision:w.revision,shotId:first.shotId,ranges:[{clipId:first.id,materialRevisionId:f.material,sourceInFrame:0,durationInFrames:36,durationLocked:false},{materialRevisionId:f.material,sourceInFrame:12,durationInFrames:36,durationLocked:false}]});expect(ranges.status,JSON.stringify(ranges.body)).toBe(200);w=ranges.body;
  const clips=w.clips.filter((c:any)=>c.shotId===first.shotId);expect(clips).toHaveLength(2);expect(w.narration.filter((n:any)=>n.shotId===first.shotId)).toHaveLength(1);
  for(const clip of clips)expect((await readWorkspaceNarrationTarget(f.c,f.assetRoot,w.id,clip.id)).audioTrackId).toBe(original.audioTrackId);
  expect(w.captions.find((c:any)=>c.shotId===first.shotId).durationMs).toBe(2400);
  const removed=await f.request('saveWorkspaceVideoRanges',{workspaceId:w.id,expectedRevision:w.revision,shotId:first.shotId,ranges:[{clipId:clips[1].id,materialRevisionId:f.material,sourceInFrame:12,durationInFrames:36,durationLocked:false}]});expect(removed.status,JSON.stringify(removed.body)).toBe(200);w=removed.body;
  const voice=w.narration.find((n:any)=>n.shotId===first.shotId);expect(voice).toMatchObject({taskId:original.taskId,audioTrackId:original.audioTrackId,adoptedAudioTrackId:original.adoptedAudioTrackId,itemId:original.itemId,text:'镜头主声不绑定可删除的画面引用。',status:'duration_conflict'});expect((await readWorkspaceNarrationTarget(f.c,f.assetRoot,w.id,clips[1].id)).audioTrackId).toBe(original.audioTrackId);
  const duplicate=await f.request('generateWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:clips[1].id});expect(duplicate.status,JSON.stringify(duplicate.body)).toBe(200);expect(duplicate.body.narration.find((n:any)=>n.shotId===first.shotId).taskId).toBe(original.taskId);
  const doc=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(doc.timelines.flatMap((t:any)=>t.items).filter((i:any)=>i.id===original.itemId)).toHaveLength(1);expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
 }finally{await f.close();}
},120_000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('registered completed task media resolve directly without a fake material and reject changed bytes',async()=>{
 const f=await productionWorkspaceFixture();try{
  const {copyFile}=await import('node:fs/promises'),{randomUUID,createHash}=await import('node:crypto'),{resolveWorkspaceSource}=await import('./workspaceSources');const path=`episodes/${f.episode}/registered-task-video.mp4`;await copyFile(join(f.assetRoot,f.videoPath),join(f.assetRoot,path));const bytes=await readFile(join(f.assetRoot,path)),sha=createHash('sha256').update(bytes).digest('hex');
  await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'b_roll_asset',$4,$5,$6)",[randomUUID(),f.episode,f.task,path,sha,bytes.length]);
  expect(await resolveWorkspaceSource(f.c,f.assetRoot,f.episode,path)).toMatchObject({registration:'task_artifact',relative_path:path,sha256:sha,file_size:String(bytes.length)});
  await expect(resolveWorkspaceSource(f.c,f.assetRoot,f.episode,'blob:unregistered')).rejects.toMatchObject({status:409});await writeFile(join(f.assetRoot,path),Buffer.alloc(bytes.length));await expect(resolveWorkspaceSource(f.c,f.assetRoot,f.episode,path)).rejects.toMatchObject({status:409});
 }finally{await f.close();}
},120_000);
