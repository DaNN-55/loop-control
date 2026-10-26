// @vitest-environment node
import {afterEach,it,expect} from 'vitest';
import {mkdtemp,mkdir,open,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {Pool} from 'pg';
import {createWorkerTaskPackage,type WorkerResult} from '../worker/contracts';
import {writeSafeAssetFile} from '../worker/controlledMediaExecutor';
import {prepareNativeAttemptOutput,recoverNativeAttemptOutput} from './nativeAttemptOutput';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const taskId='10000000-0000-4000-8000-000000000001',episodeId='10000000-0000-4000-8000-000000000002';
const output=`episodes/${episodeId}/output.json`;
const frozenOutput={relative_path:output,content_type:'application/json',review_stage:'visual_review',required_artifact_types:['visual_brief']};
const execute=promisify(execFile);
function result(bytes:string):WorkerResult{return{version:'worker-result/v1',taskId,status:'completed',artifacts:[{artifactType:'visual_brief',relativePath:output,fileSize:Buffer.byteLength(bytes),sha256:createHash('sha256').update(bytes).digest('hex')}],validation:{passed:true,checks:[]},actualCostCents:0,blockers:[],retry:{shouldRetry:false,reason:'complete'},nextStep:'Owner review'};}
async function taskPackage(attempt:number,root?:string){
 root??=await mkdtemp(join(tmpdir(),'native-attempt-'));if(!roots.includes(root))roots.push(root);
 await mkdir(join(root,'episodes',episodeId),{recursive:true});
 return createWorkerTaskPackage({task:{id:taskId,type:'prepare_visual_brief',attempt,budgetLimitCents:0,maxAttempts:3,provider:'codex',model:'configured-model',promptVersion:'visual-v1'},episode:{id:episodeId,accountId:'account',blueprintVersionId:'blueprint',title:'Attempt isolation'},capability:'visual_asset_preparation',allowedTools:['read','write'],allowedAssetRoot:root,inputArtifacts:[],output:{requiredArtifactTypes:['visual_brief'],relativePath:output,contentType:'application/json',reviewStage:'visual_review'}});
}
function database(activeAttempt:number,failReport=false,failCommit=false){
 const accepted:number[]=[],operations:string[]=[],discarded:boolean[]=[];
 const pool={async connect(){return{async query(sql:string,values?:unknown[]){
  operations.push(sql);
  if(sql.includes('native_output_authority')){if(values?.[1]!==activeAttempt)throw Error('Lease expired');return{rows:[{authority:{output:frozenOutput,reviewProjectPath:null,finalProjectPath:null,status:'running',inputHash:'frozen-input',artifacts:[],conflicts:[]}}]};}
  if(sql==='COMMIT'&&failCommit)throw Error('Commit outcome unknown');
  if(sql.includes('input_worker_call')){
   const args=values?.[1] as {p_attempt:number};
   if(args.p_attempt!==activeAttempt)throw Error('Lease expired');
   if(values?.[0]==='report_worker_result'){if(failReport)throw Error('Result registration failed');accepted.push(args.p_attempt);}
  }
  return{rows:[],rowCount:0};
 },release(broken=false){operations.push('release');discarded.push(broken);}};}} as unknown as Pool;
 return{pool,accepted,operations,discarded};
}

it('keeps a late executor in its attempt directory after a newer attempt is accepted',async()=>{
 const oldPackage=await taskPackage(0),nextPackage=await taskPackage(1,oldPackage.assets.allowedRoot);
 const old=await prepareNativeAttemptOutput(oldPackage,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000003'});
 const next=await prepareNativeAttemptOutput(nextPackage,{p_task_id:taskId,p_attempt:1,p_lease_token:'10000000-0000-4000-8000-000000000004'});
 const db=database(1);
 await writeSafeAssetFile(next.taskPackage.assets.allowedRoot,output,'new accepted output');
 await next.publish(db.pool,result('new accepted output'));
 await writeSafeAssetFile(old.taskPackage.assets.allowedRoot,output,'old late output');
 await expect(old.publish(db.pool,result('old late output'))).rejects.toThrow('Lease expired');
 expect(await readFile(join(oldPackage.assets.allowedRoot,output),'utf8')).toBe('new accepted output');
 expect(await readFile(join(old.taskPackage.assets.allowedRoot,output),'utf8')).toBe('old late output');
 expect(db.accepted).toEqual([1]);
});

it('prepares the frozen output parent for a normal planner using an exclusive direct write',async()=>{
 const p=await taskPackage(0);p.output.relativePath=`episodes/${episodeId}/visual-assets/manifest.md`;
 const attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000012'});
 const script="import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';const p=JSON.parse(readFileSync(0,'utf8'));writeFileSync(join(p.assets.allowedRoot,p.output.relativePath),'planner output',{flag:'wx',mode:0o600});";
 const child=execute(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});
 child.child.stdin!.end(JSON.stringify(attempt.taskPackage));await child;
 expect(await readFile(join(attempt.taskPackage.assets.allowedRoot,p.output.relativePath),'utf8')).toBe('planner output');
});

it('copies frozen inputs without sharing writable inodes with the accepted media',async()=>{
 const p=await taskPackage(0),input=`episodes/${episodeId}/script.txt`;
 await writeSafeAssetFile(p.assets.allowedRoot,input,'confirmed script');
 p.assets.inputs=[{artifactType:'main_script',relativePath:input,fileSize:16,sha256:createHash('sha256').update('confirmed script').digest('hex')}];
 const attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000005'});
 expect(await readFile(join(attempt.taskPackage.assets.allowedRoot,input),'utf8')).toBe('confirmed script');
 await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,input,'executor changed its local copy');
 expect(await readFile(join(p.assets.allowedRoot,input),'utf8')).toBe('confirmed script');
});

