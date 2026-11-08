// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {editStudioDocument} from './studioDocument.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('independent episode sound switches retain gains and media through native save and restart',async()=>{
 const f=await formalWorkflowFixture();try{
  expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(name:string,data:Record<string,unknown>={})=>{const r=await f.send(name,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;};
  const audio=join(f.assetRoot,'sound.mp3');await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=30','-c:a','libmp3lame',audio]);
  const imported=await f.send('importMaterial',{sourceKind:'file',sourcePath:'sound.mp3',contentBase64:(await readFile(audio)).toString('base64'),materialType:'audio',materialPurpose:'general_reference',mimeType:'audio/mpeg',isMainScript:false});expect(imported.status).toBe(200);
  for(const[kind,anchor]of [['bgm','absolute'],['sfx','shot'],['sfx','absolute']]){await send('prepareWorkspaceAudio',{kind,anchor,description:kind+anchor,materialRevisionId:imported.body.id,durationSeconds:1,offsetSeconds:0,...(anchor==='shot'?{shotId:w.clips[0].shotId}:{})});await send('adoptWorkspaceAudio',{preparationId:w.audio.preparations[0].id});}
  for(const item of w.audio.mix.sounds)await send('mixWorkspaceAudio',{edit:{kind:'sound',workspaceId:w.id,itemId:item.itemId,gainDb:item.kind==='bgm'?-9:-7,duckDepthDb:0}});
  const read=async()=>JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));
  const sounds=(p:any)=>p.timelines.flatMap((t:any)=>t.items.filter((i:any)=>['bgm','sfx'].includes(i.loopControlAudio?.kind)));
  const before=sounds(await read());expect(before).toHaveLength(3);
  await send('setWorkspaceAudioEnabled',{kind:'sfx',enabled:false});expect(w.audio.enabled).toEqual({bgm:true,sfx:false});expect(sounds(await read()).filter((i:any)=>i.loopControlAudio.kind==='sfx').every((i:any)=>i.volume===0)).toBe(true);
  expect((await f.send('prepareWorkspaceAudio',{workspaceId:w.id,expectedRevision:w.revision,kind:'sfx',anchor:'absolute',description:'blocked',materialRevisionId:imported.body.id,durationSeconds:1})).status).toBe(409);
  expect((await f.send('adoptWorkspaceAudio',{workspaceId:w.id,expectedRevision:w.revision,preparationId:w.audio.preparations.find((p:any)=>p.kind==='sfx').id})).status).toBe(409);
  await send('setWorkspaceAudioEnabled',{kind:'bgm',enabled:false});expect(sounds(await read()).every((i:any)=>i.volume===0)).toBe(true);
  const video=join(f.assetRoot,'visual.mp4');await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-y','-stream_loop','-1','-i',workspaceTestMedia('landscape-red-blue.mp4'),'-t','8','-c','copy',video]);const visual=await f.send('importMaterial',{sourceKind:'file',sourcePath:'visual.mp4',contentBase64:(await readFile(video)).toString('base64'),materialType:'video',materialPurpose:'a_roll',mimeType:'video/mp4',isMainScript:false});expect(visual.status).toBe(200);for(const clip of w.clips)await send('matchWorkspaceMaterial',{clipId:clip.id,materialRevisionId:visual.body.id});
  const opened=await f.send('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status).toBe(200);w=opened.body.productionWorkspace;await editStudioDocument(opened.body.studioUrl,w.project.projectId,()=>{});const saved=await f.send('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;expect((await f.send('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision})).status).toBe(200);
  await f.restart();const resumed=await fetch(f.origin+`/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(resumed.status).toBe(200);w=(await resumed.json()).workspace;expect(w.audio.enabled).toEqual({bgm:false,sfx:false});
  await send('setWorkspaceAudioEnabled',{kind:'sfx',enabled:true});expect(w.audio.enabled).toEqual({bgm:false,sfx:true});await send('setWorkspaceAudioEnabled',{kind:'bgm',enabled:true});for(const original of before){const restored=sounds(await read()).find((i:any)=>i.id===original.id);expect(restored.volume).toBe(original.volume);expect(restored.src).toBe(original.src);expect(restored.loopControlSoundMute).toBeUndefined();}
 }finally{await f.close();}
},120_000);
