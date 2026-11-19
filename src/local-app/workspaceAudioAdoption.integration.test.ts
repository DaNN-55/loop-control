// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {applyWorkspaceAudioAdoption} from '../workspaceAudioAdoption';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {workspaceAudioMedia} from './workspaceAudioMedia.fixture';
import {editStudioDocument} from './studioDocument.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('prepares audio while Studio is active, applies through its real store and registers only the saved adoption',async()=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){}}});try{
  const media=await workspaceAudioMedia(f.root);
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);
  const send=(name:string,data:Record<string,unknown>={})=>f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...data});
  const disabled=await send('setWorkspaceAudioEnabled',{kind:'bgm',enabled:false});expect(disabled.status,JSON.stringify(disabled.body)).toBe(200);w=disabled.body;
  const opened=await send('openWorkspaceStudio');expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;let nativeWorkspace=opened.body.workspace;
  const imported=await f.request('importMaterial',{materialType:'audio',sourceKind:'file',sourcePath:'selected.mp3',mimeType:'audio/mpeg',contentBase64:(await readFile(media.bgm)).toString('base64'),isMainScript:false,materialPurpose:'background_music'});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  const ready=await send('prepareWorkspaceAudio',{kind:'bgm',description:'受控配乐',materialRevisionId:imported.body.id,durationSeconds:4,anchor:'absolute',offsetSeconds:0});expect(ready.status,JSON.stringify(ready.body)).toBe(200);w=ready.body;const preparationId=w.audio.preparations[0].id;
  expect(w.audio.enabled.bgm).toBe(false);expect(w.audio.mix.sounds).toHaveLength(0);
  const plan=await send('prepareWorkspaceAudioAdoption',{preparationId});expect(plan.status,JSON.stringify(plan.body)).toBe(200);expect(plan.body.edit.asset.src).toMatch(/^\/media\/uploads\//);
  const unchanged=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(unchanged.timelines[0].items.some((i:any)=>i.kind==='audio')).toBe(false);
  const early=await send('commitWorkspaceAudioAdoption',{preparationId,adoptionId:plan.body.adoptionId,nativeApplied:true});expect(early.status).toBe(409);
  const applied=await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{Object.assign(doc,applyWorkspaceAudioAdoption(doc,plan.body.edit));});expect(applied.loopControl.audioEnabled.bgm).toBe(true);
  const saved=await send('saveWorkspaceStudio',{workspaceRelativePath:nativeWorkspace.relativePath,projectId:nativeWorkspace.projectId,expectedWorkspaceSha256:nativeWorkspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;nativeWorkspace=saved.body;
  const committed=await send('commitWorkspaceAudioAdoption',{preparationId,adoptionId:plan.body.adoptionId,nativeApplied:true});expect(committed.status,JSON.stringify(committed.body)).toBe(200);w=committed.body;
  expect(w.audio.enabled.bgm).toBe(true);expect(w.audio.mix.sounds).toHaveLength(1);expect(w.audio.preparations[0].adoptedItemId).toBe(w.audio.mix.sounds[0].itemId);
  const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(project.timelines[0].items.filter((i:any)=>i.kind==='audio')).toHaveLength(1);expect(project.timelines[0].items.find((i:any)=>i.kind==='audio').src).toBe(imported.body.storage_path);
  const secondMaterial=await f.request('importMaterial',{materialType:'audio',sourceKind:'file',sourcePath:'replacement.mp3',mimeType:'audio/mpeg',contentBase64:(await readFile(media.bgm)).toString('base64'),isMainScript:false,materialPurpose:'background_music'});expect(secondMaterial.status).toBe(200);
  const secondReady=await send('prepareWorkspaceAudio',{kind:'bgm',description:'第二版配乐',materialRevisionId:secondMaterial.body.id,durationSeconds:4,anchor:'absolute',offsetSeconds:0});expect(secondReady.status).toBe(200);w=secondReady.body;
  const secondId=w.audio.preparations.find((p:any)=>p.source?.materialRevisionId===secondMaterial.body.id).id;
  const secondPlan=await send('prepareWorkspaceAudioAdoption',{preparationId:secondId});expect(secondPlan.status,JSON.stringify(secondPlan.body)).toBe(200);
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{Object.assign(doc,applyWorkspaceAudioAdoption(doc,secondPlan.body.edit));});
  const secondSave=await send('saveWorkspaceStudio',{workspaceRelativePath:nativeWorkspace.relativePath,projectId:nativeWorkspace.projectId,expectedWorkspaceSha256:nativeWorkspace.sha256});expect(secondSave.status,JSON.stringify(secondSave.body)).toBe(200);w=secondSave.body.productionWorkspace;nativeWorkspace=secondSave.body;
  const secondCommit=await send('commitWorkspaceAudioAdoption',{preparationId:secondId,adoptionId:secondPlan.body.adoptionId,nativeApplied:true});expect(secondCommit.status,JSON.stringify(secondCommit.body)).toBe(200);w=secondCommit.body;
  expect(w.audio.mix.sounds).toHaveLength(1);
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{Object.assign(doc,structuredClone(applied));});
  const restored=await send('saveWorkspaceStudio',{workspaceRelativePath:nativeWorkspace.relativePath,projectId:nativeWorkspace.projectId,expectedWorkspaceSha256:nativeWorkspace.sha256});expect(restored.status,JSON.stringify(restored.body)).toBe(200);w=restored.body.productionWorkspace;
  expect(w.audio.mix.sounds).toHaveLength(1);expect(w.audio.preparations.find((p:any)=>p.id===preparationId).adoptedItemId).toBe(w.audio.mix.sounds[0].itemId);
  const restoredProject=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(restoredProject.timelines[0].items.find((i:any)=>i.kind==='audio').sourceAssetId).toBe('material-'+imported.body.id);
  expect((await send('closeWorkspaceStudio')).status).toBe(200);
 }finally{await f.close();}
},180000);
