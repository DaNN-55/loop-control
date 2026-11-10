// @vitest-environment node
import {it,expect} from 'vitest';
import {narrationFixture} from './workspaceNarration.fixture';
import {nativeWorkerPort} from './workerDatabase';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a superseded attempt cannot refresh, report, reserve submission or begin publication for the current attempt',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();const w=f.made,base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  for(const [name,data] of [['saveWorkspaceNarration',{...base,mode:'tts',...f.narrationSettings,text:'旧尝试不能操作新租约。'}],['confirmWorkspaceNarration',base],['generateWorkspaceNarration',{...base,reservationCents:100}]] as const){const r=await f.request(name,data);expect(r.status,JSON.stringify(r.body)).toBe(200);}
  const taskId=(await f.read()).narration[0].generationTask.taskId,worker=f.workerPool(),port=nativeWorkerPort(worker);
  await f.c.query('UPDATE public.tasks SET max_attempts=2 WHERE id=$1',[taskId]);
  const first=(await port.rpc('claim_next_worker_task',{p_task_id:taskId,p_worker_capacity:1}))[0] as {attempt:number;lease_token:string};
  const old={p_task_id:taskId,p_attempt:first.attempt,p_lease_token:first.lease_token},result={version:'worker-result/v1',taskId,status:'failed',artifacts:[],validation:{passed:false,checks:[]},actualCostCents:0,blockers:[],retry:{shouldRetry:true,reason:'Controlled failure before supplier submission'},nextStep:'Retry original task'};
  await port.rpc('report_worker_result',{...old,p_result:result});await f.c.query('UPDATE public.tasks SET available_at=clock_timestamp() WHERE id=$1',[taskId]);
  const second=(await port.rpc('claim_next_worker_task',{p_task_id:taskId,p_worker_capacity:1}))[0] as {attempt:number;lease_token:string};expect(second.attempt).toBe(first.attempt+1);expect(second.lease_token).not.toBe(first.lease_token);
  await expect(port.rpc('refresh_worker_task_lease',old)).rejects.toThrow();await expect(port.rpc('report_worker_result',{...old,p_result:result})).rejects.toThrow();
  await expect(worker.query('SELECT local_identity.reserve_workspace_narration_submission($1,$2,$3)',[taskId,first.attempt,first.lease_token])).rejects.toThrow();await expect(worker.query('SELECT local_identity.begin_native_output_publication($1,$2,$3)',[taskId,first.attempt,first.lease_token])).rejects.toThrow();
  const current={p_task_id:taskId,p_attempt:second.attempt,p_lease_token:second.lease_token};await port.rpc('refresh_worker_task_lease',current);expect((await f.read()).narration[0].generationTask).toMatchObject({taskId,status:'running',submissionUnknown:false});
  await port.rpc('report_worker_result',{...current,p_result:{...result,retry:{shouldRetry:false,reason:'Controlled test completed without a supplier request'}}});expect((await f.read()).narration[0].generationTask).toMatchObject({taskId,status:'failed'});
 }finally{await f.close();}
},120000);