it('rejects output publication over a frozen input or approved reuse source',async()=>{
 const p=await taskPackage(0),input=`episodes/${episodeId}/approved.mp4`;
 await writeSafeAssetFile(p.assets.allowedRoot,input,'approved media');
 const source={artifactType:'render',relativePath:input,fileSize:14,sha256:createHash('sha256').update('approved media').digest('hex')};
 const attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000006'},[source]);
 await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,input,'changed output');
 const report=result('changed output');report.artifacts[0].relativePath=input;
 const db=database(0);
 await expect(attempt.publish(db.pool,report)).rejects.toThrow('冻结输入');
 expect(await readFile(join(p.assets.allowedRoot,input),'utf8')).toBe('approved media');expect(db.accepted).toEqual([]);
});

it('publishes the existing card-project auxiliary file inside the same lease fence',async()=>{
 const p=await taskPackage(0);p.provider='openchatcut';p.aRoll={adapter:'openchatcut_card_video',shot:{id:'shot-1',scriptSegment:'Caption',durationSeconds:1,shotType:'a_roll',productionMethod:'card',targetSpec:'9:16',inputBasis:[]}};
 const attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000007'});
 const project=`episodes/${episodeId}/card-video/${taskId}/project.json`;
 await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,output,'rendered card');
 await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,project,'{"project":"card"}');
 await attempt.publish(database(0).pool,result('rendered card'));
 expect(await readFile(join(p.assets.allowedRoot,project),'utf8')).toBe('{"project":"card"}');
});

it('keeps published bytes independent from an executor still holding its staging file descriptor',async()=>{
 const p=await taskPackage(0),attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000008'});
 await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,output,'accepted snapshot');
 const fd=await open(join(attempt.taskPackage.assets.allowedRoot,output),'r+');
 try{
  await attempt.publish(database(0).pool,result('accepted snapshot'));
  await fd.write('late',0,'utf8');
  expect(await readFile(join(p.assets.allowedRoot,output),'utf8')).toBe('accepted snapshot');
 }finally{await fd.close();}
});

