import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { config,sql,quote,digest,env } from './backup.mjs';
import { targetConfiguration,targetContainer,targetId } from './restore.mjs';
import { cleanEnvironment,writePrivateFile,ensurePrivateDirectory,projectRoot } from './environment.mjs';
const c=targetConfiguration(),admin=createClient(c.apiUrl,c.serviceRoleKey,{auth:{persistSession:false}}),client=createClient(c.apiUrl,c.anonKey,{auth:{persistSession:false}});
const sourceOwner=JSON.parse(readFileSync(join(config.stateRoot,'owner.json'))),owner=JSON.parse(readFileSync(join(c.stateRoot,`owner-${sourceOwner.id}.json`)));
const unwrap=async p=>{const {data,error}=await p;if(error)throw new Error(`worker recovery: ${error.code}`);return data;};
const login=await unwrap(client.auth.signInWithPassword(owner)),headers={authorization:`Bearer ${login.session.access_token}`,origin:`http://127.0.0.1:${c.ports.console}`};
const episode=randomUUID(),task=randomUUID(),assetRoot=join(c.mediaRoot,'smoke');ensurePrivateDirectory(join(assetRoot,'episodes',episode));
const bytes=readFileSync(join(assetRoot,'episodes/13029a1c-8dff-49eb-a2d4-e04e36126f6d/source-0.mp4')),source=`episodes/${episode}/source.mp4`;writePrivateFile(join(assetRoot,source),bytes,{exclusive:true});
const output=`episodes/${episode}/recovered.mp4`;
await unwrap(admin.from('episodes').insert({id:episode,account_id:'a0000000-0000-4000-8000-000000000001',blueprint_version_id:'a0000000-0000-4000-8000-000000000002',title:'Stage B interrupted Worker recovery',is_test:true}));
await unwrap(admin.from('tasks').insert({id:task,episode_id:episode,task_type:'generate_a_roll',status:'ready',provider:'ffmpeg',model:'ffmpeg',prompt_version:'shot-clip-v1',budget_limit_cents:0,max_attempts:2,input_snapshot:{capability:'shot_clip_preparation',executor:{provider:'ffmpeg',adapter:'ffmpeg_trim_video',model:'ffmpeg',prompt_version:'shot-clip-v1'},allowed_tools:['read','write'],media:{adapter:'ffmpeg_trim_video',video_clip:{source_relative_path:source,start_seconds:0,end_seconds:2,target_duration_seconds:2}},output:{required_artifact_types:['a_roll_video'],content_type:'video/mp4',relative_path:output,review_stage:'production_ready'},input_artifacts:[{artifactType:'source_video',relativePath:source,sha256:digest(bytes),fileSize:bytes.length}]}}));
const worker=spawn(process.execPath,[join(projectRoot,'dist/worker/worker/codexWorkerCli.js'),'--task-id',task],{env:cleanEnvironment(c),cwd:projectRoot,detached:true,stdio:['ignore','pipe','pipe']});
const closed=once(worker,'exit');let old;
try{
 for(let i=0;i<200;i++){const row=await unwrap(admin.from('tasks').select('*').eq('id',task).single());if(row.status==='running'){old=row;break;}if(worker.exitCode!==null)throw Error('Worker exited before interruption');await new Promise(r=>setTimeout(r,10));}
 assert.ok(old,'Worker must really claim before interruption');
 process.kill(-worker.pid,'SIGKILL');await closed;
 assert.equal((await unwrap(admin.from('tasks').select('*').eq('id',task).single())).status,'running');
}finally{if(worker.exitCode===null && worker.signalCode===null){try{process.kill(-worker.pid,'SIGKILL');}catch{}}}
sql(`update public.tasks set claimed_at=clock_timestamp()-interval '31 minutes' where id=${quote(task)};`,targetContainer);
const route=`http://127.0.0.1:${c.ports.console}/_episode-dispatch?episode=${episode}&task=${task}`;
assert.equal((await fetch(route)).status,400);
const submitted=await fetch(route,{method:'POST',headers});assert.equal(submitted.status,202,await submitted.clone().text());
let final;
for(let i=0;i<240;i++){final=await unwrap(admin.from('tasks').select('*').eq('id',task).single());if(['completed','failed','blocked'].includes(final.status))break;await new Promise(r=>setTimeout(r,50));}
assert.equal(final.status,'completed',JSON.stringify(final.last_result));assert.equal(final.attempt,2);assert.equal(final.lease_token,null);
const runs=await unwrap(admin.from('task_runs').select('*').eq('task_id',task).order('attempt'));assert.deepEqual(runs.map(r=>[r.attempt,r.status]),[[0,'failed'],[1,'completed']]);assert.notEqual(runs[0].lease_token,runs[1].lease_token);
const artifacts=await unwrap(admin.from('artifacts').select('*').eq('producer_task_id',task));assert.equal(artifacts.length,1);const file=join(assetRoot,artifacts[0].relative_path);assert.ok(existsSync(file));assert.equal(digest(readFileSync(file)),artifacts[0].sha256);
const late=await admin.rpc('report_worker_result',{p_task_id:task,p_attempt:0,p_lease_token:old.lease_token,p_result:final.last_result});assert.equal(late.error?.code,'42501');
const result={checkedAt:new Date().toISOString(),target:targetId,episodeId:episode,taskId:task,realWorkerKilledAfterClaim:true,expiry:'controlled DB clock fixture after SIGKILL; not a 30-minute wait',httpDispatchStatus:submitted.status,anonymousStatus:400,execution:'real prebuilt Worker CLI and FFmpeg',attempts:runs.map(r=>({attempt:r.attempt,status:r.status})),artifact:{relativePath:artifacts[0].relative_path,sha256:artifacts[0].sha256,fileSize:artifacts[0].file_size},lateKilledWorkerResultRejected:true};
writePrivateFile(join(c.stateRoot,'worker-recovery.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
