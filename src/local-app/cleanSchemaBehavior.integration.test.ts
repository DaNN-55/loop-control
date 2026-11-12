// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {narrationFixture} from './workspaceNarration.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {ownerTransaction} from './ownerTransaction';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
it.skipIf(!enabled)('clean baseline preserves actual Owner RLS and Worker identity boundaries',async()=>{
 const f=await productionWorkspaceFixture(),worker=f.workerPool();try{
  const own=await ownerTransaction(f.pool,f.owner,true,c=>c.query('SELECT id FROM public.accounts'));
  const other=await ownerTransaction(f.pool,f.other,true,c=>c.query('SELECT id FROM public.accounts'));
  expect(own.rowCount).toBeGreaterThan(0);expect(other.rows).toEqual([]);
  const read=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.otherToken}});expect(read.status).toBe(404);
  await expect(ownerTransaction(f.pool,f.owner,true,c=>c.query('SELECT * FROM local_identity.claim_input_task(NULL,2)'))).rejects.toMatchObject({code:'42501'});
  const c=await worker.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);expect((await c.query("SELECT session_user,has_function_privilege(current_user,'local_identity.owner_id()','EXECUTE') owner_access")).rows[0]).toEqual({session_user:'loop_worker',owner_access:false});await expect(c.query('SELECT local_identity.owner_id()')).rejects.toMatchObject({code:'42501'});}finally{await c.query('ROLLBACK');c.release();}
 }finally{await f.close();}
},120000);
it.skipIf(!enabled)('actual claims retain global capacity two while local CPU and render resource limits remain one',async()=>{
 const f=await narrationFixture(),worker=f.workerPool();try{
  await f.authorize();await f.c.query('UPDATE public.worker_scheduler_settings SET capacity=2');const w=f.made;
  for(const clip of w.clips){const data={workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id};
   for(const [command,extra]of [['saveWorkspaceNarration',{mode:'tts',...f.narrationSettings,text:'并发校验保留完整正文。'}],['confirmWorkspaceNarration',{}],['generateWorkspaceNarration',{reservationCents:100}]]as const){const r=await f.request(command,{...data,...extra});expect(r.status,JSON.stringify(r.body)).toBe(200);}
  }
  const original=(await f.c.query("SELECT * FROM public.tasks WHERE episode_id=$1 AND task_type='generate_narration' ORDER BY id",[f.episode])).rows;expect(original).toHaveLength(2);
  const third=randomUUID();await f.c.query('INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[third,f.episode,original[0].task_type,'ready',{...original[0].input_snapshot,native_tts_retry_id:third},original[0].budget_limit_cents,original[0].max_attempts,original[0].provider,original[0].model,original[0].prompt_version]);
  const port=nativeWorkerPort(worker),claims=await Promise.all(original.map(t=>port.rpc('claim_next_worker_task',{p_task_id:t.id,p_worker_capacity:100})));expect(claims.map(c=>c.length)).toEqual([1,1]);expect(await port.rpc('claim_next_worker_task',{p_task_id:third,p_worker_capacity:100})).toEqual([]);
  expect((await f.c.query("SELECT count(*)::int n FROM public.tasks WHERE status='running'")).rows[0].n).toBe(2);expect((await f.c.query('SELECT status FROM public.tasks WHERE id=$1',[third])).rows[0].status).toBe('ready');
  for(const provider of ['ffmpeg','openchatcut','whisperx']){const limits=(await f.c.query('SELECT public.worker_resource_limits($1,100) limits',[{executor:{provider,adapter:provider}}])).rows[0].limits;expect(limits).toContainEqual({key:'host:cpu',limit:1});if(provider!=='whisperx')expect(limits).toContainEqual({key:'host:render',limit:1});}
 }finally{await f.close();}
},120000);