it('rejects canonical symlink destinations before touching outside files or registering a result',async()=>{
 const p=await taskPackage(0),attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000009'});
 const outside=join(p.assets.allowedRoot,'outside.txt');await writeSafeAssetFile(p.assets.allowedRoot,'outside.txt','outside unchanged');
 await symlink(outside,join(p.assets.allowedRoot,output));
 await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,output,'rejected output');
 const db=database(0);await expect(attempt.publish(db.pool,result('rejected output'))).rejects.toThrow('符号链接');
 expect(await readFile(outside,'utf8')).toBe('outside unchanged');expect(db.accepted).toEqual([]);expect(db.operations).toContain('ROLLBACK');
});

it('retains failed attempt files without reporting them as accepted or repeating registration',async()=>{
 const p=await taskPackage(0),attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000010'});
 await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,output,'unregistered output');
 const db=database(0,true);await expect(attempt.publish(db.pool,result('unregistered output'))).rejects.toThrow('Result registration failed');
 expect(await readFile(join(attempt.taskPackage.assets.allowedRoot,output),'utf8')).toBe('unregistered output');
 expect(db.accepted).toEqual([]);expect(db.operations).toEqual(['BEGIN','SELECT local_identity.input_worker_call($1,$2)','SELECT local_identity.native_output_authority($1,$2,$3,$4) authority','SAVEPOINT native_output_publication','SELECT local_identity.input_worker_call($1,$2)','ROLLBACK TO SAVEPOINT native_output_publication','ROLLBACK','release']);
});

it('restores an existing canonical file before releasing the task transaction when result registration fails',async()=>{
 const p=await taskPackage(0),attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000013'});
 await writeSafeAssetFile(p.assets.allowedRoot,output,'previous indexed output');
 await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,output,'candidate output');
 const db=database(0,true),connect=db.pool.connect.bind(db.pool);let bytesAtRollback='';
 db.pool.connect=(async()=>{const client=await connect(),query=client.query.bind(client);client.query=(async(sql:string,values?:unknown[])=>{if(sql==='ROLLBACK')bytesAtRollback=await readFile(join(p.assets.allowedRoot,output),'utf8');return query(sql,values);}) as typeof client.query;return client;}) as typeof db.pool.connect;
 await expect(attempt.publish(db.pool,result('candidate output'))).rejects.toThrow('Result registration failed');
 expect(await readFile(join(p.assets.allowedRoot,output),'utf8')).toBe('previous indexed output');
 expect(bytesAtRollback).toBe('previous indexed output');expect(db.accepted).toEqual([]);
 expect(await readFile(join(attempt.taskPackage.assets.allowedRoot,output),'utf8')).toBe('candidate output');
});

