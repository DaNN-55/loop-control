// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {narrationFixture} from './workspaceNarration.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {createWorkerTaskConsumer} from '../orchestration/workerDispatch';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Pool} from 'pg';
import {recoverPendingNativeAttemptOutput} from './nativeAttemptOutput';
import {runWorkspaceDeliveryProcess,withWorkspaceWorkerDatabase} from './workspaceDelivery.fixture';
import {inspectMediaRoot} from './mediaRootSettings';
import {startNativeWorkerService} from './localWorkerService';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';

it.skipIf(!enabled)('a failure report already waiting on the lease cannot cross a newly committed publication fence',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();const w=f.made,base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  for(const [name,data] of [['saveWorkspaceNarration',{...base,mode:'tts',...f.narrationSettings,text:'并发回报不能越过发布保护。'}],['confirmWorkspaceNarration',base],['generateWorkspaceNarration',{...base,reservationCents:100}]] as const)expect((await f.request(name,data)).status).toBe(200);
  const id=(await f.c.query("SELECT id FROM public.tasks WHERE episode_id=$1 AND task_type='generate_narration' AND status='ready'",[f.episode])).rows[0].id,worker=f.workerPool();
  const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:id,p_worker_capacity:1}))[0] as {attempt:number;lease_token:string};
  const publishing=await worker.connect(),reporting=await worker.connect();try{
   const fence={p_task_id:id,p_attempt:task.attempt,p_lease_token:task.lease_token},pid=(await reporting.query('SELECT pg_backend_pid() pid')).rows[0].pid;
   await publishing.query('BEGIN');await publishing.query('SELECT local_identity.begin_native_output_publication($1,$2,$3)',[id,task.attempt,task.lease_token]);
   const result={version:'worker-result/v1',taskId:id,status:'failed',artifacts:[],validation:{passed:false,checks:[]},actualCostCents:0,blockers:[],retry:{shouldRetry:false,reason:'Controlled late process failure'},nextStep:'Inspect Worker'};
   const late=reporting.query('SELECT local_identity.input_worker_call($1,$2)',['report_worker_result',{...fence,p_result:result}]).then(()=>({error:null}),error=>({error}));
   await vi.waitFor(async()=>expect((await f.c.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0].wait_event_type).toBe('Lock'),{timeout:10000,interval:25});
   await publishing.query('COMMIT');expect((await late).error).toBeInstanceOf(Error);
   expect((await f.c.query('SELECT status,attempt FROM public.tasks WHERE id=$1',[id])).rows[0]).toEqual({status:'running',attempt:1});
   expect((await worker.query('SELECT * FROM local_identity.pending_native_output_publications()')).rows).toHaveLength(1);
  }finally{await publishing.query('ROLLBACK');publishing.release();reporting.release();}
 }finally{await f.close();}
},120000);

