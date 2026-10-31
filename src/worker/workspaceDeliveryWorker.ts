import {episodeFileIO} from '../local-app/episodeFiles.js';
import type {Pool} from 'pg';
import type {ClaimedTaskRow} from '../orchestration/workerDispatch.js';
import type {ArtifactManifest} from './contracts.js';
import type {WorkspaceDeliveryIdentity} from '../publishing/workspacePublishPackage.js';
import {createWorkspacePublishPackage} from '../publishing/workspacePublishPackage.js';
import {verifyPublishPackage} from '../publishing/publishPackage.js';
import {nativeWorkerPort} from '../local-app/workerDatabase.js';
/** Executes only frozen, exact bytes; no renderer or external Provider exists here. */
export async function executeWorkspaceDeliveryWorker(pool:Pool,root:string,task:ClaimedTaskRow){
 const snapshot=task.input_snapshot as {workspace_delivery:{identity:WorkspaceDeliveryIdentity;artifacts:ArtifactManifest[]};output:{relative_path:string}};
 const args={p_task_id:task.task_id,p_attempt:task.attempt,p_lease_token:task.lease_token},port=nativeWorkerPort(pool);
 await port.rpc('refresh_worker_task_lease',args);
 let result;
 try{
 const input=snapshot.workspace_delivery,storage=await episodeFileIO(pool,root,String(task.episode_id),true);
 const pack=await createWorkspacePublishPackage({assetRoot:root,episodeId:String(task.episode_id),relativePath:snapshot.output.relative_path,identity:input.identity,artifacts:input.artifacts,storage});
 await verifyPublishPackage({assetRoot:root,episodeId:String(task.episode_id),publishPackage:pack,expectedWorkspaceIdentity:input.identity,storage});
 result={version:'worker-result/v1',taskId:task.task_id,status:'completed',deliveryIdentity:input.identity,artifacts:[...input.artifacts.filter(a=>['cover','metadata','final_qc_report'].includes(a.artifactType)),{artifactType:'publish_package',...pack}],validation:{passed:true,checks:[{name:'exact_workspace_package',passed:true,detail:'已确认视频、完整工程、封面、元数据、检查证据及清单的归属、大小和 SHA-256 均通过。'}]},actualCostCents:0,blockers:[],retry:{shouldRetry:false,reason:'交付包已验证。'},nextStep:'下载已验证交付文件。'};
 await port.rpc('report_worker_result',{...args,p_result:result});
 }catch(error){
 result={version:'worker-result/v1',taskId:task.task_id,status:'failed',artifacts:[],validation:{passed:false,checks:[{name:'exact_workspace_package',passed:false,detail:'交付校验未通过。'}]},actualCostCents:0,blockers:[],retry:{shouldRetry:false,reason:error instanceof Error?error.message.slice(0,2000):'交付失败，可重试原文件。'},nextStep:'修复原文件后重试这份已确认导出。'};
 await port.rpc('report_worker_result',{...args,p_result:result});
 }
 return result;
}
