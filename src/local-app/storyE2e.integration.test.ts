// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,rename,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {storyE2eFixture,storyLines} from './storyE2e.fixture';
import {storyBrowser} from './storyBrowser.fixture';
import {editStudioDocument} from './studioDocument.fixture';
import {applyWorkspaceCandidate} from '../workspaceCandidates';
import {storyProcess} from './storyProcess.fixture';
import {collectionOwnerPost} from './episodeCollection.fixture';
import {deletionFixtureFingerprint} from './deletionFingerprint.fixture';

const enabled=process.env.LOOP_STORY_E2E==='1';
it.skipIf(!enabled)('story 5 browser: cancel a collection plan, recover a lost move receipt, and read the same export with the old directory offline',async()=>{
 const f=await storyE2eFixture();let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  await f.fill();await f.ok(f.send('exportWorkspace'));const project=f.workspace.project.sha256,artifact=f.workspace.exports![0].artifact!;
  const old=(await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[f.episode])).rows[0];
  browser=await storyBrowser(f,'collection-story');
  const open=async()=>{await browser!.click('文件夹更多操作');await browser!.cli('find','role','menuitem','click','--name','调整收纳','--exact');await browser!.wait("!!document.querySelector('[aria-label=目标收纳] option[value=unassigned]')");};
  await open();await browser.cli('select','[aria-label="目标收纳"]','unassigned');await browser.click('盘点调整');await browser.cli('wait','--text','复制、校验并切换');
  await browser.click('放弃调整');await browser.cli('wait','--text','调整已放弃');
  expect((await f.c.query('SELECT directory_relative_path FROM local_identity.episode_storage_location($1)',[f.episode])).rows[0].directory_relative_path).toBe(old.directory_relative_path);
  await browser.cli('select','[aria-label="目标收纳"]','unassigned');await browser.click('盘点调整');await browser.cli('wait','--text','复制、校验并切换');
  browser.dropNextResponse('executeAssetDirectoryMigration');await browser.doubleClick('复制、校验并切换');await browser.cli('wait','--text','服务端结果回执未能送达');
  await browser.click('关闭调整收纳');await f.restart();
  await rename(join(f.assetRoot,old.directory_relative_path),join(f.assetRoot,old.directory_relative_path)+'.offline');
  await browser.cli('reload');await browser.cli('wait','--text','末班车前的一把伞');await open();
  expect(await browser.evaluate("document.querySelector('[role=dialog][aria-label=调整收纳]').innerText")).toContain('未分系列');
  expect((await f.read()).project.sha256).toBe(project);
  const response=await fetch(f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(artifact.relativePath)}&sha256=${artifact.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});
  expect(response.status).toBe(200);expect(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')).toBe(artifact.sha256);
  expect((await f.c.query('SELECT series_version_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].series_version_id).toBe(f.series.id);
  await browser.capture('moved-old-offline');
 }catch(error){await browser?.capture('failed');throw error;}
 finally{await browser?.close();await f.close();}
},180000);

it.skipIf(!enabled)('story 5: detached media refuses export without creating a host fallback and remount restores the same story',async()=>{
 const f=await storyE2eFixture();try{
  await f.fill();const sha=f.workspace.project.sha256;
  await f.volume.unmount();const response=await f.send('exportWorkspace');expect(response.status,JSON.stringify(response.body)).toBe(409);
  expect(await readdir(f.volume.mountPath)).toEqual([]);
  await f.volume.remount();expect((await f.read()).project.sha256).toBe(sha);expect(f.workspace.clips.map(c=>c.text)).toEqual(storyLines);
 }finally{await f.volume.remount();await f.close();}
},180000);

it.skipIf(!enabled)('story 1 browser: validates the new script, recovers committed import/create receipts and opens one series-bound order',async()=>{
 const f=await storyE2eFixture({blank:true});let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  browser=await storyBrowser(f,'creation-story');
  await browser.click('确认脚本');await browser.cli('wait','--text','请填写主脚本');
  await browser.fill('主脚本',f.scriptText.replace('模板版本：2','模板版本：3'));await browser.click('确认脚本');
  await browser.cli('wait','--text','不支持的模板版本');
  await browser.fill('主脚本',f.scriptText);browser.dropNextResponse('importMaterial');await browser.doubleClick('确认脚本');
  await browser.cli('wait','--text','服务端结果回执未能送达');
  await browser.click('确认脚本');
  await browser.click('准备素材匹配');
  await expect.poll(async()=>(await f.read())?.clips?.length,{timeout:15000}).toBe(2);
  expect(f.workspace.clips.map(c=>c.text)).toEqual(storyLines);
  expect((await f.c.query('SELECT count(*)::int n FROM public.production_material_revisions WHERE episode_id=$1 AND is_main_script',[f.episode])).rows[0].n).toBe(1);
  await f.restart();await browser.cli('reload');await browser.cli('wait','--text','末班车前的一把伞');
  await browser.click('关闭生产单详情');await browser.click('新建生产单');
  const title='末班车前的一把伞 · 纸条特写';await browser.fill('工作标题（可留空）',title);
  await browser.cli('select','[aria-label="系列版本"]',f.series.id);
  browser.dropNextResponse('create');await browser.doubleClick('创建生产单');await browser.cli('wait','--text','服务端结果回执未能送达');
  await browser.click('创建生产单');await browser.wait("!document.querySelector('[role=dialog][aria-label=新建生产单]')");
  const rows=(await f.c.query('SELECT id,series_version_id FROM public.episodes WHERE title=$1',[title])).rows;
  expect(rows).toHaveLength(1);expect(rows[0].series_version_id).toBe(f.series.id);
  await browser.capture('created');
 }catch(error){await browser?.capture('failed');throw error;}
 finally{await browser?.close();await f.close();}
},180000);

