// C follow-up uses only the existing verified target; no Worker/scheduler starts.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {targetConfiguration,targetContainer,targetId} from './restore.mjs';
import {assertContainer,sql,digest} from './backup.mjs';
import {cleanEnvironment,ensurePrivateDirectory,writePrivateFile,openPrivateFile,projectRoot} from './environment.mjs';
import {inspectRecordedService} from '../local-service-record.mjs';
assert.ok(process.argv.includes('--verified'));assert.equal(targetId,'loop-control-stage-b-verified');assertContainer(targetContainer,targetId);
const c=targetConfiguration(),directory=join(c.stateRoot,'c-followup');ensurePrivateDirectory(directory);
if(process.argv.includes('--console')){
 const recordPath=join(c.stateRoot,'console.json');assert.ok(!existsSync(recordPath),'Console must be absent; do not stop another service');
 const operationsDirectory=JSON.parse(readFileSync(join(c.stateRoot,'t09-latest.json'))).directory;
 assert.ok(operationsDirectory.startsWith(c.stateRoot+'/t09/'));
 const log=openPrivateFile(join(directory,'console.log'),{append:true});
 const child=spawn(process.execPath,[join(projectRoot,'node_modules/vite/bin/vite.js'),'--config',join(projectRoot,'scripts/isolation/restore-vite.config.mjs'),'--host','127.0.0.1','--port',String(c.ports.console),'--strictPort'],{
  cwd:projectRoot,env:{...cleanEnvironment(c),PATH:'/usr/bin:/bin',LOOP_STAGE_C_OBSERVE:'1',LOOP_N8N_STATE_DIR:operationsDirectory},detached:true,stdio:['ignore',log,log]});
 await once(child,'spawn');closeSync(log);
 const record={pid:child.pid,port:c.ports.console,projectRoot,workerEnabled:false,observationOnly:true};
 for(let i=0;i<80;i++){
  try{if((await fetch(`http://127.0.0.1:${c.ports.console}/loop-control-health.txt`)).ok && inspectRecordedService({pid:record.pid,port:String(record.port),commandIdentity:join(projectRoot,'node_modules/vite/bin/vite.js')},projectRoot).valid){writePrivateFile(recordPath,JSON.stringify(record)+'\n',{exclusive:true});child.unref();console.log(JSON.stringify(record));process.exit(0);}}catch{}
  await new Promise(r=>setTimeout(r,250));
 }
 child.kill('SIGTERM');throw Error('Observation console not ready');
}
if(process.argv.includes('--baseline')){
 const tasks=digest(sql("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.tasks t",targetContainer));
 writePrivateFile(join(directory,'baseline.json'),JSON.stringify({target:targetId,head:'5384429',tasks,at:new Date().toISOString()})+'\n');
 console.log(JSON.stringify({target:targetId,baselineRecorded:true}));
}
if(process.argv.includes('--fixtures')){
 const {randomUUID}=await import('node:crypto');
 const ownerId=sql("select user_id from account_memberships where account_id='a0000000-0000-4000-8000-000000000001' and role='owner' limit 1",targetContainer);
 const ids={account:randomUUID(),blueprint:randomUUID(),series:randomUUID(),version:randomUUID(),emptySeries:randomUUID(),detail:randomUUID(),task:randomUUID()};
 const {quote}=await import('./backup.mjs');
 sql(`begin;
 insert into accounts(id,slug,name,timezone) values(${quote(ids.account)},${quote('c-followup-'+Date.now())},'C阶段补验专用','Asia/Shanghai');
 insert into account_memberships(account_id,user_id,role) values(${quote(ids.account)},${quote(ownerId)},'owner');
 insert into account_blueprint_versions(id,account_id,version,policy,is_active) values(${quote(ids.blueprint)},${quote(ids.account)},1,'{}',true);
 update accounts set current_blueprint_version_id=${quote(ids.blueprint)} where id=${quote(ids.account)};
 insert into series(id,account_id,name) values(${quote(ids.series)},${quote(ids.account)},'C补验系列'),(${quote(ids.emptySeries)},${quote(ids.account)},'C补验空系列');
 insert into series_versions(id,account_id,series_id,version,rules,created_by) values(${quote(ids.version)},${quote(ids.account)},${quote(ids.series)},1,'{}',${quote(ownerId)});
 insert into episodes(id,account_id,blueprint_version_id,series_version_id,title,is_test,updated_at)
 values(${quote(ids.detail)},${quote(ids.account)},${quote(ids.blueprint)},${quote(ids.version)},'C补验-详情',true,'2000-01-01');
 insert into episodes(account_id,blueprint_version_id,series_version_id,title,is_test,stage,updated_at,archived_at)
 select ${quote(ids.account)},${quote(ids.blueprint)},case when n<=46 then ${quote(ids.version)}::uuid else null end,'C补验-'||lpad(n::text,4,'0'),true,
 case when n<=23 then 'visual_review'::episode_stage else 'waiting_input'::episode_stage end,'2000-01-01',case when n>1004 then '2000-01-02'::timestamptz else null end from generate_series(1,1006)n;
 insert into review_packages(episode_id,stage,revision_number,context_snapshot) select id,stage,1,'{}' from episodes where account_id=${quote(ids.account)} and stage='visual_review';
 insert into tasks(episode_id,task_type,status,input_snapshot,last_result,budget_limit_cents,max_attempts,provider,model,prompt_version)
 select id,'draft_brief','failed','{}','{"blockers":[{"code":"controlled_browser_fixture","detail":"受控浏览器验收状态，不调用执行器"}]}',0,1,'codex','controlled','c-followup' from episodes where account_id=${quote(ids.account)} and title between 'C补验-0024' and 'C补验-0046';
 insert into tasks(id,episode_id,task_type,status,input_snapshot,last_result,budget_limit_cents,max_attempts,provider,model,prompt_version) values(${quote(ids.task)},${quote(ids.detail)},'draft_brief','completed','{}','{}',0,1,'codex','controlled','c-followup');
 commit;`,targetContainer);
 writePrivateFile(join(directory,'fixtures.json'),JSON.stringify(ids,null,2)+'\n');console.log(JSON.stringify({target:targetId,...ids}));
}
if(process.argv.includes('--tests')){
 const {spawnSync}=await import('node:child_process');
 const log=join(directory,'application-'+Date.now()+'.txt');
 const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--exclude','n8n/import-workflows.test.mjs','--exclude','**/*.integration.test.ts','--exclude','.loop-control/**'],{env:cleanEnvironment(c),encoding:'utf8',maxBuffer:10*1024*1024});
 writePrivateFile(log,(r.stdout??'')+(r.stderr??''));console.log(JSON.stringify({exit:r.status,log}));process.exitCode=r.status??1;
}
