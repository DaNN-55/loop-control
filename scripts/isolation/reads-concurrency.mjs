// T10 regression: Worker recovery and progress use opposite table order.
import assert from 'node:assert/strict';
import{spawn}from'node:child_process';
import{readFileSync}from'node:fs';
import{join}from'node:path';
import{sql,quote,env,assertContainer}from'./backup.mjs';
import{targetConfiguration,targetContainer,targetId}from'./restore.mjs';
import{writePrivateFile}from'./environment.mjs';
assert.ok(process.argv.includes('--verified'));assertContainer(targetContainer,targetId);
const c=targetConfiguration(),{directory}=JSON.parse(readFileSync(join(c.stateRoot,'t10-latest.json'))),{episode}=JSON.parse(readFileSync(join(directory,'result.json')));
const tasks=JSON.parse(sql(`select jsonb_agg(id) from(select id from tasks where episode_id=${quote(episode)} order by id limit 2)t`,targetContainer));assert.equal(tasks.length,2);
sql(`insert into task_runs(task_id,attempt,task_package,status) select id,0,'{}','completed' from tasks where id in(${tasks.map(quote).join(',')}) on conflict(task_id,attempt) do nothing`,targetContainer);
function transaction(first,second){
 const p=spawn('docker',['exec','-i',targetContainer,'psql','-XqAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe']});let output='',error='';let ready;
 const started=new Promise(resolve=>{ready=resolve;});p.stdout.on('data',chunk=>{output+=chunk;if(output.includes('T10_READY'))ready();});p.stderr.on('data',chunk=>{error+=chunk;});
 const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error('Concurrent transaction failed; SQL details suppressed')));});
 p.stdin.write(`begin;set local statement_timeout='12s';${first};select 'T10_READY';\n`);
 return{started,done,finish(){p.stdin.end(second+';rollback;\n');},abort(){p.stdin.end('rollback;\n');},details:()=>({output,error})};
}
const a=transaction(`update task_runs set result='{"t10":"recovery"}' where task_id=${quote(tasks[0])}`,`update tasks set last_result='{"t10":"recovery"}' where id=${quote(tasks[0])}`);
const b=transaction(`update tasks set last_result='{"t10":"progress"}' where id=${quote(tasks[1])}`,`update task_runs set result='{"t10":"progress"}' where task_id=${quote(tasks[1])}`);
let timer;try{await Promise.race([Promise.all([a.started,b.started]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Concurrent transaction barrier timed out')),10000);})]);clearTimeout(timer);a.finish();b.finish();await Promise.all([a.done,b.done]);}catch(error){a.abort();b.abort();await Promise.allSettled([a.done,b.done]);throw error;}
const result={target:targetId,episode,oppositeTableOrder:true,bothInitialUpdatesHeldAtBarrier:true,bothTransactionsCompleted:true,mutationsRolledBack:true,sharedSectionCounterWrites:false};writePrivateFile(join(directory,'concurrency.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