it.skipIf(!enabled)('story 4 browser: confirms the actual subtitles, retries a lost package receipt, then reloads a verified playable delivery',async()=>{
 const f=await storyE2eFixture();let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  await f.fill();await f.ok(f.send('exportWorkspace'));expect(f.workspace.exports![0].status).toBe('ready');
  browser=await storyBrowser(f,'delivery-story');
  browser.dropNextResponse('confirmWorkspaceExport');await browser.click('确认成片与字幕');
  await browser.cli('wait','--text','服务端结果回执未能送达');
  await browser.click('确认成片与字幕');await browser.cli('wait','--text','已确认这份最终文件');
  await browser.cli('upload','input[aria-label="封面"]',f.files.first);
  await browser.fill('标题','末班车前的一把伞');await browser.fill('简介',storyLines.join(''));await browser.fill('标签','城市善意,黄伞');
  browser.dropNextResponse('prepareWorkspaceDelivery');await browser.doubleClick('生成并验证交付包');
  await browser.cli('wait','--text','服务端结果回执未能送达');
  await f.read();expect(f.workspace.deliveries).toHaveLength(1);
  await browser.click('生成并验证交付包');await browser.cli('wait','--text','交付已排队');
  await f.read();expect(f.workspace.deliveries).toHaveLength(1);const job=f.workspace.deliveries![0];
  await f.restart();const result=await f.execute(job.taskId);expect(result.status,JSON.stringify(result)).toBe('completed');
  await browser.cli('reload');await browser.cli('wait','--text','交付已完成');
  await browser.cli('wait','--text','验证完成');
  const links=await browser.evaluate("Array.from(document.querySelectorAll('.workspace-delivery a[download]')).map(a=>({label:a.getAttribute('aria-label')||a.textContent,href:a.href}))");expect(links.map((a:any)=>a.label)).toEqual(expect.arrayContaining(['下载封面','下载最终视频','下载全部交付文件（ZIP）','下载可编辑工程']));
  // The public package still contains all six files; the compact UI offers ZIP and primary downloads.
  await f.read();expect(f.workspace.deliveries![0].artifacts).toHaveLength(6);
  const media=await browser.evaluate("document.querySelector('video[aria-label=最终导出视频]').currentSrc");expect(media).toContain('sha256=');
  await browser.wait("document.querySelector('video[aria-label=最终导出视频]').readyState>=2");
  const start=await browser.evaluate("(async()=>{const v=document.querySelector('video[aria-label=最终导出视频]');v.muted=true;await v.play();return v.currentTime;})()");
  await browser.wait(`document.querySelector('video[aria-label=最终导出视频]').currentTime>${Number(start)+0.2}`);
  const playback=await browser.evaluate("(()=>{const v=document.querySelector('video[aria-label=最终导出视频]');const result={time:v.currentTime,duration:v.duration,frames:v.getVideoPlaybackQuality().totalVideoFrames};v.pause();return result;})()");
  expect(playback.frames).toBeGreaterThan(0);expect(playback.duration).toBeGreaterThanOrEqual(6);expect(playback.duration).toBeLessThanOrEqual(8);
  await writeFile(join(process.env.LOOP_STORY_EVIDENCE!,'browser-playback.json'),JSON.stringify(playback,null,2));
  await browser.capture('verified');
 }catch(error){await browser?.capture('failed');throw error;}
 finally{await browser?.close();await f.close();}
},180000);

