// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {OpenChatCutRuntimeConfig} from '../worker/openchatcutStudio';
import {editStudioDocument} from './studioDocument.fixture';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {buildOpenChatCutProject} from '../worker/openchatcutProject';
import {reviewRenderFromSnapshot} from '../worker/history/reviewRenderV1';
import {ownerTransaction} from './ownerTransaction';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {storyBrowser} from './storyBrowser.fixture';
const hash=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex');
it.skipIf(process.env.LOOP_LEGACY_EDIT_ACCEPTANCE!=='1').each([['legacy','hidden-caption'],['registered','hidden-caption'],['legacy','muted-item'],['legacy','muted-track'],['legacy','deleted-voice'],['legacy','deleted-caption-track'],['legacy','extra-caption'],['legacy','slow-video'],['legacy','fast-video-overrun'],['legacy','added-image'],['legacy','unused-image']] as const)('continues the exact original native project, saves a new immutable version and restores it after restart without generation (%s, %s)',async(layout,edit)=>{
 const f=await productionWorkspaceFixture({episodeRelativePath:layout==='registered'?()=> '恢复 [T09]_%/本单':undefined,migrations:['db/archive/legacy-v1/120-native-workspace-storage-locations.sql']});
 const unrelated=createServer((_q,s)=>s.end('<title>Other local app</title>'));unrelated.listen(0,'127.0.0.1');await once(unrelated,'listening');
 const occupiedPort=(unrelated.address() as {port:number}).port;(f.runtime as OpenChatCutRuntimeConfig).port=occupiedPort;
 try{
  const audio=randomUUID(),voiceTask=randomUUID(),voiceArtifact=randomUUID(),original=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[f.task])).rows[0].input_snapshot;
  original.review_render.confirmed_shots[0].subtitles_enabled=true;Object.assign(original.review_render.confirmed_shots[0].preparation_contract.captions,{enabled:true,cues:[{id:'original-visible-caption',text:original.review_render.confirmed_shots[0].subtitle_text,start_ms:0,end_ms:2000}]});
  const snapshot=JSON.parse(JSON.stringify(original).replaceAll('\"audio-track-1\"',JSON.stringify(audio))),render=reviewRenderFromSnapshot(snapshot)!;
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_narration','completed',$3)",[voiceTask,f.episode,{media:{narration:{text:render.confirmedShots[0].subtitleText}}}]);
  await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'narration_audio',$4,$5,$6)",[voiceArtifact,f.episode,voiceTask,render.members[1].relativePath,f.files[1].sha256,f.files[1].fileSize]);
  await f.c.query("INSERT INTO public.audio_tracks(id,episode_id,source_task_id,source_artifact_id,track_kind,cue_id,relative_path,sha256,file_size,duration_seconds) VALUES($1,$2,$3,$4,'narration','shot-1',$5,$6,$7,2)",[audio,f.episode,voiceTask,voiceArtifact,render.members[1].relativePath,f.files[1].sha256,f.files[1].fileSize]);
  await f.c.query('UPDATE public.tasks SET input_snapshot=$2 WHERE id=$1',[f.task,snapshot]);
  const project=buildOpenChatCutProject(render,`loop-control-${f.episode}`);project.timelines[0].items.find(i=>i.kind==='video')!.transform={scale:1.13,x:23,y:9,rotation:4};project.timelines[0].name='原有剪辑不能重建';for(const track of Object.values(project.timelines[0].tracks))for(const lane of track.captions?.sourceEntries??[])lane.visible=false;
  const nativeVoice=project.timelines[0].items.find(i=>i.kind==='audio')!;
  if(edit==='muted-item')nativeVoice.volume=0;
  if(edit==='muted-track')Object.assign(project.timelines[0].tracks[String(nativeVoice.track)],{muted:true});
  if(edit==='deleted-voice')project.timelines[0].items=project.timelines[0].items.filter(i=>i!==nativeVoice);
  if(edit==='deleted-caption-track'){delete project.timelines[0].tracks.C1;project.timelines[0].trackOrder=project.timelines[0].trackOrder.filter(id=>id!=='C1');}
  if(edit==='extra-caption'){const lane=structuredClone(project.timelines[0].tracks.C1.captions!.sourceEntries[0]);Object.assign(lane,{id:'manual-title',itemId:'manual:manual-title',label:'人工新增标题',visible:true});lane.words=[{id:'manual-title-word',text:'保留原生标题',start:0,end:1500}];project.timelines[0].tracks.C1.captions!.sourceEntries.push(lane);}
  const nativeVideo=project.timelines[0].items.find(i=>i.kind==='video')!;
  if(edit==='slow-video'){nativeVideo.playbackRate=0.5;nativeVideo.durationInFrames=120;}
  if(edit==='fast-video-overrun')nativeVideo.playbackRate=2;
  if(edit==='added-image'||edit==='unused-image'){
   const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'manual-still.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
   const material=imported.body;project.assets.push({id:'material-'+material.id,kind:'image',name:'人工新增图片',src:material.storage_path,durationInFrames:1});
   if(edit==='added-image')project.timelines[0].items.push({id:'manual-image',kind:'image',name:'人工图片保留',track:'V2',src:material.storage_path,sourceAssetId:'material-'+material.id,startFrame:0,durationInFrames:60,srcInFrame:0});
  }
  const path=`${f.episodeRelativePath}/original-project.json`,bytes=Buffer.from(JSON.stringify(project,null,2)+'\n'),artifact=randomUUID();await writeFile(join(f.assetRoot,path),bytes);
  await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'review_render_project',$4,$5,$6)",[artifact,f.episode,f.task,path,hash(bytes),bytes.length]);
  if(layout==='registered'){
   await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.confirm_legacy_workspace_preparation($1,$2,$3)',[f.episode,f.script,f.board]));
   await f.c.query("UPDATE public.episodes SET stage='script_approved' WHERE id=$1",[f.episode]);
  }
  await f.c.query('DELETE FROM local_identity.input_episodes WHERE episode_id=$1',[f.episode]);
  const fingerprint=async()=>(await f.c.query("SELECT jsonb_build_object('episode',(SELECT to_jsonb(e) FROM public.episodes e WHERE id=$1),'tasks',(SELECT jsonb_agg(t ORDER BY id) FROM public.tasks t WHERE episode_id=$1),'approvals',(SELECT jsonb_agg(a ORDER BY id) FROM public.approvals a WHERE episode_id=$1),'materials',(SELECT jsonb_agg(m ORDER BY id) FROM public.production_material_revisions m WHERE episode_id=$1)) value",[f.episode])).rows[0].value;
  const before=await fingerprint(),data={artifactId:artifact,expectedSourceSha256:hash(bytes),expectedScriptRevisionId:f.script,reviewPackageId:f.board};
  const sources=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(sources.status).toBe(200);expect((await sources.json()).sourceOptions.options).toEqual([expect.objectContaining({source:{kind:'rendered-project',reviewPackageId:f.board,artifactId:artifact,expectedSourceSha256:hash(bytes)}})]);
  const rejected=await f.request('adoptLegacyWorkspace',data,{token:f.otherToken});expect(rejected.status).toBe(404);
  expect((await f.request('adoptLegacyWorkspace',{...data,expectedSourceSha256:'0'.repeat(64)})).status).toBe(409);
  expect((await f.request('adoptLegacyWorkspace',{...data,reviewPackageId:randomUUID()})).status).toBe(409);
  expect((await f.request('adoptLegacyWorkspace',{...data,expectedScriptRevisionId:randomUUID()})).status).toBe(409);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.input_episodes')).rows[0].n).toBe(0);
  const adopted=await f.request('adoptLegacyWorkspace',data);if(edit==='fast-video-overrun'){expect(adopted.status,JSON.stringify(adopted.body)).toBe(409);expect(await readFile(join(f.assetRoot,path))).toEqual(bytes);expect(await fingerprint()).toEqual(before);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_workspaces WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(0);return;}expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);let w=adopted.body;expect(w.recovery.relativePath.startsWith(f.episodeRelativePath+'/production-workspace/recoveries/')).toBe(true);
  expect((await f.request('adoptLegacyWorkspace',data)).status).toBe(409);
  expect(w.nativeEditRevision).toBeGreaterThan(0);expect(w.preparation.authorized).toBe(false);expect(w.readiness.placeholders).toEqual([]);
  const getProject=async(sha:string)=>{const r=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace/project?sha=${sha}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);return(await r.json()).project;};
  let copy=await getProject(w.project.sha256);expect(copy.timelines[0].name).toBe(project.timelines[0].name);expect(copy.timelines[0].items.find((i:any)=>i.kind==='video').transform.x).toBe(23);
  if(process.env.LOOP_STORY_EVIDENCE)await writeFile(join(process.env.LOOP_STORY_EVIDENCE,'native-json-current-'+layout+'.json'),JSON.stringify({original:project,current:copy},null,2));
  // Current ownership/voice identities are added to a copy; every native
  // presentation field and the original file must still remain exact.
  const silent=['muted-item','muted-track','deleted-voice'].includes(edit);expect(w.audio.mix.voices[0]).toMatchObject({mode:silent?'none':'tts',gainDb:0,coverage:silent?'none':edit==='slow-video'?'partial':'full'});expect(w.captions[0].contract.enabled).toBe(false);
  const originalVoice=project.timelines[0].items.find(i=>i.kind==='audio')!,voice=copy.timelines[0].items.find((i:any)=>i.id==='workspace-narration-shot-shot-1');
  if(edit==='deleted-voice')expect(voice).toBeUndefined();else expect(voice).toMatchObject({sourceAssetId:'audio-track-'+audio,sourceContentHash:f.files[1].sha256,loopControlAudio:{workspaceId:w.id,shotId:'shot-1',voiceMode:'tts',origin:'legacy-frozen',text:render.confirmedShots[0].subtitleText}});
  const originalContent=structuredClone(copy);originalContent.loopControl=project.loopControl;
  for(const t of originalContent.timelines)for(const item of t.items){delete item.loopControlShot;delete item.loopControlAudio;if(voice&&item.id===voice.id){item.id=originalVoice.id;delete item.sourceContentHash;delete item.sourceAssetId;}}
  if(voice){const audioAsset=originalContent.assets.find((a:any)=>a.id==='audio-track-'+audio);expect(audioAsset.src).toBe(originalVoice.src);audioAsset.id=project.assets.find(a=>a.src===originalVoice.src)!.id;}
  const visualAsset=originalContent.assets.find((a:any)=>a.kind==='video');expect(visualAsset).toMatchObject({width:360,height:640});delete visualAsset.width;delete visualAsset.height;
  const oldCaptions=project.timelines[0].tracks.C1?.captions,captions=originalContent.timelines[0].tracks.C1?.captions;
  if(!oldCaptions)expect(captions).toBeUndefined();else{
   const managed=captions.sourceEntries.find((lane:any)=>lane.id==='workspace-caption-shot-shot-1');expect(managed).toMatchObject({visible:false,words:oldCaptions.sourceEntries[0].words,loopControl:expect.objectContaining({contentMode:'follow_tts',text:render.confirmedShots[0].subtitleText})});managed.id=oldCaptions.sourceEntries[0].id;managed.itemId=oldCaptions.sourceEntries[0].itemId;delete managed.loopControl;
   if(captions.perSource['workspace-caption-shot-shot-1']){captions.perSource['lane-shot-1']=captions.perSource['workspace-caption-shot-shot-1'];delete captions.perSource['workspace-caption-shot-shot-1'];}
  }
  expect(originalContent).toEqual(project);
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
  expect(new URL(opened.body.studioUrl).port).not.toBe(String(occupiedPort));expect(await(await fetch(`http://127.0.0.1:${occupiedPort}/`)).text()).toContain('Other local app');
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{doc.timelines[0].items.find((i:any)=>i.kind==='video').transform.x=51;});
  const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:opened.body.workspace.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;
  copy=await getProject(w.project.sha256);expect(copy.timelines[0].items.find((i:any)=>i.kind==='video').transform.x).toBe(51);expect(w.history.length).toBeGreaterThan(1);
  const archived=await getProject(adopted.body.recovery.sha256);expect(archived).toEqual(project);
  expect((await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:adopted.body.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:opened.body.workspace.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256})).status).toBe(409);
  await f.restart();const reopened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(reopened.status,JSON.stringify(reopened.body)).toBe(200);copy=await getProject(reopened.body.productionWorkspace.project.sha256);expect(copy.timelines[0].items.find((i:any)=>i.kind==='video').transform.x).toBe(51);
  if(process.env.LOOP_STORY_EVIDENCE)await writeFile(join(process.env.LOOP_STORY_EVIDENCE,`native-json-reopened-${layout}-${edit}.json`),JSON.stringify(copy,null,2));
  const savedCaptionLanes=Object.values(copy.timelines[0].tracks).flatMap((track:any)=>track.captions?.sourceEntries??[]);
  if(edit==='deleted-caption-track')expect(savedCaptionLanes).toEqual([]);if(edit==='extra-caption')expect(savedCaptionLanes.find((lane:any)=>lane.id==='manual-title')?.words).toEqual(project.timelines[0].tracks.C1.captions!.sourceEntries.find(lane=>lane.id==='manual-title')!.words);
  expect(await readFile(join(f.assetRoot,path))).toEqual(bytes);expect(await fingerprint()).toEqual(before);
  const flags=(await f.c.query('SELECT * FROM local_identity.input_episodes WHERE episode_id=$1',[f.episode])).rows[0];for(const key of ['enabled','storyboard_enabled','media_enabled','narration_enabled','studio_enabled'])expect(flags[key],key).toBe(false);
 }finally{await f.close();unrelated.closeAllConnections();await new Promise<void>(r=>unrelated.close(()=>r()));}
},120000);