it('restores earlier replacements and removes newly introduced files after a partial multi-file publication failure',async()=>{
 const p=await taskPackage(0),attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000014'});
 const fresh=`episodes/${episodeId}/fresh.json`,blocked=`episodes/${episodeId}/blocked.json`;
 await writeSafeAssetFile(p.assets.allowedRoot,output,'previous indexed output');
 await mkdir(join(p.assets.allowedRoot,blocked));
 const artifact=(relativePath:string,text:string)=>({artifactType:'visual_brief',relativePath,fileSize:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')});
 for(const [path,text] of [[output,'candidate output'],[fresh,'fresh output'],[blocked,'blocked output']])await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,path,text);
 const report=result('candidate output');report.artifacts.push(artifact(fresh,'fresh output'),artifact(blocked,'blocked output'));
 const db=database(0);await expect(attempt.publish(db.pool,report)).rejects.toThrow();
 expect(await readFile(join(p.assets.allowedRoot,output),'utf8')).toBe('previous indexed output');
 expect(await readdir(join(p.assets.allowedRoot,'episodes',episodeId))).not.toContain('fresh.json');
 expect(db.accepted).toEqual([]);expect(await readFile(join(attempt.taskPackage.assets.allowedRoot,fresh),'utf8')).toBe('fresh output');
});

it('restores every replaced file and removes new canonical files when multi-file registration fails',async()=>{
 const p=await taskPackage(0),attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000015'});
 const fresh=`episodes/${episodeId}/fresh.json`;await writeSafeAssetFile(p.assets.allowedRoot,output,'previous indexed output');
 await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,output,'candidate output');await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,fresh,'new sidecar');
 const report=result('candidate output');report.artifacts.push({artifactType:'sidecar',relativePath:fresh,fileSize:11,sha256:createHash('sha256').update('new sidecar').digest('hex')});
 const db=database(0,true);await expect(attempt.publish(db.pool,report)).rejects.toThrow('Result registration failed');
 expect(await readFile(join(p.assets.allowedRoot,output),'utf8')).toBe('previous indexed output');
 expect(await readdir(join(p.assets.allowedRoot,'episodes',episodeId))).not.toContain('fresh.json');
 expect(await readFile(join(attempt.taskPackage.assets.allowedRoot,fresh),'utf8')).toBe('new sidecar');expect(db.accepted).toEqual([]);expect(attempt.uncertain).toBe(false);
});

it('retains both generations without blind restoration or repeated registration when COMMIT is uncertain',async()=>{
 const p=await taskPackage(0),attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000016'});
 await writeSafeAssetFile(p.assets.allowedRoot,output,'previous indexed output');await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,output,'candidate output');
 const db=database(0,false,true);await expect(attempt.publish(db.pool,result('candidate output'))).rejects.toThrow('Commit outcome unknown');
 expect(attempt.uncertain).toBe(true);expect(await readFile(join(p.assets.allowedRoot,output),'utf8')).toBe('candidate output');
 expect(await readFile(join(attempt.taskPackage.assets.allowedRoot,'.publication-backups',output),'utf8')).toBe('previous indexed output');
 expect(JSON.parse(await readFile(join(attempt.taskPackage.assets.allowedRoot,'publication-outcome.json'),'utf8')).status).toBe('commit_unknown');
 const operations=db.operations.length;await expect(attempt.publish(db.pool,result('candidate output'))).rejects.toThrow('尚未确认');expect(db.operations).toHaveLength(operations);
 expect(db.operations).not.toContain('ROLLBACK TO SAVEPOINT native_output_publication');
 expect(db.discarded).toEqual([true]);
});

it('does not restore over canonical bytes after a connection loss prevents proving that the original lock survived',async()=>{
 const p=await taskPackage(0),attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000017'});
 await writeSafeAssetFile(p.assets.allowedRoot,output,'previous indexed output');await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,output,'candidate output');
 const db=database(0,true),connect=db.pool.connect.bind(db.pool);
 db.pool.connect=(async()=>{const client=await connect(),query=client.query.bind(client);client.query=(async(sql:string,values?:unknown[])=>{if(sql==='ROLLBACK TO SAVEPOINT native_output_publication')throw Error('Connection lost');return query(sql,values);}) as typeof client.query;return client;}) as typeof db.pool.connect;
 await expect(attempt.publish(db.pool,result('candidate output'))).rejects.toThrow('Result registration failed');
 expect(attempt.uncertain).toBe(true);expect(await readFile(join(p.assets.allowedRoot,output),'utf8')).toBe('candidate output');
 expect(await readFile(join(attempt.taskPackage.assets.allowedRoot,'.publication-backups',output),'utf8')).toBe('previous indexed output');
 expect(JSON.parse(await readFile(join(attempt.taskPackage.assets.allowedRoot,'publication-outcome.json'),'utf8')).status).toBe('restore_unknown');expect(db.discarded).toEqual([true]);
});

