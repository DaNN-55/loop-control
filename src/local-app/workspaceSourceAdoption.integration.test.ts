// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {workspaceAudioMedia} from './workspaceAudioMedia.fixture';
import {editStudioDocument} from './studioDocument.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
import {ownerTransaction} from './ownerTransaction';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each([['custom-voice',false],['workspace-main-voice',false],['custom-voice',true]] as const)('source adoption preserves native presentation and exact original source windows across repetition and replacement (track %s, missing original SHA: %s)',async(track,legacy)=>{
 const script='# 原声音量接续\n\n## 制作设置\n- 模板版本：3\n- 画幅：9:16\n- 字幕：关闭\n- 旁白音量（dB）：-9\n\n## 正文\n### 段落 01\n- 口播：保留当前原声人工编辑。\n- 画面来源：已有素材\n- 镜头时长（秒）：3\n';
 const f=await formalWorkflowFixture({freshAccount:true,controlled:true,scriptText:script}),worker=f.workerPool();
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  const media=await workspaceAudioMedia(f.root);const imported=await f.send('importMaterial',{sourceKind:'file',sourcePath:'source.mp4',contentBase64:(await readFile(media.video)).toString('base64'),materialType:'video',mimeType:'video/mp4',isMainScript:false,materialPurpose:'general_reference'});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const clip=w.clips[0],voiceId=`workspace-source-shot-${clip.shotId}`;
  const extract=async()=>{await send('prepareWorkspaceAudio',{kind:'source',shotId:clip.shotId,sourceItemId:clip.itemId});const prep=w.audio.preparations[0];const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:prep.taskId,p_worker_capacity:1})as any[])[0];expect(task.task_id).toBe(prep.taskId);expect((await runWorkspaceDeliveryProcess(f,task,{mountPath:f.mountPath,media:{mode:'local'}})).status).toBe('completed');return prep;};
  const native=async(edit:Parameters<typeof editStudioDocument>[2])=>{const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;await editStudioDocument(opened.studioUrl,w.project.projectId,edit);w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256})).productionWorkspace;await send('closeWorkspaceStudio');};
  const project=async()=>JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));
  await send('matchWorkspaceMaterial',{clipId:clip.id,materialRevisionId:imported.body.id});const prep=await extract();await send('adoptWorkspaceAudio',{preparationId:prep.id});expect(w.audio.mix.voices[0].gainDb).toBeCloseTo(-9);
  await native(doc=>{const t=doc.timelines[0],voice=t.items.find((i:any)=>i.id===voiceId);t.tracks[track]={kind:'audio',name:'人工原声轨',role:'anchor',audioRouting:{duckDepthDb:-3}};if(!t.trackOrder.includes(track))t.trackOrder.push(track);Object.assign(voice,{name:'人工原声窗口',track,volume:10**(-15/20),startFrame:6,durationInFrames:60,srcInFrame:4,playbackRate:1,fadeInFrames:3});});
  const before=await project(),events=async()=>(await f.c.query("SELECT event_type,payload FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type LIKE 'sound_%' ORDER BY id",[f.newEpisode])).rows,observed=await events();
  await send('adoptWorkspaceAudio',{preparationId:prep.id});let after=await project();expect(after.timelines[0].items.find((i:any)=>i.id===voiceId)).toEqual(before.timelines[0].items.find((i:any)=>i.id===voiceId));expect(after.timelines[0].tracks[track]).toEqual(before.timelines[0].tracks[track]);expect(await events()).toEqual(observed);expect(w.audio.mix.voices[0]).toMatchObject({mode:'source',gainDb:-15,startSeconds:.2,durationSeconds:2,coverage:'partial'});
  // New extraction starts 3 frames later in the same video. Keep original audio
  // frame 4 by selecting frame 1 of the new registered audio, never by resetting.
  await native(doc=>{doc.timelines[0].items.find((i:any)=>i.id===clip.itemId).srcInFrame=3;if(legacy){const prior=doc.timelines[0].items.find((i:any)=>i.id===voiceId);delete doc.assets.find((a:any)=>a.id===prior.sourceAssetId).loopControlAudioSource.sha256;}});const replacement=await extract();expect(replacement.id).not.toBe(prep.id);await send('adoptWorkspaceAudio',{preparationId:replacement.id});after=await project();const voice=after.timelines[0].items.find((i:any)=>i.id===voiceId);expect(voice).toMatchObject({name:'人工原声窗口',track,volume:10**(-15/20),startFrame:6,durationInFrames:60,srcInFrame:1,playbackRate:1,fadeInFrames:3,sourceAssetId:'audio-track-'+w.audio.preparations.find((p:any)=>p.id===replacement.id).audioTrackId});expect(after.timelines[0].tracks[track]).toEqual(before.timelines[0].tracks[track]);
  await f.restart();const response=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);w=(await response.json()).workspace;expect(w.audio.mix.voices[0]).toMatchObject({gainDb:-15,startSeconds:.2,durationSeconds:2});await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');
  // A later source cannot represent the retained original audio interval.
  await native(doc=>{doc.timelines[0].items.find((i:any)=>i.id===clip.itemId).srcInFrame=30;});const unavailable=await extract(),accepted=w.project.sha256,acceptedBytes=await readFile(join(f.assetRoot,w.project.relativePath));const rejected=await f.send('adoptWorkspaceAudio',{workspaceId:w.id,expectedRevision:w.revision,preparationId:unavailable.id});expect(rejected.status,JSON.stringify(rejected.body)).toBe(409);expect(rejected.body.error).toContain('短于');const read=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(read.status).toBe(200);w=(await read.json()).workspace;expect(w.project.sha256).toBe(accepted);expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(acceptedBytes);expect(w.audio.preparations.find((p:any)=>p.id===unavailable.id).adoptedItemId).toBeNull();
 }finally{await worker.end();await f.close();}
},180000);
