import {storyBrowser} from './storyBrowser.fixture';
// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {ownerTransaction} from './ownerTransaction';
import {readProductionMetricsV2} from './productionMetricsCollected';
import {productionScriptTemplate} from '../reviews/productionScript';
import {defaultShotCaptionContract} from '../shotCaptions';
import {editStudioDocument} from './studioDocument.fixture';
import {workspaceAudioMedia} from './workspaceAudioMedia.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('observes actual local music adoption, gain changes, disable and re-enable without counting preparation or reopen as use',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:productionScriptTemplate.replace('镜头时长（秒）：5','镜头时长（秒）：1')});
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+': '+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const summary=async()=>{const now=Date.now();return(await readProductionMetricsV2(f.pool,f.owner,{from:new Date(now-16*3600000).toISOString().slice(0,10),toExclusive:new Date(now+32*3600000).toISOString().slice(0,10),includeTestEpisodes:true})).collected!.detail;};
  const music=await f.send('importMaterial',{sourceKind:'file',sourcePath:'music.mp3',materialType:'audio',materialPurpose:'background_music',mimeType:'audio/mpeg',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('controlled-narration-tone.mp3'))).toString('base64')});expect(music.status).toBe(200);
  await send('prepareWorkspaceAudio',{kind:'bgm',materialRevisionId:music.body.id,description:'测试配乐',durationSeconds:1});const preparation=w.audio.preparations[0];
  expect((await summary()).soundUse).toMatchObject({version:'sound-use/v1',used:0,withdrawn:0,changed:0});
  await send('adoptWorkspaceAudio',{preparationId:preparation.id});
  expect((await summary()).soundUse).toMatchObject({used:1,withdrawn:0,changed:0,roles:{bgm:{used:1,withdrawn:0,changed:0}}});
  await send('mixWorkspaceAudio',{edit:{kind:'sound',workspaceId:w.id,itemId:'workspace-bgm',gainDb:-18,duckDepthDb:10}});
  expect((await summary()).soundUse).toMatchObject({used:1,withdrawn:0,changed:1});
  await send('setWorkspaceAudioEnabled',{kind:'bgm',enabled:false});expect((await summary()).soundUse).toMatchObject({used:1,withdrawn:1,changed:1});
  await send('setWorkspaceAudioEnabled',{kind:'bgm',enabled:true});expect((await summary()).soundUse).toMatchObject({used:2,withdrawn:1,changed:1});
  const before=await summary();await f.restart();await send('refreshWorkspaceAudio');expect(await summary()).toEqual(expect.objectContaining({soundUse:before.soundUse}));
  const events=(await f.c.query("SELECT payload FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type LIKE 'sound_%' ORDER BY id",[f.newEpisode])).rows;
  expect(events).toHaveLength(4);expect(events[0].payload).toMatchObject({source_kind:'material',source_id:music.body.id,role:'bgm'});expect(JSON.stringify(events)).not.toContain('测试配乐');expect(JSON.stringify(events)).not.toContain('relativePath');
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('does not invent sound use for a silent video registered through the real frozen legacy recovery boundary',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:productionScriptTemplate.replace('镜头时长（秒）：5','镜头时长（秒）：1')});
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+': '+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const image=await f.send('importMaterial',{sourceKind:'file',sourcePath:'image.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(image.status).toBe(200);
  const clip=w.clips[0];await send('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image.body.id,usage:'still',durationSeconds:1,fit:'contain',focusX:0,focusY:0});await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  const directory=(await f.c.query('SELECT directory_relative_path FROM local_identity.episode_storage_location($1)',[f.newEpisode])).rows[0].directory_relative_path,path=directory+'/recovered-silent.mp4';
  execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=red:size=180x320:rate=30','-t','1','-an','-c:v','libx264','-pix_fmt','yuv420p',join(f.assetRoot,path)]);
  const bytes=await readFile(join(f.assetRoot,path)),sha=createHash('sha256').update(bytes).digest('hex'),task=randomUUID(),source={relativePath:path,sha256:sha,fileSize:bytes.length};
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot)VALUES($1,$2,'generate_narration','completed',$3)",[task,f.newEpisode,{input_artifacts:[source]}]);
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.register_workspace_recovery_source($1,$2)',[f.newEpisode,JSON.stringify(source)]));
  const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{doc.assets.push({id:'recovered-video',name:'旧恢复视频',kind:'video',src:path,durationInFrames:30});const visual=doc.timelines[0].items.find((i:any)=>i.id===clip.itemId);visual.kind='video';visual.src=path;visual.sourceAssetId='recovered-video';visual.sourceContentHash=sha;visual.volume=1;});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256})).productionWorkspace;
  expect((await f.c.query("SELECT count(*)::int n FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type LIKE 'sound_%'",[f.newEpisode])).rows[0].n).toBe(0);await send('closeWorkspaceStudio');
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['muted','hidden','keyframes','source_end']as const)('uses the native audible sequence window for local effects, replacement and track %s rather than counting the media pool',async(disabled)=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:productionScriptTemplate.replace('镜头时长（秒）：5','镜头时长（秒）：1')});
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+': '+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const upload=async(path:string,kind:string,purpose:string)=>{const r=await f.send('importMaterial',{sourceKind:'file',sourcePath:path.split('/').at(-1),materialType:kind,materialPurpose:purpose,mimeType:kind==='audio'?'audio/mpeg':'image/png',isMainScript:false,contentBase64:(await readFile(path)).toString('base64')});expect(r.status).toBe(200);return r.body.id;};
  const summary=async()=>{const now=Date.now();return(await readProductionMetricsV2(f.pool,f.owner,{from:new Date(now-16*3600000).toISOString().slice(0,10),toExclusive:new Date(now+32*3600000).toISOString().slice(0,10),includeTestEpisodes:true})).collected!.detail.soundUse;};
  const image=await upload(workspaceTestMedia('still-striped.png'),'image','visual_reference'),clip=w.clips[0];await send('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image,usage:'still',durationSeconds:1,fit:'contain',focusX:0,focusY:0});await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  const media=await workspaceAudioMedia(f.root),first=await upload(media.bgm,'audio','sound_effect'),replacement=await upload(media.voice,'audio','sound_effect');
  const replacementInfo=(await f.c.query('SELECT storage_path,sha256 FROM public.production_material_revisions WHERE id=$1',[replacement])).rows[0];
  await send('prepareWorkspaceAudio',{kind:'sfx',materialRevisionId:first,description:'本地音效',durationSeconds:.4,anchor:'absolute',offsetSeconds:.2});const prep=w.audio.preparations[0];await send('adoptWorkspaceAudio',{preparationId:prep.id});
  expect(await summary()).toMatchObject({used:1,withdrawn:0,changed:0,roles:{sfx:{used:1,withdrawn:0,changed:0}}});
  await send('adoptWorkspaceAudio',{preparationId:prep.id});expect(await summary()).toMatchObject({used:1,withdrawn:0,changed:0});
  const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{
   const root=doc.timelines[0],sound=root.items.find((i:any)=>i.id===prep.adoptedItemId||i.loopControlAudio?.preparationId===prep.id);expect(sound).toBeTruthy();
   root.items=root.items.filter((i:any)=>i!==sound);const child=structuredClone(root);child.id='sound-child';child.items=[{...sound,startFrame:0,durationInFrames:12}];doc.timelines.push(child);
   root.items.push({id:'audible-sequence',name:'音效序列',kind:'sequence',track:root.items[0].track,timelineId:child.id,startFrame:0,durationInFrames:30,srcInFrame:0,volume:0,fadeInFrames:30,keyframes:{volume:[{frame:0,value:0},{frame:30,value:0}]}});
   const unused=structuredClone(child);unused.id='unreachable-sound';unused.items[0].id='unreachable-audio';doc.timelines.push(unused);
   doc.assets.push({id:'material-'+replacement,name:'Replacement',kind:'audio',src:replacementInfo.storage_path,durationInFrames:71});
  });
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256})).productionWorkspace;
  expect(await summary()).toMatchObject({used:2,withdrawn:1,changed:0});
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{const child=doc.timelines.find((t:any)=>t.id==='sound-child');if(disabled==='keyframes')child.items[0].keyframes={volume:[{frame:0,value:0},{frame:12,value:0}]};else if(disabled==='source_end')child.items[0].srcInFrame=30000;else child.tracks[String(child.items[0].track)][disabled]=true;});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256})).productionWorkspace;expect(await summary()).toMatchObject({used:2,withdrawn:2,changed:0});
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{const child=doc.timelines.find((t:any)=>t.id==='sound-child');if(disabled==='keyframes')delete child.items[0].keyframes;else if(disabled==='source_end')child.items[0].srcInFrame=0;else child.tracks[String(child.items[0].track)][disabled]=false;child.items[0].src=replacementInfo.storage_path;child.items[0].sourceAssetId='material-'+replacement;child.items[0].sourceContentHash=replacementInfo.sha256;});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256})).productionWorkspace;expect(await summary()).toMatchObject({used:3,withdrawn:2,changed:0});
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{const child=doc.timelines.find((t:any)=>t.id==='sound-child');child.items[0].keyframes={volume:[{frame:0,value:1,easing:[.1,-1,.9,2]},{frame:12,value:1}]};});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256})).productionWorkspace;expect(await summary()).toMatchObject({used:3,withdrawn:2,changed:0,unknownEvents:1});
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{delete doc.timelines.find((t:any)=>t.id==='sound-child').items[0].keyframes;});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256})).productionWorkspace;expect(await summary()).toMatchObject({used:3,withdrawn:2,changed:0,unknownEvents:2});
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{doc.timelines[0].items.find((i:any)=>i.id==='audible-sequence').srcInFrame=30;});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256})).productionWorkspace;expect(await summary()).toMatchObject({used:3,withdrawn:3,changed:0});
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{doc.timelines[0].items.find((i:any)=>i.id==='audible-sequence').srcInFrame=0;const child=doc.timelines.find((t:any)=>t.id==='sound-child'),asset=doc.assets.find((a:any)=>a.id==='material-'+replacement);doc.assets.push({...asset,id:'audio-track-'+f.other});child.items[0].sourceAssetId='audio-track-'+f.other;});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256})).productionWorkspace;expect(await summary()).toMatchObject({used:3,withdrawn:3,changed:0,unknownEvents:3});
  await send('closeWorkspaceStudio');await f.restart();expect(await summary()).toMatchObject({used:3,withdrawn:3,changed:0});
 }finally{await f.close();}
},180000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('keeps sound scope and transaction protection, and never backfills edits made while collection is off',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:productionScriptTemplate.replace('镜头时长（秒）：5','镜头时长（秒）：1')}),worker=f.workerPool();
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=(command:string,data:Record<string,unknown>={})=>f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});
  const music=await f.send('importMaterial',{sourceKind:'file',sourcePath:'protected-music.mp3',materialType:'audio',materialPurpose:'background_music',mimeType:'audio/mpeg',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('controlled-narration-tone.mp3'))).toString('base64')});expect(music.status).toBe(200);
  const made=await send('prepareWorkspaceAudio',{kind:'bgm',materialRevisionId:music.body.id,description:'保护核查',durationSeconds:1});expect(made.status).toBe(200);w=made.body;const prep=w.audio.preparations[0],before={revision:w.revision,sha:w.project.sha256};
  const eventCount=async()=>(await f.c.query("SELECT count(*)::int n FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type LIKE 'sound_%'",[f.newEpisode])).rows[0].n;
  await f.c.query("CREATE FUNCTION local_identity.c2_reject_sound()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type LIKE 'sound_%' THEN RAISE EXCEPTION 'forced sound observation failure';END IF;RETURN NEW;END$$;CREATE TRIGGER c2_reject_sound BEFORE INSERT ON local_identity.production_metric_events FOR EACH ROW EXECUTE FUNCTION local_identity.c2_reject_sound()");
  expect((await send('adoptWorkspaceAudio',{preparationId:prep.id})).status).toBeGreaterThanOrEqual(400);
  const after=await send('refreshWorkspaceAudio');expect(after.status).toBe(200);expect({revision:after.body.revision,sha:after.body.project.sha256}).toEqual(before);expect(after.body.audio.preparations[0].adoptedItemId).toBeNull();expect(await eventCount()).toBe(0);
  await f.c.query('DROP TRIGGER c2_reject_sound ON local_identity.production_metric_events;DROP FUNCTION local_identity.c2_reject_sound()');const adopted=await send('adoptWorkspaceAudio',{preparationId:prep.id});expect(adopted.status).toBe(200);w=adopted.body;expect(await eventCount()).toBe(1);
  const args=[w.id,w.revision,'bgm','used','material',music.body.id,'a'.repeat(64),'b'.repeat(64),'c'.repeat(64)],sql='SELECT local_identity.record_workspace_sound_use($1,$2,$3,$4,$5,$6,$7,$8,$9)';
  await expect(ownerTransaction(f.pool,f.other,false,c=>c.query(sql,args))).rejects.toMatchObject({code:'42501'});await expect(worker.query(sql,args)).rejects.toMatchObject({code:'42501'});
  await expect(ownerTransaction(f.pool,f.owner,false,c=>c.query(sql,args))).rejects.toMatchObject({code:'42501'});await expect(ownerTransaction(f.pool,f.owner,false,c=>c.query(sql,[...args.slice(0,2),'body text',...args.slice(3)]))).rejects.toMatchObject({code:'22023'});
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(false)'));const off=await send('setWorkspaceAudioEnabled',{kind:'bgm',enabled:false});expect(off.status).toBe(200);w=off.body;expect(await eventCount()).toBe(1);
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));expect(await eventCount()).toBe(1);await f.restart();expect(await eventCount()).toBe(1);
 }finally{await worker.end();await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('records explicitly extracted current source audio through a real local Worker without creating an old draft',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,controlled:true,scriptText:productionScriptTemplate.replace('镜头时长（秒）：5','镜头时长（秒）：2')});const worker=f.workerPool();let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+': '+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const media=await workspaceAudioMedia(f.root),video=await f.send('importMaterial',{sourceKind:'file',sourcePath:'source.mp4',materialType:'video',materialPurpose:'a_roll',mimeType:'video/mp4',isMainScript:false,contentBase64:(await readFile(media.video)).toString('base64')});expect(video.status).toBe(200);
  const clip=w.clips[0];await send('matchWorkspaceMaterial',{clipId:clip.id,materialRevisionId:video.body.id});
  const initial=(await f.c.query("SELECT payload FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type='sound_used' ORDER BY id",[f.newEpisode])).rows;expect(initial.map(e=>e.payload.role)).toEqual(['source']);expect(initial[0].payload.source_kind).toBe('material');
  const beforePreparation=w.project.sha256;
  const read=async()=>{const r=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);return(await r.json()).workspace;};
  if(process.env.LOOP_STORY_E2E==='1'&&process.env.LOOP_STORY_EVIDENCE){
   browser=await storyBrowser({...f,episode:f.newEpisode},'current-source-voice','正式新单');await browser.cli('open',browser.url+'&step=preparation');await browser.wait("!!document.querySelector('#preparation-tab-voice')");await browser.cli('find','role','tab','click','--name','字幕与口播','--exact');
   await browser.doubleClick('准备当前原片原声');await expect.poll(()=>browser!.traffic.filter(t=>t.command==='prepareWorkspaceAudio').length,{timeout:30000}).toBe(1);expect(browser.traffic.filter(t=>t.command==='prepareWorkspaceAudio')).toEqual([{command:'prepareWorkspaceAudio',status:200,dropped:false}]);w=await read();expect(w.audio.preparations).toHaveLength(1);
  }else await send('prepareWorkspaceAudio',{kind:'source',shotId:clip.shotId,sourceItemId:clip.itemId});
  expect(w.project.sha256).toBe(beforePreparation);const prep=w.audio.preparations[0];
  const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:prep.taskId,p_worker_capacity:2})as any[])[0];expect(task.task_id).toBe(prep.taskId);const done=await runWorkspaceDeliveryProcess(f,task,{mountPath:f.mountPath,media:{mode:'local'}});expect(done.status,JSON.stringify(done)).toBe('completed');
  expect((await read()).project.sha256).toBe(beforePreparation);
  if(browser){
   await browser.click('采用原片原声 '+prep.description);await browser.cli('wait','--text','当前已设为主声');w=await read();
   await browser.evaluate("document.querySelector('.workspace-source-voice').scrollIntoView({block:'start'})");await browser.capture('desktop');await browser.cli('set','viewport','390','844');await browser.evaluate("document.querySelector('.workspace-source-voice').scrollIntoView({block:'start'})");expect(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth')).toBe(true);await browser.capture('narrow');await browser.close();browser=undefined;
  }else await send('adoptWorkspaceAudio',{preparationId:prep.id});
  const events=(await f.c.query("SELECT payload FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type='sound_used' ORDER BY id",[f.newEpisode])).rows;
  expect(events.filter(e=>e.payload.role==='source').map(e=>e.payload.source_kind)).toEqual(['material','audio_track']);
  await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{const timeline=doc.timelines[0];timeline.items=timeline.items.filter((i:any)=>i.kind!=='audio');timeline.items.find((i:any)=>i.id===clip.itemId).volume=1;timeline.linkGroups=[];});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256})).productionWorkspace;
  const embedded=(await f.c.query("SELECT payload FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type='sound_used' ORDER BY id",[f.newEpisode])).rows;
  expect(embedded.filter(e=>e.payload.role==='source').map(e=>e.payload.source_kind)).toEqual(['material','audio_track','material']);expect(embedded.at(-1)?.payload.source_id).toBe(video.body.id);
  await send('closeWorkspaceStudio');
  expect((await f.c.query('SELECT count(*)::int n FROM public.shot_preparation_drafts WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
 }finally{await browser?.close();await worker.end();await f.close();}
},180000);
