// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {editStudioDocument} from './studioDocument.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('narration and caption switches survive native save without losing media, drafts, gains or independent text',async()=>{
 const second=productionScriptTemplate.slice(productionScriptTemplate.indexOf('### 段落 01'),productionScriptTemplate.indexOf('## 本期补充约束')).replace('段落 01','段落 02');
 const f=await formalWorkflowFixture({scriptText:productionScriptTemplate.replace('## 本期补充约束',second+'## 本期补充约束')});try{
  expect((await f.send('start')).status).toBe(200);
  let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;expect(w.clips).toHaveLength(2);
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;return r.body;};
  const imported=await f.send('importMaterial',{sourceKind:'file',sourcePath:'voice.mp3',contentBase64:(await readFile(workspaceTestMedia('controlled-narration-tone.mp3'))).toString('base64'),materialType:'audio',materialPurpose:'general_reference',mimeType:'audio/mpeg',isMainScript:false});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  const clipId=w.clips[0].id,shotId=w.clips[0].shotId;
  await send('saveWorkspaceNarration',{clipId,mode:'manual',text:'冻结口播，不随字幕修改。',materialRevisionId:imported.body.id});await send('confirmWorkspaceNarration',{clipId});const track=w.narration[0].audioTrackId;
  const plan=await f.send('prepareWorkspaceCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:track,durationPolicy:'use-candidate'});expect(plan.status,JSON.stringify(plan.body)).toBe(200);await send('adoptWorkspaceCandidate',{candidateId:track,adoptionId:plan.body.adoptionId});
  await send('mixWorkspaceAudio',{edit:{kind:'voice',workspaceId:w.id,shotId,visualItemIds:[w.clips[0].itemId],mode:'tts',gainDb:-9,ambienceGainDb:null}});
  await send('saveWorkspaceNarrationCaptions',{clipId,contentMode:'independent',text:'单独编辑的精简字幕。'});
  const originalProject=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),originalVoice=originalProject.timelines[0].items.find((i:any)=>i.id===w.narration[0].itemId),caption=w.captions[0].contract,narration=w.narration[0];
  const invalid=await f.send('setWorkspaceNarrationEnabled',{workspaceId:w.id,expectedRevision:w.revision,clipId,enabled:'false'});expect(invalid.status).toBe(400);
  await send('setWorkspaceNarrationEnabled',{clipId,enabled:false});expect(w.narration[0]).toMatchObject({enabled:false,retainedAudioTrackId:track,text:narration.text,mode:'manual'});expect(w.audio.mix.voices.find((v:any)=>v.shotId===shotId).mode).toBe('none');expect(w.captions[0].contract).toEqual(caption);expect(w.narration[1].enabled).toBe(true);
  const muted=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')).timelines[0].items.find((i:any)=>i.id===originalVoice.id);expect(muted).toMatchObject({src:originalVoice.src,sourceAssetId:originalVoice.sourceAssetId,volume:0,durationInFrames:originalVoice.durationInFrames});
  const legacyBlocked=await f.send('adoptWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId,inputFingerprint:narration.inputFingerprint,audioTrackId:track});expect(legacyBlocked.status).toBe(409);
  const blocked=await f.send('prepareWorkspaceCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:track,durationPolicy:'use-candidate'});expect(blocked.status).toBe(409);
  await send('setWorkspaceCaptionsEnabled',{clipId,enabled:false});expect(w.captions[0].contract).toEqual({...caption,enabled:false});expect(w.narration[0].enabled).toBe(false);
  // The base fixture clip is shorter than the template's placeholder; use a real 8-second loop.
  const videoPath=join(f.assetRoot,'switch-reference.mp4');await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-y','-stream_loop','-1','-i',workspaceTestMedia('landscape-red-blue.mp4'),'-t','8','-c','copy',videoPath]);
  const visual=await f.send('importMaterial',{sourceKind:'file',sourcePath:'visual.mp4',contentBase64:(await readFile(videoPath)).toString('base64'),materialType:'video',materialPurpose:'a_roll',mimeType:'video/mp4',isMainScript:false});expect(visual.status).toBe(200);
  for(const clip of w.clips)await send('matchWorkspaceMaterial',{clipId:clip.id,materialRevisionId:visual.body.id});
  const opened=await f.send('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,()=>{});
  const saved=await f.send('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;
  expect((await f.send('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision})).status).toBe(200);
  await f.restart();const resumed=await fetch(f.origin+`/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(resumed.status).toBe(200);w=(await resumed.json()).workspace;expect(w.narration[0].enabled).toBe(false);expect(w.captions[0].contract).toEqual({...caption,enabled:false});
  await send('setWorkspaceNarrationEnabled',{clipId,enabled:true});expect(w.narration[0]).toMatchObject({enabled:true,adoptedAudioTrackId:track,text:narration.text});const restored=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')).timelines[0].items.find((i:any)=>i.id===originalVoice.id);expect(restored.volume).toBe(originalVoice.volume);expect(restored.src).toBe(originalVoice.src);expect(restored.loopControlNarrationMute).toBeUndefined();expect(w.captions[0].contract.enabled).toBe(false);
  await send('setWorkspaceCaptionsEnabled',{clipId,enabled:true});expect(w.captions[0].contract).toEqual(caption);
  await send('saveWorkspaceNarrationCaptions',{clipId,contentMode:'independent',text:'只改字幕，不修改口播。'});expect(w.narration[0].text).toBe(narration.text);expect(w.usedNarration[0].text).toBe(narration.text);
  await send('saveWorkspaceNarrationCaptions',{clipId,contentMode:'follow_tts'});expect(w.captions[0].contract).toMatchObject({enabled:true,contentMode:'follow_tts',text:narration.text});
  expect((await f.c.query("SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1 AND task_type='generate_narration'",[f.newEpisode])).rows[0].n).toBe(1);
 }finally{await f.close();}
},120_000);
