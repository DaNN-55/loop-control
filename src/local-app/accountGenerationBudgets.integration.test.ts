// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {csrfFor} from './sessions';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('account budgets work without episodes through real Owner HTTP/DB, preserve legacy reads, and reject cross-owner and invalid writes',async()=>{
 const f=await embeddedStudioFixture();
 try{
  const post=async(command:string,data:Record<string,unknown>,token=f.token,csrf=csrfFor(token))=>{const response=await fetch(f.origin+'/api/local/account-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+token,'X-CSRF-Token':csrf},body:JSON.stringify({command,data,idempotencyKey:randomUUID()})});return {status:response.status,body:await response.json()};};
  const original=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  // A fresh account with no productions proves the editor is account-owned.
  const account=randomUUID();await f.c.query("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1,$2,'预算隔离账号','Asia/Shanghai')",[account,'budget-'+account]);await f.c.query("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner')",[account,f.owner]);
  expect((await post('readGenerationBudget',{accountId:account})).body).toEqual({accountId:account,budget:null,usedCents:0});
  const saved=await post('setGenerationBudget',{accountId:account,trialCents:129,totalCents:2500,full:false});expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect(saved.body.budget).toEqual({trial_video_limit_cents:129,total_limit_cents:2500,full_generation_enabled:false});
  for(const data of [{trialCents:0,totalCents:200,full:false},{trialCents:100,totalCents:99,full:false},{trialCents:1.5,totalCents:200,full:false},{trialCents:100,totalCents:100001,full:false},{trialCents:100,totalCents:200,full:'yes'},{trialCents:100,totalCents:200,full:false,episodeId:f.episode}])expect((await post('setGenerationBudget',{accountId:account,...data})).status).toBe(400);
  expect((await post('setGenerationBudget',{accountId:account,trialCents:100,totalCents:300,full:true},f.otherToken)).status).toBe(404);
  expect((await post('readGenerationBudget',{accountId:account},f.otherToken)).status).toBe(404);
  expect((await post('setGenerationBudget',{accountId:account,trialCents:100,totalCents:300,full:true},f.token,'0'.repeat(64))).status).toBe(403);
  await post('setGenerationBudget',{accountId:original,trialCents:200,totalCents:3000,full:true});
  const legacy=await fetch(f.origin+'/api/local/wan-budget?episode='+f.episode,{headers:{Cookie:'loop_owner_session='+f.token}});expect(legacy.status).toBe(200);expect(await legacy.json()).toEqual({accountId:original,budget:{trial_video_limit_cents:200,total_limit_cents:3000,full_generation_enabled:true},usedCents:0});
  expect((await post('readGenerationBudget',{accountId:account})).body.budget.total_limit_cents).toBe(2500);
  const tasks=(await f.c.query('SELECT count(*)::integer count FROM public.tasks WHERE episode_id=$1',[f.episode])).rows[0].count;expect(tasks).toBe(1);
  await f.restart();expect((await post('readGenerationBudget',{accountId:account})).body.budget.total_limit_cents).toBe(2500);
 }finally{await f.close();}
},300000);
