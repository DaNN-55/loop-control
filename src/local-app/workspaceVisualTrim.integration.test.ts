// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';

it.skipIf(!enabled)('Owner HTTP applies an end-only video range to preparation and final adoption',async()=>{
 const f=await productionWorkspaceFixture();try{
  const prepared=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);let w=prepared.body;
  const registered=await f.request('registerWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,materialRevisionId:f.material,usage:'video'});expect(registered.status,JSON.stringify(registered.body)).toBe(200);w=registered.body;
  const candidate=w.visualCandidates[0],plan=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'use-candidate',acceptTimelineImpact:true,sourceOutSeconds:1});expect(plan.status,JSON.stringify(plan.body)).toBe(200);
  expect(plan.body.edit.source).toMatchObject({sourceInSeconds:0,durationSeconds:1,fullDurationSeconds:2});expect(plan.body.impact).toMatchObject({sourceSeconds:1,appliedSeconds:1});
  const adopted=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:plan.body.adoptionId});expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);w=adopted.body;
  const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),item=project.timelines[0].items.find((i:{id:string})=>i.id===candidate.targetItemId);expect(item).toMatchObject({srcInFrame:0,durationInFrames:30,sourceAssetId:'candidate-'+candidate.id});
 }finally{await f.close();}
},120000);

it.skipIf(!enabled).each([
 {name:'start only',range:{sourceInSeconds:0.5},start:15,frames:45,seconds:1.5},
 {name:'both endpoints',range:{sourceInSeconds:0.5,sourceOutSeconds:1.5},start:15,frames:30,seconds:1},
 {name:'omitted',range:{},start:0,frames:60,seconds:2},
])('Owner HTTP preserves $name video range semantics through adoption',async({range,start,frames,seconds})=>{
 const f=await productionWorkspaceFixture();try{
  let r=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(r.status,JSON.stringify(r.body)).toBe(200);let w=r.body;
  r=await f.request('registerWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,materialRevisionId:f.material,usage:'video'});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;
  const candidate=w.visualCandidates[0],base={workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id},before=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));
  const plan=await f.request('prepareWorkspaceVisualCandidate',{...base,durationPolicy:'use-candidate',acceptTimelineImpact:true,...range});expect(plan.status,JSON.stringify(plan.body)).toBe(200);expect(plan.body.impact).toMatchObject({sourceSeconds:seconds,appliedSeconds:seconds});
  if(!Object.keys(range).length)expect(plan.body.edit.source).not.toHaveProperty('sourceInSeconds');
  r=await f.request('adoptWorkspaceVisualCandidate',{...base,adoptionId:plan.body.adoptionId});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;
  const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(project.timelines[0].items.find((i:{id:string})=>i.id===candidate.targetItemId)).toMatchObject({srcInFrame:start,durationInFrames:frames,sourceAssetId:'candidate-'+candidate.id});expect(project.timelines[0].items.filter((i:{id:string})=>i.id!==candidate.targetItemId)).toEqual(before.timelines[0].items.filter((i:{id:string})=>i.id!==candidate.targetItemId));
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('Owner HTTP rejects invalid video ranges and retains the current project and candidate',async()=>{
 const f=await productionWorkspaceFixture();try{
  let r=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(r.status,JSON.stringify(r.body)).toBe(200);let w=r.body;
  r=await f.request('registerWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,materialRevisionId:f.material,usage:'video'});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;const candidate=w.visualCandidates[0],before=await readFile(join(f.assetRoot,w.project.relativePath));
  for(const range of [{sourceOutSeconds:0},{sourceOutSeconds:-1},{sourceOutSeconds:3},{sourceOutSeconds:'1'},{sourceInSeconds:-1},{sourceInSeconds:2},{sourceInSeconds:1,sourceOutSeconds:0.5}]){
   const result=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'use-candidate',acceptTimelineImpact:true,...range});expect(result.status,JSON.stringify({range,body:result.body})).toBe(400);expect(result.body.error).toContain('视频使用区间无效');
  }
  const response=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const current=(await response.json()).workspace;expect(current.revision).toBe(w.revision);expect(current.project.sha256).toBe(w.project.sha256);expect(current.visualCandidates.find((v:{id:string})=>v.id===candidate.id).status).toBe('available');expect(await readFile(join(f.assetRoot,current.project.relativePath))).toEqual(before);
 }finally{await f.close();}
},120000);
