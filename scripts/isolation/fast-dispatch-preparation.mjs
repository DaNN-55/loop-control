// Fault injection touches only generated programs and a new disposable source.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,unlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {createClient} from '@supabase/supabase-js';
import {targetConfiguration,targetContainer,targetId,stopTargetConsole,startTargetConsole} from './restore.mjs';
import {config,sql,quote,env,assertContainer,digest} from './backup.mjs';
import {projectRoot,cleanEnvironment,ensurePrivateDirectory,writePrivateFile} from './environment.mjs';
assert.ok(process.argv.includes('--verified'));assert.equal(targetId,'loop-control-stage-b-verified');assertContainer(targetContainer,targetId);
const c=targetConfiguration(),dir=join(c.stateRoot,'t08'),root=join(c.mediaRoot,'smoke'),stamp=Date.now();ensurePrivateDirectory(dir);
const environment={...cleanEnvironment(c),LOOP_PROJECT_ROOT:projectRoot},generated=join(projectRoot,'dist/worker/worker/codexWorkerCli.js'),source=join(projectRoot,'src/orchestration/t08PreparationFixture.ts');
assert.ok(!existsSync(source),'Do not overwrite an existing file');
await stopTargetConsole();
const prepare=()=>{const output=execFileSync(process.execPath,['scripts/prepare-runtime.mjs'],{env:environment,encoding:'utf8'});writePrivateFile(join(dir,`preparation-build-${Date.now()}.txt`),output);};prepare();
const original=readFileSync(generated);writePrivateFile(join(dir,`original-worker-${stamp}.js`),original);
const old=sql("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from tasks t",targetContainer);
const guard=spawn('docker',['exec','-i',targetContainer,'psql','-XqAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe']});const lines=createInterface({input:guard.stdout});
const line=marker=>new Promise(resolve=>{const onLine=value=>{if(value===marker){lines.off('line',onLine);resolve();}};lines.on('line',onLine);});
const protectedOld=line('protected');guard.stdin.write("begin;select id from tasks for update;select 'protected';\n");await protectedOld;
const admin=createClient(c.apiUrl,c.serviceRoleKey,{auth:{persistSession:false}}),ownerClient=createClient(c.apiUrl,c.anonKey,{auth:{persistSession:false}});
const unwrap=async p=>{const{data,error}=await p;if(error)throw Error(`Preparation fixture ${error.code}: ${error.message}`);return data;};
const ep=randomUUID(),id=randomUUID(),evidence=[];
try{
 await unwrap(admin.from('episodes').insert({id:ep,account_id:'a0000000-0000-4000-8000-000000000001',blueprint_version_id:'a0000000-0000-4000-8000-000000000002',title:'T08 preparation failure guard',is_test:true}));
 const bytes=readFileSync(join(root,'episodes/13029a1c-8dff-49eb-a2d4-e04e36126f6d/source-0.mp4')),relative=`episodes/${ep}/source.mp4`;ensurePrivateDirectory(join(root,'episodes',ep));writePrivateFile(join(root,relative),bytes,{exclusive:true});
 await unwrap(admin.from('tasks').insert({id,episode_id:ep,task_type:'generate_a_roll',status:'ready',provider:'ffmpeg',model:'ffmpeg',prompt_version:'shot-clip-v1',max_attempts:2,budget_limit_cents:0,input_snapshot:{capability:'shot_clip_preparation',executor:{provider:'ffmpeg',adapter:'ffmpeg_trim_video'},media:{adapter:'ffmpeg_trim_video',video_clip:{source_relative_path:relative,start_seconds:0,end_seconds:2,target_duration_seconds:2}},output:{required_artifact_types:['a_roll_video'],content_type:'video/mp4',relative_path:`episodes/${ep}/result.mp4`,review_stage:'production_ready'},input_artifacts:[{artifactType:'source_video',relativePath:relative,sha256:digest(bytes),fileSize:bytes.length}]}}));
 const taskLocked=line('task-locked');guard.stdin.write(`savepoint fixture;select id from tasks where id=${quote(id)} for update;select 'task-locked';\n`);await taskLocked;
 if(!process.argv.includes('--worker'))process.argv.push('--worker');await startTargetConsole();
 const sourceOwner=JSON.parse(readFileSync(join(config.stateRoot,'owner.json'))),owner=JSON.parse(readFileSync(join(c.stateRoot,`owner-${sourceOwner.id}.json`))),login=await unwrap(ownerClient.auth.signInWithPassword(owner));
 const headers={authorization:`Bearer ${login.session.access_token}`,origin:`http://127.0.0.1:${c.ports.console}`},url=`http://127.0.0.1:${c.ports.console}/_episode-dispatch?episode=${ep}&task=${id}`;
 const episodeBefore=await unwrap(admin.from('episodes').select('*').eq('id',ep).single());
 for(const kind of ['missing','corrupt','source-changed']){
  if(kind==='missing')unlinkSync(generated);
  if(kind==='corrupt')writeFileSync(generated,Buffer.concat([original,Buffer.from('\n// Controlled T08 corruption\n')]));
  if(kind==='source-changed')writeFileSync(source,'export const t08PreparationFixture = true;\n',{flag:'wx'});
  for(const args of [['scripts/run-prepared.mjs','worker','--task-id',id],['scripts/run-prepared.mjs','orchestrator','dispatch'],['dist/orchestration/orchestration/loopOrchestratorCli.js','dispatch']]){
   let rejected=false;try{execFileSync(process.execPath,args,{env:environment,encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch(error){assert.match(String(error.stderr),/runtime:prepare/);rejected=true;writePrivateFile(join(dir,`rejected-${kind}-${args[0].includes('dist/')?'direct':args[1]}-${stamp}.txt`),String(error.stdout)+String(error.stderr));}assert.ok(rejected,'Unprepared program ran');
  }
  const response=await fetch(url,{method:'POST',headers}),body=await response.text();assert.equal(response.status,503);assert.match(body,/runtime:prepare/);
  const preflightResponse=await fetch(`http://127.0.0.1:${c.ports.console}/_worker-preflight?episode=${ep}`,{method:'POST',headers});assert.equal(preflightResponse.status,503);assert.match(await preflightResponse.text(),/runtime:prepare/);
  assert.deepEqual(await unwrap(admin.from('episodes').select('*').eq('id',ep).single()),episodeBefore,'Unprepared start changed Episode');
  const r=await unwrap(admin.from('tasks').select('status,attempt').eq('id',id).single());assert.deepEqual(r,{status:'ready',attempt:0});evidence.push({kind,workerAndOrchestratorCliRejected:true,directOrchestratorRejected:true,http:response.status,workerPreflightHttp:preflightResponse.status,episodeRowUnchanged:true,detail:body,task:r});
  if(kind!=='source-changed')writeFileSync(generated,original);
 }
 await stopTargetConsole();prepare();await startTargetConsole();
 const unlocked=line('unlocked');guard.stdin.write("rollback to savepoint fixture;select 'unlocked';\n");await unlocked;
 assert.equal((await fetch(url,{method:'POST',headers})).status,202);
 for(let i=0;i<300;i++){const r=await unwrap(admin.from('tasks').select('status,last_result').eq('id',id).single());assert.ok(!['failed','blocked'].includes(r.status),JSON.stringify(r.last_result));if(r.status==='completed')break;await new Promise(resolve=>setTimeout(resolve,25));}
 const completed=await unwrap(admin.from('tasks').select('status,attempt').eq('id',id).single());assert.deepEqual(completed,{status:'completed',attempt:1});evidence.push({kind:'explicit preparation and service restart restores real Worker completion',passed:true,task:completed});
 const result={target:targetId,episode:ep,task:id,evidence,production:false,providerCalls:false};writePrivateFile(join(dir,`preparation-${stamp}.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{
 await stopTargetConsole();writeFileSync(generated,original);if(existsSync(source))unlinkSync(source);prepare();
 const done=once(guard,'exit');guard.stdin.end('rollback;\n');await done;
 assert.equal(sql(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from tasks t where episode_id<>${quote(ep)}`,targetContainer),old);
}
