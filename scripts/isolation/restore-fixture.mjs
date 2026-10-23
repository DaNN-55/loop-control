// Synthetic checkpoint fixture, not an Owner approval-chain test.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { config, sql, quote } from './backup.mjs';
import { writePrivateFile } from './environment.mjs';
const owner=JSON.parse(readFileSync(join(config.stateRoot,'owner.json')));
const client=createClient(config.apiUrl,config.anonKey,{auth:{persistSession:false}});
const {error:loginError}=await client.auth.signInWithPassword(owner);if(loginError)throw new Error('合成 Owner 登录失败');
const secret=randomBytes(24).toString('hex');
const {data:connection,error}=await client.rpc('create_external_connection',{p_provider:'pexels',p_adapter:'pexels_video',p_name:`Stage B restore ${randomUUID()}`,p_secret:secret});
if(error)throw new Error('合成连接创建失败');
const {error:verificationError}=await createClient(config.apiUrl,config.serviceRoleKey,{auth:{persistSession:false}}).rpc('record_external_connection_verification',{p_connection_id:connection.current_version_id,p_status:'verified',p_detail:'Synthetic fixture: no external provider called.'});if(verificationError)throw new Error('合成连接记录失败');
const episode=randomUUID(),task=randomUUID(),run=randomUUID(),artifact=randomUUID(),review=randomUUID();
// This fixture deliberately seeds a historical checkpoint through the agreed DB seam.
// It uses the existing real media artifact as an independent restore fingerprint.
const output=sql(`begin; set local session_replication_role=replica;
insert into episodes(id,account_id,blueprint_version_id,title,stage,is_test) values(${quote(episode)},'a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002','Stage B restore checkpoint','qc_review',true);
insert into tasks(id,episode_id,task_type,status,attempt,provider,model,prompt_version,input_snapshot) values(${quote(task)},${quote(episode)},'generate_review_render','completed',1,'openchatcut','synthetic-checkpoint','stage-b-v1',jsonb_build_object('capability','review_rendering','frozen_test_input','preserve exactly','credential_ref',${quote(connection.current_version_id)}));
insert into task_runs(id,task_id,attempt,status,task_package,result,actual_cost_cents,completed_at) values(${quote(run)},${quote(task)},0,'completed','{"frozen":"stage-b-checkpoint"}','{"status":"completed"}',0,now());
insert into artifacts(id,episode_id,artifact_type,relative_path,sha256,file_size,producer_task_id) select ${quote(artifact)},${quote(episode)},'review_render_video',relative_path,sha256,file_size,${quote(task)} from artifacts where artifact_type='a_roll_video' limit 1;
insert into review_packages(id,episode_id,task_id,task_run_id,artifact_id,stage,revision_number,context_snapshot) values(${quote(review)},${quote(episode)},${quote(task)},${quote(run)},${quote(artifact)},'qc_review',1,'{"frozen":"stage-b-review","input":"preserve exactly"}');
insert into approvals(episode_id,stage,decision,reason,actor_id,review_package_id) values(${quote(episode)},'qc_review','changes_requested','Stage B synthetic historical checkpoint',${quote(owner.id)},${quote(review)});
insert into state_transitions(episode_id,from_stage,to_stage,reason,actor_id) values(${quote(episode)},'render_ready','qc_review','Stage B synthetic checkpoint',${quote(owner.id)});
insert into audit_events(account_id,episode_id,event_type,payload,actor_id) values('a0000000-0000-4000-8000-000000000001',${quote(episode)},'stage_b_restore_fixture','{"synthetic":true}',${quote(owner.id)});
commit;select json_build_object('artifact',id,'sha256',sha256) from artifacts where id=${quote(artifact)};`);
writePrivateFile(join(config.stateRoot,'restore-fixture.json'),JSON.stringify({episode,task,run,artifact,review,connectionId:connection.id,versionId:connection.current_version_id,secret})+'\n');
console.log(JSON.stringify({episode,task,run,artifact,review,connectionId:connection.id,versionId:connection.current_version_id,note:'synthetic checkpoint, real DB and existing media; no full approval chain claimed',output:JSON.parse(output)}));
