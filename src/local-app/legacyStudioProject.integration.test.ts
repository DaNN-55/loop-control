// @vitest-environment node
import {editStudioDocument} from './studioDocument.fixture';
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
it.skipIf(process.env.LOOP_LEGACY_WORKSPACE_ACCEPTANCE!=='1')('Owner reads and downloads the exact saved legacy edit without adopting or rewriting it',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  const get=async(suffix='',token=f.token)=>fetch(`${f.origin}/api/local/episodes/${f.episode}/legacy-project${suffix}`,{headers:{Cookie:'loop_owner_session='+token}});
  const missing=await get();expect(missing.status).toBe(200);expect(await missing.json()).toEqual({project:null});
  await f.c.query("UPDATE public.episodes SET stage='qc_review' WHERE id=$1",[f.episode]);
  const opened=await f.request('openStudio',{projectRelativePath:f.boardPath});expect(opened.status,JSON.stringify(opened.body)).toBe(200);
  const base=`${f.assetRoot}/episodes/${f.episode}/openchatcut-work/current`;
  await editStudioDocument(opened.body.studioUrl,opened.body.workspace.projectId,doc=>{doc.timelines[0].items.find((i:any)=>i.kind==='video').transform.x=37;});await f.closeStudio();
  const path=base+'/runtime/project-store-v1.sqlite3';
  await f.c.query('DELETE FROM local_identity.input_episodes WHERE episode_id=$1',[f.episode]);
  const digest=async(p:string)=>createHash('sha256').update(await readFile(p)).digest('hex'),before=[await digest(path),await digest(base+'/workspace.json')];
  const fingerprint=async()=>(await f.c.query("SELECT jsonb_build_object('episode',(SELECT to_jsonb(e) FROM public.episodes e WHERE id=$1),'tasks',(SELECT jsonb_agg(t ORDER BY id) FROM public.tasks t WHERE episode_id=$1),'inputs',(SELECT count(*) FROM local_identity.input_episodes),'workspaces',(SELECT count(*) FROM local_identity.production_workspaces)) value",[f.episode])).rows[0].value;
  const state=await fingerprint();
  const response=await get();expect(response.status).toBe(200);const read=await response.json();
  expect(read.project.timelines[0].items.find((i:any)=>i.kind==='video').transform.x).toBe(37);
  const downloaded=await get('?download='+read.sha256);expect(downloaded.status).toBe(200);expect(downloaded.headers.get('content-disposition')).toContain('attachment');expect(await downloaded.json()).toEqual(read.project);
  expect((await get('',f.otherToken)).status).toBe(404);expect((await get('','missing')).status).toBe(401);
  expect((await get('?download='+'f'.repeat(64))).status).toBe(409);expect((await get('?download=invalid')).status).toBe(400);
  expect(await fingerprint()).toEqual(state);expect([await digest(path),await digest(base+'/workspace.json')]).toEqual(before);
 }finally{await f.close();}
},120000);