it.skipIf(!enabled)('story 2 browser: a lost committed generation response and resubmission keep one task before an explicit three-second adoption',async()=>{
 const f=await storyE2eFixture();let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  await f.fill();browser=await storyBrowser(f,'generation-story');await browser.visualTools();
  await browser.click('定位镜头 shot-02');
  await browser.wait("document.querySelector('[aria-label=画面候选目标]').selectedOptions[0].textContent.includes('shot-02')");
  await browser.cli('select','[aria-label="画面候选来源"]','generate');
  await browser.wait("Array.from(document.querySelector('[aria-label=视频连接与模型]').options).some(o=>o.value&&!o.disabled)");
  const model=await browser.evaluate("Array.from(document.querySelector('[aria-label=视频连接与模型]').options).find(o=>o.value&&!o.disabled).value");
  await browser.cli('select','[aria-label="视频连接与模型"]',model);
  await browser.cli('select','[aria-label="画面首帧图片"]',f.materials.second.id);
  await browser.fill('画面动作','黄色伞柄上的纸条轻轻晃动，留给下一个人。');
  await browser.fill('生成时长（秒）','4');await browser.fill('本次费用预留（分）','20');
  await browser.doubleClick('生成画面候选');await browser.cli('wait','--text','确认本次');
  browser.dropNextResponse('confirmWorkspaceCall');await browser.doubleClick('确认并提交本次调用');
  await expect.poll(()=>browser!.traffic.filter(t=>t.command==='confirmWorkspaceCall').length,{timeout:15000}).toBe(1);
  await browser.cli('wait','--text','服务端结果回执未能送达');
  await browser.click('取消');await browser.cli('reload');await browser.visualTools();await browser.click('定位镜头 shot-02');await browser.cli('select','[aria-label="画面候选来源"]','generate');await browser.cli('wait','--text','画面等待执行');
  await f.read();expect(f.workspace.visualTasks).toHaveLength(1);const job=f.workspace.visualTasks![0];
  const result=await f.execute(job.taskId);expect(result.status,JSON.stringify(result)).toBe('completed');
  await browser.click('刷新画面');await browser.cli('wait','--text','采用此画面');
  await browser.cli('select','[aria-label="视觉候选时长处理"]','keep-target');await browser.click('采用此画面');
  await expect.poll(async()=>(await f.read()).visualCandidates![0].status,{timeout:15000}).toBe('adopted');
  const project=JSON.parse(await readFile(join(f.assetRoot,f.workspace.project.relativePath),'utf8'));
  expect(project.timelines[0].items.find((i:any)=>i.id===f.workspace.clips[1].itemId)).toMatchObject({kind:'video',durationInFrames:90,srcInFrame:0});
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
  await browser.capture('adopted');
 }catch(error){await browser?.capture('failed');throw error;}
 finally{await browser?.close();await f.close();}
},180000);

it.skipIf(!enabled)('story 2: rejects an unsupported duration, then one duplicate-safe request produces an unused four-second candidate',async()=>{
 const f=await storyE2eFixture();try{
  await f.fill();const w=f.workspace;
  expect(w.clips.map(c=>c.text)).toEqual(storyLines);
  
  const key=randomUUID(),data={targetItemId:w.clips[1].itemId,selection:f.selections.video,firstFrameMaterialRevisionId:f.materials.second.id,prompt:'黄色伞柄的纸条轻轻晃动，留给下一个人。',durationSeconds:3,reservationCents:20};
  expect((await f.send('requestWorkspaceVisualCandidate',data)).status).toBe(409);
  expect((await f.read()).visualTasks).toHaveLength(0);data.durationSeconds=4;
  const first=await f.send('requestWorkspaceVisualCandidate',data,key);expect(first.status,JSON.stringify(first.body)).toBe(200);
  const second=await f.send('requestWorkspaceVisualCandidate',data,key);expect(second.status,JSON.stringify(second.body)).toBe(200);
  await f.read();expect(f.workspace.visualTasks).toHaveLength(1);
  const execution=await f.execute(f.workspace.visualTasks![0].taskId);expect(execution.status,JSON.stringify(execution)).toBe('completed');
  const result=await f.read();expect(result.visualCandidates).toHaveLength(1);expect(result.visualCandidates![0]).toMatchObject({status:'available',durationSeconds:4,shotId:w.clips[1].shotId});
  expect(result.clips.map(c=>c.text)).toEqual(storyLines);
 }finally{await f.close();}
},180000);

