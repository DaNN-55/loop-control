// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('completed project GET preserves PostgreSQL records and frozen bytes while Studio and generation commands remain rejected',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  const prepared=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  const w=prepared.body;await f.c.query("UPDATE public.episodes SET stage='production_completed' WHERE id=$1",[f.episode]);
  const facts=async()=>{
   const result:Record<string,unknown>={};
   for(const table of ['public.episodes','public.tasks','public.artifacts','local_identity.production_workspaces','local_identity.production_workspace_versions','local_identity.workspace_exports','local_identity.workspace_deliveries','local_identity.workspace_visual_candidates']){
    const column=table==='public.episodes'?'id':'episode_id';
    result[table]=(await f.c.query(`SELECT to_jsonb(t) value FROM ${table} t WHERE ${column}=$1 ORDER BY to_jsonb(t)::text`,[f.episode])).rows;
   }
   return result;
  };
  const before=await facts(),bytes=await readFile(join(f.assetRoot,w.project.relativePath));
  const headers={Cookie:'loop_owner_session='+f.token};
  for(let i=0;i<2;i++){
   const state=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers});expect(state.status).toBe(200);
   const response=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace/project?sha=${w.project.sha256}`,{headers});expect(response.status).toBe(200);expect((await response.json()).project).toEqual(JSON.parse(bytes.toString()));
  }
  const foreign=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace/project?sha=${w.project.sha256}`,{headers:{Cookie:'loop_owner_session='+f.otherToken}});expect(foreign.status).toBe(404);
  for(const command of ['openWorkspaceStudio','saveWorkspaceStudio','requestWorkspaceImageCandidates','exportWorkspace','prepareWorkspaceDelivery']){
   const response=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision});expect(response.status,command+': '+JSON.stringify(response.body)).toBe(409);
  }
  expect(await facts()).toEqual(before);
  expect(createHash('sha256').update(await readFile(join(f.assetRoot,w.project.relativePath))).digest('hex')).toBe(w.project.sha256);
 }finally{await f.close();}
},120000);
