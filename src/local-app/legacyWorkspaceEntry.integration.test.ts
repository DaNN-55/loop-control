// @vitest-environment node
import {it,expect} from 'vitest';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';

it.skipIf(process.env.LOOP_LEGACY_WORKSPACE_ACCEPTANCE!=='1')('legacy orders enter four-step preparation only on an explicit owned command',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  await f.c.query('DELETE FROM local_identity.input_episodes WHERE episode_id=$1',[f.episode]);
  await f.c.query("UPDATE public.episodes SET stage='qc_passed' WHERE id=$1",[f.episode]);
  const get=async(path:string,token=f.token)=>{const r=await fetch(f.origin+'/api/local/'+path,{headers:{Cookie:'loop_owner_session='+token}});return{status:r.status,body:await r.json()};};
  const registered=async()=>(await f.c.query('SELECT * FROM local_identity.input_episodes WHERE episode_id=$1',[f.episode])).rows;
  expect((await get(`episodes/${f.episode}`)).status).toBe(200);
  expect(await get(`episodes/${f.episode}/workspace`)).toEqual({status:200,body:{workspace:null}});
  expect(await registered()).toHaveLength(0);
  const data={reviewPackageId:f.board,expectedScriptRevisionId:f.script};
  expect((await f.request('setAudioSourceMode',{audioSourceMode:'tts'})).status).toBe(404);
  expect(await registered()).toHaveLength(0);
  expect((await f.request('prepareWorkspace',data,{token:f.otherToken})).status).toBe(404);
  expect(await registered()).toHaveLength(0);
  expect((await f.request('prepareWorkspace',{...data,expectedScriptRevisionId:f.material})).status).toBe(409);
  expect(await registered()).toHaveLength(0);
  const before=(await f.c.query("SELECT jsonb_build_object('episode',(SELECT to_jsonb(e) FROM public.episodes e WHERE id=$1),'tasks',(SELECT jsonb_agg(t ORDER BY id) FROM public.tasks t WHERE episode_id=$1),'approvals',(SELECT jsonb_agg(a ORDER BY id) FROM public.approvals a WHERE episode_id=$1)) value",[f.episode])).rows[0].value;
  const prepared=await f.request('prepareWorkspace',data);
  expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  expect(prepared.body.preparation.origin).toBe('legacy-board');
  const [input]=await registered();expect(input.owner_id).toBe(f.owner);
  for(const key of ['enabled','storyboard_enabled','narration_enabled','media_enabled','visual_media_enabled','alignment_enabled','preview_enabled','studio_enabled','delivery_enabled'])expect(input[key],key).toBe(false);
  const after=(await f.c.query("SELECT jsonb_build_object('episode',(SELECT to_jsonb(e) FROM public.episodes e WHERE id=$1),'tasks',(SELECT jsonb_agg(t ORDER BY id) FROM public.tasks t WHERE episode_id=$1),'approvals',(SELECT jsonb_agg(a ORDER BY id) FROM public.approvals a WHERE episode_id=$1)) value",[f.episode])).rows[0].value;
  expect(after).toEqual(before);
  expect((await f.request('prepareWorkspace',data)).body.id).toBe(prepared.body.id);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_LEGACY_WORKSPACE_ACCEPTANCE!=='1')('legacy script revision uses the same explicit entry and failed imports leave no registration',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  await f.c.query('DELETE FROM local_identity.input_episodes WHERE episode_id=$1',[f.episode]);
  const invalid=await f.request('importMaterial',{materialType:'image',materialPurpose:'invalid',sourceKind:'file',sourcePath:'test.png',mimeType:'image/png',contentBase64:'AA==',isMainScript:false});
  expect(invalid.status).toBe(400);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.input_episodes')).rows[0].n).toBe(0);
  const revised=await f.request('reconfirmScript',{expectedScriptRevisionId:f.script,text:'# 旧单修订\n\n## 正文\n\n旧单的新脚本。',reason:'明确修订旧脚本'});
  expect(revised.status,JSON.stringify(revised.body)).toBe(200);
  expect((await f.c.query('SELECT stage FROM public.episodes WHERE id=$1',[f.episode])).rows[0].stage).toBe('waiting_input');
  expect((await f.c.query('SELECT owner_id,enabled FROM local_identity.input_episodes WHERE episode_id=$1',[f.episode])).rows[0]).toEqual({owner_id:f.owner,enabled:false});
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_LEGACY_WORKSPACE_ACCEPTANCE!=='1')('legacy inspection stays read-only and completed, archived and historical orders are not enrolled',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  await f.c.query('DELETE FROM local_identity.input_episodes WHERE episode_id=$1',[f.episode]);
  const get=async(token=f.token)=>{const r=await fetch(f.origin+`/api/local/script-production?episode=${f.episode}`,{headers:{Cookie:'loop_owner_session='+token}});return{status:r.status,body:await r.json()};};
  expect((await get()).status).toBe(200);expect((await get(f.otherToken)).status).toBe(404);
  await f.c.query("INSERT INTO public.account_memberships(account_id,user_id,role) SELECT e.account_id,o.id,'worker' FROM public.episodes e CROSS JOIN local_identity.owners o WHERE e.id=$1 AND o.id<>$2",[f.episode,f.owner]);
  expect((await get(f.otherToken)).status).toBe(404);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.input_episodes')).rows[0].n).toBe(0);
  const data={reviewPackageId:f.board,expectedScriptRevisionId:f.script};
  await f.c.query("UPDATE public.episodes SET stage='production_completed' WHERE id=$1",[f.episode]);
  expect((await f.request('prepareWorkspace',data)).status).toBe(409);
  await f.c.query("UPDATE public.episodes SET stage='qc_review',archived_at=now() WHERE id=$1",[f.episode]);
  expect((await f.request('prepareWorkspace',data)).status).toBe(409);
  await f.c.query('UPDATE public.episodes SET archived_at=NULL WHERE id=$1',[f.episode]);
  await f.c.query('INSERT INTO local_identity.historical_episodes(episode_id) VALUES($1)',[f.episode]);
  expect((await f.request('prepareWorkspace',data)).status).toBe(404);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.input_episodes')).rows[0].n).toBe(0);
 }finally{await f.close();}
},120000);
