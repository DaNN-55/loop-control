// T07 behavior checks run only against the final verified compatibility target.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { sql, quote, assertContainer, env } from './backup.mjs';
import { targetConfiguration, targetContainer, targetId } from './restore.mjs';
import { projectRoot, ensurePrivateDirectory, writePrivateFile } from './environment.mjs';
assert.ok(process.argv.includes('--verified'), 'T07 requires --verified');
assert.equal(targetId, 'loop-control-stage-b-verified');
assertContainer(targetContainer, targetId);
const c = targetConfiguration(), dir = join(c.stateRoot, 't07'); ensurePrivateDirectory(dir);
if (process.argv.includes('--apply')) {
 const version='20261023133427',name='worker_global_capacity_and_fair_consumption';
 const source=readFileSync(join(projectRoot,'supabase/migrations',`${version}_${name}.sql`),'utf8');
 const existing=JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(m)),'[]') from supabase_migrations.schema_migrations m where version=${quote(version)}`,targetContainer));
 if(existing.length){assert.equal(existing[0].statements[0],source,'Recorded migration differs; do not rewrite history');}
 else {
  assert.equal(sql("select count(*) from supabase_migrations.schema_migrations where version='20261023103336'",targetContainer),'1','T05 is required');
  sql(`begin;${source}insert into supabase_migrations.schema_migrations(version,name,statements) values(${quote(version)},${quote(name)},array[${quote(source)}]);commit;`,targetContainer);
 }
 const result={target:targetId,version,recorded:true,alreadyApplied:existing.length>0,migrations:Number(sql('select count(*) from supabase_migrations.schema_migrations',targetContainer))};
 writePrivateFile(join(dir,'migration.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));process.exit(0);
}
function controlledSql(source) {
 try {return execFileSync('docker',['exec','-i',targetContainer,'psql','-XqAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{env,input:source,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();}
 catch(error){writePrivateFile(join(dir,`sql-error-${Date.now()}.txt`),error.stderr??String(error));throw Error('Controlled fixture SQL failed; private diagnostic retained');}
}
const ids = Array.from({ length: 3 }, () => randomUUID());
const providers=['google_tts','pexels','volcengine_tts'];
const values = ids.map((id,i) => `(${quote(id)},'a0000000-0000-4000-8000-000000000003','draft_brief',${quote(providers[i])},'t07-controlled','t07-v1',0,2,'ready',${quote(JSON.stringify({ capability: 'brief_drafting', executor: { provider: providers[i], adapter: ['google_tts','pexels_video','volcengine_tts'][i] } }))}::jsonb)`).join(',');
let baselineClaim='';
if(process.argv.includes('--baseline-red')){
 const original=execFileSync('git',['show','8da46ed:supabase/migrations/20261023103336_worker_lease_recovery_and_fencing.sql'],{encoding:'utf8'});
 baselineClaim=original.slice(original.indexOf('CREATE OR REPLACE FUNCTION public.claim_next_worker_task_pre_lease'),original.indexOf('drop function public.claim_next_worker_task(uuid,integer);'));
}
const raw = controlledSql(`begin;${baselineClaim}
 set local request.jwt.claims='{"role":"service_role"}';
 insert into tasks(id,episode_id,task_type,provider,model,prompt_version,budget_limit_cents,max_attempts,status,input_snapshot) values ${values};
 select count(*) from claim_next_worker_task(${quote(ids[0])},2);
 select count(*) from claim_next_worker_task(${quote(ids[1])},2);
 select count(*) from claim_next_worker_task(${quote(ids[2])},2);
 rollback;`);
writePrivateFile(join(dir, `capacity-${process.argv.includes('--baseline-red')?'baseline-replay-red':process.argv.includes('--red')?'red':'green'}-${Date.now()}.txt`), raw+'\n');
const observed = raw.split('\n').map(Number);
console.log(JSON.stringify({ target: targetId, boundary: 'real DB claim RPC; transaction rolled back', expected: [1,1,0], observed }));
assert.deepEqual(observed, [1,1,0], 'Global capacity 2 must limit distinct resource groups');

if (process.argv.includes('--extended')) {
  const outcomes = [];
  const episodes = Array.from({ length: 3 }, () => randomUUID());
  const fixtures = episodes.map(id => `(${quote(id)},'a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002','T07 controlled fairness',true)`).join(',');
  const taskValues = (id, ep, index, provider = 'codex', adapter = `t07-${id}`, credential = '') => `(${quote(id)},${quote(ep)},'draft_brief',${quote(provider)},'t07-controlled','t07-v1',0,2,'ready',clock_timestamp()+interval '${index} seconds',${quote(JSON.stringify({ capability:'brief_drafting', executor:{provider,adapter}, credential_ref:credential }))}::jsonb)`;
  const setup = `begin;set local request.jwt.claims='{"role":"service_role"}';
   set local session_replication_role=replica;update tasks set status='blocked' where status in ('ready','running');set local session_replication_role=origin;
   insert into episodes(id,account_id,blueprint_version_id,title,is_test) values ${fixtures};`;
  function check(name, statements, expected) {
    const result=controlledSql(setup+statements+'rollback;');
    const observed = JSON.parse(result);
    try { assert.deepEqual(observed, expected); outcomes.push({name,passed:true,observed}); }
    catch { outcomes.push({name,passed:false,expected,observed}); }
  }
  const fairnessIds = Array.from({length:5},()=>randomUUID());
  const episodeOrder=[episodes[0],episodes[0],episodes[0],episodes[1],episodes[2]];
  check('Episode rotation uses durable turns rather than task creation order', `
   insert into tasks(id,episode_id,task_type,provider,model,prompt_version,budget_limit_cents,max_attempts,status,created_at,input_snapshot) values ${fairnessIds.map((id,i)=>taskValues(id,episodeOrder[i],i)).join(',')};
   create function pg_temp.consume() returns jsonb language plpgsql as $$ declare r record; turns jsonb:='[]'; begin
    for i in 1..5 loop select * into r from claim_next_worker_task(null,1); turns:=turns||jsonb_build_array(r.episode_id);
     perform report_worker_result(r.task_id,r.attempt,jsonb_build_object('version','worker-result/v1','taskId',r.task_id,'status','failed','artifacts','[]'::jsonb,'validation',jsonb_build_object('passed',false,'checks','[]'::jsonb),'actualCostCents',0,'blockers','[]'::jsonb,'retry',jsonb_build_object('shouldRetry',false,'reason','Controlled terminal failure'),'nextStep','Controlled release'),r.lease_token);
    end loop;return turns;end $$;select pg_temp.consume();`, [episodes[0],episodes[1],episodes[2],episodes[0],episodes[0]]);
  const groups=Array.from({length:3},()=>randomUUID());
  check('Provider and Adapter limits span distinct credential references', `
   update worker_scheduler_settings set capacity=4;
   insert into tasks(id,episode_id,task_type,provider,model,prompt_version,budget_limit_cents,max_attempts,status,created_at,input_snapshot) values ${groups.map((id,i)=>taskValues(id,episodes[i],i,'google_tts','google_tts',randomUUID())).join(',')};
   select jsonb_build_array((select count(*) from claim_next_worker_task(${quote(groups[0])},4)),(select count(*) from claim_next_worker_task(${quote(groups[1])},4)),(select count(*) from claim_next_worker_task(${quote(groups[2])},4)));`, [1,1,0]);
  const connection=randomUUID(),sameConnection=Array.from({length:2},()=>randomUUID());
  check('Trusted connection ceiling one lowers Provider and Adapter ceiling two', `
   insert into worker_resource_ceilings(resource_key,capacity) values('connection:${connection}',1);
   insert into tasks(id,episode_id,task_type,provider,model,prompt_version,budget_limit_cents,max_attempts,status,created_at,input_snapshot) values ${sameConnection.map((id,i)=>taskValues(id,episodes[i],i,'google_tts','google_tts',connection)).join(',')};
   select jsonb_build_array((select count(*) from claim_next_worker_task(${quote(sameConnection[0])},2)),(select count(*) from claim_next_worker_task(${quote(sameConnection[1])},2)));`, [1,0]);
  const cpu=Array.from({length:2},()=>randomUUID());
  check('CPU ceiling is shared across distinct local media Providers', `
   insert into tasks(id,episode_id,task_type,provider,model,prompt_version,budget_limit_cents,max_attempts,status,created_at,input_snapshot) values ${cpu.map((id,i)=>taskValues(id,episodes[i],i,i?'whisperx':'ffmpeg',i?'whisperx':'ffmpeg_trim_video')).join(',')};
   select jsonb_build_array((select count(*) from claim_next_worker_task(${quote(cpu[0])},2)),(select count(*) from claim_next_worker_task(${quote(cpu[1])},2)));`, [1,0]);
  const download=Array.from({length:2},()=>randomUUID());
  check('Trusted download ceiling spans distinct network Providers', `
   insert into worker_resource_ceilings(resource_key,capacity) values('host:download',1);
   insert into tasks(id,episode_id,task_type,provider,model,prompt_version,budget_limit_cents,max_attempts,status,created_at,input_snapshot) values ${download.map((id,i)=>taskValues(id,episodes[i],i,i?'freesound':'pexels',i?'freesound_preview':'pexels_video')).join(',')};
   select jsonb_build_array((select count(*) from claim_next_worker_task(${quote(download[0])},2)),(select count(*) from claim_next_worker_task(${quote(download[1])},2)));`, [1,0]);
  const retryId=randomUUID();
  check('Failed retry releases capacity but cannot be reclaimed in a hot loop', `
   insert into tasks(id,episode_id,task_type,provider,model,prompt_version,budget_limit_cents,max_attempts,status,created_at,input_snapshot) values ${taskValues(retryId,episodes[0],0)};
   create function pg_temp.retry_one() returns jsonb language plpgsql as $$ declare r record; begin
    select * into r from claim_next_worker_task(${quote(retryId)},1);
    perform report_worker_result(r.task_id,r.attempt,jsonb_build_object('version','worker-result/v1','taskId',r.task_id,'status','failed','artifacts','[]'::jsonb,'validation',jsonb_build_object('passed',false,'checks','[]'::jsonb),'actualCostCents',0,'blockers','[]'::jsonb,'retry',jsonb_build_object('shouldRetry',true,'reason','Controlled retry'),'nextStep','Controlled retry'),r.lease_token);
    return jsonb_build_array((select status::text from tasks where id=r.task_id),(select count(*) from claim_next_worker_task(r.task_id,1)));
   end $$;select pg_temp.retry_one();`, ['ready',0]);
  writePrivateFile(join(dir, `extended-${process.argv.includes('--red')?'red':'green'}-${Date.now()}.json`), JSON.stringify(outcomes,null,2)+'\n');
  console.log(JSON.stringify(outcomes,null,2));assert.ok(outcomes.every(o=>o.passed),'T07 extended behavior checks');
}

if (process.argv.includes('--configuration-race')) {
 const client=createClient(c.apiUrl,c.serviceRoleKey,{auth:{persistSession:false}}),resource=`connection:${randomUUID()}`;
 const gate=spawn('docker',['exec','-i',targetContainer,'psql','-XqAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe']});
 const lines=createInterface({input:gate.stdout});const locked=new Promise(resolve=>lines.on('line',line=>{if(line==='locked')resolve();}));
 gate.stdin.write("begin;select pg_advisory_xact_lock(hashtextextended('loop-worker-global-capacity',0));select 'locked';\n");await locked;
 let observed=false;const write=client.from('worker_resource_ceilings').insert({resource_key:resource,capacity:1}).then(r=>{if(r.error)throw Error(r.error.message);});
 try {
  for(let i=0;i<50;i++){
   if(Number(sql("select count(*) from pg_stat_activity where wait_event='advisory' and query like '%worker_resource_ceilings%'",targetContainer))>0){observed=true;break;}
   await new Promise(r=>setTimeout(r,20));
  }
  assert.ok(observed,'A trusted config write must really wait behind a claim global lock');
 } finally {const done=once(gate,'exit');gate.stdin.end('rollback;\n');await done;}
 await write;const{error}=await client.from('worker_resource_ceilings').delete().eq('resource_key',resource);assert.ifError(error);
 const result={target:targetId,configurationAndClaimSerialized:true,realAdvisoryWaitObserved:observed};writePrivateFile(join(dir,`configuration-race-${Date.now()}.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
