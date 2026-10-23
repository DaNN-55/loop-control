import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { sql, quote,env,digest } from './backup.mjs';
import { targetConfiguration, targetContainer, targetId } from './restore.mjs';
import { writePrivateFile, ensurePrivateDirectory } from './environment.mjs';
const c=targetConfiguration(),admin=createClient(c.apiUrl,c.serviceRoleKey,{auth:{persistSession:false}});
const episode='a0000000-0000-4000-8000-000000000003';
const unwrap=async p=>{const {data,error}=await p;if(error)throw new Error(`lease RPC: ${error.code} ${error.message}`);return data;};
const outcomes=[];
async function test(name,run){try{await run();outcomes.push({name,passed:true});}catch(e){outcomes.push({name,passed:false,detail:e.message});}}
async function task(group,max=2){const id=randomUUID();await unwrap(admin.from('tasks').insert({id,episode_id:episode,task_type:'draft_brief',provider:'codex',model:'stage-b-no-model',prompt_version:'stage-b-v1',max_attempts:max,budget_limit_cents:0,status:'ready',input_snapshot:{capability:'brief_drafting',executor:{provider:'codex',adapter:group},output:{required_artifact_types:['brief']}}}));return id;}
async function claim(id){return unwrap(admin.rpc('claim_next_worker_task',{p_task_id:id,p_worker_capacity:1}));}
function expire(id){sql(`update public.tasks set claimed_at=clock_timestamp()-interval '31 minutes' where id=${quote(id)};`,targetContainer);}
await test('only expired running is recovered without a ready candidate',async()=>{
 const id=await task(randomUUID());assert.equal((await claim(id))[0].attempt,0);expire(id);const next=await claim(id);assert.equal(next.length,1);assert.equal(next[0].attempt,1);
});
await test('expired same-group occupant releases capacity before candidate selection',async()=>{
 const group=randomUUID(),old=await task(group),ready=await task(group);assert.equal((await claim(old)).length,1);expire(old);assert.equal((await claim(ready)).length,1);
});
if(['fencing-red','green','final'].includes(process.argv[2])) {
await test('expired heartbeat cannot revive an interrupted attempt',async()=>{
 const id=await task(randomUUID()),first=(await claim(id))[0];expire(id);
 const r=await admin.rpc('refresh_worker_task_lease',{p_task_id:id,p_attempt:first.attempt,...(first.lease_token?{p_lease_token:first.lease_token}:{})}); assert.ok(r.error?.code === '42501' || r.data === false);
});
await test('claim returns a distinct lease token for the active attempt',async()=>{
 const id=await task(randomUUID()),first=(await claim(id))[0];assert.match(first.lease_token,/^[0-9a-f-]{36}$/);
});
}
if(['green','final'].includes(process.argv[2])) {
 const leaseArgs=r=>({p_task_id:r.task_id,p_attempt:r.attempt,p_lease_token:r.lease_token});
 const failResult=id=>({version:'worker-result/v1',taskId:id,status:'failed',artifacts:[],validation:{passed:false,checks:[]},actualCostCents:0,blockers:[],retry:{shouldRetry:false,reason:'Synthetic failure'},nextStep:'Inspect the synthetic run.'});
 const row=id=>unwrap(admin.from('tasks').select('*').eq('id',id).single());
 await test('active heartbeat and progress retain zero-based attempt and prevent recovery',async()=>{
  const id=await task(randomUUID()),r=(await claim(id))[0];assert.equal(r.attempt,0);assert.equal((await row(id)).attempt,1);
  await unwrap(admin.rpc('refresh_worker_task_lease',leaseArgs(r)));
  const progress={version:'worker-progress/v1',progress:{version:'worker-progress/v1',step:'provider_execution',detail:'Synthetic progress',observedAt:new Date().toISOString()}};
  await unwrap(admin.rpc('report_worker_progress',{...leaseArgs(r),p_progress:progress}));
  await unwrap(admin.rpc('recover_expired_worker_tasks'));
  assert.equal((await row(id)).last_result.progress.detail,'Synthetic progress');assert.equal((await row(id)).lease_token,r.lease_token);
  const runs=await unwrap(admin.from('task_runs').select('*').eq('task_id',id));assert.equal(runs.length,1);assert.equal(runs[0].result.progress.detail,'Synthetic progress');
 });
 await test('attempt budget terminates expired run and preserves attempt history',async()=>{
  const id=await task(randomUUID(),1),r=(await claim(id))[0];expire(id);await unwrap(admin.rpc('recover_expired_worker_tasks'));assert.equal((await row(id)).status,'failed');assert.equal((await row(id)).lease_token,null);assert.equal((await claim(id)).length,0);
  const runs=await unwrap(admin.from('task_runs').select('*').eq('task_id',id));assert.equal(runs.length,1);assert.equal(runs[0].attempt,0);assert.equal(runs[0].status,'failed');assert.equal(runs[0].lease_token,r.lease_token);
 });
 await test('late result, heartbeat, progress, wrong token and legacy API cannot overwrite next attempt',async()=>{
  const id=await task(randomUUID()),old=(await claim(id))[0];expire(id);const next=(await claim(id))[0];assert.equal(next.attempt,1);assert.notEqual(next.lease_token,old.lease_token);
  for(const response of [await admin.rpc('report_worker_result',{...leaseArgs(old),p_result:failResult(id)}),await admin.rpc('refresh_worker_task_lease',leaseArgs(old)),await admin.rpc('report_worker_progress',{...leaseArgs(old),p_progress:{version:'worker-progress/v1',progress:{}}}),await admin.rpc('report_worker_result',{...leaseArgs(next),p_lease_token:randomUUID(),p_result:failResult(id)}),await admin.rpc('report_worker_result',{p_task_id:id,p_attempt:1,p_result:failResult(id)})]) assert.equal(response.error?.code,'42501');
  const root=join(c.mediaRoot,'smoke'),relativePath=`episodes/${episode}/stage-b-${id}.txt`,content=Buffer.from('new attempt immutable artifact');ensurePrivateDirectory(join(root,'episodes',episode));writePrivateFile(join(root,relativePath),content);
  const result={...failResult(id),status:'completed',validation:{passed:true,checks:[]},artifacts:[{artifactType:'brief',relativePath,sha256:digest(content),fileSize:content.length}]};
  await unwrap(admin.rpc('report_worker_result',{...leaseArgs(next),p_result:result}));
  const before=await row(id),late=await admin.rpc('report_worker_result',{...leaseArgs(old),p_result:failResult(id)});assert.equal(late.error?.code,'42501');assert.deepEqual(await row(id),before);
  const runs=await unwrap(admin.from('task_runs').select('*').eq('task_id',id).order('attempt'));assert.deepEqual(runs.map(r=>[r.attempt,r.status]),[[0,'failed'],[1,'completed']]);
  const artifacts=await unwrap(admin.from('artifacts').select('*').eq('producer_task_id',id));assert.equal(artifacts.length,1);assert.equal(artifacts[0].sha256,digest(content));
 });
 async function barrier(statement){
  const child=spawn('docker',['exec','-i',targetContainer,'psql','-XqAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe']});
  const lines=createInterface({input:child.stdout});const ready=new Promise((resolve,reject)=>{lines.on('line',line=>{if(line==='barrier')resolve();});child.once('exit',()=>reject(Error('barrier exited')));});
  child.stdin.write(`begin; select set_config('request.jwt.claim.role','service_role',true); ${statement}; select 'barrier';\n`);await ready;
  return async()=>{const done=once(child,'exit');child.stdin.end('commit;\n');await done;};
 }
 await test('two truly overlapping transactions claim exactly once without duplicate runs',async()=>{
  const id=await task(randomUUID()),release=await barrier("select pg_advisory_xact_lock(hashtextextended('loop-worker-lease-recovery',0))");
  const operations=[claim(id),claim(id)];let waiters=0;
  try{for(let i=0;i<30;i++){waiters=Number(sql("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%claim_next_worker_task%'",targetContainer));if(waiters>=2)break;await new Promise(r=>setTimeout(r,20));}assert.ok(waiters>=2,'two claim transactions must be observed waiting concurrently');}finally{await release();}
  const results=await Promise.all(operations);assert.equal(results.flat().length,1);
  const runs=await unwrap(admin.from('task_runs').select('*').eq('task_id',id));assert.equal(runs.length,1);assert.equal((await row(id)).attempt,1);
 });
 await test('renewal holding a real row lock is skipped by concurrent recovery',async()=>{
  const id=await task(randomUUID()),r=(await claim(id))[0];
  const release=await barrier(`select public.refresh_worker_task_lease(${quote(id)},0,${quote(r.lease_token)})`);
  try{await unwrap(admin.rpc('recover_expired_worker_tasks'));assert.equal((await row(id)).status,'running');}finally{await release();}
  assert.equal((await row(id)).lease_token,r.lease_token);
 });
 await test('recovery winning the race makes late renewal fail',async()=>{
  const id=await task(randomUUID()),r=(await claim(id))[0];expire(id);
  const release=await barrier('select public.recover_expired_worker_tasks()');
  const renewal=admin.rpc('refresh_worker_task_lease',leaseArgs(r)).then(x=>x);
  await new Promise(r=>setTimeout(r,50));await release();assert.equal((await renewal).error?.code,'42501');assert.equal((await row(id)).status,'ready');
 });
 const anonymous=createClient(c.apiUrl,c.anonKey,{auth:{persistSession:false}});
 await test('anonymous cannot claim or recover',async()=>{for(const response of [await anonymous.rpc('claim_next_worker_task',{}),await anonymous.rpc('recover_expired_worker_tasks',{})])assert.ok(response.error);});
}
const result={checkedAt:new Date().toISOString(),target:targetId,mode:process.argv[2]??'regressions',outcomes};
writePrivateFile(join(c.stateRoot,`leases-${result.mode}.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(outcomes.some(o=>!o.passed))process.exitCode=1;
