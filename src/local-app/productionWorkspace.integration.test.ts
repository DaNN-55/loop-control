// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner persists incomplete matches, gates native entry until visuals are ready and reopens safely',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  const {script,material}=f;
  const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:script});
  expect(made.status,JSON.stringify(made.body)).toBe(200);
  expect(made.body.workflowVersion).toBe('four-step/v1');expect(made.body.clips).toHaveLength(2);expect(made.body.readiness.placeholders).toHaveLength(2);
  const read=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(read.status).toBe(200);expect((await read.json()).workspace.id).toBe(made.body.id);
  const payload={workspaceId:made.body.id,expectedRevision:made.body.revision,clipId:made.body.clips[0].id,materialRevisionId:material};
  expect((await f.request('matchWorkspaceMaterial',payload,{token:f.otherToken})).status).toBe(404);
  expect((await f.request('matchWorkspaceMaterial',payload,{csrf:false})).status).toBe(403);
  expect((await f.request('matchWorkspaceMaterial',payload,{origin:'http://foreign.invalid'})).status).toBe(403);
  expect((await f.request('matchWorkspaceMaterial',{...payload,expectedRevision:0})).status).toBe(409);
  expect((await f.request('matchWorkspaceMaterial',{...payload,materialRevisionId:randomUUID()})).status).toBe(404);
  const match=await f.request('matchWorkspaceMaterial',{workspaceId:made.body.id,expectedRevision:made.body.revision,clipId:made.body.clips[0].id,materialRevisionId:material});expect(match.status,JSON.stringify(match.body)).toBe(200);expect(match.body.readiness.placeholders).toHaveLength(1);
  expect((await f.request('openWorkspaceStudio',{workspaceId:match.body.id,expectedRevision:match.body.revision})).status).toBe(409);
  const allMatched=await f.fillVisuals(match.body);
  const opened=await f.request('openWorkspaceStudio',{workspaceId:allMatched.id,expectedRevision:allMatched.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);expect(opened.body.studioUrl).toContain('lcBridge=1');
  const native=JSON.parse(await readFile(join(f.assetRoot,opened.body.workspace.relativePath),'utf8'));expect(native.timelines[0].items.map((i:{kind:string})=>i.kind)).toEqual(['video','video']);
  const w=opened.body.productionWorkspace;
  const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect(saved.body.productionWorkspace.revision).toBe(w.revision);
  const closed=await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:saved.body.productionWorkspace.revision});expect(closed.status).toBe(200);
  await f.restart();
  const resumed=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(resumed.status).toBe(200);const resumedWorkspace=(await resumed.json()).workspace;expect(resumedWorkspace.project.sha256).toBe(closed.body.project.sha256);expect(resumedWorkspace.readiness.placeholders).toHaveLength(0);
  const beforeFailure=closed.body.project.sha256;
  await f.c.query("CREATE FUNCTION local_identity.controlled_workspace_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'controlled database failure'; END$$; CREATE TRIGGER controlled_workspace_failure BEFORE UPDATE ON local_identity.production_workspaces FOR EACH ROW EXECUTE FUNCTION local_identity.controlled_workspace_failure()");
  const failed=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:closed.body.revision,operation:{kind:'appearance',itemId:w.clips[1].itemId,fit:'cover'}});expect(failed.status).toBe(503);
  const intact=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(intact.status).toBe(200);expect((await intact.json()).workspace.project.sha256).toBe(beforeFailure);
  await f.c.query('DROP TRIGGER controlled_workspace_failure ON local_identity.production_workspaces; DROP FUNCTION local_identity.controlled_workspace_failure()');
  const filled=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:closed.body.revision,operation:{kind:'appearance',itemId:w.clips[1].itemId,fit:'cover'}});expect(filled.status,JSON.stringify(filled.body)).toBe(200);expect(filled.body.readiness.placeholders).toHaveLength(0);expect(filled.body.readiness.deliverable).toBe(false);
  const restored=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:filled.body.revision});expect(restored.status,JSON.stringify(restored.body)).toBe(200);
  const edited=JSON.parse(await readFile(join(f.assetRoot,restored.body.workspace.relativePath),'utf8'));expect(edited.timelines[0].items.map((i:{id:string})=>i.id)).toEqual(w.clips.map((i:{itemId:string})=>i.itemId));expect(edited.assets).toHaveLength(1);
  const originalSha=restored.body.productionWorkspace.project.sha256;
  const closedAgain=await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:restored.body.productionWorkspace.revision});expect(closedAgain.status).toBe(200);
  const script2=randomUUID(),board2=randomUUID(),path2=`episodes/${f.episode}/script-v2.md`,text2=Buffer.from('明确重新规划的脚本。');await writeFile(join(f.assetRoot,path2),text2);
  await f.c.query("INSERT INTO public.production_material_revisions(id,episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,is_main_script,created_by,material_purpose) VALUES($1,$2,3,'script','paste',$3,$3,'text/markdown',$4,$5,true,$6,'main_script')",[script2,f.episode,path2,createHash('sha256').update(text2).digest('hex'),text2.length,f.owner]);
  await f.c.query("UPDATE public.episodes SET main_script_revision_id=$2 WHERE id=$1;",[f.episode,script2]);
  await f.c.query("UPDATE public.review_packages SET invalidated_at=now(),invalidated_reason='受控重规划' WHERE id=$1",[f.board]);
  await f.c.query("INSERT INTO public.review_packages(id,episode_id,stage,revision_number,artifact_id,task_id,context_snapshot) SELECT $1,episode_id,stage,2,artifact_id,task_id,context_snapshot FROM public.review_packages WHERE id=$2",[board2,f.board]);
  const staleRead=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect((await staleRead.json()).workspace.stale).toBe(true);
  expect((await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:closedAgain.body.revision})).status).toBe(409);
  await f.c.query("INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) SELECT account_id,id,'main_script_reconfirmed',jsonb_build_object('material_id',$2::text,'reason','调整叙事顺序'),$3 FROM public.episodes WHERE id=$1",[f.episode,script2,f.owner]);
  const replan=await f.request('replanWorkspace',{workspaceId:w.id,expectedRevision:closedAgain.body.revision,reviewPackageId:board2,expectedScriptRevisionId:script2,reason:'调整叙事顺序'});expect(replan.status,JSON.stringify(replan.body)).toBe(200);expect(replan.body.scriptRevisionId).toBe(script2);expect(replan.body.history.some((h:{reason:string})=>h.reason==='调整叙事顺序')).toBe(true);expect(replan.body.history.some((h:{sha256:string})=>h.sha256===originalSha)).toBe(true);
  const history=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace/project?sha=${originalSha}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(history.status).toBe(200);expect((await history.json()).project.timelines[0].items.map((i:{id:string})=>i.id)).toEqual(w.clips.map((i:{itemId:string})=>i.itemId));
  const foreign=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace/project?sha=${originalSha}`,{headers:{Cookie:'loop_owner_session='+f.otherToken}});expect(foreign.status).toBe(404);

 }finally{await f.close();}
},180_000);
