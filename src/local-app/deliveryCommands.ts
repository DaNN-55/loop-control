import{createHash}from'node:crypto';
import{writeFile}from'node:fs/promises';
import type{PoolClient}from'pg';
import{ConfigurationError}from'./configurationCommands.js';
import{verifyNativeFile}from'./localFiles.js';
import{safeAssetOutputPath}from'../worker/controlledMediaExecutor.js';
import{createPublishPackage,verifyPublishPackage}from'../publishing/publishPackage.js';
import{coverImageExtension,coverInputPath}from'../publishing/coverImage.js';
import type{ArtifactManifest}from'../worker/contracts.js';
interface Episode{id:string;stage:string;}
interface FileRow{artifact_type:string;relative_path:string;sha256:string;file_size:number|string;}
export interface DeliveryRuntime{deliveryReady?():Promise<void>}
const manifest=(a:FileRow):ArtifactManifest=>({artifactType:a.artifact_type,relativePath:a.relative_path,sha256:a.sha256,fileSize:Number(a.file_size)});
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export class NativeDeliveryCommands{
 async execute(c:PoolClient,e:Episode,root:string,runtime:DeliveryRuntime,command:string,data:Record<string,unknown>){
  if(command==='preparePublishPackage')return this.prepare(c,e,root,data);
  const qc=(await c.query("SELECT * FROM public.review_packages WHERE episode_id=$1 AND stage='qc_review' AND invalidated_at IS NULL ORDER BY revision_number DESC LIMIT 1",[e.id])).rows[0];
  if(!qc||qc.id!==data.reviewPackageId)throw new ConfigurationError(409,'当前 QC 审核包已变化，请刷新。');
  if(command==='retryFinalRender'){
   if(!['qc_passed','render_ready'].includes(e.stage))throw new ConfigurationError(409,'当前阶段不能重试最终成片。');await this.ready(runtime);this.reason(data.reason);
   const task=(await c.query("SELECT * FROM public.tasks WHERE episode_id=$1 AND task_type='generate_final_render' AND input_snapshot#>>'{final_render,source_review_package_id}'=$2 ORDER BY created_at DESC LIMIT 1",[e.id,qc.id])).rows[0];
   if(!task)throw new ConfigurationError(409,'最终成片任务不存在。');await this.inputs(root,task.input_snapshot);
   return(await c.query('SELECT to_jsonb(local_identity.retry_owned_final_render($1,$2)) result',[e.id,data.reason])).rows[0].result;
  }
  if(command==='approveQc'&&e.stage==='qc_passed'){
   this.reason(data.reason);const existing=(await c.query('SELECT to_jsonb(local_identity.current_owned_final_render($1,$2)) result',[e.id,qc.id])).rows[0]?.result;
   if(!existing)throw new ConfigurationError(409,'已批准审核包缺少最终成片任务。');await this.inputs(root,existing.input_snapshot);return existing;
  }
  if(e.stage!=='qc_review')throw new ConfigurationError(409,'当前阶段不能修改或批准 QC。');
  const task=(await c.query('SELECT * FROM public.tasks WHERE id=$1 AND episode_id=$2 AND status=\'completed\'',[qc.task_id,e.id])).rows[0];
  if(!task)throw new ConfigurationError(409,'当前审核渲染尚未完成。');await this.inputs(root,task.input_snapshot);
  if(command==='createQcIssue'){
   if(typeof data.atSeconds!=='number'||!Number.isFinite(data.atSeconds)||data.atSeconds<0||!['blocking','warning'].includes(String(data.severity))||(data.memberKey!==null&&data.memberKey!==undefined&&typeof data.memberKey!=='string'))throw new ConfigurationError(400,'QC 问题格式无效。');
   return(await c.query('SELECT to_jsonb(public.create_qc_review_issue($1,$2,$3,$4,$5)) result',[qc.id,data.memberKey??null,data.atSeconds,data.severity,this.reason(data.reason)])).rows[0].result;
  }
  if(command==='resolveQcIssue'){
   if(!['accepted','ignored'].includes(String(data.status))||!(await c.query('SELECT 1 FROM public.qc_review_issues WHERE id=$1 AND review_package_id=$2',[data.issueId,qc.id])).rowCount)throw new ConfigurationError(409,'QC 问题不属于当前审核包。');
   return(await c.query('SELECT to_jsonb(public.resolve_qc_review_issue($1,$2)) result',[data.issueId,data.status])).rows[0].result;
  }
  if(command!=='approveQc')throw new ConfigurationError(400,'交付命令无效。');
  this.reason(data.reason);await this.ready(runtime);
  if((await c.query("SELECT 1 FROM public.qc_review_issues WHERE review_package_id=$1 AND severity='blocking' AND status='open'",[qc.id])).rowCount)throw new ConfigurationError(409,'请先处理当前 QC 的阻塞问题。');
  const artifacts=(await c.query('SELECT * FROM public.artifacts WHERE episode_id=$1 AND producer_task_id=$2',[e.id,task.id])).rows as FileRow[];
  for(const type of ['review_render_project','review_render_runtime','review_qc_report'])if(!artifacts.some(a=>a.artifact_type===type))throw new ConfigurationError(409,'审核渲染证据不完整。');
  const approved=(await c.query('SELECT * FROM public.artifacts WHERE id=$1 AND episode_id=$2 AND producer_task_id=$3',[qc.artifact_id,e.id,task.id])).rows[0];if(!approved||!['render','review_render_video'].includes(approved.artifact_type))throw new ConfigurationError(409,'受审视频索引不匹配。');
  for(const a of artifacts)await this.file(root,a);
  const report=JSON.parse((await this.file(root,artifacts.find(a=>a.artifact_type==='review_qc_report')!)).toString('utf8'));if(report.passed!==true)throw new ConfigurationError(409,'技术 QC 尚未通过。');
  await c.query('UPDATE local_identity.input_episodes SET delivery_enabled=true WHERE episode_id=$1',[e.id]);
  await c.query('SELECT public.transition_episode($1,$2,$3)',[e.id,'qc_passed',data.reason]);
  const final=(await c.query('SELECT to_jsonb(t) result FROM local_identity.queue_owned_final_render($1) t',[e.id])).rows[0]?.result;if(!final)throw new ConfigurationError(409,'最终成片任务未创建。');await this.inputs(root,final.input_snapshot);return final;
 }
 private async ready(runtime:DeliveryRuntime){try{if(!runtime.deliveryReady)throw Error();await runtime.deliveryReady();}catch{throw new ConfigurationError(503,'本地最终成片执行环境尚未就绪，不会切换到在线执行。');}}
 private reason(v:unknown){if(typeof v!=='string'||!v.trim()||v.length>4000)throw new ConfigurationError(400,'请填写有效原因。');return v.trim();}
 private async file(root:string,a:FileRow){try{return await verifyNativeFile(root,a.relative_path,a.sha256,Number(a.file_size));}catch{throw new ConfigurationError(409,'交付输入或产物缺失、路径异常或指纹已变化。');}}
 private async inputs(root:string,snapshot:Record<string,unknown>){for(const a of (snapshot.input_artifacts??[]) as Array<{relativePath:string;sha256:string;fileSize:number}>)await this.file(root,{artifact_type:'input',relative_path:a.relativePath,sha256:a.sha256,file_size:a.fileSize});}
 private async immutable(root:string,a:ArtifactManifest,bytes:Buffer){
  const path=await safeAssetOutputPath(root,a.relativePath);
  try{await writeFile(path,bytes,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;await this.file(root,{artifact_type:a.artifactType,relative_path:a.relativePath,sha256:a.sha256,file_size:a.fileSize});}
 }
 private async packageReferences(root:string,episodeId:string,pack:{relativePath:string;sha256:string;fileSize:number},expected:ArtifactManifest[]){
  const bytes=await verifyNativeFile(root,pack.relativePath,pack.sha256,pack.fileSize),value=JSON.parse(bytes.toString('utf8'));const required=['final_render','cover','metadata','final_qc_report'];
  if(value.episodeId!==episodeId||!Array.isArray(value.artifacts)||value.artifacts.length!==required.length||required.some(type=>{const want=expected.find(a=>a.artifactType===type),matches=value.artifacts.filter((a:ArtifactManifest)=>a.artifactType===type);return !want||matches.length!==1||matches[0].relativePath!==want.relativePath||matches[0].sha256!==want.sha256||Number(matches[0].fileSize)!==want.fileSize;}))throw new ConfigurationError(409,'发布包清单与当前最终产物或发布输入不一致。');
 }
 private async prepare(c:PoolClient,e:Episode,root:string,data:Record<string,unknown>){
  if(!['qc_passed','production_completed'].includes(e.stage))throw new ConfigurationError(409,'请先通过 QC 并完成最终成片。');
  if(typeof data.title!=='string'||!data.title.trim()||data.title.trim().length>200||typeof data.description!=='string'||data.description.trim().length>5000||!Array.isArray(data.tags)||data.tags.length>20||data.tags.some(t=>typeof t!=='string'||!t.trim()||t.trim().length>50)||typeof data.coverBase64!=='string'||data.coverBase64.length>28*1024*1024)throw new ConfigurationError(400,'发布输入格式无效。');
  const bytes=Buffer.from(data.coverBase64,'base64'),ext=coverImageExtension(bytes);if(bytes.toString('base64')!==data.coverBase64||!ext||bytes.length>20*1024*1024)throw new ConfigurationError(400,'请上传有效 JPG、PNG 或 WebP 封面。');
  const cover:ArtifactManifest={artifactType:'cover',relativePath:coverInputPath(e.id,ext),sha256:digest(bytes),fileSize:bytes.length};
  const text=Buffer.from(JSON.stringify({title:data.title.trim(),description:data.description.trim(),tags:data.tags.map(t=>(t as string).trim())},null,2)+'\n');const metadata:ArtifactManifest={artifactType:'metadata',relativePath:`episodes/${e.id}/publish-input/metadata-v1.json`,sha256:digest(text),fileSize:text.length};
  const all=(await c.query('SELECT * FROM public.artifacts WHERE episode_id=$1',[e.id])).rows as FileRow[];
  for(const wanted of [cover,metadata]){const old=all.find(a=>a.artifact_type===wanted.artifactType);if(old&&(old.relative_path!==wanted.relativePath||old.sha256!==wanted.sha256||Number(old.file_size)!==wanted.fileSize))throw new ConfigurationError(409,'发布输入已经固定，不能覆盖。');}
  const qc=(await c.query("SELECT * FROM public.review_packages WHERE episode_id=$1 AND stage='qc_review' AND invalidated_at IS NULL ORDER BY revision_number DESC LIMIT 1",[e.id])).rows[0];
  const final=qc?(await c.query("SELECT * FROM public.tasks WHERE episode_id=$1 AND task_type='generate_final_render' AND status='completed' AND invalidated_at IS NULL AND input_snapshot#>>'{final_render,source_review_package_id}'=$2 ORDER BY created_at DESC LIMIT 1",[e.id,qc.id])).rows[0]:null;
  if(!final)throw new ConfigurationError(409,'当前已批准审核包的最终成片尚未完成。');await this.inputs(root,final.input_snapshot);
  const output=(await c.query('SELECT * FROM public.artifacts WHERE episode_id=$1 AND producer_task_id=$2',[e.id,final.id])).rows as FileRow[];for(const type of ['final_render','final_render_project','final_qc_report'])if(!output.some(a=>a.artifact_type===type))throw new ConfigurationError(409,'最终交付证据不完整。');for(const a of output)await this.file(root,a);
  const fixed=all.find(a=>a.artifact_type==='publish_package');
  if(fixed){await this.file(root,fixed);try{await verifyPublishPackage({assetRoot:root,episodeId:e.id,publishPackage:{relativePath:fixed.relative_path,sha256:fixed.sha256,fileSize:Number(fixed.file_size)}});}catch{throw new ConfigurationError(409,'固定发布包校验失败。');}await this.packageReferences(root,e.id,{relativePath:fixed.relative_path,sha256:fixed.sha256,fileSize:Number(fixed.file_size)},[...output.map(manifest),cover,metadata]);if(e.stage!=='production_completed')throw new ConfigurationError(409,'发布包验证记录未完成，请重试原操作。');return{episodeId:e.id,status:'verified',publishPackage:manifest(fixed)};}
  if(e.stage!=='qc_passed')throw new ConfigurationError(409,'生产完成的发布包索引缺失。');
  await this.immutable(root,cover,bytes);await this.immutable(root,metadata,text);
  let pack;try{pack=await createPublishPackage({assetRoot:root,episodeId:e.id,artifacts:[...output.map(manifest),cover,metadata]});await this.packageReferences(root,e.id,pack,[...output.map(manifest),cover,metadata]);await verifyPublishPackage({assetRoot:root,episodeId:e.id,publishPackage:pack});}catch{throw new ConfigurationError(409,'发布包文件或清单校验失败，生产尚未完成。');}
  const artifact=(await c.query('SELECT local_identity.complete_owned_publish($1,$2,$3,$4) result',[e.id,cover,metadata,pack])).rows[0].result;return{episodeId:e.id,status:'verified',publishPackage:manifest(artifact)};
 }
}