it.skipIf(!enabled).each(['image','speech'] as const)('story 2: %s generation rejects bad input and duplicate submission leaves one unused story candidate',async capability=>{
 const f=await storyE2eFixture();try{
  await f.fill();
  const before=f.workspace.project.sha256,clip=f.workspace.clips[0],key=randomUUID();
  let command:string,data:Record<string,unknown>;
  if(capability==='image'){
   command='requestWorkspaceImageCandidates';data={targetItemId:clip.itemId,selection:f.selections.image,prompt:'站台长椅旁的黄色雨伞，雨已停，保持故事人物和构图。',settings:{size:'864x1536',quality:'low',count:1},referenceMaterialRevisionIds:[f.materials.first.id],reservationCents:20};
   expect((await f.send(command,{...data,prompt:''})).status).toBe(400);
  }else{
   await f.ok(f.request('saveTtsSettings',{languageCode:'zh-CN',voice:'zh_female_vv_uranus_bigtts',speakingRate:1}));
   const settings={clipId:clip.id,mode:'tts',selection:f.selections.speech,text:storyLines[0],voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1};
   expect((await f.send('saveWorkspaceNarration',{...settings,selection:undefined})).status).toBe(400);
   await f.ok(f.send('saveWorkspaceNarration',settings));await f.ok(f.send('confirmWorkspaceNarration',{clipId:clip.id}));
   command='generateWorkspaceNarration';data={clipId:clip.id,reservationCents:20};
  }
  const revision=f.workspace.revision;await f.ok(f.send(command,data,key));await f.ok(f.send(command,{...data,expectedRevision:revision},key));
  const taskId=capability==='image'?f.workspace.visualTasks![0].taskId:f.workspace.narration!.find(n=>n.shotId===clip.shotId)!.taskId!;
  const result=await f.execute(taskId);expect(result.status,JSON.stringify(result)).toBe('completed');
  if(capability==='speech')await f.ok(f.send('refreshWorkspaceNarration'));await f.read();
  const candidates=capability==='image'?f.workspace.visualCandidates:f.workspace.candidates;
  expect(candidates).toHaveLength(1);expect(candidates![0].status).toBe('available');
  // A new voice draft is allowed, but no generated source is used until adoption.
  if(capability==='image')expect(f.workspace.project.sha256).toBe(before);
  expect(f.workspace.clips.map(c=>c.text)).toEqual(storyLines);
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
 }finally{await f.close();}
},180000);

it.skipIf(!enabled)('story 1 process: a real crash during directory creation resumes the same story order and rejects a changed duplicate',async()=>{
 const f=await storyE2eFixture({blank:true});const process=await storyProcess(f);
 try{
  let app=await process.launch('create-mkdir');let post=collectionOwnerPost({...f,origin:app.origin});
  const key=randomUUID(),data={accountId:f.account.id,seriesVersionId:f.series.id,title:'雨伞故事中断'};
  await expect(post('episode-commands','create',data,key)).rejects.toThrow();
  app=await process.launch();post=collectionOwnerPost({...f,origin:app.origin});
  const resumed=await post('episode-commands','create',data,key);expect(resumed.status,JSON.stringify(resumed.body)).toBe(200);
  const duplicate=await post('episode-commands','create',data,key);expect(duplicate.status).toBe(200);expect(duplicate.body.id).toBe(resumed.body.id);
  expect((await post('episode-commands','create',{...data,title:'换标题不能复用原请求'},key)).status).toBe(409);
  expect((await f.c.query('SELECT count(*)::int n FROM public.episodes WHERE title=$1',[data.title])).rows[0].n).toBe(1);
 }finally{await process.close();await f.close();}
},180000);

