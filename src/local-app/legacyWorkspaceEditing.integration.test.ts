// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {OpenChatCutRuntimeConfig} from '../worker/openchatcutStudio';
import {editStudioDocument} from './studioDocument.fixture';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {buildOpenChatCutProject} from '../worker/openchatcutProject';
import {confirmedTtsRender} from '../worker/openchatcutProject.fixture';
const hash=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex');
it.skipIf(process.env.LOOP_LEGACY_EDIT_ACCEPTANCE!=='1')('continues the exact original native project, saves a new immutable version and restores it after restart without generation',async()=>{
 const f=await productionWorkspaceFixture();
 const unrelated=createServer((_q,s)=>s.end('<title>Other local app</title>'));unrelated.listen(0,'127.0.0.1');await once(unrelated,'listening');
 const occupiedPort=(unrelated.address() as {port:number}).port;(f.runtime as OpenChatCutRuntimeConfig).port=occupiedPort;
 try{
  const render=confirmedTtsRender(false);render.preRenderReviewPackageId=f.board;render.members[0].relativePath=f.videoPath;render.members[1].relativePath=`episodes/${f.episode}/voice.mp3`;
  const project=buildOpenChatCutProject(render,`loop-control-${f.episode}`);project.timelines[0].items.find(i=>i.kind==='video')!.transform={scale:1.13,x:23,y:9,rotation:4};project.timelines[0].name='原有剪辑不能重建';
  const path=`episodes/${f.episode}/original-project.json`,bytes=Buffer.from(JSON.stringify(project,null,2)+'\n'),artifact=randomUUID();await writeFile(join(f.assetRoot,path),bytes);
  await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'review_render_project',$4,$5,$6)",[artifact,f.episode,f.task,path,hash(bytes),bytes.length]);
  await f.c.query('DELETE FROM local_identity.input_episodes WHERE episode_id=$1',[f.episode]);
  const fingerprint=async()=>(await f.c.query("SELECT jsonb_build_object('episode',(SELECT to_jsonb(e) FROM public.episodes e WHERE id=$1),'tasks',(SELECT jsonb_agg(t ORDER BY id) FROM public.tasks t WHERE episode_id=$1),'approvals',(SELECT jsonb_agg(a ORDER BY id) FROM public.approvals a WHERE episode_id=$1),'materials',(SELECT jsonb_agg(m ORDER BY id) FROM public.production_material_revisions m WHERE episode_id=$1)) value",[f.episode])).rows[0].value;
  const before=await fingerprint(),data={artifactId:artifact,expectedSourceSha256:hash(bytes),expectedScriptRevisionId:f.script,reviewPackageId:f.board};
  const rejected=await f.request('adoptLegacyWorkspace',data,{token:f.otherToken});expect(rejected.status).toBe(404);
  expect((await f.request('adoptLegacyWorkspace',{...data,expectedSourceSha256:'0'.repeat(64)})).status).toBe(409);
  expect((await f.request('adoptLegacyWorkspace',{...data,reviewPackageId:randomUUID()})).status).toBe(409);
  expect((await f.request('adoptLegacyWorkspace',{...data,expectedScriptRevisionId:randomUUID()})).status).toBe(409);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.input_episodes')).rows[0].n).toBe(0);
  const adopted=await f.request('adoptLegacyWorkspace',data);expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);let w=adopted.body;
  expect((await f.request('adoptLegacyWorkspace',data)).status).toBe(409);
  expect(w.nativeEditRevision).toBeGreaterThan(0);expect(w.preparation.authorized).toBe(false);expect(w.readiness.placeholders).toEqual([]);
  const getProject=async(sha:string)=>{const r=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace/project?sha=${sha}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);return(await r.json()).project;};
  let copy=await getProject(w.project.sha256);expect(copy.timelines[0].name).toBe(project.timelines[0].name);expect(copy.timelines[0].items.find((i:any)=>i.kind==='video').transform.x).toBe(23);
  const originalContent=structuredClone(copy);originalContent.loopControl=project.loopControl;for(const t of originalContent.timelines)for(const item of t.items)delete item.loopControlShot;expect(originalContent).toEqual(project);
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
  expect(new URL(opened.body.studioUrl).port).not.toBe(String(occupiedPort));expect(await(await fetch(`http://127.0.0.1:${occupiedPort}/`)).text()).toContain('Other local app');
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{doc.timelines[0].items.find((i:any)=>i.kind==='video').transform.x=51;});
  const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:opened.body.workspace.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;
  copy=await getProject(w.project.sha256);expect(copy.timelines[0].items.find((i:any)=>i.kind==='video').transform.x).toBe(51);expect(w.history.length).toBeGreaterThan(1);
  const archived=await getProject(adopted.body.recovery.sha256);expect(archived).toEqual(project);
  expect((await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:adopted.body.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:opened.body.workspace.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256})).status).toBe(409);
  await f.restart();const reopened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(reopened.status,JSON.stringify(reopened.body)).toBe(200);copy=await getProject(reopened.body.productionWorkspace.project.sha256);expect(copy.timelines[0].items.find((i:any)=>i.kind==='video').transform.x).toBe(51);
  expect(await readFile(join(f.assetRoot,path))).toEqual(bytes);expect(await fingerprint()).toEqual(before);
  const flags=(await f.c.query('SELECT * FROM local_identity.input_episodes WHERE episode_id=$1',[f.episode])).rows[0];for(const key of ['enabled','storyboard_enabled','media_enabled','narration_enabled','studio_enabled'])expect(flags[key],key).toBe(false);
 }finally{await f.close();unrelated.closeAllConnections();await new Promise<void>(r=>unrelated.close(()=>r()));}
},120000);

it.skipIf(process.env.LOOP_LEGACY_EDIT_ACCEPTANCE!=='1')('prefers the most recently saved native edit and archives it before creating the working copy',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  await f.c.query("UPDATE public.episodes SET stage='qc_review' WHERE id=$1",[f.episode]);
  const opened=await f.request('openStudio',{projectRelativePath:f.boardPath});expect(opened.status,JSON.stringify(opened.body)).toBe(200);
  await editStudioDocument(opened.body.studioUrl,opened.body.workspace.projectId,doc=>{doc.timelines[0].items.find((i:any)=>i.kind==='video').transform.x=37;});await f.closeStudio();
  const response=await fetch(`${f.origin}/api/local/episodes/${f.episode}/legacy-project`,{headers:{Cookie:'loop_owner_session='+f.token}}),saved=await response.json();
  const data={expectedScriptRevisionId:f.script,reviewPackageId:f.board,savedProjectSha256:saved.sha256};
  expect((await f.request('adoptLegacyWorkspace',{...data,savedProjectSha256:'0'.repeat(64)})).status).toBe(409);
  expect((await f.request('adoptLegacyWorkspace',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,artifactId:randomUUID(),expectedSourceSha256:'0'.repeat(64)})).status).toBe(409);
  const result=await f.request('adoptLegacyWorkspace',data);expect(result.status,JSON.stringify(result.body)).toBe(200);
  const archived=JSON.parse(await readFile(join(f.assetRoot,result.body.recovery.relativePath),'utf8'));expect(archived.project).toEqual(saved.project);
  const working=JSON.parse(await readFile(join(f.assetRoot,result.body.project.relativePath),'utf8'));expect(working.timelines[0].items.find((i:any)=>i.kind==='video').transform.x).toBe(37);
 }finally{await f.close();}
},120000);
