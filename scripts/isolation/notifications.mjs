// T09: verified-only real DB/RPC/HTTP exercise. Desktop transport is controlled,
// with actual child-process SIGKILL after a recorded acceptance; no Provider calls.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {createServer as createHttpServer} from 'node:http';
import {createServer as createViteServer} from 'vite';
import {createClient} from '@supabase/supabase-js';
import {targetConfiguration,targetContainer,targetId} from './restore.mjs';
import {sql,quote,assertContainer,env,createBackup,readBackup,digest} from './backup.mjs';
import {cleanEnvironment,projectRoot,ensurePrivateDirectory,writePrivateFile} from './environment.mjs';
assert.ok(process.argv.includes('--verified'));assert.equal(targetId,'loop-control-stage-b-verified');assertContainer(targetContainer,targetId);
const c=targetConfiguration(),directory=join(c.stateRoot,'t09',String(Date.now()));ensurePrivateDirectory(directory);
const runtimeEnv={...cleanEnvironment(c),LOOP_PROJECT_ROOT:projectRoot,LOOP_N8N_STATE_DIR:directory};
execFileSync(process.execPath,['scripts/prepare-runtime.mjs'],{env:runtimeEnv,stdio:['ignore','pipe','pipe']});
const cli=(mode,override={})=>{
 const child=execFileSync(process.execPath,['dist/orchestration/orchestration/loopOrchestratorCli.js',mode],{env:{...runtimeEnv,...override},encoding:'utf8',stdio:['ignore','pipe','pipe']});
 return JSON.parse(child.trim().split('\n').at(-1));
};
const beforeTasks=digest(sql("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.tasks t",targetContainer));
let initial;try{initial=cli('notify');}catch(error){assert.equal(error.status,1);initial=JSON.parse(error.stdout.trim().split('\n').at(-1));}assert.equal(initial.notifications,0);
const acceptedPath=join(directory,'controlled-accepted.jsonl'),helper=join(directory,'consumer.mjs');
writePrivateFile(helper,`import {appendFileSync} from 'node:fs';
import {notificationDelivery} from ${JSON.stringify(join(projectRoot,'dist/orchestration/orchestration/notificationDelivery.js'))};
import {consumeNotifications} from ${JSON.stringify(join(projectRoot,'dist/orchestration/orchestration/notificationConsumer.js'))};
const delivery=notificationDelivery({url:process.env.SUPABASE_URL,serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY},process.env.LOOP_N8N_STATE_DIR);
const result=await consumeNotifications(delivery,async notification=>{appendFileSync(${JSON.stringify(acceptedPath)},JSON.stringify({eventId:notification.eventId})+'\\n',{mode:0o600});if(process.argv[2]==='crash')process.kill(process.pid,'SIGKILL');if(process.argv[2]==='fail')throw Error('Controlled acceptance lost acknowledgement');});
console.log(JSON.stringify({...result,unresolved:await delivery.unresolved()}));\n`);
function child(mode='normal'){
 const p=spawn(process.execPath,[helper,mode],{env:runtimeEnv,stdio:['ignore','pipe','pipe']});let output='';p.stdout.on('data',x=>{output+=x;});let stderr='';p.stderr.on('data',x=>{stderr+=x;});
 return once(p,'exit').then(([code,signal])=>({code,signal,output,stderr}));
}
const rows=[];
function insert(id,at='clock_timestamp()'){
 rows.push(id);sql(`insert into public.audit_events(id,account_id,event_type,payload,created_at) values(${quote(id)},'a0000000-0000-4000-8000-000000000001','stage_transition','{"to_stage":"script_review"}',${at});`,targetContainer);
}
const lateId=randomUUID();rows.push(lateId);
const late=spawn('docker',['exec','-i',targetContainer,'psql','-XqAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe']});
const lines=createInterface({input:late.stdout});
const held=new Promise((resolve,reject)=>{lines.on('line',line=>{if(line==='held')resolve();});late.once('exit',()=>reject(Error('late transaction exited')));});
late.stdin.write(`begin;insert into public.audit_events(id,account_id,event_type,payload,created_at) values(${quote(lateId)},'a0000000-0000-4000-8000-000000000001','stage_transition','{"to_stage":"script_review"}','2001-01-01');select 'held';\n`);await held;
const fastId=randomUUID();insert(fastId);
assert.equal((await child()).code,0);
const committed=once(late,'exit');late.stdin.end('commit;\n');await committed;
assert.equal((await child()).code,0);
// More than the old REST page ceiling, all with one timestamp, under concurrency.
const bulk=Array.from({length:1005},()=>randomUUID());rows.push(...bulk);
sql(`insert into public.audit_events(id,account_id,event_type,payload,created_at) select id::uuid,'a0000000-0000-4000-8000-000000000001','stage_transition','{"to_stage":"production_ready"}','2002-01-01' from unnest(array[${bulk.map(quote).join(',')}]) id;`,targetContainer);
const parallel=await Promise.all([child(),child()]);assert.ok(parallel.every(r=>r.code===0));assert.equal((await child()).code,0);
const crashId=randomUUID();insert(crashId);assert.equal((await child('crash')).signal,'SIGKILL');assert.equal((await child()).code,0);
const failId=randomUUID();insert(failId);assert.equal((await child('fail')).code,1);assert.equal((await child()).code,0);
const accepted=readFileSync(acceptedPath,'utf8').trim().split('\n').map(line=>JSON.parse(line).eventId);
assert.equal(accepted.length,1009);assert.equal(new Set(accepted).size,accepted.length);assert.ok(accepted.includes(lateId));
const outcomes=JSON.parse(sql(`select jsonb_object_agg(outcome,total) from(select outcome,count(*) total from public.notification_delivery_events where event_id in (${rows.map(quote).join(',')}) group by outcome)s`,targetContainer));
assert.deepEqual(outcomes,{accepted:1007,reserved:1,uncertain:1});
// Real CLI reports unresolved rather than silently declaring notification success.
let uncertainCli=false;try{cli('notify');}catch(error){uncertainCli=error.status===1;}assert.ok(uncertainCli);
const {readOperationsEvidence,recordOperation}=await import('../../dist/orchestration/orchestration/operationsEvidence.js');
assert.equal((await readOperationsEvidence(directory)).notification.latest.passed,false);
const health=cli('health');assert.equal(health.passed,true);
const snapshot=cli('export');assert.equal(snapshot.restorableBackup,false);
let backupFailed=false;try{await createBackup({...c,projectId:'not-an-approved-target'});}catch{backupFailed=true;}assert.ok(backupFailed);
const backup=await createBackup(c);assert.equal(readBackup(backup.root,c).version,'loop-business-backup/v2');
// Read complete backup evidence alongside the per-run notification/health evidence.
const backupEvidence=await readOperationsEvidence(join(c.stateRoot,'orchestration'));assert.equal(backupEvidence.backup.latest.passed,true);assert.ok(backupEvidence.backup.lastFailure);
await recordOperation(directory,'backup',backupEvidence.backup.latest);
const allEvidence=await readOperationsEvidence(directory);assert.equal(allEvidence.health.latest.passed,true);assert.equal(allEvidence.snapshot.latest.passed,true);assert.equal(allEvidence.notification.latest.passed,false);
// Existing authenticated HTTP handler, same real verified Auth/API. PATH excludes
// Codex/Provider probes; this harness never starts a scheduler or a new task.
const ownerId=sql("select user_id from public.account_memberships where account_id='a0000000-0000-4000-8000-000000000001' and role='owner' limit 1",targetContainer);
const ownerFile=JSON.parse(readFileSync(join(c.stateRoot,`owner-${ownerId}.json`),'utf8'));
const client=createClient(c.apiUrl,c.anonKey,{auth:{persistSession:false}});const login=await client.auth.signInWithPassword({email:ownerFile.email,password:ownerFile.password});assert.ifError(login.error);
const oldPath=process.env.PATH,oldState=process.env.LOOP_N8N_STATE_DIR;
process.env.PATH='/usr/bin:/bin';process.env.LOOP_N8N_STATE_DIR=directory;
const vite=await createViteServer({root:projectRoot,configFile:false,server:{middlewareMode:true},appType:'custom'});
let http;
try{
 const {serveSystemStatus}=await vite.ssrLoadModule('/src/local-control-plane/routes/handlers.ts');
 const handler=serveSystemStatus(c.apiUrl,c.anonKey);http=createHttpServer(handler);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${http.address().port}/_system-status`;
 assert.equal((await fetch(url)).status,401);
 const response=await fetch(url,{headers:{Authorization:`Bearer ${login.data.session.access_token}`}});assert.equal(response.status,200);const report=await response.json();
 assert.equal(report.operations.notification.latest.passed,false);assert.equal(report.operations.health.latest.passed,true);assert.equal(report.operations.backup.latest.passed,true);assert.equal(report.n8n.lastHealthCheckAt,report.operations.health.latest.at);
 writePrivateFile(join(directory,'http-summary.json'),JSON.stringify({status:response.status,operations:report.operations,lastHealthCheckAt:report.n8n.lastHealthCheckAt},null,2)+'\n');
}finally{
 if(http)await new Promise(resolve=>http.close(resolve));await vite.close();process.env.PATH=oldPath;if(oldState===undefined)delete process.env.LOOP_N8N_STATE_DIR;else process.env.LOOP_N8N_STATE_DIR=oldState;await client.auth.signOut();
}
assert.equal(digest(sql("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.tasks t",targetContainer)),beforeTasks);
const result={target:targetId,directory,transport:'controlled acceptance log, not macOS display or Owner read receipt',initial,lateCommitDelivered:true,bulkSameTimestamp:1005,concurrentConsumers:2,acceptedOnce:accepted.length,outcomes,crashAfterAcceptance:'real SIGKILL; reserved retained and never resent',explicitSendFailure:'uncertain retained and never resent',uncertainCliExit:1,healthPassed:true,partialSnapshotNotRestorable:true,backup:{...backup,manifestVerified:true},httpAuthenticated:true,unauthenticatedStatus:401,existingTasksUnchanged:true};
writePrivateFile(join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');
writePrivateFile(join(c.stateRoot,'t09-latest.json'),JSON.stringify({directory})+'\n');
console.log(JSON.stringify(result,null,2));
