// @vitest-environment node
import {it,expect} from 'vitest';
import {freshProductionFixture} from './freshProduction.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each([
 ['plain','# 无模型正文\n\n## 正文\n\n第一段是原样保留的正文。\n\n第二段仍由Owner提供。'],['v2',productionScriptTemplate],
])('current %s preparation works without CLI planning and retired requests preserve history',async(kind,scriptText)=>{
 const f=await freshProductionFixture({scriptText});
 try{
  const started=await f.send('start');expect(started.status,JSON.stringify(started.body)).toBe(200);expect(started.body.stage).toBe('script_approved');
  const prepared=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  expect(prepared.body.clips.length).toBeGreaterThan(0);
  if(kind==='plain')expect(prepared.body.clips.map((c:{text:string})=>c.text)).toEqual(['第一段是原样保留的正文。','第二段仍由Owner提供。']);
  const preparedSource=(await f.c.query('SELECT id,main_script_revision_id,blueprint_version_id FROM public.episodes WHERE id=$1',[f.newEpisode])).rows[0];
  expect((await f.send('retryWorkspacePlanning',{taskId:'11111111-1111-4111-8111-111111111111',expectedScriptRevisionId:f.main})).status).toBe(410);
  const after=(await f.c.query('SELECT id,main_script_revision_id,blueprint_version_id FROM public.episodes WHERE id=$1',[f.newEpisode])).rows[0];expect(after).toEqual(preparedSource);
  const tasks=(await f.c.query("SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1 AND task_type IN('prepare_visual_brief','draft_storyboard','draft_storyboard_revision')",[f.newEpisode])).rows[0];expect(tasks.n).toBe(0);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['ready','running'])('claim and lease recovery leave retired %s task records byte-equivalent',async status=>{
 const {randomUUID}=await import('node:crypto');
 const f=await freshProductionFixture({blank:true});
 try{
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2) ON CONFLICT(singleton) DO UPDATE SET capacity=2');
  await f.c.query('UPDATE local_identity.input_episodes SET enabled=true,storyboard_enabled=true,media_enabled=true WHERE episode_id=$1',[f.newEpisode]);
  const ids:string[]=[];
  for(const [type,provider,capability] of [['prepare_visual_brief','codex','visual_planning'],['generate_narration','codex','narration_generation']]){
    const id=randomUUID();ids.push(id);
    await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,provider,model,prompt_version,max_attempts,attempt,claimed_at,input_snapshot) VALUES($1,$2,$3,$4,$5,'historical-model','historical-v1',3,$6,$7,$8)",[id,f.newEpisode,type,status,provider,status==='running'?1:0,status==='running'?'2020-01-01T00:00:00Z':null,{capability,marker:id,executor:{provider,adapter:provider==='codex'?'codex':'openai_images',model:'historical-model'},allowed_tools:['read','write'],output:{relative_path:`episodes/${f.newEpisode}/historical/${id}.json`,required_artifact_types:['historical_evidence'],content_type:'application/json',review_stage:'visual_review'},harness:{id:randomUUID(),version:1,adapter:'codex',model:'historical-model',prompt_version:'historical-v1',content:'历史冻结规则',content_hash:'a'.repeat(64)}}]);
    if(status==='running')await f.c.query("INSERT INTO public.task_runs(task_id,attempt,status,task_package,started_at) VALUES($1,0,'running','{}','2020-01-01T00:00:00Z')",[id]);
  }
  expect((await f.c.query("SELECT local_identity.input_task_allowed($1,'prepare_visual_brief') eligible",[f.newEpisode])).rows[0].eligible).toBe(true);
  const read=async()=>({tasks:(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=ANY($1::uuid[]) ORDER BY id',[ids])).rows,runs:(await f.c.query('SELECT to_jsonb(r) value FROM public.task_runs r WHERE task_id=ANY($1::uuid[]) ORDER BY task_id,attempt',[ids])).rows});
  for(const row of [
   {provider:'openai',task_type:'generate_static_visual',input_snapshot:{capability:'storyboard_planning'}},
   {provider:'openai',task_type:'draft_storyboard',input_snapshot:{capability:'static_visual_generation'}},
   {provider:'openai',task_type:'generate_static_visual',input_snapshot:{capability:'static_visual_generation',executor:{provider:'codex'}}},
  ])expect((await f.c.query('SELECT local_identity.current_worker_task(jsonb_populate_record(NULL::public.tasks,$1::jsonb)) allowed',[JSON.stringify(row)])).rows[0].allowed).toBe(false);
  const before=await read();
  await f.c.query('SET SESSION AUTHORIZATION loop_worker');
  try{
   expect((await f.c.query('SELECT * FROM local_identity.claim_input_task(NULL,2)')).rows).toEqual([]);
   for(const id of ids)expect((await f.c.query('SELECT * FROM local_identity.claim_input_task($1,2)',[id])).rows).toEqual([]);
  }finally{await f.c.query('SET SESSION AUTHORIZATION DEFAULT');}
  expect(await read()).toEqual(before);
 }finally{await f.close();}
},120000);
