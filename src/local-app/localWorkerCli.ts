import{mappedAssetPath}from'./mediaPaths.js';
import{readMediaDeployment}from'./mediaDeployment.js';
import{assertAlignmentReady,executeNativeAlignment}from'./alignmentWorker.js';
import{assertMediaReady,executeNativeMedia,nativeMediaTask}from'./mediaWorker.js';
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
import{verifyReportedStoryboardArtifact}from'../worker/storyboardArtifact.js';
import{executeStoryboardRevision}from'../worker/storyboardRevisionExecutor.js';
import{executeNativeNarration,assertNarrationReady}from'./narrationWorker.js';
let input='';for await(const chunk of process.stdin){input+=String(chunk);if(Buffer.byteLength(input)>10*1024*1024)throw Error('Task input too large');}
const {task,config}=JSON.parse(input) as {task:ClaimedTaskRow;config:NativeWorkerConfiguration};input='';
await assertPreparedRuntime(config.projectRoot);
assertWorkerDatabaseBinding(config.database,config.applicationDatabase);
const pool=createWorkerDatabase(config.database),port=nativeWorkerPort(pool),args={p_task_id:task.task_id,p_attempt:task.attempt,p_lease_token:task.lease_token};
const heartbeat=setInterval(()=>{void port.rpc('refresh_worker_task_lease',args).catch(()=>{});},5*60*1000);heartbeat.unref();
try{
 await port.rpc('refresh_worker_task_lease',args);
 const roots=await readMediaDeployment(pool,config.mediaRoot),physicalRoot=mappedAssetPath(config.mediaRoot,task.allowed_asset_root,roots);
 if(typeof task.task_type!=='string'||!((task.task_type==='align_shot_captions'&&task.provider==='whisperx')||nativeMediaTask(task.task_type,String(task.provider))|| (task.task_type==='generate_narration'?['google_tts','volcengine_tts'].includes(String(task.provider)):['prepare_visual_brief','draft_storyboard','draft_storyboard_revision'].includes(task.task_type)&&task.provider==='codex')))throw Error('Task outside native input/storyboard/narration boundary');
 const result=await runCodexWorker({
  actualCostCents:config.actualCostCents,
  async claimNextTask(){return {taskId:task.task_id,taskType:task.task_type,attempt:task.attempt,budgetLimitCents:task.budget_limit_cents,maxAttempts:task.max_attempts,provider:task.provider,model:task.model,promptVersion:task.prompt_version,episodeId:task.episode_id,accountId:task.account_id,blueprintVersionId:task.blueprint_version_id,title:task.title,allowedAssetRoot:physicalRoot,inputSnapshot:task.input_snapshot} as ClaimedWorkerTask;},
  async verifyAssetRoot(root){await nativeAssetRoot(config.mediaRoot,root);await verifyMediaLibrary({assetRoot:root,mountPath:config.mountPath,minimumFreeBytes:config.minimumFreeBytes});},
  async verifyArtifacts(p,artifacts,storyboard){await verifyArtifactIndex({assetRoot:p.assets.allowedRoot,episodeId:p.episode.id,artifacts});if(storyboard)await verifyReportedStoryboardArtifact({assetRoot:p.assets.allowedRoot,frozenInputs:p.assets.inputs,relativePath:p.output.relativePath,storyboard});},
  async preflight(p){if(task.task_type==='generate_final_render'&&!config.delivery)throw Error('最终交付尚未配置。');if(p.capability==='acoustic_alignment')await assertAlignmentReady(config.projectRoot,config.mediaRoot,config.alignment,p.model);if(task.task_type==='generate_review_render'&&!config.studio)throw Error('审核视频尚未配置。');if(task.task_type==='generate_shot_sync_preview'&&!config.shotPreview)throw Error('同步预览尚未配置。');if(p.capability==='narration_generation')await assertNarrationReady(config.narration);if(nativeMediaTask(String(task.task_type),String(task.provider))||p.visualAssetPreparation?.imageGeneration)await assertMediaReady(config.media);return {version:workerPreflightVersion,checks:[{capability:p.capability,check:'command_availability',phase:'preflight',status:config.visualCommand.length&&(!p.visualAssetPreparation?.imageGeneration||Boolean(config.media))?'passed':'unavailable',reason:p.capability==='narration_generation'?`本地口播执行模式：${config.narration?.mode??'disabled'}。`:'本地受控规划执行路径；不自动调用在线Provider。',action:config.visualCommand.length&&(!p.visualAssetPreparation?.imageGeneration||Boolean(config.media))?'none':'contact_environment_admin',scope:'worker'}]};},
  reportProgress:async(_id,_attempt,progress)=>{await port.rpc('report_worker_progress',{...args,p_progress:{version:'worker-progress/v1',progress}});process.stdout.write(JSON.stringify({event:'progress',taskId:task.task_id,step:progress.step})+'\n');},
  reportResult:async(_id,_attempt,result)=>{await port.rpc('report_worker_result',{...args,p_result:result});},
  execute:async p=>p.capability==='acoustic_alignment'?executeNativeAlignment(config.projectRoot,config.mediaRoot,config.alignment,p):p.capability==='narration_generation'?executeNativeNarration(pool,config.narration,p,args):nativeMediaTask(String(task.task_type),String(task.provider))?executeNativeMedia(pool,config.media,p,args):p.storyboardRevision?executeStoryboardRevision(p):p.visualAssetPreparation?.imageGeneration?executeNativeMedia(pool,config.media,p,args,await executeVisual(p)):executeVisual(p),
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
