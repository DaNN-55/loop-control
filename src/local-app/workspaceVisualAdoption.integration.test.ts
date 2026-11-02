// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {editStudioDocument} from './studioDocument.fixture';
import {applyWorkspaceCandidate,workspaceCandidateTarget} from '../workspaceCandidates';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1',exec=promisify(execFile);

async function scenario(kind:'image'|'video'){
 const f=await productionWorkspaceFixture();
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const image=await f.request('importMaterial',{sourceKind:'file',sourcePath:'baseline.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(image.status,JSON.stringify(image.body)).toBe(200);
  for(const clip of w.clips){const result=await f.request('matchWorkspaceImage',{workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id,materialRevisionId:image.body.id,usage:'still',durationSeconds:2,fit:'contain',focusX:0,focusY:0});expect(result.status,JSON.stringify(result.body)).toBe(200);w=result.body;}
  let material=f.material;
  if(kind==='image'){
   const path=join(f.root,'candidate.png');await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=640x360','-frames:v','1',path]);
   const result=await f.request('importMaterial',{sourceKind:'file',sourcePath:'candidate.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(path)).toString('base64')});expect(result.status,JSON.stringify(result.body)).toBe(200);material=result.body.id;
  }
  const result=await f.request('registerWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,materialRevisionId:material,usage:kind==='image'?'still':'video',durationSeconds:2});expect(result.status,JSON.stringify(result.body)).toBe(200);w=result.body;
  return{...f,w,candidate:w.visualCandidates.find((v:{materialRevisionId:string})=>v.materialRevisionId===material)};
 }catch(error){await f.close();throw error;}
}

it.skipIf(!enabled).each(['image','video'] as const)('a saved native %s recovers only its missing adoption receipt and remains identical after reopening',async kind=>{
 const f=await scenario(kind);try{
  let w=f.w;const candidate=f.candidate,opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
  // The real editor loads/migrates the SDK document before Owner chooses a candidate.
  const original=await editStudioDocument(opened.body.studioUrl,w.project.projectId,()=>{});
  const prepared=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'keep-target'});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  const premature=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:prepared.body.adoptionId,nativeApplied:true});expect(premature.status).toBe(409);expect(premature.body.error).toContain('保存');
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{expect(workspaceCandidateTarget(doc.timelines[0].items.find((i:{id:string})=>i.id===candidate.targetItemId))).toEqual(prepared.body.edit.expectedTarget);return applyWorkspaceCandidate(doc,prepared.body.edit);});
  const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;
  expect(w.visualCandidates.find((v:{id:string})=>v.id===candidate.id).pendingConfirmation).toBe(true);
  const decisions=()=>f.c.query('SELECT * FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1 AND candidate_id=$2',[w.id,candidate.id]);expect((await decisions()).rows).toHaveLength(0);
  const savedBytes=await readFile(join(f.assetRoot,w.project.relativePath)),savedProject=JSON.parse(savedBytes.toString()),target=savedProject.timelines[0].items.find((i:{id:string})=>i.id===candidate.targetItemId),tasksBefore=(await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.episode])).rows[0].n;
  expect(target).toMatchObject({kind,src:candidate.relativePath,sourceContentHash:candidate.sha256,sourceAssetId:'candidate-'+candidate.id,srcInFrame:0,durationInFrames:60});
  expect(savedProject.timelines[0].items.filter((i:{id:string})=>i.id!==target.id).map((i:{id:string;durationInFrames:number;startFrame:number})=>({id:i.id,durationInFrames:i.durationInFrames,startFrame:i.startFrame}))).toEqual(original.timelines[0].items.filter((i:{id:string})=>i.id!==target.id).map((i:{id:string;durationInFrames:number;startFrame:number})=>({id:i.id,durationInFrames:i.durationInFrames,startFrame:i.startFrame})));
  await f.restart();const reopened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(reopened.status,JSON.stringify(reopened.body)).toBe(200);w=reopened.body.productionWorkspace;
  const beforeConfirm=w.project.sha256;
  for(let attempt=0;attempt<2;attempt++){
   const confirmed=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,nativeApplied:true});expect(confirmed.status,JSON.stringify(confirmed.body)).toBe(200);w=confirmed.body;
   expect(w.visualCandidates.find((v:{id:string})=>v.id===candidate.id)).toMatchObject({status:'adopted',pendingConfirmation:false});expect(w.project.sha256).toBe(beforeConfirm);
  }
  expect((await decisions()).rows).toHaveLength(1);expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(tasksBefore);
  await f.restart();const final=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(final.status,JSON.stringify(final.body)).toBe(200);w=final.body.productionWorkspace;
  const actual=await editStudioDocument(final.body.studioUrl,w.project.projectId,()=>{}),item=actual.timelines[0].items.find((i:{id:string})=>i.id===target.id);expect(item).toMatchObject({sourceAssetId:target.sourceAssetId,sourceContentHash:target.sourceContentHash,srcInFrame:target.srcInFrame,durationInFrames:target.durationInFrames});
  expect(await readFile(join(f.assetRoot,saved.body.productionWorkspace.project.relativePath))).toEqual(savedBytes);expect(w.visualCandidates.find((v:{id:string})=>v.id===candidate.id).pendingConfirmation).toBe(false);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled).each(['image','video'] as const)('a prepared %s cannot overwrite a newer saved target',async kind=>{
 const f=await scenario(kind);try{
  let w=f.w;const prepared=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:f.candidate.id,durationPolicy:'keep-target'});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  const changed=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'appearance',itemId:w.clips[0].itemId,focusX:23}});expect(changed.status,JSON.stringify(changed.body)).toBe(200);w=changed.body;
  const before=await readFile(join(f.assetRoot,w.project.relativePath));const denied=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:f.candidate.id,adoptionId:prepared.body.adoptionId});expect(denied.status,JSON.stringify(denied.body)).toBe(409);
  expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(before);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1 AND candidate_id=$2',[w.id,f.candidate.id])).rows[0].n).toBe(0);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled).each(['image','video'] as const)('changed prepared %s bytes prevent native save without recording adoption',async kind=>{
 const f=await scenario(kind);try{
  let w=f.w;const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,()=>{});
  const prepared=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:f.candidate.id,durationPolicy:'keep-target'});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>applyWorkspaceCandidate(doc,prepared.body.edit));
  const path=join(f.assetRoot,f.candidate.relativePath),bytes=await readFile(path);bytes[0]^=1;await writeFile(path,bytes);
  const denied=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(denied.status,JSON.stringify(denied.body)).toBe(409);
  expect((await f.c.query('SELECT project_sha256 FROM local_identity.production_workspaces WHERE id=$1',[w.id])).rows[0].project_sha256).toBe(w.project.sha256);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1 AND candidate_id=$2',[w.id,f.candidate.id])).rows[0].n).toBe(0);
 }finally{await f.close();}
},120000);
