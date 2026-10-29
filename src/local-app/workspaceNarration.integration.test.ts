// @vitest-environment node
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
  const ready=await f.read();
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
  const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'four-second.mp4',contentBase64:(await readFile('/private/tmp/loop-152-orchestration/media/landscape-red-blue.mp4')).toString('base64'),materialType:'video',mimeType:'video/mp4',isMainScript:false,materialPurpose:'a_roll'});
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
  const refreshed=await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision});expect(refreshed.status).toBe(200);expect(refreshed.body.narration[0].text).toBe('Owner 已手工修改的新输入。');expect(refreshed.body.narration[0].audioTrackId).toBeNull();expect(refreshed.body.project.sha256).toBe(w.project.sha256);expect(refreshed.body.readiness.deliverable).toBe(false);
 }finally{await f.close();}
},120_000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('manual narration and disabled modes never enqueue TTS, while short pictures preserve a recoverable conflict',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();let w=f.made;const base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  const match=await f.request('matchWorkspaceMaterial',{...base,materialRevisionId:f.material});expect(match.status).toBe(200);w=match.body;const current={...base,expectedRevision:w.revision};
  await f.request('saveWorkspaceNarration',{...current,mode:'tts',text:'实际口播长于短画面，不允许循环填充。'});await f.request('confirmWorkspaceNarration',current);const q=await f.request('generateWorkspaceNarration',current);expect((await f.execute(q.body.narration[0].taskId))?.status).toBe('completed');
  const conflict=await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision});expect(conflict.status,JSON.stringify(conflict.body)).toBe(409);expect((await f.read()).project.sha256).toBe(w.project.sha256);
  const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'manual.mp3',contentBase64:(await readFile('/private/tmp/loop-152-orchestration/media/controlled-narration-tone.mp3')).toString('base64'),materialType:'audio',mimeType:'audio/mpeg',isMainScript:false,materialPurpose:'narration'});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  const registered=await f.request('registerManualMedia',{materialRevisionId:imported.body.id,targetId:w.clips[1].shotId,storyboardReviewPackageId:f.board,kind:'narration'});expect(registered.status,JSON.stringify(registered.body)).toBe(200);
  const registeredTrack=(await f.c.query('SELECT id FROM public.audio_tracks WHERE episode_id=$1 AND source_task_id=$2',[f.episode,registered.body.id])).rows[0];expect(registeredTrack).toBeTruthy();
  const manual={...current,clipId:w.clips[1].id};const saved=await f.request('saveWorkspaceNarration',{...manual,mode:'manual',text:'Owner 人工口播。',audioTrackId:registeredTrack.id});expect(saved.status,JSON.stringify(saved.body)).toBe(200);await f.request('confirmWorkspaceNarration',manual);
  expect((await f.request('generateWorkspaceNarration',manual)).status).toBe(409);
  const disabled=await f.request('saveWorkspaceNarration',{...manual,mode:'none',text:'关闭后保留正文。'});expect(disabled.status).toBe(200);expect((await f.request('generateWorkspaceNarration',manual)).status).toBe(409);
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
 }finally{await f.close();}
},120_000);
