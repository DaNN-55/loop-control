// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {editStudioDocument} from './studioDocument.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('saves consecutive native edits when split metadata changes the canonical snapshot SHA',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  w=await f.fillVisuals(w);
  const send=(name:string,extra={})=>f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...extra});
  const opened=await send('openWorkspaceStudio');expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{
   const t=doc.timelines[0],item=t.items.find((i:any)=>i.id===w.clips[0].itemId),part=structuredClone(item),half=Math.floor(item.durationInFrames/2);
   part.id='item_'+randomUUID();part.startFrame=item.startFrame+half;part.srcInFrame=(item.srcInFrame??0)+half;part.durationInFrames=item.durationInFrames-half;item.durationInFrames=half;t.items.push(part);
  });
  const first=await send('saveWorkspaceStudio',{workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(first.status,JSON.stringify(first.body)).toBe(200);w=first.body.productionWorkspace;
  expect(w.clips).toHaveLength(3);expect(first.body.sha256).not.toBe(w.project.sha256);
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{doc.timelines[0].name='拆分后继续编辑';});
  const payload={workspaceRelativePath:first.body.relativePath,projectId:w.project.projectId};
  const stale=await send('saveWorkspaceStudio',{...payload,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(stale.status).toBe(409);
  const second=await send('saveWorkspaceStudio',{...payload,expectedWorkspaceSha256:first.body.sha256});expect(second.status,JSON.stringify(second.body)).toBe(200);w=second.body.productionWorkspace;
  const doc=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(doc.timelines[0].name).toBe('拆分后继续编辑');expect(w.clips).toHaveLength(3);
  const closed=await send('closeWorkspaceStudio');expect(closed.status).toBe(200);
 }finally{await f.close();}
},180000);