it.skipIf(!enabled).each(['resume','rollback'] as const)('story 5 process: %s a real copy-publication SIGKILL without losing either shot or duplicating the move',async action=>{
 const f=await storyE2eFixture();const process=await storyProcess(f);
 try{
  await f.fill();const original=f.workspace.project.sha256;
  const target=await f.ok(f.post('configuration','createSeries',{accountId:f.account.id,name:'留给下一个人',rules:{positioning:'善意的后续'}}));
  let app=await process.launch();let post=collectionOwnerPost({...f,origin:app.origin});
  const location=(await f.c.query('SELECT * FROM local_identity.episode_storage_location($1)',[f.episode])).rows[0];
  const source=join(location.asset_root,location.directory_relative_path),before=await deletionFixtureFingerprint(source);
  const key=randomUUID(),args={episodeId:f.episode,seriesId:target.series_id};
  const planned=await post('account-commands','planEpisodeCollectionMove',args,key);expect(planned.status,JSON.stringify(planned.body)).toBe(200);
  expect((await post('account-commands','planEpisodeCollectionMove',args,key)).body.id).toBe(planned.body.id);
  expect((await post('account-commands','planEpisodeCollectionMove',{...args,path:'/tmp/forbidden'},randomUUID())).status).toBe(400);
  app=await process.launch('copy-published');post=collectionOwnerPost({...f,origin:app.origin});
  const commandData={accountId:f.account.id,migrationId:planned.body.id};
  await expect(post('account-commands','executeAssetDirectoryMigration',commandData)).rejects.toThrow();
  const receipt=(await f.c.query('SELECT status,manifest FROM local_identity.account_directory_migrations WHERE id=$1',[planned.body.id])).rows[0];expect(receipt.status).toBe('copying');expect(receipt.manifest.temporaryFiles.length).toBeGreaterThan(0);
  app=await process.launch();post=collectionOwnerPost({...f,origin:app.origin});
  const done=await post('account-commands',action==='resume'?'executeAssetDirectoryMigration':'rollbackAssetDirectoryMigration',commandData);expect(done.status,JSON.stringify(done.body)).toBe(200);expect(done.body.status).toBe(action==='resume'?'completed':'rolled_back');
  expect(await deletionFixtureFingerprint(source)).toEqual(before);
  if(action==='resume')expect((await post('account-commands','executeAssetDirectoryMigration',commandData)).status).toBe(200);
  await f.restart();expect((await f.read()).project.sha256).toBe(original);expect(f.workspace.clips.map(c=>c.text)).toEqual(storyLines);
  const current=await post('account-commands','readEpisodeCollection',{episodeId:f.episode});expect(current.body.collection.seriesId).toBe(action==='resume'?target.series_id:f.series.series_id);
  const frozen=(await f.c.query('SELECT series_version_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0];expect(frozen.series_version_id).toBe(f.series.id);
 }finally{await process.close();await f.close();}
},180000);

it.skipIf(!enabled).each(['image','video'] as const)('story 3: saved native %s recovers a missing adoption receipt, and repeated confirmation preserves both story shots',async kind=>{
 const f=await storyE2eFixture();try{
  await f.fill();const material=await f.importFile(kind==='image'?f.files.candidate:f.files.video,kind,'visual_reference');
  await f.ok(f.send('registerWorkspaceVisualCandidate',{targetItemId:f.workspace.clips[1].itemId,materialRevisionId:material.id,usage:kind==='image'?'still':'video',durationSeconds:3}));
  const candidate=f.workspace.visualCandidates![0],opened=await f.ok(f.send('openWorkspaceStudio'));await f.read();
  const original=await editStudioDocument(opened.studioUrl,f.workspace.project.projectId,()=>{});
  const prepared=await f.ok(f.send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target'}));
  expect((await f.send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:prepared.adoptionId,nativeApplied:true})).status).toBe(409);
  await editStudioDocument(opened.studioUrl,f.workspace.project.projectId,doc=>applyWorkspaceCandidate(doc,prepared.edit));
  await f.ok(f.send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:f.workspace.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256}));
  await f.read();expect(f.workspace.visualCandidates![0].pendingConfirmation).toBe(true);
  const saved=f.workspace.project.sha256,project=JSON.parse(await readFile(join(f.assetRoot,f.workspace.project.relativePath),'utf8'));
  const target=project.timelines[0].items.find((i:any)=>i.id===candidate.targetItemId);
  expect(target).toMatchObject({kind,sourceContentHash:candidate.sha256,srcInFrame:0,durationInFrames:90});
  expect(project.timelines[0].items.filter((i:any)=>i.id!==target.id).map((i:any)=>[i.id,i.startFrame,i.durationInFrames])).toEqual(original.timelines[0].items.filter((i:any)=>i.id!==target.id).map((i:any)=>[i.id,i.startFrame,i.durationInFrames]));
  await f.restart();await f.ok(f.send('openWorkspaceStudio'));await f.read();
  for(let n=0;n<2;n++)await f.ok(f.send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,nativeApplied:true}));
  expect(f.workspace.visualCandidates![0]).toMatchObject({status:'adopted',pendingConfirmation:false});expect(f.workspace.project.sha256).toBe(saved);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1 AND candidate_id=$2',[f.workspace.id,candidate.id])).rows[0].n).toBe(1);
  expect(f.workspace.clips.map(c=>c.text)).toEqual(storyLines);
 }finally{await f.close();}
},180000);

