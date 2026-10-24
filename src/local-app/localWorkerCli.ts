// Native task process: database authentication arrives over bounded stdin only.
import {spawn} from 'node:child_process';
import {runCodexWorker,type ClaimedWorkerTask} from '../worker/codexRunner.js';
import {verifyMediaLibrary,verifyArtifactIndex} from '../worker/mediaLibrary.js';
import {assertPreparedRuntime} from '../orchestration/runtimeBuild.js';
import {nativeAssetRoot} from './localFiles.js';
import {createWorkerDatabase,nativeWorkerPort,assertWorkerDatabaseBinding} from './workerDatabase.js';
import type {NativeWorkerConfiguration} from './localWorkerService.js';
import type {ClaimedTaskRow} from '../orchestration/workerDispatch.js';
import type {WorkerTaskPackage} from '../worker/contracts.js';
import {workerPreflightVersion} from '../worker/contracts.js';
let input='';for await(const chunk of process.stdin){input+=String(chunk);if(Buffer.byteLength(input)>10*1024*1024)throw Error('Task input too large');}
const {task,config}=JSON.parse(input) as {task:ClaimedTaskRow;config:NativeWorkerConfiguration};input='';
await assertPreparedRuntime(config.projectRoot);
assertWorkerDatabaseBinding(config.database,config.applicationDatabase);
const pool=createWorkerDatabase(config.database),port=nativeWorkerPort(pool),args={p_task_id:task.task_id,p_attempt:task.attempt,p_lease_token:task.lease_token};
const heartbeat=setInterval(()=>{void port.rpc('refresh_worker_task_lease',args).catch(()=>{});},5*60*1000);heartbeat.unref();
try{
 await port.rpc('refresh_worker_task_lease',args);
 if(task.task_type!=='prepare_visual_brief'||task.provider!=='codex')throw Error('Task outside native input boundary');
 const result=await runCodexWorker({
  actualCostCents:config.actualCostCents,
  async claimNextTask(){return {taskId:task.task_id,taskType:task.task_type,attempt:task.attempt,budgetLimitCents:task.budget_limit_cents,maxAttempts:task.max_attempts,provider:task.provider,model:task.model,promptVersion:task.prompt_version,episodeId:task.episode_id,accountId:task.account_id,blueprintVersionId:task.blueprint_version_id,title:task.title,allowedAssetRoot:task.allowed_asset_root,inputSnapshot:task.input_snapshot} as ClaimedWorkerTask;},
  async verifyAssetRoot(root){await nativeAssetRoot(config.mediaRoot,root);await verifyMediaLibrary({assetRoot:root,mountPath:config.mountPath,minimumFreeBytes:config.minimumFreeBytes});},
  async verifyArtifacts(p,artifacts){await verifyArtifactIndex({assetRoot:p.assets.allowedRoot,episodeId:p.episode.id,artifacts});},
  async preflight(p){return {version:workerPreflightVersion,checks:[{capability:p.capability,check:'command_availability',phase:'preflight',status:config.visualCommand.length&&!p.visualAssetPreparation?.imageGeneration?'passed':'unavailable',reason:'本地受控视觉执行路径；不自动调用图片Provider。',action:config.visualCommand.length&&!p.visualAssetPreparation?.imageGeneration?'none':'contact_environment_admin',scope:'worker'}]};},
  reportProgress:async(_id,_attempt,progress)=>{await port.rpc('report_worker_progress',{...args,p_progress:{version:'worker-progress/v1',progress}});process.stdout.write(JSON.stringify({event:'progress',taskId:task.task_id,step:progress.step})+'\n');},
  reportResult:async(_id,_attempt,result)=>{await port.rpc('report_worker_result',{...args,p_result:result});},
  execute:executeVisual,
 });
 process.stdout.write(JSON.stringify(result??{status:'failed',taskId:task.task_id})+'\n');
}finally{clearInterval(heartbeat);await pool.end();}
function executeVisual(p:WorkerTaskPackage):Promise<string>{
 return new Promise((resolve,reject)=>{
  const child=spawn(config.visualCommand[0],config.visualCommand.slice(1),{cwd:p.assets.allowedRoot,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR},stdio:['pipe','pipe','pipe']});
  let output='',bad=false;const timer=setTimeout(()=>{bad=true;child.kill('SIGKILL');},300000);
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(p));child.stdout.on('data',b=>{output+=String(b);if(Buffer.byteLength(output)>2*1024*1024){bad=true;child.kill('SIGKILL');}});child.stderr.on('data',()=>{});
  child.once('error',()=>{clearTimeout(timer);reject(Error('视觉执行器不可用。'));});child.once('close',code=>{clearTimeout(timer);code===0&&!bad?resolve(output):reject(Error('视觉执行器未返回有效结果。'));});
 });
}
