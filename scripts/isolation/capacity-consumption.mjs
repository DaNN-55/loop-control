// Real DB queue and result transactions; controlled execution is explicitly
// separate from the ordinary Worker/FFmpeg HTTP path verified below.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { createClient } from '@supabase/supabase-js';
import { dispatchWorkerTasks } from '../../dist/orchestration/orchestration/workerDispatch.js';
import { targetConfiguration, targetContainer, targetId } from './restore.mjs';
import { config, sql, quote, digest, env, assertContainer } from './backup.mjs';
import { projectRoot, cleanEnvironment, ensurePrivateDirectory, writePrivateFile } from './environment.mjs';
assert.ok(process.argv.includes('--verified'));assert.equal(targetId,'loop-control-stage-b-verified');assertContainer(targetContainer,targetId);
const c=targetConfiguration(),dir=join(c.stateRoot,'t07'),root=join(c.mediaRoot,'smoke');ensurePrivateDirectory(dir);
const admin=createClient(c.apiUrl,c.serviceRoleKey,{auth:{persistSession:false}});
const ownerClient=createClient(c.apiUrl,c.anonKey,{auth:{persistSession:false}});
const unwrap=async p=>{const{data,error}=await p;if(error)throw Error(`T07 DB ${error.code}: ${error.message}`);return data;};
const options={projectRoot,supabaseUrl:c.apiUrl,serviceRoleKey:c.serviceRoleKey,environment:cleanEnvironment(c),concurrency:2};
const hint={taskId:randomUUID()}; // Durable-queue wake; avoids unrelated planner writes.
const lease=t=>({p_task_id:t.task_id,p_attempt:t.attempt,p_lease_token:t.lease_token});
const row=id=>unwrap(admin.from('tasks').select('*').eq('id',id).single());
async function finish(t) {
 const relativePath=`episodes/${t.episode_id}/t07-${t.task_id}-${t.attempt}.txt`,content=Buffer.from('T07 real DB controlled executor output\n');
 ensurePrivateDirectory(join(root,'episodes',t.episode_id));writePrivateFile(join(root,relativePath),content,{exclusive:true});
 await unwrap(admin.rpc('report_worker_result',{...lease(t),p_result:{version:'worker-result/v1',taskId:t.task_id,status:'completed',artifacts:[{artifactType:'brief',relativePath,sha256:digest(content),fileSize:content.length}],validation:{passed:true,checks:[]},actualCostCents:0,blockers:[],retry:{shouldRetry:false,reason:'Controlled execution completed'},nextStep:'Inspect the controlled artifact'}}));
 return{status:'completed',taskId:t.task_id};
}
if(process.argv.includes('--child')) {
 const abort=new AbortController(),claimed=[];
 await dispatchWorkerTasks({...options,concurrency:1,signal:abort.signal},hint,{prepare:async()=>{},execute:async t=>{claimed.push({id:t.task_id,episode:t.episode_id});const result=await finish(t);if(process.argv.includes('--one'))abort.abort();return result;}});
 console.log(JSON.stringify({claimed}));process.exit(0);
}
const episodes=[],allTasks=[];
async function episode(label) {const id=randomUUID();await unwrap(admin.from('episodes').insert({id,account_id:'a0000000-0000-4000-8000-000000000001',blueprint_version_id:'a0000000-0000-4000-8000-000000000002',title:`T07 ${label}`,is_test:true}));episodes.push(id);return id;}
async function task(ep,index=0,provider='google_tts',taskType='draft_brief') {const id=randomUUID();await unwrap(admin.from('tasks').insert({id,episode_id:ep,task_type:taskType,provider,model:'t07-controlled',prompt_version:'t07-controlled',budget_limit_cents:0,max_attempts:2,status:'ready',created_at:new Date(Date.now()+index*1000).toISOString(),input_snapshot:{capability:'brief_drafting',executor:{provider,adapter:provider==='pexels'?'pexels_video':provider}}}));allTasks.push(id);return id;}
const invalidation=reason=>({invalidated_at:new Date().toISOString(),invalidated_reason:reason});
const wait=async predicate=>{for(let i=0;i<300;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,50));}throw Error('Controlled condition did not become true');};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function protect() {
 const child=spawn('docker',['exec','-i',targetContainer,'psql','-XqAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe']});
 const lines=createInterface({input:child.stdout});const ready=new Promise((resolve,reject)=>{lines.on('line',l=>{if(l==='protected')resolve();});child.once('exit',()=>reject(Error('Old-task guard exited')));});
 child.stdin.write("begin;select id from tasks for update;select 'protected';\n");await ready;
 return async()=>{const done=once(child,'exit');child.stdin.end('rollback;\n');await done;};
}
const oldTasks=sql("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from tasks t",targetContainer);
const releaseOld=await protect();const evidence=[];const pending=[];
try {
 const [a,b,cEp]=await Promise.all(['long A','short B','short C'].map(episode));
 const a1=await task(a,0),a2=await task(a,1),a3=await task(a,2),b1=await task(b,3),b2=await task(b,4),c1=await task(cEp,5);
 const holdA=deferred(),holdB=deferred(),starts=[];let active=0,peak=0,prepared=0;
 const consumer=dispatchWorkerTasks(options,hint,{prepare:async()=>{prepared++;},execute:async t=>{
  active++;peak=Math.max(peak,active);starts.push({id:t.task_id,episode:t.episode_id,at:Date.now()});
  try{if(t.task_id===a1)await holdA.promise;if(t.task_id===b1)await holdB.promise;return await finish(t);}finally{active--;}
 }});pending.push(consumer);
 try {
  await wait(()=>starts.length===2);assert.deepEqual(starts.map(s=>s.id),[a1,b1]);
  let fullStarts=0,fullPrepared=0;
  const full=await dispatchWorkerTasks(options,hint,{prepare:async()=>{fullPrepared++;},execute:async()=>{fullStarts++;}});
  assert.equal(fullStarts,0);assert.equal(fullPrepared,0);assert.equal(full.queuedTasks,0);
  const sourceOwner=JSON.parse(readFileSync(join(config.stateRoot,'owner.json'))),owner=JSON.parse(readFileSync(join(c.stateRoot,`owner-${sourceOwner.id}.json`)));
  const login=await unwrap(ownerClient.auth.signInWithPassword(owner));
  const headers={authorization:`Bearer ${login.session.access_token}`,origin:`http://127.0.0.1:${c.ports.console}`};
  const status=async(id,ep)=>{const r=await fetch(`http://127.0.0.1:${c.ports.console}/_episode-dispatch?episode=${ep}&task=${id}`,{headers});assert.equal(r.status,200);return r.json();};
  assert.equal((await status(a1,a)).status,'starting');assert.equal((await status(a2,a)).status,'queued');
  const d=await episode('joined while executing'),d1=await task(d,6);
  holdB.resolve();await wait(async()=> (await row(d1)).status==='completed');await wait(()=>starts.length>=5);
  assert.deepEqual(starts.slice(0,5).map(s=>s.episode),[a,b,cEp,d,b]);
  holdA.resolve();const result=await consumer;assert.equal(result.queuedTasks,7);assert.equal(peak,2);assert.equal(prepared,1);
  evidence.push({name:'continuous fair refill, late arrival, distinct HTTP queued/running and no executor at capacity',passed:true,peak,prepared,starts,fullStarts,taskCount:7});
 }finally{holdA.resolve();holdB.resolve();await consumer;}
 // Independent Node processes consume the same persisted rotation cursor.
 const e=await episode('restart E'),f=await episode('restart F');const e1=await task(e),e2=await task(e,1),f1=await task(f,2);
 const child=async args=>{const p=spawn(process.execPath,['scripts/isolation/capacity-consumption.mjs','--verified','--child',...args],{env:cleanEnvironment(c),stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);const[code]=await once(p,'close');assert.equal(code,0,err);return JSON.parse(out.trim().split('\n').at(-1));};
 const first=await child(['--one']),second=await child([]);assert.deepEqual(first.claimed.map(t=>t.id),[e1]);assert.deepEqual(second.claimed.map(t=>t.id),[f1,e2]);
 evidence.push({name:'independent process restart retains fair queue position',passed:true,first,second});
 const g=await episode('retry'),h=await episode('continue after failure');const retry=await task(g),other=await task(h,1);const retryStarts=[];
 await dispatchWorkerTasks({...options,concurrency:1},hint,{prepare:async()=>{},execute:async t=>{retryStarts.push({id:t.task_id,attempt:t.attempt,at:Date.now()});if(t.task_id===retry&&t.attempt===0)throw Error('Controlled process failure');return finish(t);}});
 assert.equal((await row(retry)).attempt,2);assert.equal((await row(retry)).status,'completed');assert.equal((await row(other)).status,'completed');
 const retryTimes=retryStarts.filter(t=>t.id===retry);assert.ok(retryTimes[1].at-retryTimes[0].at>=900);
 evidence.push({name:'process failure releases slot, other Episode advances, durable bounded retry succeeds',passed:true,retryStarts});
 const cancelEp=await episode('cancel'),nextEp=await episode('after cancel');const cancelled=await task(cancelEp,0,'google_tts','generate_narration'),afterCancel=await task(nextEp,1);let rejected=false;
 await unwrap(admin.from('episodes').update({stage:'storyboard_approved'}).eq('id',cancelEp));
 await dispatchWorkerTasks({...options,concurrency:1},hint,{prepare:async()=>{},execute:async t=>{if(t.task_id===cancelled){await unwrap(ownerClient.rpc('save_episode_tts_settings',{p_episode_id:cancelEp,p_tts_language_code:'zh-CN',p_tts_voice:'T07 controlled cancellation voice',p_tts_speaking_rate:1}));assert.equal((await row(cancelled)).status,'superseded');const r=await admin.rpc('refresh_worker_task_lease',lease(t));assert.equal(r.error?.code,'42501');rejected=true;return{status:'cancelled',taskId:t.task_id};}return finish(t);}});
 assert.ok(rejected);assert.equal((await row(afterCancel)).status,'completed');
 evidence.push({name:'actual Owner TTS settings RPC cancels obsolete narration, releases capacity and fences old lease',passed:true,cancelled,afterCancel});
 const racing=await Promise.all(['google_tts','pexels','volcengine_tts'].map(async(p,i)=>task(await episode('concurrent distinct resource '+i),i,p)));
 const raced=await Promise.all(racing.map(id=>unwrap(admin.rpc('claim_next_worker_task',{p_task_id:id,p_worker_capacity:8}))));
 assert.equal(raced.flat().length,2);for(const t of raced.flat())await finish(t);
 await dispatchWorkerTasks(options,hint,{prepare:async()=>{},execute:finish});
 evidence.push({name:'independent concurrent RPCs cannot exceed durable global capacity even with caller limit eight',passed:true,claimCounts:raced.map(r=>r.length),configuredCapacity:2});
 const sharedCredential=randomUUID(),connectionTasks=[];
 await unwrap(admin.from('worker_resource_ceilings').insert({resource_key:`connection:${sharedCredential}`,capacity:1}));
 try {
  for(let i=0;i<3;i++) {
   const id=await task(await episode('connection competition '+i));connectionTasks.push(id);
   const current=await row(id);await unwrap(admin.from('tasks').update({input_snapshot:{...current.input_snapshot,credential_ref:i<2?sharedCredential:randomUUID()}}).eq('id',id));
  }
  const claims=await Promise.all(connectionTasks.map(id=>unwrap(admin.rpc('claim_next_worker_task',{p_task_id:id,p_worker_capacity:2}))));
  assert.equal(claims[0].length+claims[1].length,1);assert.equal(claims[2].length,1);
  for(const t of claims.flat())await finish(t);
  evidence.push({name:'concurrent same-connection quota one and independent connection share Provider quota two',passed:true,claimCounts:claims.map(r=>r.length)});
 } finally {await unwrap(admin.from('worker_resource_ceilings').delete().eq('resource_key',`connection:${sharedCredential}`));}
 await dispatchWorkerTasks(options,hint,{prepare:async()=>{},execute:finish});
 // A killed dispatcher leaves its reserved lease durable. Advance only this
 // fixture's lease clock, then a fresh dispatcher recovers after persisted delay.
 const interrupted=await task(await episode('interrupted lease'));
 const stale=(await unwrap(admin.rpc('claim_next_worker_task',{p_task_id:interrupted,p_worker_capacity:2})))[0];assert.ok(stale);
 await unwrap(admin.from('tasks').update({claimed_at:new Date(Date.now()-31*60*1000).toISOString()}).eq('id',interrupted));
 await dispatchWorkerTasks({...options,concurrency:1},hint,{prepare:async()=>{},execute:finish});
 assert.equal((await row(interrupted)).attempt,2);assert.equal((await row(interrupted)).status,'completed');
 assert.equal((await admin.rpc('refresh_worker_task_lease',lease(stale))).error?.code,'42501');
 evidence.push({name:'fresh dispatcher recovers interrupted expired lease after durable backoff and rejects old attempt',passed:true,taskId:interrupted,attempts:2});
 const nonExecuted=new Set([cancelled]);
 const ineligible=[];
 for(let i=0;i<3;i++){
  const id=await task(await episode('ineligible future '+i),0,i===2?'unsupported-t07':'google_tts');nonExecuted.add(id);ineligible.push(id);
  await unwrap(admin.from('tasks').update({available_at:new Date(Date.now()+60000).toISOString(),...(i===0?{attempt:2}:i===1?invalidation('T07 ineligible future fixture'): {})}).eq('id',id));
 }
 let ineligibleStarts=0;const idleStart=performance.now();await dispatchWorkerTasks(options,hint,{prepare:async()=>{ineligibleStarts++;},execute:async()=>{ineligibleStarts++;}});
 assert.equal(ineligibleStarts,0);assert.ok(performance.now()-idleStart<2000);
 await unwrap(admin.from('tasks').update({status:'superseded',...invalidation('T07 ineligible future fixture completed')}).in('id',ineligible));
 evidence.push({name:'invalidated, unsupported or attempt-exhausted future rows do not keep an idle consumer waiting',passed:true,ineligible,executorStarts:0});
 const tasks=await unwrap(admin.from('tasks').select('id,status,attempt,available_at').in('id',allTasks));
 const runs=await unwrap(admin.from('task_runs').select('task_id,attempt,status').in('task_id',allTasks));
 const artifacts=await unwrap(admin.from('artifacts').select('producer_task_id,relative_path,sha256,file_size').in('producer_task_id',allTasks));
 for(const art of artifacts){const bytes=readFileSync(join(root,art.relative_path));assert.equal(digest(bytes),art.sha256);assert.equal(bytes.length,art.file_size);}
 for(const t of tasks.filter(t=>!nonExecuted.has(t.id))){assert.equal(t.status,'completed');assert.equal(artifacts.filter(a=>a.producer_task_id===t.id).length,1);}
 const result={at:new Date().toISOString(),target:targetId,boundary:'real DB claims/results + controlled executor + ordinary authenticated HTTP status; no online Provider',evidence,tasks,runs,artifacts,existingTasksUnchanged:true};
 writePrivateFile(join(dir,`consumption-${Date.now()}.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
} finally {
 await Promise.allSettled(pending);await releaseOld();
 const after=sql(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from tasks t where episode_id not in (${episodes.map(quote).join(',')||'null'})`,targetContainer);assert.equal(after,oldTasks,'All old task rows must remain byte-identical');
}