it.skipIf(!enabled)('story 3: saved native speech recovers its missing receipt without regenerating or substituting the story text',async()=>{
 const f=await storyE2eFixture();try{
  await f.fill();const clip=f.workspace.clips[0];
  await f.ok(f.request('saveTtsSettings',{languageCode:'zh-CN',voice:'zh_female_vv_uranus_bigtts',speakingRate:1}));
  await f.ok(f.send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',selection:f.selections.speech,text:storyLines[0],voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1}));
  await f.ok(f.send('confirmWorkspaceNarration',{clipId:clip.id}));await f.ok(f.send('generateWorkspaceNarration',{clipId:clip.id,reservationCents:20}));
  const result=await f.execute(f.workspace.narration![0].taskId!);expect(result.status,JSON.stringify(result)).toBe('completed');await f.ok(f.send('refreshWorkspaceNarration'));
  const candidate=f.workspace.candidates![0];expect(candidate.text).toBe(storyLines[0]);
  const opened=await f.ok(f.send('openWorkspaceStudio'));await f.read();await editStudioDocument(opened.studioUrl,f.workspace.project.projectId,()=>{});
  const prepared=await f.ok(f.send('prepareWorkspaceCandidate',{candidateId:candidate.id,durationPolicy:'use-candidate'}));
  expect((await f.send('adoptWorkspaceCandidate',{candidateId:candidate.id,adoptionId:prepared.adoptionId,nativeApplied:true})).status).toBe(409);
  await editStudioDocument(opened.studioUrl,f.workspace.project.projectId,doc=>applyWorkspaceCandidate(doc,prepared.edit));
  await f.ok(f.send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:f.workspace.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256}));await f.read();
  expect(f.workspace.candidates![0].pendingConfirmation).toBe(true);const saved=f.workspace.project.sha256;
  await f.restart();await f.ok(f.send('openWorkspaceStudio'));await f.read();
  for(let n=0;n<2;n++)await f.ok(f.send('adoptWorkspaceCandidate',{candidateId:candidate.id,nativeApplied:true}));
  expect(f.workspace.candidates![0].status).toBe('adopted');expect(f.workspace.project.sha256).toBe(saved);
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
  const project=JSON.parse(await readFile(join(f.assetRoot,f.workspace.project.relativePath),'utf8'));
  expect(project.timelines[0].items.find((i:any)=>i.id===prepared.edit.targetItemId)).toMatchObject({kind:'audio',sourceContentHash:candidate.sha256});
  expect(f.workspace.clips.map(c=>c.text)).toEqual(storyLines);
 }finally{await f.close();}
},180000);

