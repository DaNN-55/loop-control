// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner reorders native shot instances without rewriting registered sources or storyboard history',async()=>{
 const f=await productionWorkspaceFixture();try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const before=await readFile(join(f.assetRoot,f.boardPath),'utf8');
  const moved=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'move',shotId:w.clips[1].shotId,beforeShotId:w.clips[0].shotId}});
  expect(moved.status,JSON.stringify(moved.body)).toBe(200);w=moved.body;
  const project=(await (await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace/project?sha=${w.project.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}})).json()).project;
  expect(project.timelines[0].items.find((i:{id:string})=>i.id===w.clips[0].itemId).startFrame).toBe(0);
  expect(w.clips[0].shotId).toBe('shot-2');expect(await readFile(join(f.assetRoot,f.boardPath),'utf8')).toBe(before);
  expect((await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision-1,operation:{kind:'remove',shotId:'shot-2'}})).status).toBe(409);
  await f.restart();const resumed=(await (await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}})).json()).workspace;
  expect(resumed.clips[0].shotId).toBe('shot-2');expect(resumed.history.length).toBeGreaterThan(1);
 }finally{await f.close();}
},180_000);
