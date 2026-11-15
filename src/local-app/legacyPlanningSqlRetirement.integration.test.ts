// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {ownerTransaction} from './ownerTransaction';
const enabled=Boolean(process.env.LOOP_TEST_CONTEXT_MODULE);
it.skipIf(!enabled)('retired SQL planning entrypoints are absent and keep historical records',async()=>{
 const f=await formalWorkflowFixture({blank:true});try{
  const old=randomUUID();await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,provider,model,prompt_version,input_snapshot) VALUES($1,$2,'draft_storyboard','failed','codex','historical','historical-v1','{\"marker\":\"retained\"}')",[old,f.newEpisode]);
  const before=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=$1',[old])).rows[0].value;
  for(const [query,args]of[
   ['SELECT local_identity.queue_workspace_planning($1,$2)',[f.newEpisode,f.main]],
   ['SELECT local_identity.replan_workspace_planning($1,$2,$3)',[f.newEpisode,f.main,old]],
   ['SELECT local_identity.save_planning_selection($1,$2,0)',[f.newEpisode,{provider:'codex'}]],
  ]as const){
   await expect(ownerTransaction(f.pool,f.owner,false,c=>c.query(query,[...args]))).rejects.toMatchObject({code:'42883'});
   await expect(ownerTransaction(f.pool,f.other,false,c=>c.query(query,[...args]))).rejects.toMatchObject({code:'42883'});
  }
  expect((await f.c.query("SELECT to_regprocedure('public.orchestrate_storyboard_tasks()') value")).rows[0].value).toBeNull();
  await expect(f.c.query('SELECT * FROM public.orchestrate_storyboard_tasks()')).rejects.toMatchObject({code:'42883'});
  expect((await f.c.query("SELECT to_regprocedure('public.orchestrate_storyboard_tasks_for_episode(uuid)') value")).rows[0].value).toBeNull();
  await expect(f.c.query('SELECT * FROM public.orchestrate_storyboard_tasks_for_episode($1)',[f.newEpisode])).rejects.toMatchObject({code:'42883'});
  expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=$1',[old])).rows[0].value).toEqual(before);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.episode_planning_selections WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
  expect((await f.c.query("SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal AND tgname IN('initialize_planning_selection','freeze_shared_planning_harness_before_insert','zy_freeze_native_planning_attempt_limit')")).rows[0].n).toBe(0);
 }finally{await f.close();}
},120000);
