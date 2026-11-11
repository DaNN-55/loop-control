// @vitest-environment node
import {it,expect} from 'vitest';
import type{Pool,PoolClient}from'pg';
import{readFile}from'node:fs/promises';
import{narrationFixture}from'./workspaceNarration.fixture';
import{nativeWorkerPort}from'./workerDatabase';
import{prepareProviderDispatch,markProviderDispatching}from'./providerDispatch';
import{csrfFor}from'./sessions';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
async function queued(f:Awaited<ReturnType<typeof narrationFixture>>){
 const w=f.made,base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
 for(const [command,data]of [['saveWorkspaceNarration',{...base,mode:'tts',...f.narrationSettings,text:'真实隔离回执验收。'}],['confirmWorkspaceNarration',base]]as const){const r=await f.request(command,data);expect(r.status,JSON.stringify(r.body)).toBe(200);}
 const r=await f.request('generateWorkspaceNarration',{...base,reservationCents:100});expect(r.status,JSON.stringify(r.body)).toBe(200);return{id:r.body.narration[0].taskId as string,base};
}
async function sent(f:{submissions:string}){return(await readFile(f.submissions,'utf8').catch(()=> '')).trim().split('\n').filter(Boolean).length;}
it.skipIf(!enabled)('4/24 persists exactly two local recoveries across attempts and reuses a reserved request without an extra send',async()=>{
 const f=await narrationFixture();try{
  const {id}=await queued(f),worker=f.workerPool(),port=nativeWorkerPort(worker);
  await f.c.query('UPDATE public.tasks SET max_attempts=2 WHERE id=$1',[id]);
  const task=(await port.rpc('claim_next_worker_task',{p_task_id:id,p_worker_capacity:1}))[0]as any;
  const fence={p_task_id:id,p_attempt:task.attempt,p_lease_token:task.lease_token};
  let failures=0;
  const preparation={query:async(sql:string,args:unknown[])=>{if(sql.includes('prepare_provider_dispatch')&&++failures<=2)throw Object.assign(Error('controlled transient serialization'),{code:'40001'});return worker.query(sql,args);}}as Pool;
  expect(await prepareProviderDispatch(preparation,fence,'speech')).toBe('confirmed');
  expect((await worker.query('SELECT local_identity.allow_provider_preparation_recovery($1,$2,$3,$4) allowed',[id,task.attempt,task.lease_token,'speech'])).rows[0].allowed).toBe(false);
  expect(await sent(f)).toBe(0);
  await port.rpc('report_worker_result',{...fence,p_result:{version:'worker-result/v1',taskId:id,status:'failed',artifacts:[],validation:{passed:false,checks:[]},actualCostCents:0,blockers:[],retry:{shouldRetry:true,reason:'Controlled interruption before transport'},nextStep:'Recover local preparation'}});
  await f.c.query('UPDATE public.tasks SET available_at=clock_timestamp() WHERE id=$1',[id]);await f.restartWorker();
  expect((await f.execute(id))?.status).toBe('completed');expect(await sent(f)).toBe(1);
  expect((await f.c.query('SELECT outcome FROM local_identity.workspace_narration_submissions WHERE task_id=$1',[id])).rows[0].outcome).toBe('received');
  const facts=(await f.c.query('SELECT attempt,phase,local_recoveries FROM local_identity.provider_dispatch_facts WHERE task_id=$1 ORDER BY attempt',[id])).rows;
  expect(facts).toEqual([{attempt:0,phase:'reserved',local_recoveries:2},{attempt:1,phase:'received',local_recoveries:0}]);
 }finally{await f.close();}
},120000);
it.skipIf(!enabled)('4 changed input is proven not sent, while historical reservations remain unknown',async()=>{
 const f=await narrationFixture();try{
  const {id}=await queued(f),worker=f.workerPool(),task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:id,p_worker_capacity:1}))[0]as any;
  const fence={p_task_id:id,p_attempt:task.attempt,p_lease_token:task.lease_token};
  await worker.query('SELECT local_identity.reserve_workspace_narration_route($1,$2,$3)',[id,task.attempt,task.lease_token]);
  await expect(prepareProviderDispatch(worker,fence,'speech')).rejects.toMatchObject({name:'ProviderOutcomeUnknownError'});
  // A changed input is a local refusal for this invocation, never proof that an old paid request was not sent.
  await f.c.query("UPDATE local_identity.production_workspaces SET project_sha256=repeat('f',64) WHERE id=$1",[f.made.id]);
  await expect(prepareProviderDispatch(worker,fence,'speech')).rejects.toMatchObject({name:'ProviderRequestNotSentError'});
  expect(await sent(f)).toBe(0);expect((await f.c.query('SELECT outcome FROM local_identity.workspace_narration_submissions WHERE task_id=$1',[id])).rows[0].outcome).toBe('started');
  await expect(markProviderDispatching(worker,fence)).rejects.toMatchObject({name:'ProviderRequestNotSentError'});
 }finally{await f.close();}
},120000);
it.skipIf(!enabled).each(['received-write','commit-rejected','commit-ack-lost']as const)('5/9/24 verified files recover the original publication with no new Provider request: %s',async fault=>{
 const f=await narrationFixture();try{
  const {id}=await queued(f),worker=f.workerPool();let injected=false;
  const publication={connect:async()=>{
   const client=await worker.connect();return new Proxy(client,{get(target,key){if(key==='query')return async(sql:string,args?:unknown[])=>{
    if(!injected&&(fault==='received-write'?sql.includes('record_workspace_narration_submission'):sql==='COMMIT')){injected=true;if(fault!=='received-write')await target.query(fault==='commit-ack-lost'?'COMMIT':'ROLLBACK');throw Object.assign(Error('controlled publication receipt loss'),{code:'ECONNRESET'});}return target.query(sql,args);
   };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}})as PoolClient;
  }}as Pool;
  await expect(f.execute(id,true,1,false,publication)).rejects.toMatchObject({name:'NativePublicationUnknownError'});expect(injected).toBe(true);expect(await sent(f)).toBe(1);
  const holds=(await worker.query('SELECT * FROM local_identity.pending_native_output_publications()')).rows;
  if(fault!=='commit-ack-lost')expect(holds).toHaveLength(1);
  await f.restart();await f.restartWorker();
  const recover=await fetch(f.origin+'/api/local/native-output/reconcile',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({episodeId:f.episode,taskId:id,attempt:0})});
  expect(recover.status,await recover.clone().text()).toBe(200);expect((await recover.json()).status).toBe('completed');
  expect((await f.c.query('SELECT status FROM public.tasks WHERE id=$1',[id])).rows[0].status).toBe('completed');expect(await sent(f)).toBe(1);
  expect((await f.c.query('SELECT outcome FROM local_identity.workspace_narration_submissions WHERE task_id=$1',[id])).rows[0].outcome).toBe('received');
 }finally{await f.close();}
},120000);
it.skipIf(!enabled)('24 unknown speech only allows a separately confirmed new generation, preserves old receipt, and cannot reuse that exception',async()=>{
 const f=await narrationFixture();try{
  const {id,base}=await queued(f);await import('node:fs/promises').then(fs=>fs.writeFile(f.responseMode,'unknown'));expect((await f.execute(id,false))?.status).toBe('blocked');
  expect((await f.request('generateWorkspaceNarration',{...base,retry:true,reservationCents:100})).status).toBe(409);expect(await sent(f)).toBe(1);
  const proposal=await f.rawRequest('prepareWorkspaceCall',{workspaceId:base.workspaceId,expectedRevision:base.expectedRevision,callCommand:'generateWorkspaceNarration',callData:{episodeId:f.episode,...base,retry:true,retryOfTaskId:id,reservationCents:100}});
  expect(proposal.status,JSON.stringify(proposal.body)).toBe(200);expect(proposal.body.summary.retryOfTaskId).toBe(id);expect(await sent(f)).toBe(1);
  await import('node:fs/promises').then(fs=>fs.writeFile(f.responseMode,'success'));
  const confirmed=await f.rawRequest('confirmWorkspaceCall',{workspaceId:base.workspaceId,expectedRevision:base.expectedRevision,confirmationId:proposal.body.confirmationId});expect(confirmed.status,JSON.stringify(confirmed.body)).toBe(200);
  const next=confirmed.body.narration[0].taskId;expect(next).not.toBe(id);expect((await f.execute(next))?.status).toBe('completed');expect(await sent(f)).toBe(2);
  const latest=await f.read();expect(latest.narration[0].generationTask).toBeUndefined();expect(latest.narration[0]).toMatchObject({taskId:next,status:'completed'});
  const link=(await f.c.query("SELECT request_snapshot->>'retryOfTaskId' original FROM local_identity.workspace_narration_requests WHERE task_id=$1",[next])).rows[0];expect(link.original).toBe(id);
  expect((await f.c.query('SELECT outcome FROM local_identity.workspace_narration_submissions WHERE task_id=$1',[id])).rows[0].outcome).toBe('started');
  expect((await f.request('generateWorkspaceNarration',{...base,retry:true,retryOfTaskId:id,reservationCents:100})).status).toBe(409);
 }finally{await f.close();}
},120000);
it.skipIf(!enabled)('4/24 a temporary local failure stops after two recovery attempts and a new explicit confirmation can retry without unknown warning',async()=>{
 const f=await narrationFixture();try{
  const{id,base}=await queued(f),worker=f.workerPool();let prepares=0;
  const unavailable={query:async(sql:string,args:unknown[])=>{if(sql.includes('prepare_provider_dispatch')){prepares++;throw Object.assign(Error('controlled transient failure'),{code:'40001'});}return worker.query(sql,args);}}as Pool;
  expect((await f.execute(id,false,1,false,undefined,unavailable))?.status).toBe('failed');expect(prepares).toBe(3);expect(await sent(f)).toBe(0);
  const old=(await f.c.query('SELECT status,last_result FROM public.tasks WHERE id=$1',[id])).rows[0];expect(old.last_result.retry.shouldRetry).toBe(false);expect(old.last_result.blockers[0].code).toBe('PROVIDER_REQUEST_NOT_SENT');
  const read=await f.read();expect(read.narration[0].generationTask).toMatchObject({submissionOutcome:'not_sent',submissionUnknown:false,dispatchObservation:{phase:'preparing',localRecoveries:2}});
  const retry=await f.request('generateWorkspaceNarration',{...base,retry:true,reservationCents:100});expect(retry.status,JSON.stringify(retry.body)).toBe(200);const next=retry.body.narration[0].taskId;expect(next).not.toBe(id);expect((await f.execute(next))?.status).toBe('completed');expect(await sent(f)).toBe(1);
 }finally{await f.close();}
},120000);
it.skipIf(!enabled)('24 a documented business refusal over HTTP 200 is rejected, preserves the code and allows explicit retry',async()=>{
 const f=await narrationFixture();try{
  const{id,base}=await queued(f),module=await import('node:path').then(p=>p.join(f.root,'controlled-narration.mjs')),fs=await import('node:fs/promises');
  await fs.writeFile(module,(await fs.readFile(module,'utf8')).replace("if(mode==='reject')", "if(mode==='business-reject')return new Response('data: '+JSON.stringify({code:45000001})+'\\n');if(mode==='reject')"));await fs.writeFile(f.responseMode,'business-reject');
  expect((await f.execute(id,false))?.status).toBe('failed');const state=await f.read();expect(state.narration[0].generationTask).toMatchObject({submissionOutcome:'rejected',submissionUnknown:false});expect(await sent(f)).toBe(1);
  await fs.writeFile(f.responseMode,'success');const retry=await f.request('generateWorkspaceNarration',{...base,retry:true,reservationCents:100});expect(retry.status,JSON.stringify(retry.body)).toBe(200);expect((await f.execute(retry.body.narration[0].taskId))?.status).toBe('completed');expect(await sent(f)).toBe(2);
 }finally{await f.close();}
},120000);
