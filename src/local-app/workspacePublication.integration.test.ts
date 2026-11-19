// @vitest-environment node
import {expect,it} from 'vitest';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('persists optional publication text before and after completion without changing video identity',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(made.status).toBe(200);let w=made.body;
  const endpoint=`episodes/${f.episode}/publication`;
  const read=async(token=f.token)=>{const r=await fetch(f.origin+'/api/local/'+endpoint,{headers:{Cookie:'loop_owner_session='+token}});return{status:r.status,body:await r.json()};};
  const initial=await read();expect(initial.status,JSON.stringify(initial.body)).toBe(200);expect(initial.body.revision).toBe(0);
  const content={title:'我修改的标题',description:'简介无需等待视频确认。',tags:['#测试','测试'],instruction:'简短一点'};
  const saved=await f.post(endpoint,'save',{expectedRevision:0,content});expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect(saved.body.revision).toBe(1);expect(saved.body.content.tags).toEqual(['测试']);
  expect((await f.post(endpoint,'save',{expectedRevision:0,content:{...content,title:'旧页面覆盖'}})).status).toBe(409);
  expect((await read(f.otherToken)).status).toBe(404);
  expect((await f.post(endpoint,'save',{expectedRevision:1,content},{csrf:false})).status).toBe(403);
  w=await f.fillVisuals(w);
  expect((await read()).body.basisContentSha256).not.toBe(w.contentSha256);
  await f.restart();expect((await read()).body.content.title).toBe(content.title);
  await f.c.query("UPDATE public.episodes SET stage='production_completed' WHERE id=$1",[f.episode]);
  const updated=await f.post(endpoint,'save',{expectedRevision:1,content:{...content,title:'完成后更新'}});expect(updated.status,JSON.stringify(updated.body)).toBe(200);expect(updated.body.basisContentSha256).toBe(initial.body.basisContentSha256);
  const identity=(await f.c.query('SELECT revision,content_sha256 FROM local_identity.production_workspaces WHERE id=$1',[w.id])).rows[0];expect(Number(identity.revision)).toBe(w.revision);expect(identity.content_sha256).toBe(w.contentSha256);
  expect((await f.c.query('SELECT stage FROM public.episodes WHERE id=$1',[f.episode])).rows[0].stage).toBe('production_completed');
 }finally{await f.close();}
},60000);