it.skipIf(process.env.LOOP_LEGACY_EDIT_ACCEPTANCE!=='1').each(['legacy','registered'] as const)('prefers the most recently saved native edit and archives it before creating the working copy (%s)',async layout=>{
 const f=await productionWorkspaceFixture({episodeRelativePath:layout==='registered'?()=> '恢复 [T09]_%/本单':undefined,migrations:['db/archive/legacy-v1/120-native-workspace-storage-locations.sql']});
 let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  await f.c.query("UPDATE public.episodes SET stage='qc_review' WHERE id=$1",[f.episode]);
  const opened=await f.request('openStudio',{projectRelativePath:f.boardPath});expect(opened.status,JSON.stringify(opened.body)).toBe(200);
  await editStudioDocument(opened.body.studioUrl,opened.body.workspace.projectId,doc=>{doc.timelines[0].items.find((i:any)=>i.kind==='video').transform.x=37;});await f.closeStudio();
  const response=await fetch(`${f.origin}/api/local/episodes/${f.episode}/legacy-project`,{headers:{Cookie:'loop_owner_session='+f.token}}),saved=await response.json();
  const data={expectedScriptRevisionId:f.script,reviewPackageId:f.board,savedProjectSha256:saved.sha256};
  const sources=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(sources.status).toBe(200);
  expect((await sources.json()).sourceOptions.options).toEqual([expect.objectContaining({source:{kind:'saved-native',reviewPackageId:f.board,savedProjectSha256:saved.sha256}})]);
  expect((await f.request('adoptLegacyWorkspace',{...data,savedProjectSha256:'0'.repeat(64)})).status).toBe(409);
  expect((await f.request('adoptLegacyWorkspace',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,artifactId:randomUUID(),expectedSourceSha256:'0'.repeat(64)})).status).toBe(409);
  let result;
  if(layout==='legacy'&&process.env.LOOP_STORY_E2E==='1'){
   browser=await storyBrowser(f,'native-source','四步制作 T02 验收');await browser.cli('open',browser.url+'&step=editing');await browser.wait("!!document.querySelector('select[name=workspaceSource]')");await browser.cli('select','select[name=workspaceSource]','saved-native');expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_workspaces WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(0);await browser.click('接入当前制作');await browser.wait("!!document.querySelector('[aria-label=素材镜头列表]')");const r=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});result={status:r.status,body:(await r.json()).workspace};await browser.capture('imported');
  }else result=await f.request('adoptLegacyWorkspace',data);
  expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.recovery.relativePath.startsWith(f.episodeRelativePath+'/production-workspace/recoveries/')).toBe(true);
  const archived=JSON.parse(await readFile(join(f.assetRoot,result.body.recovery.relativePath),'utf8'));expect(archived.project).toEqual(saved.project);
  const working=JSON.parse(await readFile(join(f.assetRoot,result.body.project.relativePath),'utf8'));expect(working.timelines[0].items.find((i:any)=>i.kind==='video').transform.x).toBe(37);
  const current=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}}),read=await current.json();expect(read.workspace.id).toBe(result.body.id);expect(read.sourceOptions).toBeUndefined();
 }finally{await browser?.close();await f.close();}
},120000);
