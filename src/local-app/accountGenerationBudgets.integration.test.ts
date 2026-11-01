// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {csrfFor} from './sessions';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('retired account budget endpoints reject writes while rule saves and authorization remain enforced',async()=>{
 const f=await productionWorkspaceFixture();try{
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  const post=async(path:string,command:string,data:unknown,csrf=csrfFor(f.token))=>{const r=await fetch(f.origin+'/api/local/'+path,{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrf},body:JSON.stringify({command,data,idempotencyKey:randomUUID()})});return{status:r.status,body:await r.json()};};
  for(const command of ['readGenerationBudget','setGenerationBudget'])expect((await post('account-commands',command,{accountId:account,trialCents:1,totalCents:1,full:false})).status).toBe(400);
  expect((await f.request('setWanBudget',{trialCents:1,totalCents:1,full:false})).status).toBe(400);
  const legacy=await fetch(f.origin+'/api/local/wan-budget?episode='+f.episode,{headers:{Cookie:'loop_owner_session='+f.token}});expect(legacy.status).toBe(404);
  expect((await post('account-commands','setGenerationBudget',{accountId:account},'0'.repeat(64))).status).toBe(403);
  const changedFunctions=(await f.c.query("SELECT p.oid::regprocedure::text signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','local_identity') AND p.prokind='f' AND p.prosrc ILIKE '%generation_account_budgets%' AND p.proname<>'set_generation_budget'")).rows;
  expect(changedFunctions).toEqual([]);
  const before=(await f.c.query('SELECT b.policy,md5(b.policy::text) revision FROM public.accounts a JOIN public.account_blueprint_versions b ON b.id=a.current_blueprint_version_id WHERE a.id=$1',[account])).rows[0];
  const save=async(extra:Record<string,unknown>)=>{const r=await fetch(f.origin+'/api/local/configuration',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'updateBlueprint',idempotencyKey:randomUUID(),expectedRevision:before.revision,data:{accountId:account,policy:{positioning:'规则独立保存'},...extra}})});return{status:r.status,body:await r.json()};};
  expect((await save({budget:{trialCents:1,totalCents:1,full:false}})).status).toBe(400);
  expect((await save({})).status).toBe(200);
  expect((await f.c.query('SELECT b.policy FROM public.accounts a JOIN public.account_blueprint_versions b ON b.id=a.current_blueprint_version_id WHERE a.id=$1',[account])).rows[0].policy.positioning).toBe('规则独立保存');
 }finally{await f.close();}
},120000);