it.skipIf(!enabled).each(['prepare','execute'] as const)('the final %s failure records a terminal result through the real fenced Worker port',async phase=>{
 const f=await narrationFixture();try{
  await f.authorize();const w=f.made,base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  for(const [name,data] of [['saveWorkspaceNarration',{...base,mode:'tts',...f.narrationSettings,text:'最后一次准备失败。'}],['confirmWorkspaceNarration',base],['generateWorkspaceNarration',{...base,reservationCents:100}]] as const){const r=await f.request(name,data);expect(r.status,JSON.stringify(r.body)).toBe(200);}
  const id=(await f.c.query("SELECT id FROM public.tasks WHERE episode_id=$1 AND task_type='generate_narration' AND status='ready'",[f.episode])).rows[0].id;
  await f.c.query('UPDATE public.tasks SET max_attempts=1 WHERE id=$1',[id]);
  const failure=Error('controlled '+phase+' failure'),port=nativeWorkerPort(f.workerPool()),consumer=createWorkerTaskConsumer({projectRoot:process.cwd(),database:port,concurrency:1},{prepare:async()=>{if(phase==='prepare')throw failure;},execute:async()=>{throw failure;}},()=>{});
  if(phase==='prepare')await expect(consumer.scan({taskId:id})).rejects.toBe(failure);else{await consumer.scan({taskId:id});await consumer.settled();}
  const task=(await f.c.query('SELECT status,attempt,max_attempts,last_result,lease_token FROM public.tasks WHERE id=$1',[id])).rows[0];
  expect(task).toMatchObject({status:'failed',attempt:1,max_attempts:1,lease_token:null});expect(task.last_result.retry.shouldRetry).toBe(false);
  expect((await f.c.query('SELECT status FROM public.task_runs WHERE task_id=$1',[id])).rows).toEqual([{status:'failed'}]);
  expect(await port.rpc('claim_next_worker_task',{p_task_id:id,p_worker_capacity:1})).toEqual([]);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('ordinary execution failure retries within its allowance and stops at the final attempt',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();const w=f.made,base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  for(const [name,data] of [['saveWorkspaceNarration',{...base,mode:'tts',...f.narrationSettings,text:'普通失败仍按次数重试。'}],['confirmWorkspaceNarration',base],['generateWorkspaceNarration',{...base,reservationCents:100}]] as const)expect((await f.request(name,data)).status).toBe(200);
  const id=(await f.c.query("SELECT id FROM public.tasks WHERE episode_id=$1 AND task_type='generate_narration' AND status='ready'",[f.episode])).rows[0].id;
  await f.c.query('UPDATE public.tasks SET max_attempts=2 WHERE id=$1',[id]);
  const port=nativeWorkerPort(f.workerPool());let executions=0;
  const consumer=createWorkerTaskConsumer({projectRoot:process.cwd(),database:port,concurrency:1},{prepare:async()=>{},execute:async()=>{executions++;throw Error('Controlled ordinary failure');}},()=>{});
  await consumer.scan({taskId:id});await consumer.settled();
  const first=(await f.c.query('SELECT status,attempt,last_result FROM public.tasks WHERE id=$1',[id])).rows[0];expect(first.status).toBe('ready');expect(first.attempt).toBe(1);expect(first.last_result.retry.shouldRetry).toBe(true);
  await f.c.query('UPDATE public.tasks SET available_at=clock_timestamp() WHERE id=$1',[id]);
  await consumer.scan({taskId:id});await consumer.settled();
  const last=(await f.c.query('SELECT status,attempt,last_result FROM public.tasks WHERE id=$1',[id])).rows[0];expect(last.status).toBe('failed');expect(last.attempt).toBe(2);expect(last.last_result.retry.shouldRetry).toBe(false);expect(executions).toBe(2);
  expect((await f.c.query('SELECT status FROM public.task_runs WHERE task_id=$1 ORDER BY attempt',[id])).rows).toEqual([{status:'failed'},{status:'failed'}]);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled||!process.env.LOOP_WORKER_OUTCOME_RUNTIME).each([false,true])('the real scheduler observes unknown publication and restart does not regenerate (committed=%s)',async committed=>{
 const f=await narrationFixture();try{
  await f.authorize();const w=f.made,base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  for(const [name,data] of [['saveWorkspaceNarration',{...base,mode:'tts',...f.narrationSettings,text:'常驻调度器保留发布结果。'}],['confirmWorkspaceNarration',base],['generateWorkspaceNarration',{...base,reservationCents:100}]] as const)expect((await f.request(name,data)).status).toBe(200);
  const id=(await f.c.query("SELECT id FROM public.tasks WHERE episode_id=$1 AND task_type='generate_narration' AND status='ready'",[f.episode])).rows[0].id;
  const fault=join(f.root,'scheduler-commit-loss.mjs');await writeFile(fault,`import {createRequire} from 'node:module';const {Client}=createRequire(process.cwd()+'/package.json')('pg'),query=Client.prototype.query;let lost=false;Client.prototype.query=function(sql,...args){if(typeof sql==='string'&&sql.includes('begin_native_output_publication'))this.publishing=true;if(sql==='COMMIT'&&this.publishing&&!lost){lost=true;return query.call(this,${JSON.stringify(committed?'COMMIT':'ROLLBACK')}).then(()=>{throw Error('Controlled COMMIT acknowledgement loss');});}return query.call(this,sql,...args);};`);
  const mountPath=(await inspectMediaRoot(f.root)).mountPath,events:Array<{name:string;taskId:string}>=[];
  await withWorkspaceWorkerDatabase(f,async database=>{
   const config={projectRoot:process.env.LOOP_WORKER_OUTCOME_RUNTIME!,database,applicationDatabase:database,mediaRoot:f.root,mountPath,minimumFreeBytes:0,visualCommand:[process.execPath,'--version'],actualCostCents:0,concurrency:1,narration:{mode:'controlled' as const,modulePath:join(f.root,'controlled-narration.mjs')},environment:{...process.env,LOOP_STATE_DIR:join(f.root,'scheduler-state'),NODE_OPTIONS:'--import '+fault},record:(event:{name:string;taskId:string})=>events.push(event)};
   const service=await startNativeWorkerService(config);
   try{await vi.waitFor(()=>{expect(events.some(e=>e.name==='worker-publication-unknown'&&e.taskId===id)).toBe(true);expect(service.status().activeWorkers).toBe(0);},{timeout:30000,interval:50});}finally{await service.stop();}
   if(!committed)await f.c.query("UPDATE public.tasks SET claimed_at=clock_timestamp()-interval '31 minutes' WHERE id=$1",[id]);
   const restart=await startNativeWorkerService({...config,environment:{...config.environment,NODE_OPTIONS:''}});
   try{await vi.waitFor(()=>{expect(restart.status().lastScanAt).not.toBeNull();expect(restart.status().scanning).toBe(false);},{timeout:10000,interval:50});}finally{await restart.stop();}
  });
  expect(events.filter(e=>e.name==='worker-started')).toHaveLength(1);
  expect((await f.c.query('SELECT status,attempt FROM public.tasks WHERE id=$1',[id])).rows[0]).toEqual({status:committed?'completed':'running',attempt:1});
  expect(await recoverPendingNativeAttemptOutput(f.workerPool(),f.root,id,0)).toEqual({status:'completed',registered:!committed});
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled||!process.env.LOOP_WORKER_OUTCOME_RUNTIME).each([false,true])('actual compiled Worker preserves unknown publication across its process boundary (committed=%s)',async committed=>{
 const f=await narrationFixture();try{
  await f.authorize();const w=f.made,base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  for(const [name,data] of [['saveWorkspaceNarration',{...base,mode:'tts',...f.narrationSettings,text:'子进程发布结果待核对。'}],['confirmWorkspaceNarration',base],['generateWorkspaceNarration',{...base,reservationCents:100}]] as const){const r=await f.request(name,data);expect(r.status,JSON.stringify(r.body)).toBe(200);}
  const id=(await f.c.query("SELECT id FROM public.tasks WHERE episode_id=$1 AND task_type='generate_narration' AND status='ready'",[f.episode])).rows[0].id;
  const fault=join(f.root,'commit-loss.mjs');await writeFile(fault,`import {createRequire} from 'node:module';const {Client}=createRequire(process.cwd()+'/package.json')('pg'),query=Client.prototype.query;let lost=false;Client.prototype.query=function(sql,...args){if(typeof sql==='string'&&sql.includes('begin_native_output_publication'))this.publishing=true;if(sql==='COMMIT'&&this.publishing&&!lost){lost=true;return query.call(this,${JSON.stringify(committed?'COMMIT':'ROLLBACK')}).then(()=>{throw Error('Controlled COMMIT acknowledgement loss');});}return query.call(this,sql,...args);};`);
  const worker=f.workerPool(),port=nativeWorkerPort(worker);let parentReports=0,executions=0;
  const database={...port,async rpc(name:string,args:Record<string,unknown>){if(name==='report_worker_result')parentReports++;return port.rpc(name,args);}};
  const root=process.env.LOOP_WORKER_OUTCOME_RUNTIME!,mountPath=(await inspectMediaRoot(f.root)).mountPath;
  const consumer=createWorkerTaskConsumer({projectRoot:root,database,concurrency:1},{prepare:async()=>{},execute:async task=>{executions++;return runWorkspaceDeliveryProcess(f,task,{mountPath,visualCommand:[process.execPath,'--version'],narration:{mode:'controlled',modulePath:join(f.root,'controlled-narration.mjs')}},{projectRoot:root,environment:{...process.env,NODE_OPTIONS:'--import '+fault}});}},()=>{});
  await consumer.scan({taskId:id});await consumer.settled();expect(executions).toBe(1);expect(parentReports).toBe(0);
  const task=(await f.c.query('SELECT status,attempt FROM public.tasks WHERE id=$1',[id])).rows[0];expect(task).toEqual({status:committed?'completed':'running',attempt:1});
  const run=(await f.c.query('SELECT attempt FROM public.task_runs WHERE task_id=$1',[id])).rows[0];
  expect((await worker.query('SELECT * FROM local_identity.pending_native_output_publications()')).rows).toHaveLength(committed?0:1);
  expect(await recoverPendingNativeAttemptOutput(worker,f.root,id,run.attempt)).toEqual({status:'completed',registered:!committed});
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled).each([false,true])('lost COMMIT acknowledgement (committed=%s) survives expiry and reconciles from a new connection without generation',async committed=>{
 let injected=false;
 const f=await narrationFixture(undefined,base=>{
  const workerPool=base.workerPool;
  base.workerPool=()=>{
   const pool=workerPool();
   pool.on('connect',c=>{
    const query=c.query.bind(c);let publication=false;
    c.query=(async(sql:string,...args:unknown[])=>{
     if(sql.includes('begin_native_output_publication'))publication=true;
     if(sql==='COMMIT'&&publication&&!injected){injected=true;await query(committed?'COMMIT':'ROLLBACK');throw Error('Controlled lost COMMIT acknowledgement');}
     return (query as Function)(sql,...args);
    }) as typeof c.query;
   });
   return pool;
  };
 });try{
  await f.authorize();const w=f.made,base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  for(const [name,data] of [['saveWorkspaceNarration',{...base,mode:'tts',...f.narrationSettings,text:'保留结果，核对后恢复。'}],['confirmWorkspaceNarration',base],['generateWorkspaceNarration',{...base,reservationCents:100}]] as const){const r=await f.request(name,data);expect(r.status,JSON.stringify(r.body)).toBe(200);}
  const task=(await f.c.query("SELECT id,input_snapshot FROM public.tasks WHERE episode_id=$1 AND task_type='generate_narration' AND status='ready'",[f.episode])).rows[0];
  await expect(f.execute(task.id,false)).rejects.toThrow();expect(injected).toBe(true);
  const run=(await f.c.query('SELECT attempt,lease_token FROM public.task_runs WHERE task_id=$1',[task.id])).rows[0],fence={p_task_id:task.id,p_attempt:run.attempt,p_lease_token:run.lease_token};
  const identity=createHash('sha256').update(JSON.stringify(fence)).digest('hex'),staging=join(f.assetRoot,f.episodeRelativePath,'.native-worker-attempts',identity),receipt=join(staging,'publication-receipt-private.json'),receiptBytes=await readFile(receipt),output=join(f.assetRoot,task.input_snapshot.output.relative_path),published=await readFile(output),requests=await readFile(f.submissions,'utf8');
  const worker=f.workerPool();
  if(!committed){
   await expect(worker.query('SELECT local_identity.resume_native_output_publication($1,$2,$3)',[task.id,run.attempt+1,run.lease_token])).rejects.toThrow();
   await expect(worker.query('SELECT local_identity.resume_native_output_publication($1,$2,$3)',[task.id,run.attempt,'00000000-0000-4000-8000-000000000001'])).rejects.toThrow();
   await expect(recoverPendingNativeAttemptOutput(worker,f.root,task.id,run.attempt+1)).rejects.toThrow();
   await expect(f.pool.query('SELECT * FROM local_identity.pending_native_output_publications()')).rejects.toThrow(/permission denied/);
   await expect(f.pool.query('SELECT * FROM local_identity.native_output_publications')).rejects.toThrow(/permission denied/);
   await expect(f.c.query("UPDATE public.tasks SET status='ready' WHERE id=$1",[task.id])).rejects.toThrow(/explicit reconciliation/);
   await f.c.query("UPDATE public.tasks SET claimed_at=clock_timestamp()-interval '31 minutes' WHERE id=$1",[task.id]);
   expect(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:task.id,p_worker_capacity:1})).toEqual([]);
   expect((await f.c.query('SELECT status,attempt FROM public.tasks WHERE id=$1',[task.id])).rows[0]).toEqual({status:'running',attempt:1});
   expect((await worker.query('SELECT * FROM local_identity.pending_native_output_publications()')).rows).toHaveLength(1);
   await writeFile(receipt,Buffer.concat([receiptBytes,Buffer.from('invalid')]));
   await expect(recoverPendingNativeAttemptOutput(worker,f.root,task.id,run.attempt)).rejects.toThrow();
   expect(await readFile(output)).toEqual(published);expect((await worker.query('SELECT * FROM local_identity.pending_native_output_publications()')).rows).toHaveLength(1);await writeFile(receipt,receiptBytes);
  }
  for(let n=0;n<2;n++)expect(await recoverPendingNativeAttemptOutput(worker as Pool,f.root,task.id,run.attempt)).toEqual({status:'completed',registered:n===0&&!committed});
  expect((await worker.query('SELECT * FROM local_identity.pending_native_output_publications()')).rows).toEqual([]);
  expect((await f.c.query('SELECT status,attempt FROM public.tasks WHERE id=$1',[task.id])).rows[0]).toEqual({status:'completed',attempt:1});
  expect((await f.c.query('SELECT status FROM public.task_runs WHERE task_id=$1',[task.id])).rows).toEqual([{status:'completed'}]);
  expect(await readFile(output)).toEqual(published);expect(await readFile(f.submissions,'utf8')).toBe(requests);
 }finally{await f.close();}
},120000);
