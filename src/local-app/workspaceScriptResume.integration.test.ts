// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner confirms a formatting-only revision while preserving the exact edited project and old invalidated evidence',async()=>{
 const f=await productionWorkspaceFixture();try{
 let w=await f.fillVisuals((await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body);const oldProject=w.project,oldBindings=w.clips,oldRevision=w.revision;
 const revision=await f.request('reconfirmScript',{expectedScriptRevisionId:f.script,text:'# 已确认的第一镜。\n## 正文\n> 缺少素材的第二镜。\n',reason:'仅调整 Markdown 排版'});expect(revision.status).toBe(200);
 const read=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});w=(await read.json()).workspace;expect(w.stale).toBe(true);expect((await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision})).status).toBe(409);
 const args={workspaceId:w.id,expectedRevision:w.revision,expectedScriptRevisionId:revision.body.id,expectedProjectSha256:oldProject.sha256};
 expect((await f.request('resumeWorkspaceEditing',args,{token:f.otherToken})).status).toBe(404);
 expect((await f.request('resumeWorkspaceEditing',{...args,expectedProjectSha256:'0'.repeat(64)})).status).toBe(409);
 const resumed=await f.request('resumeWorkspaceEditing',args);expect(resumed.status,JSON.stringify(resumed.body)).toBe(200);w=resumed.body;
 expect(w.stale).toBe(false);expect(w.revision).toBeGreaterThan(oldRevision);expect(w.scriptRevisionId).toBe(revision.body.id);expect(w.project).toEqual(oldProject);expect(w.clips).toEqual(oldBindings);expect(w.preparation.authorized).toBe(false);
 expect((await f.c.query('SELECT invalidated_at FROM public.review_packages WHERE id=$1',[f.board])).rows[0].invalidated_at).not.toBeNull();expect(w.storyboardPackageId).not.toBe(f.board);
 expect((await f.c.query('SELECT count(*)::int n FROM public.approvals WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(0);
 expect((await f.c.query("SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1 AND status IN ('ready','running')",[f.episode])).rows[0].n).toBe(0);
 const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);expect(JSON.parse(await readFile(join(f.assetRoot,opened.body.workspace.relativePath),'utf8')).timelines[0].items.filter((i:{kind:string})=>i.kind==='video')).toHaveLength(2);
 }finally{await f.close();}
},120000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('substantive script edits cannot bypass the stale-project guard through formatting recovery',async()=>{
 const f=await productionWorkspaceFixture();try{
 const w=await f.fillVisuals((await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body);
 const revision=await f.request('reconfirmScript',{expectedScriptRevisionId:f.script,text:`# 实质修订

## 正文

不同的故事内容。`,reason:'实质脚本修改'});expect(revision.status,JSON.stringify(revision.body)).toBe(200);
 const resumed=await f.request('resumeWorkspaceEditing',{workspaceId:w.id,expectedRevision:w.revision,expectedScriptRevisionId:revision.body.id,expectedProjectSha256:w.project.sha256});expect(resumed.status).toBe(409);
 expect((await f.c.query('SELECT project_sha256,script_revision_id FROM local_identity.production_workspaces WHERE id=$1',[w.id])).rows[0]).toEqual({project_sha256:w.project.sha256,script_revision_id:f.script});
 }finally{await f.close();}
},120000);
