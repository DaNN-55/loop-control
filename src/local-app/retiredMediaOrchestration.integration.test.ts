// @vitest-environment node
import {it,expect} from 'vitest';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('obsolete bulk media entrypoints are absent without changing retained tasks or broader Worker grants',async()=>{
 const f=await productionWorkspaceFixture();try{
  const before=(await f.c.query("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') tasks FROM public.tasks t")).rows[0].tasks;expect(before.length).toBeGreaterThan(0);
  for(const name of ['orchestrate_a_roll_tasks_without_manual_path','orchestrate_a_roll_tasks_without_card_adapter','orchestrate_a_roll_tasks','orchestrate_b_roll_tasks_all','orchestrate_b_roll_tasks_legacy_all']){
   expect((await f.c.query('SELECT to_regprocedure($1) value',[`public.${name}()`])).rows[0].value).toBeNull();
   await expect(f.c.query(`SELECT * FROM public.${name}()`)).rejects.toMatchObject({code:'42883'});
  }
  expect((await f.c.query("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') tasks FROM public.tasks t")).rows[0].tasks).toEqual(before);
  for(const signature of ['public.orchestrate_review_render_tasks(uuid)','public.orchestrate_final_render_tasks(uuid)'])expect((await f.c.query('SELECT to_regprocedure($1) IS NOT NULL present',[signature])).rows[0].present).toBe(true);
 }finally{await f.close();}
},120000);
