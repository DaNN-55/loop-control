// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {editStudioDocument} from './studioDocument.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each([2,1,3])('prepared visual impact matches native adoption, persistence and reopen for %s seconds',async duration=>{
 const f=await productionWorkspaceFixture();try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const targetItemId=w.clips[0].itemId,otherItemId=w.clips[1].itemId;
  const send=async(name:string,data:Record<string,unknown>={})=>{const r=await f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body;};
  const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'candidate.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(image.status).toBe(200);
  const original=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),placeholder=original.timelines[0].items[0];
  w=await send('registerWorkspaceVisualCandidate',{targetItemId,materialRevisionId:image.body.id,usage:'still',durationSeconds:2});let plan=await send('prepareWorkspaceVisualCandidate',{candidateId:w.visualCandidates[0].id,durationPolicy:'keep-target'});w=await send('adoptWorkspaceVisualCandidate',{candidateId:w.visualCandidates[0].id,adoptionId:plan.adoptionId});w=await f.fillVisuals(w);
  let opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{const timeline=doc.timelines[0];timeline.tracks.overlay={kind:'text',name:'说明'};timeline.trackOrder.push('overlay');timeline.items.push({...placeholder,id:'spanning-overlay',name:'跨区间说明',track:'overlay',startFrame:15,durationInFrames:90});});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256})).productionWorkspace;await send('closeWorkspaceStudio');
  const nextImage=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'next-candidate.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(nextImage.status).toBe(200);
  w=await send('registerWorkspaceVisualCandidate',{targetItemId,materialRevisionId:nextImage.body.id,usage:'still',durationSeconds:duration});const candidate=w.visualCandidates.find((c:any)=>c.materialRevisionId===nextImage.body.id),sha=w.project.sha256;
  plan=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'use-candidate',acceptTimelineImpact:true});
  expect(plan.projectSha256).toBe(sha);expect(plan.impact).toMatchObject({fps:30,currentSeconds:2,sourceSeconds:duration,appliedSeconds:duration,deltaSeconds:duration-2,startSeconds:0,endSeconds:duration});
  const affected=plan.impact.affectedFragments;
  if(duration===2)expect(affected).toEqual([]);else expect(affected).toContainEqual(expect.objectContaining({itemId:'spanning-overlay',startSeconds:0.5,endSeconds:3.5,changedStartSeconds:Math.min(2,duration),changedEndSeconds:Math.max(2,duration)}));
  if(duration===3){expect(affected).toContainEqual(expect.objectContaining({itemId:otherItemId,changedStartSeconds:2,changedEndSeconds:3}));w=await send('editWorkspaceStructure',{operation:{kind:'appearance',itemId:otherItemId,focusX:23}});const conflict=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:plan.adoptionId});expect(conflict.status).toBe(409);expect((await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'use-candidate',acceptTimelineImpact:true})).projectSha256).toBe(w.project.sha256);plan=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'use-candidate',acceptTimelineImpact:true});}
  const before=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));w=await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:plan.adoptionId});
  const document=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),target=document.timelines[0].items.find((i:any)=>i.id===candidate.targetItemId);expect(target.durationInFrames).toBe(duration*30);expect(document.timelines[0].items.filter((i:any)=>i.id!==candidate.targetItemId)).toEqual(before.timelines[0].items.filter((i:any)=>i.id!==candidate.targetItemId));
  opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;const native=await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>doc);expect(native.timelines[0].items.find((i:any)=>i.id===candidate.targetItemId).durationInFrames).toBe(duration*30);w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256})).productionWorkspace;await send('closeWorkspaceStudio');expect(w.visualCandidates.find((c:any)=>c.id===candidate.id).status).toBe('adopted');
  if(process.env.LOOP_STORY_EVIDENCE)await writeFile(join(process.env.LOOP_STORY_EVIDENCE,`candidate-impact-${duration}.json`),JSON.stringify({plan,persistedFrames:target.durationInFrames,unchangedOtherFragments:true,reopened:true,conflictChecked:duration===3},null,2));
 }finally{await f.close();}
},120000);