it('rejects a changed output hash before replacing an existing canonical file',async()=>{
 const p=await taskPackage(0),attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000011'});
 await writeSafeAssetFile(p.assets.allowedRoot,output,'canonical unchanged');
 await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,output,'unexpected bytes');
 const db=database(0);await expect(attempt.publish(db.pool,result('declared bytes'))).rejects.toThrow('不匹配');
 expect(await readFile(join(p.assets.allowedRoot,output),'utf8')).toBe('canonical unchanged');expect(db.accepted).toEqual([]);
});


it('rejects publication over a path already indexed by a different task before changing any bytes',async()=>{
 const p=await taskPackage(0),attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000018'});
 await writeSafeAssetFile(p.assets.allowedRoot,output,'historical accepted bytes');await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,output,'candidate output');
 const db=database(0),connect=db.pool.connect.bind(db.pool);
 db.pool.connect=(async()=>{const client=await connect(),query=client.query.bind(client);client.query=(async(sql:string,values?:unknown[])=>sql.includes('native_output_authority')?{rows:[{authority:{output:frozenOutput,reviewProjectPath:null,finalProjectPath:null,status:'running',inputHash:'frozen-input',artifacts:[],conflicts:[{relativePath:output}]}}]}:query(sql,values)) as typeof client.query;return client;}) as typeof db.pool.connect;
 await expect(attempt.publish(db.pool,result('candidate output'))).rejects.toThrow('其他任务');
 expect(await readFile(join(p.assets.allowedRoot,output),'utf8')).toBe('historical accepted bytes');expect(db.accepted).toEqual([]);
});


it('reconciles an unknown commit from the current completed database result and is safe to repeat',async()=>{
 const p=await taskPackage(0),attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000019'});
 await writeSafeAssetFile(p.assets.allowedRoot,output,'old output');await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,output,'candidate output');
 const report=result('candidate output');await expect(attempt.publish(database(0,false,true).pool,report)).rejects.toThrow();
 const db=database(0),connect=db.pool.connect.bind(db.pool);
 db.pool.connect=(async()=>{const client=await connect(),query=client.query.bind(client);client.query=(async(sql:string,values?:unknown[])=>sql.includes('native_output_authority')?{rows:[{authority:{output:frozenOutput,reviewProjectPath:null,finalProjectPath:null,status:'completed',inputHash:'frozen-input',result:report,artifacts:report.artifacts,conflicts:[]}}]}:query(sql,values)) as typeof client.query;return client;}) as typeof db.pool.connect;
 for(let n=0;n<2;n++)expect(await recoverNativeAttemptOutput(db.pool,{assetRoot:p.assets.allowedRoot,stagingRoot:attempt.taskPackage.assets.allowedRoot})).toEqual({status:'completed',registered:false});
 expect(await readFile(join(p.assets.allowedRoot,output),'utf8')).toBe('candidate output');expect(db.accepted).toEqual([]);
});

it('registers the verified staged result after an unknown transaction rolled back, without rerunning its executor',async()=>{
 const p=await taskPackage(0),attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000020'});
 await writeSafeAssetFile(p.assets.allowedRoot,output,'old output');await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,output,'candidate output');
 await expect(attempt.publish(database(0,false,true).pool,result('candidate output'))).rejects.toThrow();
 const db=database(0);expect(await recoverNativeAttemptOutput(db.pool,{assetRoot:p.assets.allowedRoot,stagingRoot:attempt.taskPackage.assets.allowedRoot})).toEqual({status:'completed',registered:true});
 expect(db.accepted).toEqual([0]);expect(await readFile(join(p.assets.allowedRoot,output),'utf8')).toBe('candidate output');
});

