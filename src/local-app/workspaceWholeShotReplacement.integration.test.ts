// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {editStudioDocument} from './studioDocument.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('whole-shot replacement preserves independent tracks and a recoverable real native version through reopen and restore',async()=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){}}});try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);
  const send=async(name:string,data:Record<string,unknown>={})=>{const r=await f.request(name,{...(name==='importMaterial'?{}:{workspaceId:w.id,expectedRevision:w.revision}),...data});expect(r.status,JSON.stringify(r.body)).toBe(200);if(r.body.clips)w=r.body;return r.body;};
  const imported=await send('importMaterial',{materialType:'audio',materialPurpose:'general_reference',sourceKind:'file',sourcePath:'independent-effect.mp3',mimeType:'audio/mpeg',contentBase64:(await readFile(join(f.assetRoot,f.episodeRelativePath,'voice.mp3'))).toString('base64'),isMainScript:false});
  await send('prepareWorkspaceAudio',{kind:'sfx',shotId:w.clips[0].shotId,description:'保留独立音效',materialRevisionId:imported.id,durationSeconds:1});await send('adoptWorkspaceAudio',{preparationId:w.audio.preparations[0].id});
  const targetId=w.clips[0].itemId,shotId=w.clips[0].shotId,splitClip=randomUUID(),splitId=`shot-${shotId}-${splitClip}`;
  let opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{const t=doc.timelines[0],item=t.items.find((i:any)=>i.id===targetId);item.durationInFrames=30;t.items.push({...structuredClone(item),id:splitId,startFrame:30,srcInFrame:30,loopControlShot:{...item.loopControlShot,clipId:splitClip}});});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256})).productionWorkspace;await send('closeWorkspaceStudio');
  const before=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));
  const image=await send('importMaterial',{materialType:'image',materialPurpose:'visual_reference',sourceKind:'file',sourcePath:'replacement.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false});
  await send('registerWorkspaceVisualCandidate',{targetItemId:targetId,materialRevisionId:image.id,usage:'still',durationSeconds:2});const candidate=w.visualCandidates.find((c:any)=>c.materialRevisionId===image.id);
  const plan=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,replacementScope:'shot',durationPolicy:'keep-target',replaceCurrentVisual:true});expect(plan.edit.visual.replacement.itemIds.sort()).toEqual([targetId,splitId].sort());expect(plan.impact.replacementScope).toBe('shot');
  await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:plan.adoptionId});
  const after=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));
  expect(after.timelines[0].items.some((i:any)=>i.id===splitId)).toBe(false);expect(after.timelines[0].items.find((i:any)=>i.id===targetId)).toMatchObject({kind:'image',startFrame:0,durationInFrames:60});
  expect(after.timelines[0].items.filter((i:any)=>![targetId,splitId].includes(i.id))).toEqual(before.timelines[0].items.filter((i:any)=>![targetId,splitId].includes(i.id)));expect(after.timelines[0].tracks).toEqual(before.timelines[0].tracks);
  opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;const origin=new URL(opened.studioUrl).origin;
  const response=await fetch(origin+'/api/project-store/entry?key='+encodeURIComponent('versions:'+w.project.projectId),{headers:{'Sec-Fetch-Site':'none'}});expect(response.status).toBe(200);const history=(await response.json()).value;const version=history.find((entry:any)=>entry.name==='替换整条分镜前');expect(version).toBeTruthy();expect(version.doc.timelines[0].items.some((i:any)=>i.id===splitId)).toBe(true);
  const oldMedia=version.doc.timelines[0].items.find((i:any)=>i.id===splitId).src;expect(oldMedia).toMatch(/^\/media\/uploads\//);expect((await fetch(origin+oldMedia)).status).toBe(200);
  await editStudioDocument(opened.studioUrl,w.project.projectId,()=>structuredClone(version.doc));w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256})).productionWorkspace;
  const restored=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(restored.timelines[0].items.some((i:any)=>i.id===splitId)).toBe(true);expect(w.clips.filter((clip:any)=>clip.shotId===shotId)).toHaveLength(2);
 }finally{await f.close();}
},120000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a locked non-target shot member rejects replacement before creating native history or changing the saved source',async()=>{
 const f=await productionWorkspaceFixture();try{
  let w=await f.fillVisuals((await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body);
  const send=async(name:string,data:Record<string,unknown>={})=>{const result=await f.request(name,{...(name==='importMaterial'?{}:{workspaceId:w.id,expectedRevision:w.revision}),...data});expect(result.status,JSON.stringify(result.body)).toBe(200);if(result.body.clips)w=result.body;return result.body;};
  let opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;const targetId=w.clips[0].itemId,shotId=w.clips[0].shotId,clipId=randomUUID(),lockedId=`shot-${shotId}-${clipId}`;
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{const t=doc.timelines[0],target=t.items.find((i:any)=>i.id===targetId);t.tracks['locked-slot']={kind:'video',name:'锁定画面',locked:true};t.trackOrder.push('locked-slot');t.items.push({...structuredClone(target),id:lockedId,track:'locked-slot',loopControlShot:{...target.loopControlShot,clipId}});});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256})).productionWorkspace;await send('closeWorkspaceStudio');
  const image=await send('importMaterial',{materialType:'image',materialPurpose:'visual_reference',sourceKind:'file',sourcePath:'locked-replacement.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false});await send('registerWorkspaceVisualCandidate',{targetItemId:targetId,materialRevisionId:image.id,usage:'still',durationSeconds:2});const candidate=w.visualCandidates.find((c:any)=>c.materialRevisionId===image.id),sha=w.project.sha256,bytes=await readFile(join(f.assetRoot,w.project.relativePath));
  const rejected=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,replacementScope:'shot',durationPolicy:'keep-target',replaceCurrentVisual:true});expect(rejected.status).toBe(409);expect(rejected.body.error).toContain('锁定');
  expect((await f.c.query('SELECT project_sha256 FROM local_identity.production_workspaces WHERE id=$1',[w.id])).rows[0].project_sha256).toBe(sha);expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(bytes);
  opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;const result=await fetch(new URL(opened.studioUrl).origin+'/api/project-store/entry?key='+encodeURIComponent('versions:'+w.project.projectId),{headers:{'Sec-Fetch-Site':'none'}});expect((await result.json()).value??[]).toEqual([]);
 }finally{await f.close();}
},120000);