it.skipIf(!enabled).each(['changed-file','newer-target','reject'] as const)('story 3: %s cannot overwrite the saved umbrella scene',async fault=>{
 const f=await storyE2eFixture();try{
  await f.fill();const material=await f.importFile(f.files.candidate,'image','visual_reference');
  await f.ok(f.send('registerWorkspaceVisualCandidate',{targetItemId:f.workspace.clips[0].itemId,materialRevisionId:material.id,usage:'still',durationSeconds:3}));
  const candidate=f.workspace.visualCandidates![0];const prepared=await f.ok(f.send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target'}));
  if(fault==='changed-file')await writeFile(join(f.assetRoot,material.storage_path),'tampered umbrella');
  if(fault==='newer-target')await f.ok(f.send('editWorkspaceStructure',{operation:{kind:'appearance',itemId:f.workspace.clips[0].itemId,focusX:17}}));
  if(fault==='reject')await f.ok(f.send('rejectWorkspaceVisualCandidate',{candidateId:candidate.id}));
  const latest=f.workspace.project.sha256;
  expect((await f.send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:prepared.adoptionId})).status).toBe(409);
  await f.restart();expect((await f.read()).project.sha256).toBe(latest);expect(f.workspace.clips.map(c=>c.text)).toEqual(storyLines);
 }finally{await f.close();}
},180000);

it.skipIf(!enabled)('story 4: a six-second subtitled export and exact package survive failed validation, retry, restart and duplicate submission',async()=>{
 const f=await storyE2eFixture();try{
  // A missing second-shot visual must not become a successful final export.
  const denied=await f.send('exportWorkspace');expect(denied.status,JSON.stringify(denied.body)).toBe(200);expect(denied.body.exports[0].status).toBe('failed');expect(denied.body.exports[0].checks.find((c:any)=>c.name==='used_content').passed).toBe(false);
  await f.fill();await f.ok(f.send('exportWorkspace'));const exported=f.workspace.exports![0];
  expect(exported.status,JSON.stringify(exported.checks)).toBe('ready');expect(exported.checks.every(c=>c.passed)).toBe(true);
  const videoPath=join(f.assetRoot,exported.artifact!.relativePath),video=await readFile(videoPath);
  const probe=await promisify(execFile)('ffprobe',['-v','error','-show_entries','format=duration','-of','json',videoPath]);
  const duration=Number(JSON.parse(probe.stdout).format.duration);expect(duration).toBeGreaterThanOrEqual(6);expect(duration).toBeLessThanOrEqual(8);
  expect((await f.send('confirmWorkspaceExport',{exportId:exported.id,expectedExportSha256:'0'.repeat(64),expectedContentSha256:f.workspace.contentSha256})).status).toBe(409);
  await f.ok(f.send('confirmWorkspaceExport',{exportId:exported.id,expectedExportSha256:exported.artifact!.sha256,expectedContentSha256:f.workspace.contentSha256}));
  const data={exportId:exported.id,expectedExportSha256:exported.artifact!.sha256,expectedContentSha256:f.workspace.contentSha256,title:'末班车前的一把伞',description:storyLines.join(''),tags:['城市善意'],coverBase64:(await readFile(f.files.first)).toString('base64')};
  expect((await f.send('prepareWorkspaceDelivery',{...data,coverBase64:''})).status).toBe(400);
  const key=randomUUID(),revision=f.workspace.revision;await f.ok(f.send('prepareWorkspaceDelivery',data,key));
  await f.ok(f.send('prepareWorkspaceDelivery',{...data,expectedRevision:revision},key));
  const job=f.workspace.deliveries![0];expect(f.workspace.deliveries).toHaveLength(1);
  await writeFile(videoPath,'interrupted story file');const failed=await f.execute(job.taskId);expect(failed.status).toBe('failed');
  await f.restart();await f.read();expect(f.workspace.deliveries![0].verified).toBe(false);
  expect((await f.send('retryWorkspaceDelivery',{deliveryId:job.id})).status).toBe(409);
  await writeFile(videoPath,video);await f.ok(f.send('retryWorkspaceDelivery',{deliveryId:job.id}));
  const result=await f.execute(f.workspace.deliveries![0].taskId);expect(result.status,JSON.stringify(result)).toBe('completed');
  await f.restart();await f.read();expect(f.workspace.deliveries![0].verified).toBe(true);
  for(const a of f.workspace.deliveries![0].artifacts){const r=await fetch(f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(a.relativePath)}&sha256=${a.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);const bytes=Buffer.from(await r.arrayBuffer());expect(createHash('sha256').update(bytes).digest('hex')).toBe(a.sha256);}
  const evidence=process.env.LOOP_STORY_EVIDENCE!;await writeFile(join(evidence,'umbrella-final.mp4'),video);await writeFile(join(evidence,'umbrella-delivery.json'),JSON.stringify({duration,workspace:f.workspace},null,2));
 }finally{await f.close();}
},180000);

