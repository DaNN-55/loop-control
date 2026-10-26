import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {join} from 'node:path';import {randomUUID} from 'node:crypto';import {spawn} from 'node:child_process';import {once} from 'node:events';import {createInterface} from 'node:readline';
import {root,appPort,container,env,sql,writePrivateFile} from './environment.mjs';
const fixture=JSON.parse(readFileSync(join(root,'state/t14-http.json'))),owner=JSON.parse(readFileSync(join(root,'state/t13-owner.json'))),base=`http://127.0.0.1:${appPort}`;
const login=await fetch(base+'/api/local/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:owner.email,password:owner.password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).csrfToken;
const catalog=await (await fetch(base+'/api/local/catalog',{headers:{Cookie:cookie}})).json(),blueprint=catalog.blueprints.find(b=>b.id===fixture.currentBlueprintId),revision=catalog.blueprintRevisions[blueprint.id];
const holder=spawn('docker',['exec','-i',container,'psql','-XqAt','-U','postgres','-d','loop_imported','-v','ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe']});const lines=createInterface({input:holder.stdout});const ready=once(lines,'line');let requests,blocked;
try{
 holder.stdin.write(`begin;select id from public.accounts where id='${fixture.accountId}' for update;\n`);await ready;
 requests=['A','B'].map(mark=>fetch(base+'/api/local/configuration',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},body:JSON.stringify({command:'updateBlueprint',data:{accountId:fixture.accountId,policy:{...blueprint.policy,positioning:'T14 race '+mark}},idempotencyKey:randomUUID(),expectedRevision:revision})}));
 for(let i=0;i<100;i++){blocked=Number(sql("select count(*) from pg_stat_activity where usename='loop_app' and wait_event_type='Lock' and query like '%lock_owned_account%'") );if(blocked===2)break;await new Promise(r=>setTimeout(r,25));}
 assert.equal(blocked,2,'both HTTP transactions must be waiting before lock release');
}finally{const done=once(holder,'exit');holder.stdin.end('rollback;\n');await done;lines.close();}
const statuses=await Promise.all(requests.map(async p=>(await p).status));
const result={ticket:120,at:new Date().toISOString(),bothWaitedBeforeRelease:blocked===2,statuses,passed:JSON.stringify([...statuses].sort())===JSON.stringify([200,409])};
writePrivateFile(join(root,`state/t14-race-${result.passed?'passed':'failed'}.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));assert.equal(result.passed,true,'one stale concurrent edit must be rejected');
