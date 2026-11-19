// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,lstat,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
import {csrfFor} from './sessions';
import {editStudioDocument} from './studioDocument.fixture';
import type {ClaimedTaskRow} from '../orchestration/workerDispatch';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('first edited save creates one full production order in editing, preserving original, baseline, media, captions and publication across restart',async()=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){}}}),worker=f.workerPool();
 try{
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2)');
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);
  const uploaded=await f.request('importMaterial',{sourceKind:'file',sourcePath:'voice.mp3',contentBase64:(await readFile(workspaceTestMedia('controlled-narration-tone.mp3'))).toString('base64'),materialType:'audio',materialPurpose:'narration',mimeType:'audio/mpeg',isMainScript:false});expect(uploaded.status).toBe(200);
  w=(await f.request('saveWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,mode:'manual',text:'采用的完整口播',materialRevisionId:uploaded.body.id})).body;
  w=(await f.request('confirmWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id})).body;
  const candidate=w.candidates.find((candidate:{id:string})=>candidate.id===w.narration[0].audioTrackId),candidateInput={workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id};
  const prepared=await f.request('prepareWorkspaceCandidate',{...candidateInput,durationPolicy:'keep-target'});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  const adopted=await f.request('adoptWorkspaceCandidate',{...candidateInput,adoptionId:prepared.body.adoptionId});expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);w=adopted.body;
  for(const clip of w.clips)w=(await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)})).body;
  w=(await f.request('exportWorkspace',{workspaceId:w.id,expectedRevision:w.revision})).body;expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');
  w=(await f.request('completeWorkspaceExport',{workspaceId:w.id,expectedRevision:w.revision,exportId:w.exports[0].id,expectedExportSha256:w.exports[0].artifact.sha256,expectedContentSha256:w.contentSha256})).body;
  const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_worker_capacity:2}))[0] as ClaimedTaskRow;expect((await runWorkspaceDeliveryProcess(f,task)).status).toBe('completed');
  await f.c.query("UPDATE public.artifacts SET artifact_type='audio' WHERE id IN(SELECT source_artifact_id FROM public.audio_tracks WHERE episode_id=$1)",[f.episode]);
  const publication={title:'继承的标题',description:'继承的简介',tags:['原'],instruction:'保留要求'};expect((await f.post(`episodes/${f.episode}/publication`,'save',{expectedRevision:0,content:publication})).status).toBe(200);
  const originalRow=(await f.c.query('SELECT * FROM public.episodes WHERE id=$1',[f.episode])).rows[0],originalProject=await readFile(join(f.assetRoot,w.project.relativePath));
  const action=async(action:string,copyId:string,token=f.token)=>{const r=await fetch(f.origin+`/api/local/episodes/${f.episode}/studio-copy`,{method:'POST',headers:{Origin:f.origin,Cookie:'loop_owner_session='+token,'X-CSRF-Token':csrfFor(token),'Content-Type':'application/json'},body:JSON.stringify({action,copyId})});return{status:r.status,body:await r.json()};};
  const originalVideo=join(f.assetRoot,w.exports[0].artifact.relativePath);await rename(originalVideo,originalVideo+'.missing');
  const id=randomUUID(),opened=await action('open',id);expect(opened.status,JSON.stringify(opened.body)).toBe(200);expect((await action('keep',id)).body).toEqual({unchanged:true});expect((await f.c.query('SELECT count(*)::int n FROM public.episodes')).rows[0].n).toBe(1);
  const newImage=await readFile(workspaceTestMedia('still-striped.png')),privateOrigin=new URL(opened.body.studioUrl).origin;
  const uploadedImage=await fetch(privateOrigin+'/upload?name=copy-extra.png',{method:'POST',headers:{Origin:privateOrigin,'Sec-Fetch-Site':'same-origin','Content-Type':'image/png'},body:newImage});expect(uploadedImage.status,await uploadedImage.clone().text()).toBe(200);const newImageSource=(await uploadedImage.json()).path;
  await editStudioDocument(opened.body.studioUrl,opened.body.workspace.projectId,doc=>{doc.timelines[0].items.find((item:{kind:string})=>item.kind==='video').transform={x:0.1,y:0,scaleX:1,scaleY:1,rotation:0};doc.assets.push({id:'copy-extra-image',name:'新导入图片',kind:'image',src:newImageSource,durationInFrames:30});});
  const newerBlueprint=randomUUID();await f.c.query('INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES($1,$2,2,$3,true)',[newerBlueprint,originalRow.account_id,{asset_root:f.assetRoot,positioning:'新规则不得替代原单基准'}]);await f.c.query('UPDATE public.accounts SET current_blueprint_version_id=$1 WHERE id=$2',[newerBlueprint,originalRow.account_id]);
  await f.c.query("CREATE FUNCTION local_identity.fixture_copy_interruption() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fixture interrupted before visibility'; END $$; CREATE TRIGGER fixture_copy_interruption BEFORE INSERT ON local_identity.production_workspaces FOR EACH ROW EXECUTE FUNCTION local_identity.fixture_copy_interruption()");
  const failed=await action('keep',id);expect(failed.status).toBe(409);expect((await f.c.query('SELECT count(*)::int n FROM public.episodes')).rows[0].n).toBe(1);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_copy_intents WHERE copy_id=$1',[id])).rows[0].n).toBe(1);
  await f.restart();await f.c.query('DROP TRIGGER fixture_copy_interruption ON local_identity.production_workspaces');
  const copied=await action('keep',id);expect(copied.status,JSON.stringify(copied.body)).toBe(200);expect(copied.body.episodeId).not.toBe(f.episode);expect(copied.body.workspaceId).not.toBe(w.id);
  const target=copied.body.episodeId,copyW=(await f.c.query('SELECT * FROM local_identity.production_workspaces WHERE episode_id=$1',[target])).rows[0];
  await rename(originalVideo+'.missing',originalVideo);
  expect(copyW.id).toBe(copied.body.workspaceId);expect((await f.c.query('SELECT stage,blueprint_version_id FROM public.episodes WHERE id=$1',[target])).rows[0]).toEqual({stage:'production_ready',blueprint_version_id:originalRow.blueprint_version_id});
  expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[target])).rows[0].n).toBe(0);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.workspace_exports WHERE episode_id=$1',[target])).rows[0].n).toBe(0);
  const clonedProject=JSON.parse(await readFile(join(f.assetRoot,copyW.project_path),'utf8'));expect(clonedProject.timelines[0].items.find((item:{kind:string})=>item.kind==='video').transform.x).toBe(0.1);
  const extraImage=clonedProject.assets.find((asset:{id:string})=>asset.id==='copy-extra-image');expect(extraImage.src).not.toBe(newImageSource);expect(await readFile(join(f.assetRoot,extraImage.src))).toEqual(newImage);
  expect((await f.c.query('SELECT content FROM local_identity.workspace_publications WHERE episode_id=$1',[target])).rows[0].content).toEqual(publication);
  for(const source of copyW.bindings.filter((clip:{source:unknown})=>clip.source).map((clip:{source:{relativePath:string;sha256:string}})=>clip.source)){
   const file=join(f.assetRoot,source.relativePath);expect(createHash('sha256').update(await readFile(file)).digest('hex')).toBe(source.sha256);expect((await lstat(file)).nlink).toBe(1);
  }
  await f.restart();expect((await action('keep',id)).body).toEqual(copied.body);expect((await f.c.query('SELECT count(*)::int n FROM public.episodes')).rows[0].n).toBe(2);
  const response=await fetch(f.origin+`/api/local/episodes/${target}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status,await response.clone().text()).toBe(200);const current=(await response.json()).workspace;expect(current.stale).toBe(false);expect(current.clips.length).toBe(w.clips.length);expect(current.usedNarration[0].text).toBe('采用的完整口播');expect(current.usedNarration[0].audioTrackId).not.toBe(w.usedNarration[0].audioTrackId);
  const studio=await f.request('openWorkspaceStudio',{episodeId:target,workspaceId:current.id,expectedRevision:current.revision});expect(studio.status,JSON.stringify(studio.body)).toBe(200);const copyOpened=studio.body.productionWorkspace;const closed=await f.request('closeWorkspaceStudio',{episodeId:target,workspaceId:copyOpened.id,expectedRevision:copyOpened.revision});expect(closed.status,JSON.stringify(closed.body)).toBe(200);Object.assign(current,closed.body);
  expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(originalProject);expect((await f.c.query('SELECT stage FROM public.episodes WHERE id=$1',[f.episode])).rows[0].stage).toBe('production_completed');
  let next=(await f.request('saveWorkspaceCaptions',{episodeId:target,workspaceId:current.id,expectedRevision:current.revision,clipId:current.clips[0].id,captionContract:{...defaultShotCaptionContract('副本新字幕','independent',true),cues:[{id:'copy-caption',text:'副本新字幕',startMs:0,endMs:1000}]}})).body;
  expect(next.id).toBe(current.id);
  const again=await f.request('openWorkspaceStudio',{episodeId:target,workspaceId:next.id,expectedRevision:next.revision});expect(again.status,JSON.stringify(again.body)).toBe(200);next=again.body.productionWorkspace;
  await editStudioDocument(again.body.studioUrl,next.project.projectId,doc=>{doc.timelines[0].items.find((item:{kind:string})=>item.kind==='video').transform.x=0.2;});
  const saved=await f.request('saveWorkspaceStudio',{episodeId:target,workspaceId:next.id,expectedRevision:next.revision,workspaceRelativePath:again.body.workspace.relativePath,projectId:next.project.projectId,expectedWorkspaceSha256:next.project.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);next=saved.body.productionWorkspace;
  next=(await f.request('closeWorkspaceStudio',{episodeId:target,workspaceId:next.id,expectedRevision:next.revision})).body;
  next=(await f.request('exportWorkspace',{episodeId:target,workspaceId:next.id,expectedRevision:next.revision})).body;expect(next.exports[0].status,JSON.stringify(next.exports[0])).toBe('ready');
  const completed=await f.request('completeWorkspaceExport',{episodeId:target,workspaceId:next.id,expectedRevision:next.revision,exportId:next.exports[0].id,expectedExportSha256:next.exports[0].artifact.sha256,expectedContentSha256:next.contentSha256});expect(completed.status,JSON.stringify(completed.body)).toBe(200);next=completed.body;
  const nextTask=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_worker_capacity:2}))[0] as ClaimedTaskRow;expect((await runWorkspaceDeliveryProcess(f,nextTask)).status).toBe('completed');
  expect((await f.c.query('SELECT count(*)::int n FROM public.episodes')).rows[0].n).toBe(2);expect((await f.c.query('SELECT stage FROM public.episodes WHERE id=$1',[target])).rows[0].stage).toBe('production_completed');
  expect((await f.post('recycle-bin','recycleEpisode',{episodeId:f.episode})).status).toBe(200);
  const originalDirectory=join(f.assetRoot,f.episodeRelativePath);await rename(originalDirectory,originalDirectory+'.offline');
  try{
   const file=next.exports[0].artifact,download=await fetch(f.origin+'/_local-artifact?'+new URLSearchParams({episode:target,path:file.relativePath,sha256:file.sha256}),{headers:{Cookie:'loop_owner_session='+f.token}});expect(download.status).toBe(200);expect(createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex')).toBe(file.sha256);
   const viewId=randomUUID(),view=await fetch(f.origin+`/api/local/episodes/${target}/studio-copy`,{method:'POST',headers:{Origin:f.origin,Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token),'Content-Type':'application/json'},body:JSON.stringify({action:'open',copyId:viewId})});expect(view.status,await view.clone().text()).toBe(200);
  }finally{await rename(originalDirectory+'.offline',originalDirectory);}
  const copyFile=join(f.assetRoot,copyW.bindings[0].source.relativePath),originalMedia=await readFile(join(f.assetRoot,f.videoPath));await writeFile(copyFile,'副本独立改动');expect(await readFile(join(f.assetRoot,f.videoPath))).toEqual(originalMedia);
 }finally{await worker.end();await f.close();}
},240000);
