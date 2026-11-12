// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {ownerTransaction} from './ownerTransaction';
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('retired repair and automatic dispatch reject execution while keeping history and current ownership boundaries',async()=>{
 const f=await formalWorkflowFixture({blank:true});try{
  const old=randomUUID();await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,provider,model,prompt_version,input_snapshot) VALUES($1,$2,'generate_b_roll','failed','pexels','historical','historical-v1','{\"marker\":\"retained legacy output\"}')",[old,f.newEpisode]);
  const read=async()=>(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=$1',[old])).rows[0].value,before=await read();
  for(const name of ['apply_episode_configuration_repair','apply_episode_configuration_repair_v2','apply_external_connection_repair']){
   const query=`SELECT public.${name}($1,$2,$3,$4)`,value=name==='apply_external_connection_repair'?randomUUID():{};
   await expect(ownerTransaction(f.pool,f.owner,false,c=>c.query(query,[f.newEpisode,value,'old','retained diagnostic']))).rejects.toMatchObject({code:name==='apply_episode_configuration_repair'?'42501':'0A000'});
   await expect(ownerTransaction(f.pool,f.other,false,c=>c.query(query,[f.newEpisode,value,'old','retained diagnostic']))).rejects.toMatchObject({code:'42501'});
  }
  const worker=f.workerPool();try{
   for(const name of ['plan_input_tasks','plan_input_tasks_before_workspace_audio']){
    const allowed=name==='plan_input_tasks';
    expect((await f.c.query("SELECT has_function_privilege('loop_worker',$1,'EXECUTE') allowed",[`local_identity.${name}(uuid)`])).rows[0].allowed).toBe(allowed);
    await expect(worker.query(`SELECT * FROM local_identity.${name}($1)`,[f.newEpisode])).rejects.toMatchObject({code:allowed?'0A000':'42501'});
   }
  }finally{await worker.end();}
  for(const name of ['orchestrate_a_roll_tasks_for_episode','orchestrate_a_roll_tasks_for_episode_without_card_adapter','orchestrate_b_roll_tasks','orchestrate_b_roll_tasks_configured','orchestrate_b_roll_tasks_legacy','orchestrate_b_roll_tasks_with_connection_ref','orchestrate_b_roll_tasks_without_connection_ref','orchestrate_soundtrack_tasks','orchestrate_soundtrack_tasks_without_manual_path']){
   await expect(f.c.query(`SELECT * FROM public.${name}($1)`,[f.newEpisode])).rejects.toMatchObject({code:'42501'});
   expect((await f.c.query('SELECT has_function_privilege(\'loop_worker\',$1,\'EXECUTE\') allowed',[`public.${name}(uuid)`])).rows[0].allowed).toBe(false);
  }
  for(const command of ['repairConfiguration','repairConnection','configureScriptProduction'])expect((await f.send(command,{enabled:true,policy:{},versionId:randomUUID(),blockerCode:'old',blockerDetail:'retained'})).status).toBe(410);
  const original=(await f.c.query('SELECT main_script_revision_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0];
  await f.c.query("INSERT INTO local_identity.script_productions(episode_id,owner_id,script_revision_id,script_sha256,plan,enabled,authorization_hash,authorized_at) VALUES($1,$2,$3,repeat('a',64),'{}',true,repeat('b',64),clock_timestamp()) ON CONFLICT(episode_id) DO UPDATE SET enabled=true",[f.episode,f.owner,original.main_script_revision_id]);
  const authorization=(await f.c.query('SELECT to_jsonb(p) value FROM local_identity.script_productions p WHERE episode_id=$1',[f.episode])).rows[0].value;
  expect((await f.c.query('SELECT * FROM local_identity.script_production_scopes()')).rows).toEqual([]);
  expect((await f.c.query('SELECT to_jsonb(p) value FROM local_identity.script_productions p WHERE episode_id=$1',[f.episode])).rows[0].value).toEqual(authorization);
  expect(await read()).toEqual(before);
 }finally{await f.close();}
},120000);