it.skipIf(!enabled).each(['unknown','poll-fail'] as const)('story 2: %s interruption survives restart without a second supplier submission',async mode=>{
 const f=await storyE2eFixture();try{
  await f.fill();
  const original=f.workspace.project.sha256;
  const data={targetItemId:f.workspace.clips[1].itemId,selection:f.selections.video,firstFrameMaterialRevisionId:f.materials.second.id,prompt:'纸条特写，留给下一个人。',durationSeconds:4,reservationCents:20};
  await f.ok(f.send('requestWorkspaceVisualCandidate',data));const task=f.workspace.visualTasks![0];
  await writeFile(f.mode,mode);const interrupted=await f.execute(task.taskId);expect(interrupted.status).not.toBe('completed');
  await f.restart();await f.read();expect(f.workspace.project.sha256).toBe(original);
  if(mode==='unknown'){
   expect((await f.send('retryWorkspaceVisualCandidate',{candidateId:task.id})).status).toBe(409);
   expect((await f.send('requestWorkspaceVisualCandidate',{...data,prompt:'换一句描述也不能重复提交'})).status).toBe(409);
   expect(f.workspace.visualCandidates).toHaveLength(0);
  }else{
   expect(f.workspace.visualTasks![0].canResume).toBe(true);
   await writeFile(f.mode,'success');await f.ok(f.send('retryWorkspaceVisualCandidate',{candidateId:task.id}));
   const resumed=await f.execute(task.taskId);expect(resumed.status,JSON.stringify(resumed)).toBe('completed');
   expect((await f.read()).visualCandidates).toHaveLength(1);
  }
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
  expect(f.workspace.visualTasks).toHaveLength(1);
 }finally{await f.close();}
},180000);

it.skipIf(!enabled)('story 3 browser: native adoption interrupted before its receipt recovers on reload and duplicate confirmation',async()=>{
 const f=await storyE2eFixture();let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  await f.fill();const material=await f.importFile(f.files.candidate,'image','visual_reference');
  await f.ok(f.send('registerWorkspaceVisualCandidate',{targetItemId:f.workspace.clips[0].itemId,materialRevisionId:material.id,usage:'still',durationSeconds:3}));
  browser=await storyBrowser(f,'native-story');
  await browser.visualTools();
  expect(await browser.evaluate("document.querySelector('.workspace-shot-rail').textContent")).toContain(storyLines[0]);
  await browser.wait("!!document.querySelector('[aria-label=视觉候选时长处理]')");
  await browser.cli('select','[aria-label="视觉候选时长处理"]','keep-target');
  browser.interruptNextRequest('adoptWorkspaceVisualCandidate');
  await browser.click('采用此画面');
  await expect.poll(async()=>(await f.read()).visualCandidates![0].pendingConfirmation,{timeout:20000}).toBe(true);
  await expect.poll(()=>browser!.traffic.some(t=>t.command==='adoptWorkspaceVisualCandidate'&&t.dropped),{timeout:10000}).toBe(true);
  const saved=f.workspace.project.sha256;
  await browser.capture('receipt-interrupted');
  await f.restart();await browser.cli('reload');
  await browser.visualTools();
  await browser.cli('wait','--text','确认画面采用');
  await browser.doubleClick('确认画面采用');
  await expect.poll(async()=>(await f.read()).visualCandidates![0].status,{timeout:10000}).toBe('adopted');
  expect(f.workspace.project.sha256).toBe(saved);expect(f.workspace.clips.map(c=>c.text)).toEqual(storyLines);
  await browser.cli('wait','--text','已采用');
  await browser.wait("Array.from(document.querySelectorAll('.embedded-studio button')).some(b=>b.textContent.includes('返回生产单')&&!b.disabled)");
  await browser.click('返回生产单');
  await browser.wait("!document.querySelector('iframe[title=\"OpenChatCut 剪辑工程\"]')");
  await browser.capture('adopted-and-saved');
 }catch(error){await browser?.capture('failed');throw error;}
 finally{await browser?.close();await f.close();}
},180000);
