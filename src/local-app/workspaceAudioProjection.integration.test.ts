import {editStudioDocument} from './studioDocument.fixture';
import {adoptInitialNarration} from './workspaceNarration.fixture';
// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceAudioFixture} from './workspaceAudio.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('native workspace projection follows audible source over muted prior speech and reports none without altering music or effects',async()=>{
 const f=await workspaceAudioFixture();try{
  await f.authorize();await f.request('setWanBudget',{trialCents:300,totalCents:10000,full:false});let w=f.made;
  const send=async(name:string,data={})=>{const r=await f.chosenRequest(name,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;return w;};
  const upload=async(path:string,type:string,purpose:string)=>{const r=await f.request('importMaterial',{sourceKind:'file',sourcePath:path.split('/').pop(),contentBase64:(await readFile(path)).toString('base64'),materialType:type,mimeType:type==='video'?'video/mp4':'audio/mpeg',isMainScript:false,materialPurpose:purpose});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body.id;};
  const clip=w.clips[0],video=await upload(f.media.video,'video','a_roll');await send('matchWorkspaceMaterial',{clipId:clip.id,materialRevisionId:video});
  await send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',text:'保留历史口播，实际使用原片主声。'});await send('confirmWorkspaceNarration',{clipId:clip.id});await send('generateWorkspaceNarration',{clipId:clip.id});await f.execute(w.narration.find((n:any)=>n.shotId===clip.shotId).taskId);await send('refreshWorkspaceNarration');
  w=await adoptInitialNarration(f,w);const narration=w.narration.find((n:any)=>n.shotId===clip.shotId);expect(narration.adoptedAudioTrackId).toBe(narration.audioTrackId);
  const speechDoc=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),priorSpeech=structuredClone(speechDoc.timelines[0].items.find((i:any)=>i.id===`workspace-narration-shot-${clip.shotId}`));expect(priorSpeech).toBeTruthy();
  await send('prepareWorkspaceAudio',{kind:'source',shotId:clip.shotId,sourceItemId:clip.itemId});const prep=w.audio.preparations[0];await f.executeAudio(prep.taskId);await send('adoptWorkspaceAudio',{preparationId:prep.id});const sourceTrackId=w.audio.preparations.find((p:any)=>p.id===prep.id).audioTrackId;
  const preparationIds:Record<string,string>={};
  for(const[path,kind,purpose,seconds,offset]of [[f.media.bgm,'bgm','background_music',5,0],[f.media.sfx,'sfx','sound_effect',.4,1]] as const){const materialRevisionId=await upload(path,'audio',purpose);await send('prepareWorkspaceAudio',{kind,materialRevisionId,description:kind,durationSeconds:seconds,anchor:'absolute',offsetSeconds:offset});preparationIds[kind]=w.audio.preparations[0].id;await send('adoptWorkspaceAudio',{preparationId:preparationIds[kind]});}
  const record=async(name:string,value:unknown)=>{if(process.env.LOOP_T06_EVIDENCE_DIR)await writeFile(join(process.env.LOOP_T06_EVIDENCE_DIR,name+'.json'),JSON.stringify(value,null,2));};
  let before=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));const sounds=w.audio.mix.sounds;
  const soundNodes=(doc:any)=>({items:doc.timelines[0].items.filter((i:any)=>['bgm','sfx'].includes(i.loopControlAudio?.kind)).sort((a:any,b:any)=>String(a.id).localeCompare(String(b.id))),tracks:Object.fromEntries(Object.entries(doc.timelines[0].tracks).filter(([id])=>before.timelines[0].items.some((i:any)=>i.track===id&&['bgm','sfx'].includes(i.loopControlAudio?.kind))))});
  w=await f.fillVisuals(w);const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
  async function nativeFile(){return{doc:await editStudioDocument(opened.body.studioUrl,w.project.projectId,()=>{}),write:async(doc:any)=>editStudioDocument(opened.body.studioUrl,w.project.projectId,()=>doc)};}
  // Establish the SDK's canonical track/source identities before measuring edits.
  await nativeFile();const baseline=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});expect(baseline.status,JSON.stringify(baseline.body)).toBe(200);w=baseline.body.productionWorkspace;before=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));
  let native=await nativeFile();const inactive={...priorSpeech,volume:0,src:native.doc.assets.find((a:any)=>a.id===priorSpeech.sourceAssetId).src};native.doc.timelines[0].items.push(inactive);native.doc.timelines[0].items.find((i:any)=>i.id===`workspace-source-shot-${clip.shotId}`).volume=10**(-6/20);await native.write(native.doc);
  const save=async()=>{const r=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body.productionWorkspace;};
  await save();let refreshed=(await(await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}})).json()).workspace;
  await record('projection-source',{mix:refreshed.audio.mix,captions:refreshed.captions});
  expect(refreshed.audio.mix.voices.find((v:any)=>v.shotId===clip.shotId)).toMatchObject({mode:'source',gainDb:-6});expect(refreshed.captions.find((c:any)=>c.shotId===clip.shotId).audioTrackId).toBe(sourceTrackId);expect(refreshed.audio.mix.sounds).toEqual(sounds);expect(soundNodes(JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')))).toEqual(soundNodes(before));
  native=await nativeFile();native.doc.timelines[0].items.find((i:any)=>i.id===`workspace-source-shot-${clip.shotId}`).volume=0;await native.write(native.doc);await save();refreshed=(await(await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}})).json()).workspace;
  await record('projection-none',{mix:refreshed.audio.mix,captions:refreshed.captions});
  expect(refreshed.audio.mix.voices.find((v:any)=>v.shotId===clip.shotId)).toMatchObject({mode:'none',gainDb:0});expect(refreshed.captions.find((c:any)=>c.shotId===clip.shotId).audioTrackId).toBeNull();expect(refreshed.audio.mix.sounds).toEqual(sounds);expect(soundNodes(JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')))).toEqual(soundNodes(before));
  // Re-adoption must keep the Owner's native trims and mix, not the preparation defaults.
  native=await nativeFile();const music=native.doc.timelines[0].items.find((i:any)=>i.id==='workspace-bgm');Object.assign(music,{startFrame:6,durationInFrames:90,srcInFrame:15,playbackRate:1,volume:10**(-18/20),fadeInFrames:3,fadeOutFrames:4});Object.assign(native.doc.timelines[0].tracks[music.track],{role:'follower',audioRouting:{duckDepthDb:-14}});await native.write(native.doc);await save();
  const edited=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),editedNodes=soundNodes(edited);await send('closeWorkspaceStudio');await send('adoptWorkspaceAudio',{preparationId:preparationIds.bgm});
  await record('projection-bgm-readoption',{mix:w.audio.mix,sounds:soundNodes(JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')))});
  expect(w.audio.mix.sounds.find((s:any)=>s.kind==='bgm')).toMatchObject({startSeconds:.2,durationSeconds:3,gainDb:-18,duckDepthDb:14});expect(soundNodes(JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')))).toEqual(editedNodes);
 }finally{await f.close();}
},240000);