it('restores original bytes while still locked when explicit recovery registration fails',async()=>{
 const p=await taskPackage(0),attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000021'});
 await writeSafeAssetFile(p.assets.allowedRoot,output,'old output');await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,output,'candidate output');
 await expect(attempt.publish(database(0,false,true).pool,result('candidate output'))).rejects.toThrow();
 const db=database(0,true),connect=db.pool.connect.bind(db.pool);let bytesAtRollback='';
 db.pool.connect=(async()=>{const client=await connect(),query=client.query.bind(client);client.query=(async(sql:string,values?:unknown[])=>{if(sql==='ROLLBACK')bytesAtRollback=await readFile(join(p.assets.allowedRoot,output),'utf8');return query(sql,values);}) as typeof client.query;return client;}) as typeof db.pool.connect;
 await expect(recoverNativeAttemptOutput(db.pool,{assetRoot:p.assets.allowedRoot,stagingRoot:attempt.taskPackage.assets.allowedRoot})).rejects.toThrow('Result registration failed');
 expect(bytesAtRollback).toBe('old output');expect(await readFile(join(p.assets.allowedRoot,output),'utf8')).toBe('old output');expect(db.accepted).toEqual([]);
});

it('keeps canonical bytes and private recovery evidence when the database cannot verify the identity',async()=>{
 const p=await taskPackage(0),attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000022'});
 await writeSafeAssetFile(p.assets.allowedRoot,output,'old output');await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,output,'candidate output');
 await expect(attempt.publish(database(0,false,true).pool,result('candidate output'))).rejects.toThrow();
 const receipt=await readFile(join(attempt.taskPackage.assets.allowedRoot,'publication-receipt-private.json'),'utf8');
 const unavailable={async connect(){throw Error('Database unavailable');}} as unknown as Pool;
 await expect(recoverNativeAttemptOutput(unavailable,{assetRoot:p.assets.allowedRoot,stagingRoot:attempt.taskPackage.assets.allowedRoot})).rejects.toThrow('Database unavailable');
 expect(await readFile(join(p.assets.allowedRoot,output),'utf8')).toBe('candidate output');expect(await readFile(join(attempt.taskPackage.assets.allowedRoot,'publication-receipt-private.json'),'utf8')).toBe(receipt);
 await expect(recoverNativeAttemptOutput(database(1).pool,{assetRoot:p.assets.allowedRoot,stagingRoot:attempt.taskPackage.assets.allowedRoot})).rejects.toThrow('Lease expired');
 expect(await readFile(join(p.assets.allowedRoot,output),'utf8')).toBe('candidate output');
});


it('rejects a recomputed receipt whose declared primary path differs from the database frozen output',async()=>{
 const p=await taskPackage(0),attempt=await prepareNativeAttemptOutput(p,{p_task_id:taskId,p_attempt:0,p_lease_token:'10000000-0000-4000-8000-000000000023'});
 await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,output,'candidate output');await expect(attempt.publish(database(0,false,true).pool,result('candidate output'))).rejects.toThrow();
 const path=join(attempt.taskPackage.assets.allowedRoot,'publication-receipt-private.json'),envelope=JSON.parse(await readFile(path,'utf8'));
 const {receiptSha256:_,...receipt}=envelope,newPath=`episodes/${episodeId}/native-tasks/${taskId}/different.json`;
 receipt.taskPackage.output.relativePath=newPath;receipt.result.artifacts[0].relativePath=newPath;receipt.files[0].artifact.relativePath=newPath;
 await writeSafeAssetFile(attempt.taskPackage.assets.allowedRoot,newPath,'candidate output');
 await writeFile(path,JSON.stringify({...receipt,receiptSha256:createHash('sha256').update(JSON.stringify(receipt)).digest('hex')}));
 const db=database(0);await expect(recoverNativeAttemptOutput(db.pool,{assetRoot:p.assets.allowedRoot,stagingRoot:attempt.taskPackage.assets.allowedRoot})).rejects.toThrow('冻结输出');
 expect(db.accepted).toEqual([]);await expect(readFile(join(p.assets.allowedRoot,newPath))).rejects.toMatchObject({code:'ENOENT'});
});
