// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {csrfFor} from './sessions';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('requires exact session/CSRF/ownership and a verified completed delivery before allocating a copy',async()=>{
 const f=await productionWorkspaceFixture();
 const request=async(body:Record<string,unknown>,token=f.token,csrf=true,origin=f.origin)=>{
  const response=await fetch(`${f.origin}/api/local/episodes/${f.episode}/studio-copy`,{method:'POST',headers:{Origin:origin,Cookie:'loop_owner_session='+token,'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrfFor(token)}:{})},body:JSON.stringify(body)});return{status:response.status,body:await response.json()};
 };
 try{
  const body={action:'open',copyId:randomUUID()};
  expect((await request(body,f.token,false)).status).toBe(403);
  expect((await request(body,f.token,true,'http://untrusted.invalid')).status).toBe(403);
  expect((await request({...body,root:'/untrusted'})).status).toBe(400);
  expect((await request(body,f.otherToken)).status).toBe(404);
  expect((await request(body)).status).toBe(409);
  const prepared=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(prepared.status).toBe(200);
  await f.c.query("UPDATE public.episodes SET stage='production_completed' WHERE id=$1",[f.episode]);
  const before=(await f.c.query('SELECT to_jsonb(e) value FROM public.episodes e WHERE id=$1',[f.episode])).rows;
  const missing=await request(body);expect(missing.status).toBe(409);expect(missing.body.error).toContain('交付对应');
  expect((await f.c.query('SELECT to_jsonb(e) value FROM public.episodes e WHERE id=$1',[f.episode])).rows).toEqual(before);
 }finally{await f.close();}
},120000);
