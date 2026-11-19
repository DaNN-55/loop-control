// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceAudioFixture} from './workspaceAudio.fixture';
import {resolveWorkspaceMainVoice} from '../workspaceAudio';
import {editStudioDocument} from './studioDocument.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('replacement video reconnects registered primary source for caption timing, survives native save and silences a later silent source',async()=>{
 const f=await workspaceAudioFixture();try{
  let w=f.made;const send=async(name:string,data:Record<string,unknown>={})=>{const r=await f.chosenRequest(name,{...(name==='importMaterial'?{}:{workspaceId:w.id,expectedRevision:w.revision}),...data});expect(r.status,JSON.stringify(r.body)).toBe(200);if(r.body.clips)w=r.body;return r.body;};
  const clip=w.clips[0],shotId=clip.shotId;
  async function importVideo(path:string,name:string){return send('importMaterial',{materialType:'video',materialPurpose:'a_roll',sourceKind:'file',sourcePath:name,mimeType:'video/mp4',contentBase64:(await readFile(path)).toString('base64'),isMainScript:false});}
  const initial=await importVideo(f.media.video,'old-primary.mp4');await send('matchWorkspaceMaterial',{clipId:clip.id,materialRevisionId:initial.id});
  await send('prepareWorkspaceAudio',{kind:'source',shotId,sourceItemId:clip.itemId});const prep=w.audio.preparations[0];expect((await f.executeAudio(prep.taskId)).status).toBe('completed');await send('adoptWorkspaceAudio',{preparationId:prep.id});
  const before=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),old=resolveWorkspaceMainVoice(before,shotId).item;expect(old).toBeTruthy();
  const fresh=await importVideo(f.media.video,'new-primary.mp4');await send('registerWorkspaceVisualCandidate',{targetItemId:clip.itemId,materialRevisionId:fresh.id,usage:'video',durationSeconds:2});let candidate=w.visualCandidates.find((c:any)=>c.materialRevisionId===fresh.id);
  const taskCount=(await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.episode])).rows[0].n;
  let plan=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target'});expect(plan.edit.videoSound.mode).toBe('separate');expect(plan.edit.videoSound.boundSourceAsset.id).toMatch(/^audio-track-/);
  await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:plan.adoptionId});
  let doc=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),route=resolveWorkspaceMainVoice(doc,shotId);expect(route.sourceCurrent).toBe(true);expect(route.item?.sourceAssetId).toBe(plan.edit.videoSound.boundSourceAsset.id);expect(route.item?.src).not.toBe(old!.src);expect(w.captions.find((c:any)=>c.shotId===shotId).alignmentReady).toBe(true);
  expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(taskCount);
  w=await f.fillVisuals(w);const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;await editStudioDocument(opened.studioUrl,w.project.projectId,()=>{});w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256})).productionWorkspace;await send('closeWorkspaceStudio');
  const silent=await importVideo(join(f.assetRoot,f.videoPath),'no-audio.mp4');await send('registerWorkspaceVisualCandidate',{targetItemId:clip.itemId,materialRevisionId:silent.id,usage:'video',durationSeconds:2});candidate=w.visualCandidates.find((c:any)=>c.materialRevisionId===silent.id);plan=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target'});expect(plan.impact.videoSound).toBe('silent');await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:plan.adoptionId});
  doc=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(resolveWorkspaceMainVoice(doc,shotId).item).toBeUndefined();expect(doc.timelines[0].items.find((i:any)=>i.id===clip.itemId).loopControlAudio.sourceAudioStatus).toBe('silent');
 }finally{await f.close();}
},180000);
