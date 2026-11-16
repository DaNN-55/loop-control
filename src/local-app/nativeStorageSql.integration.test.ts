// @vitest-environment node
import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('current preparation writes a fingerprinted project at a literal registered prefix while retired Studio task scope stays absent',async()=>{
 const f=await productionWorkspaceFixture({storageContract:'pre-lineage',episodeRelativePath:()=> '系列 scope_[100%]/本期',migrations:['db/archive/legacy-v1/118-visual-storage-locations.sql','db/archive/legacy-v1/119-audio-caption-storage-locations.sql','db/archive/legacy-v1/120-native-workspace-storage-locations.sql']});
 try{
  for(const signature of ['local_identity.scope_input_studio_task(uuid,text,jsonb)','local_identity.owned_studio_frozen_reference(uuid,jsonb)'])expect((await f.c.query('SELECT to_regprocedure($1) value',[signature])).rows[0].value).toBeNull();
  const prepared=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  const w=prepared.body;
  expect(w.project.relativePath).toBe(`${f.episodeRelativePath}/production-workspace/versions/${w.project.sha256}.json`);
  const bytes=await readFile(join(f.assetRoot,w.project.relativePath));expect(createHash('sha256').update(bytes).digest('hex')).toBe(w.project.sha256);expect(bytes.length).toBe(w.project.fileSize);
  const taskBefore=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[f.episode])).rows;
  const get=async(sha:string,token=f.token)=>fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace/project?sha=${sha}`,{headers:{Cookie:'loop_owner_session='+token}});
  const read=await get(w.project.sha256);expect(read.status).toBe(200);expect((await read.json()).project).toEqual(JSON.parse(bytes.toString('utf8')));
  expect((await get('b'.repeat(64))).status).toBe(404);expect((await get(w.project.sha256,f.otherToken)).status).toBe(404);
  expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[f.episode])).rows).toEqual(taskBefore);
  expect(createHash('sha256').update(await readFile(join(f.assetRoot,w.project.relativePath))).digest('hex')).toBe(w.project.sha256);
 }finally{await f.close();}
},120000);
