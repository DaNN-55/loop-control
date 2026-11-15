// @vitest-environment node
import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {editStudioDocument} from './studioDocument.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
import {ownerTransaction} from './ownerTransaction';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1'||!process.env.LOOP_TEST_CONTEXT_MODULE).each(['video','audio'] as const)('sound facts match the actual decoded output of a nested sequence on a %s track',async(kind)=>{
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=runtimeContext();expect(context.dailyRuntime).toBe(false);expect(context.isolatedFixtureContainer).toBe(true);
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:productionScriptTemplate.replace('镜头时长（秒）：5','镜头时长（秒）：1')});
 try{
  expect((await f.send('start')).status).toBe(200);const made=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(made.status).toBe(200);let w=made.body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.productionWorkspace)w=r.body.productionWorkspace;else if(r.body.id===w.id)w=r.body;return r.body;};
  const upload=async(type:'image'|'audio',name:string)=>{const r=await f.send('importMaterial',{sourceKind:'file',sourcePath:name,materialType:type,materialPurpose:type==='image'?'visual_reference':'background_music',mimeType:type==='image'?'image/png':'audio/mpeg',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia(name))).toString('base64')});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body.id;};
  const image=await upload('image','still-striped.png'),audio=await upload('audio','controlled-narration-tone.mp3'),clip=w.clips[0];
  await send('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image,usage:'still',durationSeconds:1,fit:'contain',focusX:0,focusY:0});await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  await send('prepareWorkspaceAudio',{kind:'bgm',materialRevisionId:audio,description:'嵌套实际声音',durationSeconds:1,anchor:'absolute',offsetSeconds:0});await send('adoptWorkspaceAudio',{preparationId:w.audio.preparations[0].id});
  const opened=await send('openWorkspaceStudio');
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  await editStudioDocument(opened.studioUrl,w.project.projectId,document=>{
   const root=document.timelines[0],sound=root.items.find((item:any)=>item.kind==='audio'),visual=root.items.find((item:any)=>item.kind==='image'),child=structuredClone(root);expect(sound).toBeTruthy();child.id='rendered-sound-child';child.items=[sound];root.items=root.items.filter((item:any)=>item!==sound);document.timelines.push(child);
   root.items.push({id:'rendered-sound-sequence',name:'嵌套声音验证',kind:'sequence',track:kind==='video'?visual.track:sound.track,timelineId:child.id,startFrame:0,durationInFrames:30,srcInFrame:0});
  });
  await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256});await send('closeWorkspaceStudio');await send('exportWorkspace');
  const output=w.exports[0];expect(output.status,JSON.stringify(output)).toBe('ready');
  const sources=output.checks.find((check:any)=>check.name==='used_content').sources;
  expect(sources.some((source:any)=>source.sha256==='9c40eaec3822c6943dee6f975d405551ce9b658dd55898112fc6a163f45b5100')).toBe(kind==='video');
  const response=await fetch(`${f.origin}/_local-artifact?episode=${f.newEpisode}&path=${encodeURIComponent(output.artifact.relativePath)}&sha256=${output.artifact.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const bytes=Buffer.from(await response.arrayBuffer());expect(createHash('sha256').update(bytes).digest('hex')).toBe(output.artifact.sha256);
  const evidence=join(process.env.LOOP_STORY_EVIDENCE!,'sound-rendering-'+kind);await mkdir(evidence,{recursive:true});const file=join(evidence,'actual-output.mp4');await writeFile(file,bytes);await writeFile(join(evidence,'project.json'),await readFile(join(f.assetRoot,output.project.relativePath)));
  const streams=execFileSync('ffprobe',['-v','error','-select_streams','a','-show_entries','stream=index','-of','csv=p=0',file],{encoding:'utf8'}).trim();
  const pcm=streams?execFileSync('ffmpeg',['-nostdin','-v','error','-i',file,'-map','0:a:0','-ac','1','-ar','48000','-f','f32le','pipe:1'],{maxBuffer:4*1024*1024}):Buffer.alloc(0);let squares=0;for(let index=0;index<pcm.length;index+=4){const value=pcm.readFloatLE(index);expect(Number.isFinite(value)).toBe(true);squares+=value*value;}
  const samples=pcm.length/4,rms=samples?Math.sqrt(squares/samples):0,events=(await f.c.query("SELECT event_type,payload FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type LIKE 'sound_%' ORDER BY id",[f.newEpisode])).rows;
  await writeFile(join(evidence,'observation.json'),JSON.stringify({kind,audioStreams:streams?streams.split('\n').length:0,samples,rms,exportSha256:output.artifact.sha256,events},null,2));
  if(kind==='video'){expect(samples).toBeGreaterThan(0);expect(rms).toBeGreaterThan(.00001);}else expect(rms).toBeLessThan(.000001);
  expect(events.filter(event=>event.event_type==='sound_used')).toHaveLength(kind==='video'?1:0);expect(events.filter(event=>event.event_type==='sound_withdrawn')).toHaveLength(1);
  const old=events;await f.restart();const reopened=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(reopened.status).toBe(200);expect((await f.c.query("SELECT event_type,payload FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type LIKE 'sound_%' ORDER BY id",[f.newEpisode])).rows).toEqual(old);
 }finally{await f.close();}
},120000);

// The same child may be referenced by a rendered and an ignored sequence. Metadata
// must follow the rendered placement, including the native sequence gain semantics.
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1'||!process.env.LOOP_TEST_CONTEXT_MODULE).each(['video','audio'] as const)('delivery narration windows match rendered nested placements on %s tracks',async(kind)=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:productionScriptTemplate.replace('镜头时长（秒）：5','镜头时长（秒）：1')}),worker=f.workerPool();
 try{
  expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.productionWorkspace)w=r.body.productionWorkspace;else if(r.body.id===w.id)w=r.body;return r.body;};
  const upload=async(type:string,name:string,mime:string)=>{const r=await f.send('importMaterial',{sourceKind:'file',sourcePath:name,materialType:type,materialPurpose:'general_reference',mimeType:mime,isMainScript:false,contentBase64:(await readFile(workspaceTestMedia(name))).toString('base64')});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body.id;};
  const image=await upload('image','still-striped.png','image/png'),audio=await upload('audio','controlled-narration-tone.mp3','audio/mpeg'),clip=w.clips[0];
  await send('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image,usage:'still',durationSeconds:1,fit:'contain',focusX:0,focusY:0});await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  await send('saveWorkspaceNarration',{clipId:clip.id,mode:'manual',text:'这份人工录音是明确采用的来源。',materialRevisionId:audio});
  const track=w.narration[0].audioTrackId,prepared=await send('prepareWorkspaceCandidate',{candidateId:track,durationPolicy:'keep-target'});await send('adoptWorkspaceCandidate',{candidateId:track,adoptionId:prepared.adoptionId});
  const opened=await send('openWorkspaceStudio');await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{
   const root=doc.timelines[0],voice=root.items.find((i:any)=>i.id==='workspace-narration-shot-'+clip.shotId),child=structuredClone(root);expect(voice).toBeTruthy();child.id='voice-child';child.items=[voice];root.items=root.items.filter((i:any)=>i!==voice);doc.timelines.push(child);
   const sequence={id:'ignored-voice-sequence',kind:'sequence',name:'音频轨不渲染',track:voice.track,timelineId:child.id,startFrame:0,durationInFrames:30,srcInFrame:0};root.items.push(sequence);
   if(kind==='video')root.items.push({...sequence,id:'rendered-voice-sequence',name:'画面轨嵌套声音',track:root.items[0].track,volume:0});
  });await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});await send('closeWorkspaceStudio');await send('exportWorkspace');
  const exported=w.exports[0];expect(exported.status,JSON.stringify(exported)).toBe('ready');await send('confirmWorkspaceExport',{exportId:exported.id,expectedExportSha256:exported.artifact.sha256,expectedContentSha256:w.contentSha256});
  await send('prepareWorkspaceDelivery',{exportId:exported.id,expectedExportSha256:exported.artifact.sha256,expectedContentSha256:w.contentSha256,title:'嵌套声音对账',description:'',tags:[],coverBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});
  const claimed=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:w.deliveries[0].taskId,p_worker_capacity:2}) as any[])[0],result=await runWorkspaceDeliveryProcess(f,claimed,{mountPath:f.mountPath});expect(result.status,JSON.stringify(result)).toBe('completed');
  const metadata=result.artifacts.find((a:any)=>a.artifactType==='metadata'),response=await fetch(`${f.origin}/_local-artifact?episode=${f.newEpisode}&path=${encodeURIComponent(metadata.relativePath)}&sha256=${metadata.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const bytes=Buffer.from(await response.arrayBuffer());expect(createHash('sha256').update(bytes).digest('hex')).toBe(metadata.sha256);const record=JSON.parse(bytes.toString()).narration[0];
  expect(record.windows).toHaveLength(kind==='video'?1:0);if(kind==='video'){expect(record.audioTrackId).toBe(track);expect(record.windows[0]).toMatchObject({audible:true,srcInFrame:0,sourceDurationSeconds:1,playbackRate:1});}else{expect(record.audioTrackId).toBeNull();expect(record.adoptedText).toBeNull();}
  await writeFile(join(process.env.LOOP_STORY_EVIDENCE!,'nested-voice-'+kind+'.json'),bytes);
 }finally{await worker.end();await f.close();}
},120000);
