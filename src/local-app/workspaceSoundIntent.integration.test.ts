// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {editStudioDocument} from './studioDocument.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner saves optional shot sound intent without adding audio and reads it after structure changes, native save and restart',async()=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){throw Error('Sound intent must not start production');}}});
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const first=w.clips[0],boardBefore=await readFile(join(f.assetRoot,f.boardPath),'utf8'),scriptBefore=await readFile(join(f.assetRoot,`episodes/${f.episode}/script.md`),'utf8');
  const send=async(command:string,data={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...(command==='saveWorkspaceSoundIntent'?{expectedProjectSha256:w.project.sha256}:{}),...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body.productionWorkspace??r.body;return r.body;};
  const read=async()=> (await(await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}})).json()).workspace;
  const before=await read(),projectBefore=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));
  expect(first.soundIntent).toBeUndefined();
  await send('saveWorkspaceSoundIntent',{shotId:first.shotId,soundIntent:' 开门时一声轻响，落在切镜点。 '});
  expect(w.clips.find((c:any)=>c.shotId===first.shotId).soundIntent).toBe('开门时一声轻响，落在切镜点。');
  expect(w.clips.find((c:any)=>c.shotId!==first.shotId).soundIntent).toBeUndefined();
  expect(w.contentSha256).toBe(before.contentSha256);expect(w.revision).toBe(before.revision);expect(w.project.sha256).not.toBe(before.project.sha256);
  expect((await f.request('saveWorkspaceSoundIntent',{workspaceId:w.id,expectedRevision:w.revision,expectedProjectSha256:before.project.sha256,shotId:first.shotId,soundIntent:'过时意图覆盖'})).status).toBe(409);
  expect(w.audio).toEqual(before.audio);expect(w.visualTasks).toEqual(before.visualTasks);
  const projectAfter=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));
  expect(projectAfter.timelines.flatMap((t:any)=>t.items).map((i:any)=>i.id)).toEqual(projectBefore.timelines.flatMap((t:any)=>t.items).map((i:any)=>i.id));
  expect(projectAfter.assets).toEqual(projectBefore.assets);
  expect((await f.request('saveWorkspaceSoundIntent',{workspaceId:w.id,expectedRevision:w.revision-1,expectedProjectSha256:w.project.sha256,shotId:first.shotId,soundIntent:'过时编辑'})).status).toBe(409);
  expect((await f.request('saveWorkspaceSoundIntent',{workspaceId:w.id,expectedRevision:w.revision,expectedProjectSha256:w.project.sha256,shotId:'unknown',soundIntent:'不属于本镜'})).status).toBe(400);
  expect((await f.request('saveWorkspaceSoundIntent',{workspaceId:w.id,expectedRevision:w.revision,expectedProjectSha256:w.project.sha256,shotId:first.shotId,soundIntent:'声'.repeat(241)})).status).toBe(400);
  expect((await f.request('saveWorkspaceSoundIntent',{workspaceId:w.id,expectedRevision:w.revision,expectedProjectSha256:w.project.sha256,shotId:first.shotId,soundIntent:'外部修改'},{token:f.otherToken})).status).toBe(404);
  await send('saveWorkspaceVideoRanges',{shotId:first.shotId,ranges:[{clipId:first.id,materialRevisionId:f.material,sourceInFrame:0,durationInFrames:30,durationLocked:false},{materialRevisionId:f.material,sourceInFrame:30,durationInFrames:30,durationLocked:false}]});
  expect(w.clips.filter((c:any)=>c.shotId===first.shotId).map((c:any)=>c.soundIntent)).toEqual(['开门时一声轻响，落在切镜点。','开门时一声轻响，落在切镜点。']);
  await send('editWorkspaceStructure',{operation:{kind:'move',shotId:first.shotId,beforeShotId:null}});
  expect(w.clips.find((c:any)=>c.shotId===first.shotId)).toMatchObject({id:first.id,soundIntent:'开门时一声轻响，落在切镜点。'});
  w=await f.fillVisuals(w);const opened=await send('openWorkspaceStudio');
  expect((await f.request('saveWorkspaceSoundIntent',{workspaceId:w.id,expectedRevision:w.revision,expectedProjectSha256:w.project.sha256,shotId:first.shotId,soundIntent:'剪辑中不可覆盖'})).status).toBe(409);
  const native=await editStudioDocument(opened.studioUrl,w.project.projectId,()=>{});
  expect(native.timelines.flatMap((t:any)=>t.items).find((i:any)=>i.id===first.itemId).loopControlShot.soundIntent).toBe('开门时一声轻响，落在切镜点。');
  await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});
  await send('closeWorkspaceStudio');await f.restart();w=await read();
  expect(w.clips.find((c:any)=>c.shotId===first.shotId).soundIntent).toBe('开门时一声轻响，落在切镜点。');
  expect(await readFile(join(f.assetRoot,f.boardPath),'utf8')).toBe(boardBefore);expect(await readFile(join(f.assetRoot,`episodes/${f.episode}/script.md`),'utf8')).toBe(scriptBefore);
  const previousIntentSha=w.project.sha256;
  const revised=await f.request('reconfirmScript',{expectedScriptRevisionId:f.script,text:'# 已确认的第一镜。\n## 正文\n> 缺少素材的第二镜。\n',reason:'仅调整 Markdown 排版'});expect(revised.status,JSON.stringify(revised.body)).toBe(200);
  expect((await f.request('saveWorkspaceSoundIntent',{workspaceId:w.id,expectedRevision:w.revision,expectedProjectSha256:w.project.sha256,shotId:first.shotId,soundIntent:'脚本变化后不可直接写'})).status).toBe(409);
  await send('resumeWorkspaceEditing',{expectedScriptRevisionId:revised.body.id,expectedProjectSha256:w.project.sha256});
  expect(w.clips.find((c:any)=>c.shotId===first.shotId)).toMatchObject({id:first.id,soundIntent:'开门时一声轻响，落在切镜点。'});
  await send('saveWorkspaceSoundIntent',{shotId:first.shotId,soundIntent:''});expect(w.clips.find((c:any)=>c.shotId===first.shotId).soundIntent).toBeUndefined();
  const historical=await(await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace/project?sha=${previousIntentSha}`,{headers:{Cookie:'loop_owner_session='+f.token}})).json();
  expect(historical.project.timelines.flatMap((t:any)=>t.items).find((i:any)=>i.id===first.itemId).loopControlShot.soundIntent).toBe('开门时一声轻响，落在切镜点。');
  for(const state of ['archived','completed']){
   await f.c.query(state==='archived'?"UPDATE public.episodes SET archived_at=clock_timestamp() WHERE id=$1":"UPDATE public.episodes SET archived_at=NULL,stage='production_completed' WHERE id=$1",[f.episode]);
   expect((await f.request('saveWorkspaceSoundIntent',{workspaceId:w.id,expectedRevision:w.revision,expectedProjectSha256:w.project.sha256,shotId:first.shotId,soundIntent:'只读不可改'})).status).toBe(409);
  }
 }finally{await f.close();}
},180_000);
