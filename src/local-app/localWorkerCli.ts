import {episodeFileIO} from './episodeFiles.js';
import {resolveEpisodeStorageLocation,requireEpisodeStorageDirectory} from './episodeStorageLocation.js';
import {requireAccountAssetRoot} from './accountAssetRoots.js';
import {executeWorkspaceDeliveryWorker} from '../worker/workspaceDeliveryWorker.js';
import{readMediaDeployment}from'./mediaDeployment.js';
import{assertAlignmentReady,executeNativeAlignment}from'./alignmentWorker.js';
import{assertMediaReady,executeNativeMedia,nativeMediaTask,nativeMediaRequiresExternal}from'./mediaWorker.js';
// Native task process: database authentication arrives over bounded stdin only.
import {runMediaTask,type ClaimedWorkerTask} from '../worker/mediaTaskRunner.js';
import {verifyMediaLibrary,verifyArtifactIndex} from '../worker/mediaLibrary.js';
import {assertRuntimeRelease,RuntimePreparationError} from '../orchestration/runtimeBuild.js';
import {fileURLToPath} from 'node:url';
import {realpath} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {nativeAssetRoot} from './localFiles.js';
import {createWorkerDatabase,nativeWorkerPort,assertWorkerDatabaseBinding,assertNativeWorkerDatabase} from './workerDatabase.js';
import type {NativeWorkerConfiguration} from './localWorkerService.js';
import type {ClaimedTaskRow} from '../orchestration/workerDispatch.js';
import {workerPreflightVersion} from '../worker/contracts.js';
import{verifyReportedStoryboardArtifact}from'../worker/storyboardArtifact.js';
import{executeNativeNarration,assertNarrationReady}from'./narrationWorker.js';
import{prepareNativeAttemptOutput}from'./nativeAttemptOutput.js';
import {NativePublicationUnknownError} from '../orchestration/workerOutcome.js';
// A detached Worker may outlive its parent; a closed log pipe must not strand its live lease.
process.stdout.on('error',(error:NodeJS.ErrnoException)=>{if(error.code!=='EPIPE')throw error;});
let input='';for await(const chunk of process.stdin){input+=String(chunk);if(Buffer.byteLength(input)>10*1024*1024)throw Error('Task input too large');}
if(!input.trim())throw Error('本地Worker需要常驻调度器通过stdin提供任务包；请使用 npm start。');
const {task,config}=JSON.parse(input) as {task:ClaimedTaskRow;config:NativeWorkerConfiguration};input='';
if(!config.runtimeRelease){const root=await realpath(fileURLToPath(new URL('../../../',import.meta.url)));config.runtimeRelease={root,id:basename(root)};}
if(await realpath(fileURLToPath(import.meta.url))!==join(config.runtimeRelease.root,'dist/worker/local-app/localWorkerCli.js'))throw new RuntimePreparationError('runtime_release_invalid');
await assertRuntimeRelease(config.projectRoot,config.runtimeRelease);
assertWorkerDatabaseBinding(config.database,config.applicationDatabase);
const pool=createWorkerDatabase(config.database),port=nativeWorkerPort(pool),args={p_task_id:task.task_id,p_attempt:task.attempt,p_lease_token:task.lease_token};
const heartbeat=setInterval(()=>{void port.rpc('refresh_worker_task_lease',args).catch(()=>{});},5*60*1000);heartbeat.unref();
try{
 await assertNativeWorkerDatabase(pool,config.database.database!,Boolean(config.narration),Boolean(config.media));
 await pool.query('SELECT local_identity.assert_current_worker_execution($1,$2,$3)',[task.task_id,task.attempt,task.lease_token]);
 await port.rpc('refresh_worker_task_lease',args);
 await readMediaDeployment(pool,config.mediaRoot);
 const location=await resolveEpisodeStorageLocation(pool,config.mediaRoot,String(task.episode_id)),physicalRoot=location.assetRoot;
 if((await pool.query('SELECT 1 FROM local_identity.account_asset_directories WHERE account_id=$1',[task.account_id])).rowCount)await requireAccountAssetRoot(pool,config.mediaRoot,String(task.account_id));
 await requireEpisodeStorageDirectory(pool,location);
 if(task.task_type==='prepare_publish_package'&&(task.input_snapshot as Record<string,unknown>)?.capability==='workspace_delivery'){const result=await executeWorkspaceDeliveryWorker(pool,physicalRoot,task);process.stdout.write(JSON.stringify(result)+'\n');}else{
 if(typeof task.task_type!=='string'||!((task.task_type==='align_shot_captions'&&task.provider==='whisperx')||nativeMediaTask(task.task_type,String(task.provider))|| (task.task_type==='generate_narration'&&task.provider==='volcengine_tts')))throw Error('Task outside native input/storyboard/narration boundary');
 let outputs:Awaited<ReturnType<typeof prepareNativeAttemptOutput>>|undefined;
 const result=await runMediaTask({
  actualCostCents:config.actualCostCents,
  async claimNextTask(){return {taskId:task.task_id,taskType:task.task_type,attempt:task.attempt,budgetLimitCents:task.budget_limit_cents,maxAttempts:task.max_attempts,provider:task.provider,model:task.model,promptVersion:task.prompt_version,episodeId:task.episode_id,accountId:task.account_id,blueprintVersionId:task.blueprint_version_id,title:task.title,allowedAssetRoot:physicalRoot,inputSnapshot:task.input_snapshot} as ClaimedWorkerTask;},
  async verifyAssetRoot(root){if(!(location.layoutVersion===1&&root===config.mediaRoot&&root===location.assetRoot))await nativeAssetRoot(config.mediaRoot,root);await verifyMediaLibrary({mediaRootBinding:(await pool.query("SELECT local_identity.media_deployment()->'binding' binding")).rows[0].binding,assetRoot:root,mountPath:config.mountPath,minimumFreeBytes:config.minimumFreeBytes,requireEpisodesDirectory:false,allowMountRoot:location.layoutVersion===1&&root===config.mediaRoot});},
  async verifyArtifacts(p,artifacts,storyboard){if(outputs){await outputs.verify(artifacts,storyboard);return;}const storage=await episodeFileIO(pool,physicalRoot,String(task.episode_id));await verifyArtifactIndex({assetRoot:p.assets.allowedRoot,episodeId:p.episode.id,episodeRelativePath:p.assets.episodeRelativePath,artifacts,storage});if(storyboard)await verifyReportedStoryboardArtifact({assetRoot:p.assets.allowedRoot,frozenInputs:p.assets.inputs,relativePath:p.output.relativePath,storyboard,storage});},
  async preflight(p){if(p.capability==='acoustic_alignment')await assertAlignmentReady(config.projectRoot,config.mediaRoot,config.alignment,p.model);if(p.capability==='narration_generation')await assertNarrationReady(config.narration);if(nativeMediaTask(String(task.task_type),String(task.provider)))await assertMediaReady(config.media,{},process.env,nativeMediaRequiresExternal(p));return {version:workerPreflightVersion,checks:[{capability:p.capability,check:'command_availability',phase:'preflight',status:'passed',reason:p.capability==='narration_generation'?`本地口播执行模式：${config.narration?.mode??'disabled'}。`:'本地已登记的媒体执行路径。',action:'none',scope:'worker'}]};},
  reportProgress:async(_id,_attempt,progress)=>{await port.rpc('report_worker_progress',{...args,p_progress:{version:'worker-progress/v1',progress}});process.stdout.write(JSON.stringify({event:'progress',taskId:task.task_id,step:progress.step})+'\n');},
  reportResult:async(_id,_attempt,result)=>{if(outputs?.uncertain)throw new NativePublicationUnknownError();if(outputs&&result.status==='completed')await outputs.publish(pool,result);else await port.rpc('report_worker_result',{...args,p_result:result});},
  execute:async p=>{
   outputs=await prepareNativeAttemptOutput(p,args,[],await episodeFileIO(pool,physicalRoot,String(task.episode_id),true));const staged=outputs.taskPackage;
   if(staged.capability==='acoustic_alignment')return executeNativeAlignment(config.projectRoot,config.mediaRoot,config.alignment,staged);
   if(staged.capability==='narration_generation')return executeNativeNarration(pool,config.narration,staged,args);
   if(nativeMediaTask(String(task.task_type),String(task.provider)))return executeNativeMedia(pool,config.media,staged,args);
   throw Error('任务未登记到本地媒体执行路径。');
  },
 });
 process.stdout.write(JSON.stringify(result??{status:'failed',taskId:task.task_id})+'\n');
}
}catch(error){if(!(error instanceof NativePublicationUnknownError))throw error;process.stdout.write(JSON.stringify({code:NativePublicationUnknownError.code,taskId:task.task_id,attempt:task.attempt})+'\n');process.exitCode=2;}finally{clearInterval(heartbeat);await pool.end();}
