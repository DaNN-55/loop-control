import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {createClient} from '@supabase/supabase-js';
import {targetConfiguration,targetContainer,targetId,stopTargetConsole,startTargetConsole} from './restore.mjs';
import {config,sql,quote,env,assertContainer,digest} from './backup.mjs';
import {ensurePrivateDirectory,writePrivateFile} from './environment.mjs';
assert.ok(process.argv.includes('--verified'));assert.equal(targetId,'loop-control-stage-b-verified');assertContainer(targetContainer,targetId);
const c=targetConfiguration(),root=join(c.mediaRoot,'smoke'),dir=join(c.stateRoot,'t07');ensurePrivateDirectory(dir);
const admin=createClient(c.apiUrl,c.serviceRoleKey,{auth:{persistSession:false}}),ownerClient=createClient(c.apiUrl,c.anonKey,{auth:{persistSession:false}});
const unwrap=async p=>{const{data,error}=await p;if(error)throw Error(`T07 HTTP DB ${error.code} ${error.message}`);return data;};
const sourceOwner=JSON.parse(readFileSync(join(config.stateRoot,'owner.json'))),owner=JSON.parse(readFileSync(join(c.stateRoot,`owner-${sourceOwner.id}.json`)));
const login=await unwrap(ownerClient.auth.signInWithPassword(owner)),headers={authorization:`Bearer ${login.session.access_token}`,origin:`http://127.0.0.1:${c.ports.console}`};
const old=sql("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from tasks t",targetContainer),episodes=[],tasks=[];
const child=spawn('docker',['exec','-i',targetContainer,'psql','-XqAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe']});
const lines=createInterface({input:child.stdout});const protectedRows=new Promise((resolve,reject)=>{lines.on('line',l=>{if(l==='protected')resolve();});child.once('exit',()=>reject(Error('Guard exited')));});child.stdin.write("begin;select id from tasks for update;select 'protected';\n");await protectedRows;
const path=(id,ep)=>`http://127.0.0.1:${c.ports.console}/_episode-dispatch?episode=${ep}&task=${id}`;
const get=async(id,ep)=>{const r=await fetch(path(id,ep),{headers});assert.equal(r.status,200);return r.json();};
const post=(id,ep)=>fetch(path(id,ep),{method:'POST',headers});
try {
 await stopTargetConsole();if(!process.argv.includes('--worker'))process.argv.push('--worker');await startTargetConsole();
 const bytes=readFileSync(join(root,'episodes/13029a1c-8dff-49eb-a2d4-e04e36126f6d/source-0.mp4'));
 for(let i=0;i<3;i++) {
  const ep=randomUUID(),id=randomUUID();episodes.push(ep);tasks.push(id);ensurePrivateDirectory(join(root,'episodes',ep));
  const source=`episodes/${ep}/source.mp4`;writePrivateFile(join(root,source),bytes,{exclusive:true});
  await unwrap(admin.from('episodes').insert({id:ep,account_id:'a0000000-0000-4000-8000-000000000001',blueprint_version_id:'a0000000-0000-4000-8000-000000000002',title:`T07 ordinary HTTP FFmpeg ${i+1}`,is_test:true}));
  await unwrap(admin.from('tasks').insert({id,episode_id:ep,task_type:'generate_a_roll',status:'ready',provider:'ffmpeg',model:'ffmpeg',prompt_version:'shot-clip-v1',max_attempts:2,budget_limit_cents:0,input_snapshot:{capability:'shot_clip_preparation',executor:{provider:'ffmpeg',adapter:'ffmpeg_trim_video',model:'ffmpeg',prompt_version:'shot-clip-v1'},allowed_tools:['read','write'],media:{adapter:'ffmpeg_trim_video',video_clip:{source_relative_path:source,start_seconds:0,end_seconds:2,target_duration_seconds:2}},output:{required_artifact_types:['a_roll_video'],content_type:'video/mp4',relative_path:`episodes/${ep}/result.mp4`,review_stage:'production_ready'},input_artifacts:[{artifactType:'source_video',relativePath:source,sha256:digest(bytes),fileSize:bytes.length}]}}));
 }
 const posts=await Promise.all(Array.from({length:5},()=>post(tasks[0],episodes[0])));const replies=[];
 for(const r of posts){assert.equal(r.status,202);replies.push(await r.json());}
 const states=[];
 for(let i=0;i<600;i++) {
  const rows=await unwrap(admin.from('tasks').select('id,status,attempt,last_result,lease_token').in('id',tasks));states.push({at:new Date().toISOString(),tasks:rows.map(({id,status,attempt})=>({id,status,attempt}))});
  for(const r of rows)assert.ok(!['blocked','failed'].includes(r.status),JSON.stringify(r.last_result));
  if(rows.every(r=>r.status==='completed'))break;
  await new Promise(r=>setTimeout(r,100));
 }
 const rows=await unwrap(admin.from('tasks').select('id,status,attempt,lease_token').in('id',tasks));assert.ok(rows.every(r=>r.status==='completed'&&r.attempt===1&&r.lease_token===null));
 const runs=await unwrap(admin.from('task_runs').select('task_id,attempt,status').in('task_id',tasks));assert.equal(runs.length,3);assert.ok(runs.every(r=>r.attempt===0&&r.status==='completed'));
 const artifacts=await unwrap(admin.from('artifacts').select('producer_task_id,relative_path,sha256,file_size').in('producer_task_id',tasks));assert.equal(artifacts.length,3);
 for(const a of artifacts){const actual=readFileSync(join(root,a.relative_path));assert.equal(digest(actual),a.sha256);assert.equal(actual.length,a.file_size);}
 const repeat=await post(tasks[0],episodes[0]);assert.equal(repeat.status,200);assert.equal((await repeat.json()).status,'succeeded');
 await stopTargetConsole();await startTargetConsole();assert.equal((await get(tasks[0],episodes[0])).status,'succeeded');
 const result={at:new Date().toISOString(),target:targetId,boundary:'ordinary HTTP middleware -> DB reservation -> stdin leased package -> real Worker CLI -> actual FFmpeg -> fenced result',episodes,tasks,replies,states,runs,artifacts,repeatCompletedPost:200,serviceRestartStatusPersisted:true,oldTasksUnchanged:true,providerCalls:false};
 writePrivateFile(join(dir,`http-${Date.now()}.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{const done=once(child,'exit');child.stdin.end('rollback;\n');await done;assert.equal(sql(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from tasks t where episode_id not in (${episodes.map(quote).join(',')||'null'})`,targetContainer),old);}
