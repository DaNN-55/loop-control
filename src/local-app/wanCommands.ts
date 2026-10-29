import {isVideoProvider,videoProviders} from "../worker/videoProviderCatalog.js";
import type {PoolClient} from 'pg';
import type {InputRuntime} from './episodeCommands.js';
import {ConfigurationError} from './configurationCommands.js';
import {verifyNativeFile} from './localFiles.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function executeWanCommand(c:PoolClient,e:{id:string;account_id:string;policy:Record<string,unknown>},root:string,runtime:InputRuntime,command:string,data:Record<string,unknown>,requestId:string){
 if(command==='setWanBudget'){
  if(!Number.isSafeInteger(data.trialCents)||!Number.isSafeInteger(data.totalCents)||Number(data.trialCents)<1||Number(data.totalCents)<Number(data.trialCents)||Number(data.totalCents)>100000||typeof data.full!=='boolean')throw new ConfigurationError(400,'生成预算须为有效金额，总上限不小于试片上限且不超过1000元。');
  return(await c.query('SELECT to_jsonb(public.set_generation_budget($1,$2,$3,$4)) result',[e.account_id,data.trialCents,data.totalCents,data.full])).rows[0].result;
 }
 let taskId:string;
 if(command==='resumeWan'){
  if(typeof data.taskId!=='string'||!uuid.test(data.taskId))throw new ConfigurationError(400,'万相任务标识无效。');
  const task=(await c.query("SELECT t.*,r.provider_task_id FROM public.tasks t LEFT JOIN public.paid_generation_reservations r ON r.task_id=t.id WHERE t.id=$1 AND t.episode_id=$2 AND t.provider IN ('bailian','volcengine','minimax','kling')",[data.taskId,e.id])).rows[0];
  if(!task)throw new ConfigurationError(404,'万相任务不可见。');
  if(!['failed','blocked'].includes(task.status)||!task.provider_task_id)throw new ConfigurationError(409,'只有已保存供应商任务 ID 的失败任务可以恢复；提交结果未知时请先核对供应商记录，不会重新收费提交。');
  await runtime.checkReferences(c,[task.input_snapshot.credential_ref]);
  for(const f of task.input_snapshot.input_artifacts??[])await verifyNativeFile(root,f.relativePath,f.sha256,Number(f.fileSize));
  await c.query('SELECT public.resume_wan_video_task($1)',[task.id]);taskId=task.id;
 }else{
  if(typeof data.reviewPackageId!=='string'||!uuid.test(data.reviewPackageId)||typeof data.firstFrameId!=='string'||!uuid.test(data.firstFrameId)||typeof data.shotId!=='string'||!data.shotId.trim()||data.shotId.length>200||typeof data.prompt!=='string'||!data.prompt.trim()||data.prompt.length>1500||!Number.isInteger(data.durationSeconds)||Number(data.durationSeconds)<2||Number(data.durationSeconds)>15)throw new ConfigurationError(400,'首帧、镜头动作或时长无效。');
  const rp=(await c.query("SELECT p.context_snapshot,a.relative_path,a.sha256,a.file_size FROM public.review_packages p JOIN public.artifacts a ON a.id=p.artifact_id AND a.episode_id=p.episode_id WHERE p.id=$1 AND p.episode_id=$2 AND p.stage='storyboard_review' AND p.invalidated_at IS NULL",[data.reviewPackageId,e.id])).rows[0];
  const shot=rp?.context_snapshot?.worker_result?.storyboard?.shots?.find((s:{id:string})=>s.id===data.shotId);
  if(!shot||!['a_roll','b_roll'].includes(shot.shotType))throw new ConfigurationError(409,'当前分镜镜头不可用，请刷新。');
  const config=e.policy[shot.shotType] as {credential_ref?:string;executor?:{provider?:string;adapter?:string}}|undefined;
  const provider=config?.executor?.provider??'',official=isVideoProvider(provider);
  if(!config?.credential_ref||!(provider==='bailian'&&config.executor?.adapter==='wan_video'||official&&config.executor?.adapter===videoProviders[provider].adapter))throw new ConfigurationError(409,'请为当前镜头选择视频连接。');
  if(official&&(command!=='generateOfficialVideo'||!Number.isSafeInteger(data.reservationCents)||Number(data.reservationCents)<1||Number(data.reservationCents)>100000||Number(data.durationSeconds)<videoProviders[provider].minDuration))throw new ConfigurationError(400,'请填写有效时长和本次费用预留额。');
  if(!official&&command==='generateOfficialVideo')throw new ConfigurationError(400,'视频执行方式已变化，请刷新。');
  await runtime.checkReferences(c,[config.credential_ref]);
  if(!runtime.mediaReady)throw new ConfigurationError(503,'本地媒体Worker尚未配置。');await runtime.mediaReady({[shot.shotType]:config});
  await verifyNativeFile(root,rp.relative_path,rp.sha256,Number(rp.file_size));
  const image=(await c.query('SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2',[data.firstFrameId,e.id])).rows[0];
  if(!image)throw new ConfigurationError(404,'首帧图片不可见。');await verifyNativeFile(root,image.storage_path,image.sha256,Number(image.file_size));
  // Opt in before INSERT so the existing output-namespace trigger isolates this
  // task. A rejected request rolls the opt-in back with the command transaction.
  await c.query('UPDATE local_identity.input_episodes SET media_enabled=true WHERE episode_id=$1',[e.id]);
  taskId=(await c.query(official?'SELECT public.request_official_shot_video($1,$2,$3,$4,$5,$6,$7,$8) id':'SELECT public.request_wan_shot_video($1,$2,$3,$4,$5,$6,$7) id',[e.id,data.reviewPackageId,data.shotId,data.firstFrameId,data.prompt.trim(),data.durationSeconds,requestId,...(official?[data.reservationCents]:[])])).rows[0].id;
 }
 return(await c.query('SELECT to_jsonb(t) result FROM public.tasks t WHERE id=$1 AND episode_id=$2',[taskId,e.id])).rows[0].result;
}
