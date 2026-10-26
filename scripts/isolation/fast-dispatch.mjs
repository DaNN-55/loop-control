// T08: real verified DB/HTTP/Worker evidence; controlled execution is labelled.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,statSync,chmodSync,closeSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {createClient} from '@supabase/supabase-js';
import {targetConfiguration,targetContainer,targetId,stopTargetConsole,startTargetConsole} from './restore.mjs';
import {config,sql,quote,env,assertContainer,digest} from './backup.mjs';
import {projectRoot,cleanEnvironment,ensurePrivateDirectory,writePrivateFile,openPrivateFile} from './environment.mjs';
assert.ok(process.argv.includes('--verified'));assert.equal(targetId,'loop-control-stage-b-verified');assertContainer(targetContainer,targetId);
const c=targetConfiguration(),root=join(c.mediaRoot,'smoke'),dir=join(c.stateRoot,'t08');ensurePrivateDirectory(dir);
const stamp=Date.now(),mode=process.argv.includes('--shutdown')?'shutdown':process.argv.includes('--controlled')?'controlled':'http';
await stopTargetConsole();
const prepared=execFileSync(process.execPath,['scripts/prepare-runtime.mjs'],{env:cleanEnvironment(c),encoding:'utf8'});
writePrivateFile(join(dir,`prepare-${mode}-${stamp}.txt`),prepared);
const manifest=JSON.parse(readFileSync(join(projectRoot,'dist/runtime-manifest.json')));
const buildSnapshot=()=>Object.fromEntries(['dist/runtime-manifest.json',...Object.keys(manifest.outputs)].map(p=>[p,{sha256:digest(readFileSync(join(projectRoot,p))),mtime:statSync(join(projectRoot,p)).mtimeMs}]));
const buildBefore=buildSnapshot();
const {startWorkerScheduler}=await import('../../dist/orchestration/orchestration/workerScheduler.js');
const admin=createClient(c.apiUrl,c.serviceRoleKey,{auth:{persistSession:false}});
const unwrap=async p=>{const{data,error}=await p;if(error)throw Error(`T08 DB ${error.code}: ${error.message}`);return data;};
const episodes=[],tasks=[],evidence=[];
const old=sql("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from tasks t",targetContainer);
const guard=spawn('docker',['exec','-i',targetContainer,'psql','-XqAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe']});
const lines=createInterface({input:guard.stdout});const locked=new Promise((resolve,reject)=>{lines.on('line',l=>{if(l==='protected')resolve();});guard.once('exit',()=>reject(Error('Guard exited')));});
guard.stdin.write("begin;select id from tasks for update;select 'protected';\n");await locked;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async(predicate,label)=>{for(let i=0;i<400;i++){if(await predicate())return;await delay(25);}throw Error(`T08 timeout: ${label}`);};
const row=id=>unwrap(admin.from('tasks').select('*').eq('id',id).single());
async function episode(label){const id=randomUUID();await unwrap(admin.from('episodes').insert({id,account_id:'a0000000-0000-4000-8000-000000000001',blueprint_version_id:'a0000000-0000-4000-8000-000000000002',title:`T08 ${label}`,is_test:true}));episodes.push(id);return id;}
async function task(ep,media=false){
 const id=randomUUID();let input={capability:'brief_drafting',executor:{provider:'google_tts',adapter:'google_tts'}};
 if(media){
  ensurePrivateDirectory(join(root,'episodes',ep));const source=`episodes/${ep}/source.mp4`,bytes=readFileSync(join(root,'episodes/13029a1c-8dff-49eb-a2d4-e04e36126f6d/source-0.mp4'));
  writePrivateFile(join(root,source),bytes,{exclusive:true});
  input={capability:'shot_clip_preparation',executor:{provider:'ffmpeg',adapter:'ffmpeg_trim_video',model:'ffmpeg',prompt_version:'shot-clip-v1'},allowed_tools:['read','write'],media:{adapter:'ffmpeg_trim_video',video_clip:{source_relative_path:source,start_seconds:0,end_seconds:2,target_duration_seconds:2}},output:{required_artifact_types:['a_roll_video'],content_type:'video/mp4',relative_path:`episodes/${ep}/result.mp4`,review_stage:'production_ready'},input_artifacts:[{artifactType:'source_video',relativePath:source,sha256:digest(bytes),fileSize:bytes.length}]};
 }
 await unwrap(admin.from('tasks').insert({id,episode_id:ep,task_type:media?'generate_a_roll':'draft_brief',status:'ready',provider:media?'ffmpeg':'google_tts',model:media?'ffmpeg':'controlled',prompt_version:media?'shot-clip-v1':'t08',max_attempts:2,budget_limit_cents:0,input_snapshot:input}));tasks.push(id);return id;
}
function latency(id){return JSON.parse(sql(`select jsonb_build_object('task',id,'readyAt',created_at,'claimedAt',claimed_at,'readyToClaimMs',extract(epoch from claimed_at-created_at)*1000,'attempt',attempt) from tasks where id=${quote(id)}`,targetContainer));}
async function finish(t){
 const relativePath=`episodes/${t.episode_id}/t08-${t.task_id}.txt`,bytes=Buffer.from('T08 controlled executor, actual DB result transaction\n');ensurePrivateDirectory(join(root,'episodes',t.episode_id));writePrivateFile(join(root,relativePath),bytes,{exclusive:true});
 await unwrap(admin.rpc('report_worker_result',{p_task_id:t.task_id,p_attempt:t.attempt,p_lease_token:t.lease_token,p_result:{version:'worker-result/v1',taskId:t.task_id,status:'completed',artifacts:[{artifactType:'brief',relativePath,sha256:digest(bytes),fileSize:bytes.length}],validation:{passed:true,checks:[]},actualCostCents:0,blockers:[],retry:{shouldRetry:false,reason:'Controlled successful execution'},nextStep:'Await Owner'}}));
 return{status:'completed',taskId:t.task_id};
}
try{
 if(mode==='controlled'){
  const gates=new Map(),started=[];let active=0,peak=0,prepares=0;
  const scheduler=await startWorkerScheduler({projectRoot,supabaseUrl:c.apiUrl,serviceRoleKey:c.serviceRoleKey,environment:cleanEnvironment(c),concurrency:2},{prepare:async()=>{prepares++;},execute:async t=>{active++;peak=Math.max(peak,active);started.push(t.task_id);try{if(gates.has(t.task_id))await gates.get(t.task_id).promise;return await finish(t);}finally{active--;}}});
  const hold=id=>{let release;const promise=new Promise(resolve=>{release=resolve;});gates.set(id,{promise,release});};
  try{
   const a=await task(await episode('long controlled'));hold(a);scheduler.wake({taskId:a});await wait(()=>started.includes(a),'immediate long start');
   await wait(()=>!scheduler.status().scanning&&!scheduler.status().planning,'previous work fully settled');
   const beforeFallback=scheduler.status();const b=await task(await episode('no wake, long still executing'));await wait(()=>started.includes(b),'fallback during long execution');
   const fallback=latency(b);assert.ok(fallback.readyToClaimMs<=5000,JSON.stringify(fallback));assert.ok(active>=1);evidence.push({name:'five-second fallback with long executor active; no wake or browser',passed:true,beforeFallback,afterFallback:scheduler.status(),...fallback});
   const d=await task(await episode('duplicate wakes'));for(let i=0;i<20;i++)scheduler.wake({taskId:d});await wait(()=>started.includes(d),'duplicate wake');const immediate=latency(d);assert.ok(immediate.readyToClaimMs<=5000);evidence.push({name:'immediate wake coalescing',passed:true,...immediate});
   await wait(async()=>(await row(d)).status==='completed','short completed');
   const e=await task(await episode('second held'));hold(e);scheduler.wake({taskId:e});await wait(()=>started.includes(e),'second held');
   const full=await task(await episode('full queue'));scheduler.wake({taskId:full});await delay(200);assert.equal((await row(full)).status,'ready');assert.equal((await row(full)).attempt,0);
   gates.get(e).release();await wait(()=>started.includes(full),'completion refill');evidence.push({name:'saturated sample excluded from free-slot SLA, completion refills',passed:true,wasReadyAtCapacity:true,...latency(full)});
   gates.get(a).release();await wait(async()=>(await row(a)).status==='completed','long completed');
   assert.equal(new Set(started).size,started.length);assert.equal(peak,2);assert.equal(prepares,1);
   evidence.push({name:'real DB controlled execution',passed:true,peak,prepares,started});
  }finally{for(const gate of gates.values())gate.release();await scheduler.stop();}
  const scans=scheduler.status().scans;await delay(200);assert.equal(scheduler.status().scans,scans);evidence.push({name:'stop clears timer and scan activity',passed:true,status:scheduler.status()});
  const abnormal=await startWorkerScheduler({projectRoot,supabaseUrl:'http://127.0.0.1:1',serviceRoleKey:'controlled-invalid',concurrency:2},{prepare:async()=>undefined,execute:async()=>assert.fail('unreachable DB cannot start executor')});
  await wait(()=>Boolean(abnormal.status().lastError),'unavailable DB error');evidence.push({name:'unavailable DB excluded from healthy SLA',passed:true,status:abnormal.status()});await abnormal.stop();
 }else if(mode==='shutdown'){
  const bin=join(dir,`shutdown-bin-${stamp}`),pidPath=join(dir,`shutdown-process-${stamp}.json`);ensurePrivateDirectory(bin);
  const realFfmpeg=execFileSync('/usr/bin/which',['ffmpeg'],{env:cleanEnvironment(c),encoding:'utf8'}).trim();
  const wrapper=join(bin,'ffmpeg');
  writePrivateFile(wrapper,`#!${process.execPath}\nimport {spawn} from 'node:child_process';import fs from 'node:fs';const args=process.argv.slice(2);const run=()=>spawn(${JSON.stringify(realFfmpeg)},args,{stdio:'inherit'}).once('exit',c=>process.exit(c??1));if(args.includes('-version'))run();else{fs.writeFileSync(${JSON.stringify(pidPath)},JSON.stringify({pid:process.pid,parent:process.ppid}),{mode:0o600});setTimeout(run,30000);}`);chmodSync(wrapper,0o700);
  const log=openPrivateFile(join(c.logsRoot,'console.log'),{append:true});
  const service=spawn(process.execPath,[join(projectRoot,'node_modules/vite/bin/vite.js'),'--config',join(projectRoot,'scripts/isolation/restore-vite.config.mjs'),'--host','127.0.0.1','--port',String(c.ports.console),'--strictPort'],{cwd:projectRoot,env:{...cleanEnvironment(c),PATH:bin+':'+cleanEnvironment(c).PATH,LOOP_STAGE_B_WORKER:'1'},detached:true,stdio:['ignore',log,log]});await once(service,'spawn');closeSync(log);service.unref();
  writePrivateFile(join(c.stateRoot,'console.json'),JSON.stringify({pid:service.pid,port:c.ports.console,projectRoot,workerEnabled:true})+'\n',{exclusive:true});
  await wait(async()=>{try{return(await fetch(`http://127.0.0.1:${c.ports.console}/loop-control-health.txt`)).ok;}catch{return false;}},'custom verified console ready');
  const ep=await episode('interrupted actual Worker with controlled slow local FFmpeg'),id=await task(ep,true);await wait(()=>existsSync(pidPath),'actual Worker child started');
  const processes=JSON.parse(readFileSync(pidPath));const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};assert.ok(alive(processes.pid)&&alive(processes.parent));
  const stoppedAt=Date.now();await stopTargetConsole();await wait(()=>!alive(processes.pid)&&!alive(processes.parent),'Worker and descendant exited');
  const interrupted=await row(id);assert.equal(interrupted.status,'ready');assert.equal(interrupted.attempt,1);assert.equal(interrupted.lease_token,null);
  evidence.push({name:'actual service shutdown terminates its leased Worker and controlled slow FFmpeg descendant; fenced retry released',passed:true,processes,stopMs:Date.now()-stoppedAt,status:interrupted.status,attempt:interrupted.attempt,availableAt:interrupted.available_at});
  if(!process.argv.includes('--worker'))process.argv.push('--worker');await startTargetConsole();
  await wait(async()=>{const r=await row(id);assert.ok(!['failed','blocked'].includes(r.status),JSON.stringify(r.last_result));return r.status==='completed';},'restart completes interrupted task');
  const runs=await unwrap(admin.from('task_runs').select('attempt,status').eq('task_id',id).order('attempt'));assert.deepEqual(runs.map(r=>r.status),['failed','completed']);
  const [artifact]=await unwrap(admin.from('artifacts').select('relative_path,sha256,file_size').eq('producer_task_id',id));assert.equal(digest(readFileSync(join(root,artifact.relative_path))),artifact.sha256);
  evidence.push({name:'restart uses original FFmpeg, durable retry completes once after interrupted attempt',passed:true,runs,artifact,healthyFiveSecondSample:false});
 }else{
  const ownerClient=createClient(c.apiUrl,c.anonKey,{auth:{persistSession:false}}),sourceOwner=JSON.parse(readFileSync(join(config.stateRoot,'owner.json'))),owner=JSON.parse(readFileSync(join(c.stateRoot,`owner-${sourceOwner.id}.json`)));
  const login=await unwrap(ownerClient.auth.signInWithPassword(owner)),headers={authorization:`Bearer ${login.session.access_token}`,origin:`http://127.0.0.1:${c.ports.console}`};
  if(!process.argv.includes('--worker'))process.argv.push('--worker');await startTargetConsole();
  const path=(ep,id)=>`http://127.0.0.1:${c.ports.console}/_episode-dispatch?episode=${ep}&task=${id}`;
  for(const kind of ['immediate','no-browser-no-wake','restart-ready']){
   if(kind==='restart-ready')await stopTargetConsole();
   const ep=await episode(kind),id=await task(ep,true);
   if(kind==='immediate'){
    const responses=await Promise.all(Array.from({length:5},()=>fetch(path(ep,id),{method:'POST',headers})));for(const r of responses)assert.equal(r.status,202);
   }
   if(kind==='restart-ready')await startTargetConsole();
   await wait(async()=>{const r=await row(id);assert.ok(!['failed','blocked'].includes(r.status),JSON.stringify(r.last_result));return r.status==='completed';},kind);
   const timing=latency(id);assert.ok(timing.readyToClaimMs<=5000,JSON.stringify(timing));
   const runs=await unwrap(admin.from('task_runs').select('attempt,status').eq('task_id',id));assert.equal(runs.length,1);assert.equal(runs[0].attempt,0);
   const [artifact]=await unwrap(admin.from('artifacts').select('relative_path,sha256,file_size').eq('producer_task_id',id));const bytes=readFileSync(join(root,artifact.relative_path));assert.equal(digest(bytes),artifact.sha256);assert.equal(bytes.length,artifact.file_size);
   const status=await fetch(path(ep,id),{headers});assert.equal((await status.json()).status,'succeeded');evidence.push({name:kind,passed:true,...timing,runs,artifact});
  }
  await stopTargetConsole();await startTargetConsole();const r=await fetch(path(episodes[0],tasks[0]),{headers});assert.equal((await r.json()).status,'succeeded');evidence.push({name:'restart GET preserves persistent completed state',passed:true});
 }
 assert.deepEqual(buildSnapshot(),buildBefore,'Hot path or warm restart recompiled runtime artifacts');
 const result={target:targetId,mode,noHotCompilation:true,boundary:mode==='http'?'ordinary HTTP + resident service + actual Worker/FFmpeg + real DB':mode==='shutdown'?'real service/Worker/process shutdown with controlled slow FFmpeg wrapper; restart uses actual FFmpeg':'real DB queue/result + controlled executor; not online generation',evidence,episodes,tasks,production:false,providerCalls:false,priorDefaultFiveSecondFailureRetained:true,priorRootCauseFixed:false};writePrivateFile(join(dir,`${mode}-${stamp}.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{
 await stopTargetConsole();const done=once(guard,'exit');guard.stdin.end('rollback;\n');await done;
 assert.equal(sql(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from tasks t where episode_id not in (${episodes.map(quote).join(',')||'null'})`,targetContainer),old,'Pre-test task rows changed');
}
