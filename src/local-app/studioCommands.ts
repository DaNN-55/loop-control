import {defaultReviewRenderComposition,reviewRenderCompositionFromJson,reviewRenderCompositionToJson} from '../reviews/reviewComposition.js';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {ConfigurationError} from './configurationCommands.js';
import {verifyNativeFile} from './localFiles.js';
import {closeOpenChatCutStudio,openOpenChatCutStudio,snapshotOpenChatCutStudio,freezeOpenChatCutStudio,type OpenChatCutRuntimeConfig} from '../worker/openchatcutStudio.js';
import {shotPreparationContractFromSnapshot,reviewRenderFromSnapshot} from '../worker/codexRunner.js';
import {parseShotWorkbenchClipSegments,shotWorkbenchReviewRender} from '../worker/shotWorkbenchStudio.js';
import type {WorkerTaskPackage} from '../worker/contracts.js';
import {workerPreflightVersion} from '../worker/contracts.js';

interface AudioFile {id?:string;relative_path:string;sha256:string;file_size:number|string;start_seconds?:number|string;duration_seconds?:number|string}
interface SelectedAudio {member_key:string;cue:{kind:'bgm'|'sfx';startSeconds?:number};task?:{id:string};audio_track?:AudioFile;source_material?:AudioFile;duration_seconds?:number}
type Render=NonNullable<WorkerTaskPackage['reviewRender']>;
type Episode={id:string;stage:string;account_id:string;series_version_id:string|null;storyboard_enabled:boolean};
export interface StudioRuntime {studioRuntime?():Promise<OpenChatCutRuntimeConfig>}
interface Basis {hash:string;render:Render;mode:'workbench'|'shot'|'qc';reviewPackageId:string;sourcePath:string}
interface Binding {basis:Basis;workspaceRelativePath:string}
const editableStages=['storyboard_approved','production_ready','render_ready','qc_review'];
const identity=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class NativeStudioCommands {
 private bindings=new Map<string,Binding>();
 async closeEpisode(id:string){await closeOpenChatCutStudio(id);this.bindings.delete(id);}
 async close(){await Promise.all([...this.bindings.keys()].map(id=>closeOpenChatCutStudio(id)));this.bindings.clear();}
 async execute(c:PoolClient,e:Episode,root:string,runtime:StudioRuntime,command:string,data:Record<string,unknown>):Promise<unknown>{
  if(!e.storyboard_enabled||!editableStages.includes(e.stage))throw new ConfigurationError(409,'当前阶段不能编辑或冻结 Studio 工程。');
  let config:OpenChatCutRuntimeConfig;
  try{if(!runtime.studioRuntime)throw Error();config=await runtime.studioRuntime();}catch{throw new ConfigurationError(503,'本地 Studio 执行环境尚未就绪。',{version:workerPreflightVersion,checks:[{capability:'review_rendering',check:'command_availability',phase:'preflight',status:'unavailable',reason:'请检查本地 OpenChatCut、Node 与媒体工具；不会切换到在线执行。',action:'contact_environment_admin',scope:'worker'}]});}
  if(command==='requestStudioCompositionRevision'){
   const qc=await this.currentPackage(c,e.id,'qc_review');if(e.stage!=='qc_review'||!qc||qc.id!==data.reviewPackageId)throw new ConfigurationError(409,'当前审核包已变化，请刷新。');
   const sourcePath=qc.context_snapshot.project_relative_path,basis=await this.basis(c,e,root,sourcePath),binding=this.bindings.get(e.id);
   if(!binding||binding.basis.hash!==basis.hash){const opened=await openOpenChatCutStudio(root,e.id,basis.render,config);if(!opened.studioUrl)throw new ConfigurationError(409,'工作版本存在输入变更，请先打开 Studio 确认保留或替换。');this.bindings.set(e.id,{basis,workspaceRelativePath:opened.workspace.relativePath});}
   return this.execute(c,e,root,runtime,'submitStudioRevision',{...data,sourceProjectRelativePath:sourcePath,workspaceRelativePath:this.bindings.get(e.id)!.workspaceRelativePath});
  }
  if(command==='requestStudioStoryboardRevision'){
   const qc=await this.currentPackage(c,e.id,'qc_review');if(e.stage!=='qc_review'||!qc||qc.id!==data.reviewPackageId)throw new ConfigurationError(409,'当前审核包已变化，请刷新。');
   const reason=this.reason(data.reason);await this.verifyTask(c,root,qc.task_id);
   const result=(await c.query('SELECT to_jsonb(public.request_studio_storyboard_revision($1,$2)) result',[qc.id,reason])).rows[0].result;
   await closeOpenChatCutStudio(e.id);this.bindings.delete(e.id);return result;
  }
  const sourcePath=command==='openStudio'?data.projectRelativePath:data.sourceProjectRelativePath;
  if(typeof sourcePath!=='string'||!sourcePath.startsWith(`episodes/${e.id}/`))throw new ConfigurationError(400,'Studio 来源路径无效。');
  const basis=await this.basis(c,e,root,sourcePath);
  if(command==='openStudio'){
   if(data.replaceWorkspace!==undefined&&typeof data.replaceWorkspace!=='boolean')throw new ConfigurationError(400,'工作版本替换参数无效。');
   const opened=await openOpenChatCutStudio(root,e.id,basis.render,config,{replaceWorkspace:data.replaceWorkspace===true});
   if(opened.studioUrl){try{await this.verifyProjectSources(root,opened.workspace,basis.render);}catch(error){await closeOpenChatCutStudio(e.id);this.bindings.delete(e.id);throw error;}this.bindings.set(e.id,{basis,workspaceRelativePath:opened.workspace.relativePath});}
   return opened;
  }
  const binding=this.bindings.get(e.id);
  if(!binding||binding.basis.hash!==basis.hash||binding.workspaceRelativePath!==data.workspaceRelativePath)throw new ConfigurationError(409,'Studio 会话或输入已变化，请重新打开当前工程后提交。');
  if(command==='generateReviewVideo'&&(basis.mode!=='workbench'||data.reviewPackageId!==basis.reviewPackageId))throw new ConfigurationError(409,'请从当前整期镜头工作版本生成审核视频。');
  if(command==='submitStudioRevision'&&(e.stage!=='qc_review'||basis.mode!=='qc'||data.reviewPackageId!==basis.reviewPackageId))throw new ConfigurationError(409,'请从当前 QC 工作版本提交修订。');
  if(data.acceptDurationRisk!==undefined&&typeof data.acceptDurationRisk!=='boolean')throw new ConfigurationError(400,'时长风险接受参数无效。');
  if(data.riskReason!==undefined&&data.riskReason!==null&&(typeof data.riskReason!=='string'||data.riskReason.length>4000))throw new ConfigurationError(400,'时长风险原因无效。');
  const reason=command==='submitStudioRevision'?this.reason(data.reason):undefined;
  const workspace=await snapshotOpenChatCutStudio(root,e.id,binding.workspaceRelativePath);
  await this.verifyProjectSources(root,workspace,basis.render);
  const fingerprint=identity({command,basis:basis.hash,workspace:workspace.sha256,reason,acceptDurationRisk:data.acceptDurationRisk??false,riskReason:data.riskReason??null});
  const existing=(await c.query("SELECT t.* FROM public.tasks t WHERE t.episode_id=$1 AND t.task_type='generate_review_render' AND t.input_snapshot->>'native_studio_fingerprint'=$2 AND t.invalidated_at IS NULL AND EXISTS(SELECT 1 FROM public.review_packages p WHERE p.id::text=t.input_snapshot#>>'{review_render,pre_render_review_package_id}' AND p.episode_id=t.episode_id AND p.invalidated_at IS NULL) AND (t.status IN ('ready','running') OR (t.status='completed' AND t.id=(SELECT p.task_id FROM public.review_packages p WHERE p.episode_id=t.episode_id AND p.stage='qc_review' AND p.invalidated_at IS NULL ORDER BY p.revision_number DESC LIMIT 1))) ORDER BY t.created_at DESC LIMIT 1",[e.id,fingerprint])).rows[0];
  if(existing){await this.verifyTask(c,root,existing.id);return existing;}
  if((await c.query("SELECT 1 FROM public.tasks WHERE episode_id=$1 AND task_type='generate_review_render' AND invalidated_at IS NULL AND status IN ('ready','running')",[e.id])).rowCount)throw new ConfigurationError(409,'当前审核视频正在排队或生成，请等待完成。');
  const frozen=await freezeOpenChatCutStudio(root,e.id,binding.workspaceRelativePath,workspace.sha256);
  await this.verifyProjectSources(root,frozen,basis.render);
  const reference={relative_path:frozen.relativePath,sha256:frozen.sha256,file_size:frozen.fileSize};
  await c.query('UPDATE local_identity.input_episodes SET studio_enabled=true WHERE episode_id=$1',[e.id]);
  let task;
  if(command==='generateReviewVideo'){
   task=(await c.query('SELECT to_jsonb(t) result FROM public.generate_shot_review_video($1,$2,$3,$4,$5) t',[e.id,basis.reviewPackageId,reference,data.acceptDurationRisk??false,data.riskReason??null])).rows[0]?.result;
  }else{
   await c.query('SELECT public.request_review_render_revision($1,$2,$3)',[basis.reviewPackageId,{...this.composition(basis.render),studio_project:{...reference,composition:this.composition(basis.render)}},reason]);
   task=(await c.query('SELECT to_jsonb(t) result FROM local_identity.queue_owned_studio_render($1) t',[e.id])).rows[0]?.result;
  }
  if(!task)throw new ConfigurationError(409,'没有创建当前审核视频任务。');
  task=(await c.query('SELECT to_jsonb(local_identity.scope_input_studio_task($1,$2,$3)) result',[task.id,fingerprint,reference])).rows[0].result;
  await this.verifyTask(c,root,task.id);return task;
 }
 private reason(value:unknown){if(typeof value!=='string'||!value.trim()||value.length>4000)throw new ConfigurationError(400,'请填写有效修订原因。');return value.trim();}
 private async currentPackage(c:PoolClient,id:string,stage:string){return(await c.query('SELECT * FROM public.review_packages WHERE episode_id=$1 AND stage=$2 AND invalidated_at IS NULL ORDER BY revision_number DESC LIMIT 1',[id,stage])).rows[0];}
 private async file(root:string,path:string,sha:string,size:number){try{return await verifyNativeFile(root,path,sha,size);}catch{throw new ConfigurationError(409,'当前 Studio 输入或产物缺失、路径异常或指纹已变化。');}}
 private async verifyTask(c:PoolClient,root:string,id:string){
  const task=(await c.query('SELECT * FROM public.tasks WHERE id=$1',[id])).rows[0];if(!task)throw new ConfigurationError(409,'Studio 任务已变化。');
  for(const f of task.input_snapshot.input_artifacts??[])await this.file(root,f.relativePath,f.sha256,Number(f.fileSize));
  if(task.status==='completed'){
   const outputs=(await c.query('SELECT * FROM public.artifacts WHERE producer_task_id=$1',[id])).rows;
   if(!outputs.length)throw new ConfigurationError(409,'审核产物缺失。');for(const f of outputs)await this.file(root,f.relative_path,f.sha256,Number(f.file_size));
  }return task;
 }
 private async verifyProjectSources(root:string,file:{relativePath:string;sha256:string;fileSize:number},render:Render){
  const project=JSON.parse((await this.file(root,file.relativePath,file.sha256,file.fileSize)).toString('utf8'));
  const allowed=new Set(render.members.map(m=>m.relativePath));
  const visit=(value:unknown)=>{if(Array.isArray(value))return value.forEach(visit);if(!value||typeof value!=='object')return;for(const[key,entry]of Object.entries(value)){if(key==='src'&&typeof entry==='string'&&!allowed.has(entry))throw new ConfigurationError(409,'Studio 包含当前冻结输入以外的素材，请先经材料工作流批准。');visit(entry);}};visit(project);
 }
 private composition(render:Render){return reviewRenderCompositionToJson(render.adjustments);}
 private async basis(c:PoolClient,e:Episode,root:string,path:string):Promise<Basis>{
  const p=await this.currentPackage(c,e.id,'storyboard_review');if(!p)throw new ConfigurationError(409,'当前批准分镜不存在。');
  const boardFile=(await c.query('SELECT * FROM public.artifacts WHERE id=$1 AND episode_id=$2',[p.artifact_id,e.id])).rows[0];if(!boardFile)throw new ConfigurationError(409,'分镜产物缺失。');
  const board=JSON.parse((await this.file(root,boardFile.relative_path,boardFile.sha256,Number(boardFile.file_size))).toString('utf8'));
  let render:Render|undefined,mode:Basis['mode']='workbench',packageId=p.id,sourceId=p.id;
  if(e.stage==='qc_review'){
   const qc=await this.currentPackage(c,e.id,'qc_review');
   if(qc?.context_snapshot?.project_relative_path===path){const task=await this.verifyTask(c,root,qc.task_id);render=reviewRenderFromSnapshot(task.input_snapshot);mode='qc';packageId=qc.id;sourceId=task.id;}
  }
  if(!render&&path===boardFile.relative_path){
   const drafts=(await c.query('SELECT * FROM public.shot_preparation_drafts WHERE episode_id=$1 AND review_package_id=$2',[e.id,p.id])).rows;
   if(board.shots.some((shot:{id:string})=>!drafts.some(d=>d.shot_id===shot.id&&d.confirmation_status==='confirmed'&&d.preparation_input_fingerprint&&d.current_preview_input_fingerprint===d.preparation_input_fingerprint)))throw new ConfigurationError(409,'请先按当前输入确认全部镜头，再打开整期 Studio。');
   const materials=(await c.query('SELECT * FROM public.production_material_revisions WHERE episode_id=$1 AND id=ANY($2::uuid[])',[e.id,drafts.map(d=>d.selected_material_revision_id).filter(Boolean)])).rows;
   const tracks=(await c.query('SELECT * FROM public.audio_tracks WHERE episode_id=$1 AND id=ANY($2::uuid[])',[e.id,drafts.map(d=>d.current_audio_track_id).filter(Boolean)])).rows;
   for(const d of drafts){await this.verifyTask(c,root,d.current_preview_task_id);}
   for(const m of materials)await this.file(root,m.storage_path,m.sha256,Number(m.file_size));for(const t of tracks)await this.file(root,t.relative_path,t.sha256,Number(t.file_size));
   const selected=(await c.query('SELECT local_identity.studio_audio_members($1,$2) result',[e.id,p.id])).rows[0].result as SelectedAudio[];
   const soundtrackMembers:Render['members']=[];
   for(const audio of selected){const a=audio.audio_track??audio.source_material;if(!a)throw new ConfigurationError(409,'当前声音素材缺失。');await this.file(root,a.relative_path,a.sha256,Number(a.file_size));soundtrackMembers.push({memberKey:audio.member_key,memberKind:'soundtrack',audioKind:audio.cue.kind,...(audio.task?{taskId:audio.task.id}:{}),...(audio.audio_track?{audioTrackId:a.id}:{}),relativePath:a.relative_path,sha256:a.sha256,startSeconds:Number(a.start_seconds??audio.cue.startSeconds??0),durationSeconds:Number(a.duration_seconds??audio.duration_seconds)});}
   const settings=(await c.query('SELECT local_identity.studio_duration_settings($1) result',[e.id])).rows[0].result;
   render=shotWorkbenchReviewRender(e.id,path,{allowedFrames:Number(settings.allowed_frames),frameRate:Number(settings.frame_rate),storyboard:board,soundtrackMembers,materials:materials.map(m=>({id:m.id,relativePath:m.storage_path,sha256:m.sha256})),audioTracks:tracks.map(t=>({id:t.id,cueId:t.cue_id??'',relativePath:t.relative_path,sha256:t.sha256,startSeconds:Number(t.start_seconds),durationSeconds:Number(t.duration_seconds)})),drafts:drafts.map(d=>({audioMode:d.audio_mode,audioTrackId:d.current_audio_track_id,clipSegments:parseShotWorkbenchClipSegments(d.clip_segments),composition:d.composition,confirmationStatus:d.confirmation_status,inputFingerprint:d.preparation_input_fingerprint,materialRevisionId:d.selected_material_revision_id,preparationContract:shotPreparationContractFromSnapshot(d.preparation_contract),shotId:d.shot_id,subtitleText:d.subtitle_text,subtitlesEnabled:d.subtitles_enabled,ttsText:d.tts_text,videoArtifactId:d.current_video_artifact_id,videoTaskId:d.current_video_task_id}))});
  }
  if(render&&mode==='workbench'){
   const rules=e.series_version_id?(await c.query('SELECT rules FROM public.series_versions WHERE id=$1 AND account_id=$2',[e.series_version_id,e.account_id])).rows[0]?.rules:undefined;
   const candidate={...reviewRenderCompositionToJson(defaultReviewRenderComposition),...(rules?.openchatcut_composition??{}),frame_rate:render.adjustments.frameRate,allowed_frames:render.adjustments.allowedFrames};
   const composition=reviewRenderCompositionFromJson(candidate);if(!composition)throw new ConfigurationError(409,'当前冻结系列合成规则无效。');
   render.adjustments={...composition,frameRate:render.adjustments.frameRate,allowedFrames:render.adjustments.allowedFrames,reason:'镜头工作版本'};
  }
  if(!render){
   const draft=(await c.query('SELECT d.* FROM public.shot_preparation_drafts d JOIN public.artifacts a ON a.id=d.current_preview_project_artifact_id WHERE d.episode_id=$1 AND d.review_package_id=$2 AND a.relative_path=$3 AND d.current_preview_input_fingerprint=d.preparation_input_fingerprint',[e.id,p.id,path])).rows[0];
   if(draft){const task=await this.verifyTask(c,root,draft.current_preview_task_id);render=reviewRenderFromSnapshot(task.input_snapshot);mode='shot';sourceId=task.id;}
  }
  if(!render)throw new ConfigurationError(409,'Studio 工程不是当前分镜、同步预览或 QC 版本。');
  if(render.studioProject)await this.file(root,render.studioProject.relativePath,render.studioProject.sha256,render.studioProject.fileSize);
  const basis={mode,reviewPackageId:packageId,sourcePath:path,render};return{...basis,hash:identity({...basis,sourceId})};
 }
}
