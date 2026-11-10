import {legacyVideoDefault} from './legacyVideoCompatibility.js';
import {defaultShotComposition,shotCompositionRect,shotCompositionTransform,shotCompositionSlotLabels,shotCompositionLayouts} from '../shotComposition.js';
import type {StoryboardShotManifest} from '../worker/contracts.js';
import {prepareWorkspaceVideoSound} from './workspaceVideoSound.js';
import {applyWorkspaceVideoSound} from '../workspaceVideoSound.js';
import {requiresWorkspaceCall} from '../workspaceCall.js';
import {prepareWorkspaceCall,consumeWorkspaceCall} from './workspaceCallConfirmation.js';
import {verifyEpisodeFile,episodeFileIO} from './episodeFiles.js';
import {saveWorkspacePlanningSelection} from './planningSelectionStore.js';
import {readWorkspacePexels} from './workspacePexels.js';
import {readWorkspaceScriptResume,resumeWorkspaceScript} from './workspaceScriptResume.js';
import {prepareAuthoredWorkspace,readWorkspacePlanning,syncWorkspaceShotInputs,readWorkspacePreparation,preserveLegacyWorkspace,preserveLegacyDocument,recoverLegacyBindings} from './workspacePreparation.js';
import {importLegacyHtmlWorkspace} from './legacyHtmlWorkspace.js';
import {adaptLegacyWorkspaceMetadata} from './legacyWorkspaceMetadata.js';
import {readLegacyStudioProject} from './legacyStudioProject.js';
import {verifyReportedStoryboardArtifact} from '../worker/storyboardArtifact.js';
import {readWorkspaceVisualCandidates,readWorkspaceVisualTasks,readWorkspaceVisualTargets,validateWorkspaceVisualUses,executeWorkspaceVisualCandidate} from './workspaceVisualCandidates.js';
import {workspaceVisualFields} from '../workspaceVisualCandidates.js';
import {readWorkspaceCandidates,readUsedWorkspaceNarrationVersions,validateWorkspaceCandidateUses,executeWorkspaceCandidateCommand} from './workspaceCandidates.js';
import {executeWorkspaceAudio,readWorkspaceAudio} from './workspaceAudio.js';
import {workspaceAudioFields,resolveWorkspaceMainVoice} from '../workspaceAudio.js';
import {executeWorkspaceDelivery,readWorkspaceDeliveries} from './workspaceDeliveryCommands.js';
import {workspaceDeliveryFields} from '../workspaceDelivery.js';
import {migrateWorkspaceCaptionLanes} from '../workspaceCaptions.js';
import {applyWorkspaceShotOperation,isWorkspaceShotOperation,synchronizeWorkspaceBindings,withWorkspaceShotMetadata,workspaceShotIdentity} from '../workspaceShots.js';
import {resolveWorkspaceSource,registerWorkspaceBundledSound} from './workspaceSources.js';
import {executeWorkspaceNarration,readWorkspaceNarration} from './workspaceNarration.js';
import type {InputRuntime} from './episodeCommands.js';
import {executeWorkspaceExport,readWorkspaceExports,usedWorkspaceContent} from './workspaceExportCommands.js';
import {workspaceExportFields} from '../workspaceExport.js';
import {saveWorkspaceVideoRanges} from './workspaceVideo.js';
import {executeWorkspaceCaptionCommand,readWorkspaceCaptions,syncNativeWorkspaceCaptions,assembleWorkspaceCaptions} from './workspaceCaptionsCommands.js';
import {workspaceCaptionFields} from '../workspaceCaptions.js';
import {matchWorkspaceImage,generateWorkspaceImage,fillWorkspaceImageResult} from './workspaceImages.js';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {dirname,relative} from 'node:path';
import type {PoolClient} from 'pg';
import {ConfigurationError} from './configurationCommands.js';
import {verifyNativeFile} from './localFiles.js';
import {safeAssetOutputPath} from '../worker/controlledMediaExecutor.js';
import {inspectWorkspaceVisualFile} from './workspaceVisualMedia.js';
import {probeMp3Artifact,inspectMp4Artifact} from '../worker/mediaTools.js';
import {inspectOpenChatCutProjectWithRuntime,type OpenChatCutProjectObservation} from '../worker/openchatcutProjectReader.js';
import {openOpenChatCutDraftStudio,snapshotOpenChatCutStudio,closeOpenChatCutStudio,isOpenChatCutStudio,type OpenChatCutRuntimeConfig} from '../worker/openchatcutStudio.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import type {ProductionWorkspace,WorkspaceClip} from '../productionWorkspace.js';
interface Episode {id:string;account_id:string;policy:Record<string,unknown>;main_script_revision_id:string|null;stage:string;archived_at?:string|null}
export interface ProductionWorkspaceRecord {id:string;episode_id:string;workflow_version:'four-step/v1';script_revision_id:string;storyboard_package_id:string;revision:string|number;native_edit_revision:string|number;bindings:WorkspaceClip[];project_path:string;project_sha256:string;content_sha256:string;project_size:string|number}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
export async function readProductionWorkspace(c:PoolClient,episodeId:string,root:string):Promise<ProductionWorkspace|null>{
 const row=(await c.query('SELECT w.*,e.main_script_revision_id current_script,e.stage episode_stage,p.invalidated_at FROM local_identity.production_workspaces w JOIN public.episodes e ON e.id=w.episode_id JOIN public.review_packages p ON p.id=w.storyboard_package_id WHERE w.episode_id=$1',[episodeId])).rows[0];
 if(!row)return null;
 const project=JSON.parse((await verifyEpisodeFile(c,root,episodeId,row.project_path,row.project_sha256,Number(row.project_size))).toString('utf8')) as OpenChatCutProject;
 const usedContent=usedWorkspaceContent(project),placeholders=row.bindings.filter((b:WorkspaceClip)=>usedContent.items.some(i=>i.id===b.itemId&&(!['video','image'].includes(String(i.kind))||!i.src))).map((b:WorkspaceClip)=>b.itemId),missingSources:string[]=[];
 for(const path of usedContent.paths)try{await resolveWorkspaceSource(c,root,episodeId,path);}catch{missingSources.push(path);}
 let captionProblem=false;const captions=await readWorkspaceCaptions(c,root,{...row,bindings:row.bindings.filter((b:WorkspaceClip)=>usedContent.ids.has(b.itemId))},project).catch(()=>{captionProblem=true;return[];});
 const exportState=await readWorkspaceExports(c,root,row),inputsReady=!placeholders.length&&!missingSources.length&&!captionProblem&&captions.filter(x=>usedContent.ids.has(x.itemId)&&x.contract.enabled).every(x=>x.timing==='current'&&x.textConfirmed),stale=row.current_script!==row.script_revision_id||!!row.invalidated_at;
 if(!inputsReady||stale)for(const e of exportState.exports)e.confirmed=false;
 const deliverable=inputsReady&&!stale&&!!exportState.exports[0]?.current&&exportState.exports[0].status==='ready'&&exportState.exports[0].checks.every(x=>x.passed);
 const history=(await c.query('SELECT revision,project_sha256,script_revision_id,reason,created_at FROM local_identity.production_workspace_versions WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 50',[row.id])).rows.map(v=>({revision:Number(v.revision),sha256:v.project_sha256,scriptRevisionId:v.script_revision_id,reason:v.reason,createdAt:v.created_at}));
 const recovered=(await c.query('SELECT decision,relative_path,sha256,file_size FROM local_identity.workspace_legacy_recoveries WHERE workspace_id=$1',[row.id])).rows[0];
 const config=(await c.query('SELECT b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[episodeId])).rows[0]?.policy;
 return{scriptResume:stale?await readWorkspaceScriptResume(c,root,row,row.current_script,row.episode_stage):undefined,selectedImages:(await c.query('SELECT s.target_item_id "targetItemId",s.candidate_id "candidateId",v.material_revision_id "materialRevisionId" FROM local_identity.workspace_visual_image_choices s JOIN local_identity.workspace_visual_candidates v ON v.id=s.candidate_id WHERE s.workspace_id=$1',[row.id])).rows,visualConfiguration:{...(config?.static_visual?.credential_ref?{imageSelection:{capability:'image' as const,provider:config.static_visual.executor?.provider,adapter:config.static_visual.executor?.adapter,model:config.static_visual.executor?.model,connectionVersionId:config.static_visual.credential_ref}}:{}),imageModel:config?.static_visual?.executor?.model??null,videoModel:legacyVideoDefault(config)?.executor?.model??null,videoProvider:legacyVideoDefault(config)?.executor?.provider??null},...(recovered?{recovery:{decision:recovered.decision,relativePath:recovered.relative_path,sha256:recovered.sha256,fileSize:Number(recovered.file_size)}}:{}),preparation:await readWorkspacePreparation(c,row),pexels:await readWorkspacePexels(c,root,row),visualCandidates:await readWorkspaceVisualCandidates(c,row,project,root),visualTasks:await readWorkspaceVisualTasks(c,row),visualTargets:await readWorkspaceVisualTargets(c,row,project),audio:await readWorkspaceAudio(c,row,project),deliveries:await readWorkspaceDeliveries(c,root,row),usedNarration:await readUsedWorkspaceNarrationVersions(c,row,project),candidates:await readWorkspaceCandidates(c,row,project),...exportState,captions,id:row.id,episodeId,workflowVersion:row.workflow_version,scriptRevisionId:row.script_revision_id,storyboardPackageId:row.storyboard_package_id,revision:Number(row.revision),contentSha256:row.content_sha256,nativeEditRevision:Number(row.native_edit_revision),narration:await readWorkspaceNarration(c,row,project),clips:row.bindings,project:{relativePath:row.project_path,sha256:row.project_sha256,fileSize:Number(row.project_size),projectId:`loop-control-${episodeId}`},history,readiness:{deliverable,placeholders,missingSources},stale};
}
// Creative sound notes do not alter the rendered content or its confirmed version.
export function workspaceContentSha256(project:OpenChatCutProject):string{
 const content=structuredClone(project);for(const timeline of content.timelines){for(const item of timeline.items)if(item.loopControlShot&&typeof item.loopControlShot==='object')delete (item.loopControlShot as {soundIntent?:string}).soundIntent;delete (timeline as unknown as Record<string,unknown>).selectedId;delete (timeline as unknown as Record<string,unknown>).selectedIds;}
 return hash(JSON.stringify(content));
}
export class ProductionWorkspaceCommands{
 private opened=new Set<string>();
 isOpen(id:string){return this.opened.has(id)&&isOpenChatCutStudio(id);}
 async closeEpisode(id:string){await closeOpenChatCutStudio(id);this.opened.delete(id);}
 async close(){await Promise.all([...this.opened].map(id=>this.closeEpisode(id)));}

 async execute(c:PoolClient,e:Episode,root:string,runtime:InputRuntime,command:string,data:Record<string,unknown>,confirmedCall=false):Promise<unknown>{
  if(e.archived_at||e.stage==='production_completed'||(await c.query('SELECT local_identity.is_historical_episode($1) historical',[e.id])).rows[0].historical)throw new ConfigurationError(409,'历史或已完成生产单只读。');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[e.id+':studio']);
  if(command==='authorizeWorkspacePreparation')throw new ConfigurationError(409,'请在生成时确认本次调用，不再开启整期在线制作。');
  if(requiresWorkspaceCall(command,data)&&!confirmedCall)throw new ConfigurationError(409,'请先确认本次调用与费用预留。');
  if(command==='saveWorkspacePlanningSelection')return saveWorkspacePlanningSelection(c,e.id,data);
  let row=(await c.query('SELECT * FROM local_identity.production_workspaces WHERE episode_id=$1 FOR UPDATE',[e.id])).rows[0] as ProductionWorkspaceRecord|undefined;
  if(command==='adoptLegacyWorkspace'){
   if(row)throw new ConfigurationError(409,'已有可编辑工作版本，请刷新并继续该版本；不会覆盖已有编辑。');
   if(!e.main_script_revision_id||data.expectedScriptRevisionId!==e.main_script_revision_id)throw new ConfigurationError(409,'主脚本基准已变化，请刷新生产单。');
   if(isOpenChatCutStudio(e.id))throw new ConfigurationError(409,'请先保存并关闭原编辑器，再继续已有工程。');
   const board=(await c.query("SELECT * FROM public.review_packages WHERE episode_id=$1 AND stage='storyboard_review' AND invalidated_at IS NULL ORDER BY revision_number DESC LIMIT 1",[e.id])).rows[0];
   if(!board||board.id!==data.reviewPackageId)throw new ConfigurationError(409,'当前分镜基准已变化，请刷新生产单。');
   const saved=await readLegacyStudioProject(c,root,e.id);
   let recovery, importedRender:ReturnType<typeof importLegacyHtmlWorkspace>['render']|undefined;
   if(data.savedProjectSha256!==undefined){
    if(data.artifactId!==undefined||data.expectedSourceSha256!==undefined||typeof data.savedProjectSha256!=='string'||!saved||saved.sha256!==data.savedProjectSha256)throw new ConfigurationError(409,'已保存工程已变化，请重新读取后继续。');
    recovery=await preserveLegacyWorkspace(c,root,e.id,'preserve');
    if(!recovery||hash(JSON.stringify(recovery.project,null,2)+'\n')!==data.savedProjectSha256)throw new ConfigurationError(409,'已保存工程已变化，未接入旧版本。');
   }else{
    if(saved)throw new ConfigurationError(409,'已有保存的编辑，请选择最近保存的工作版本继续。');
    if(typeof data.artifactId!=='string'||!uuid.test(data.artifactId)||typeof data.expectedSourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(data.expectedSourceSha256))throw new ConfigurationError(400,'请选择已有 OpenChatCut 工程和版本指纹。');
    const source=(await c.query("SELECT a.*,t.input_snapshot FROM public.artifacts a JOIN public.tasks t ON t.id=a.producer_task_id AND t.episode_id=a.episode_id AND t.status='completed' WHERE a.id=$1 AND a.episode_id=$2 AND a.artifact_type IN ('review_render_project','final_render_project')",[data.artifactId,e.id])).rows[0];
    if(!source||source.sha256!==data.expectedSourceSha256)throw new ConfigurationError(409,'原工程文件或版本已变化，请重新选择。');
    if(!/\.(json|html)$/.test(source.relative_path))throw new ConfigurationError(409,'此工程格式暂不支持接入，原版本保持不变。');
    const frozen=source.input_snapshot?.review_render??source.input_snapshot?.final_render?.review_render;
    const pre=frozen?.pre_render_review_package_id;
    const origin=typeof pre==='string'&&uuid.test(pre)?(await c.query("SELECT CASE WHEN stage='storyboard_review' THEN id::text ELSE context_snapshot->>'storyboard_review_package_id' END board FROM public.review_packages WHERE id=$1 AND episode_id=$2",[pre,e.id])).rows[0]?.board:null;
    if(origin!==board.id)throw new ConfigurationError(409,'原工程对应其他分镜基准，请选择当前分镜对应的工程。');
    let bytes:Buffer;try{bytes=await verifyEpisodeFile(c,root,e.id,source.relative_path,source.sha256,Number(source.file_size));}catch{throw new ConfigurationError(409,'原工程缺失或指纹不符，未修改原文件。');}
    let project;try{if(source.relative_path.endsWith('.html')){const native=frozen?.studio_project??frozen?.adjustments?.studio_project;if(native){project=JSON.parse((await verifyEpisodeFile(c,root,e.id,native.relative_path,native.sha256,Number(native.file_size))).toString('utf8'));}else{const imported=importLegacyHtmlWorkspace(source.input_snapshot,bytes.toString('utf8'),`loop-control-${e.id}`);project=imported.project;importedRender=imported.render;}}else project=JSON.parse(bytes.toString('utf8'));}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'原工程缺失或格式无效，未修改原文件。');}
    if(project.version!==3||!Array.isArray(project.timelines)||!Array.isArray(project.assets))throw new ConfigurationError(409,'原工程不是可编辑的 OpenChatCut 文档。');
    if(importedRender)for(const member of importedRender.members){const frozenSource=source.input_snapshot.input_artifacts?.find((f:{relativePath:string;sha256:string})=>f.relativePath===member.relativePath&&f.sha256===member.sha256);if(!frozenSource)throw new ConfigurationError(409,'旧工程素材缺少对应冻结来源，未接入其他版本。');await verifyEpisodeFile(c,root,e.id,member.relativePath,member.sha256,Number(frozenSource.fileSize));}
    recovery={...await preserveLegacyDocument(c,root,e.id,{project,source:{artifactId:source.id,relativePath:source.relative_path,sha256:source.sha256,fileSize:Number(source.file_size)}}),decision:'preserve' as const};
   }
   const id=randomUUID(),project=structuredClone(recovery.project),shots=board.context_snapshot?.worker_result?.storyboard?.shots??board.context_snapshot?.storyboard?.shots;
   if(!Array.isArray(shots)||!shots.length)throw new ConfigurationError(409,'原分镜记录不可用，未重新生成工程。');
   if(importedRender&&JSON.stringify(shots.map((s:{id:string})=>s.id))!==JSON.stringify(importedRender.storyboard.shots.map(s=>s.id)))throw new ConfigurationError(409,'旧工程未覆盖当前完整分镜，未建立缺少镜头的副本。');
   const original:WorkspaceClip[]=shots.map((s:{id:string;scriptSegment:string})=>({id:randomUUID(),itemId:`shot-${s.id}`,shotId:s.id,text:s.scriptSegment,source:null}));
   const clips=await recoverLegacyBindings(c,root,e.id,id,project,original);
   if(importedRender){
    for(const member of importedRender.members){const source=await resolveWorkspaceSource(c,root,e.id,member.relativePath);if(source.sha256!==member.sha256)throw new ConfigurationError(409,'当前素材登记与旧工程冻结版本不一致。');}
    // Source asset duration is the full file, not the selected legacy interval.
    for(const asset of project.assets){const observed=asset.kind==='video'?await inspectWorkspaceVisualFile(root,relative(root,await (await episodeFileIO(c,root,e.id)).resolveReference(asset.src)),'video'):null;asset.durationInFrames=Math.ceil((observed?.durationSeconds??await probeMp3Artifact(await (await episodeFileIO(c,root,e.id)).resolveReference(asset.src)))*project.timelines[0].fps);if(observed)Object.assign(asset,{width:observed.width,height:observed.height});}
    for(const item of project.timelines[0].items){const asset=project.assets.find(a=>a.id===item.sourceAssetId||a.src===item.src);if(asset&&Number(item.srcInFrame??0)+Number(item.durationInFrames)>asset.durationInFrames+1)throw new ConfigurationError(409,'旧工程的实际使用区间超出原文件，未接入不完整素材。');}
    adaptLegacyWorkspaceMetadata(project,clips,importedRender);
   }
   if(!runtime.studioRuntime)throw new ConfigurationError(503,'本地 Studio 未配置。');
   await validateWorkspaceProject(c,root,e.id,project,await runtime.studioRuntime());
   const file=await persistWorkspaceProject(c,root,e.id,project);
   row=(await c.query('INSERT INTO local_identity.production_workspaces(id,episode_id,script_revision_id,storyboard_package_id,bindings,project_path,project_sha256,project_size,content_sha256,native_edit_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1) RETURNING *',[id,e.id,e.main_script_revision_id,board.id,JSON.stringify(clips),file.relativePath,file.sha256,file.fileSize,workspaceContentSha256(project)])).rows[0];
   await recordWorkspaceVersion(c,row!,importedRender?'从旧 HTML 冻结工程接入逐镜头编辑':'从原 OpenChatCut 工程继续编辑');await syncWorkspaceShotInputs(c,row!,clips);
   await c.query('INSERT INTO local_identity.workspace_legacy_recoveries(workspace_id,decision,relative_path,sha256,file_size) VALUES($1,$2,$3,$4,$5)',[id,'preserve',recovery.relativePath,recovery.sha256,recovery.fileSize]);
   return readProductionWorkspace(c,e.id,root);
  }
  if(command==='resumeWorkspaceEditing'){
   if(!row)throw new ConfigurationError(409,'原工作空间不存在。');
   if(isOpenChatCutStudio(e.id))throw new ConfigurationError(409,'请先保存并返回，再确认脚本排版修订。');
   await resumeWorkspaceScript(c,root,row,e.main_script_revision_id,e.stage,data);
   const resumed=(await c.query('SELECT * FROM local_identity.production_workspaces WHERE id=$1',[row.id])).rows[0] as ProductionWorkspaceRecord;
   await syncWorkspaceShotInputs(c,resumed,resumed.bindings);
   await recordWorkspaceVersion(c,resumed,'确认脚本排版修订，沿用原工程继续编辑');
   return readProductionWorkspace(c,e.id,root);
  }
  if(command==='retryWorkspacePlanning'){
   if(!e.main_script_revision_id||e.main_script_revision_id!==data.expectedScriptRevisionId||row?.script_revision_id===e.main_script_revision_id)throw new ConfigurationError(409,'当前脚本或制作依据已变化。');
   if(typeof data.taskId!=='string'||!uuid.test(data.taskId))throw new ConfigurationError(400,'规划任务无效。');
   let taskId;try{taskId=(await c.query('SELECT local_identity.queue_workspace_planning($1,$2,$3) id',[e.id,e.main_script_revision_id,data.taskId])).rows[0].id;}catch(error){if((error as {code?:string}).code==='40001')throw new ConfigurationError(409,'规划任务已变化，请刷新当前结果。');throw error;}return readWorkspacePlanning(c,taskId);
  }
  if(command==='replanWorkspace'&&data.planningTaskId){
   if(!e.main_script_revision_id||e.main_script_revision_id!==data.expectedScriptRevisionId||typeof data.planningTaskId!=='string'||!uuid.test(data.planningTaskId))throw new ConfigurationError(409,'当前脚本或规划任务已变化。');
   try{const task=(await c.query('SELECT local_identity.replan_workspace_planning($1,$2,$3) id',[e.id,e.main_script_revision_id,data.planningTaskId])).rows[0].id;return readWorkspacePlanning(c,task);}catch(error){if((error as {code?:string}).code==='40001')throw new ConfigurationError(409,'规划任务已变化，请刷新后重试。');throw error;}
  }
  if(command==='prepareWorkspace'||command==='replanWorkspace'){
   if(!e.main_script_revision_id||e.main_script_revision_id!==data.expectedScriptRevisionId)throw new ConfigurationError(409,'脚本基准已变化，请先确认当前脚本。');
   if(!data.reviewPackageId&&command==='prepareWorkspace'&&row?.script_revision_id===e.main_script_revision_id){
    await syncWorkspaceShotInputs(c,row,row.bindings);return readProductionWorkspace(c,e.id,root);
   }
   let p=(await c.query("SELECT p.*,a.relative_path,a.sha256,a.file_size FROM public.review_packages p JOIN public.artifacts a ON a.id=p.artifact_id WHERE p.id=$1 AND p.episode_id=$2 AND p.stage='storyboard_review' AND p.invalidated_at IS NULL",[data.reviewPackageId,e.id])).rows[0];
   if(!p&&!data.reviewPackageId)p=await prepareAuthoredWorkspace(c,root,e);
   if(p?.context_snapshot?.workspace_preparation?.scriptRevisionId===e.main_script_revision_id){await verifyEpisodeFile(c,root,e.id,p.relative_path,p.sha256,Number(p.file_size));await verifyReportedStoryboardArtifact({storage:await episodeFileIO(c,root,e.id),assetRoot:root,relativePath:p.relative_path,frozenInputs:p.context_snapshot.input_artifacts,storyboard:p.context_snapshot.worker_result.storyboard});await c.query('SELECT local_identity.confirm_workspace_plan($1,$2,$3)',[e.id,e.main_script_revision_id,p.id]);}
   const formal=p&&(await c.query('SELECT 1 FROM local_identity.workspace_preparations WHERE package_id=$1 AND script_revision_id=$2',[p.id,e.main_script_revision_id])).rowCount;
   if(!p||!formal&&!['storyboard_review','storyboard_approved','production_ready','render_ready','qc_review','qc_passed'].includes(e.stage))throw new ConfigurationError(409,'请先确认脚本与分镜匹配基准。');
   if(row){
    const same=row.script_revision_id===e.main_script_revision_id&&row.storyboard_package_id===p.id;
    if(same){await syncWorkspaceShotInputs(c,row,row.bindings);return readProductionWorkspace(c,e.id,root);}
    if(command!=='replanWorkspace'||data.workspaceId!==row.id||data.expectedRevision!==Number(row.revision))throw new ConfigurationError(409,'已有工程使用旧基准，请明确重新规划；不会覆盖原工程。');
    if(data.reason!==undefined&&(typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>4000))throw new ConfigurationError(400,'规划更新说明无效。');
    if(isOpenChatCutStudio(e.id))throw new ConfigurationError(409,'请先保存并返回，再重新规划。');
   }else if(command==='replanWorkspace')throw new ConfigurationError(409,'原工程不存在，请先建立初稿。');
   const storyboard=JSON.parse((await verifyEpisodeFile(c,root,e.id,p.relative_path,p.sha256,Number(p.file_size))).toString('utf8'));
   if(!Array.isArray(storyboard.shots)||!storyboard.shots.length||new Set(storyboard.shots.map((s:{id:string})=>s.id)).size!==storyboard.shots.length)throw new ConfigurationError(409,'分镜基准无效。');
   if(!formal)await c.query('SELECT local_identity.confirm_legacy_workspace_preparation($1,$2,$3)',[e.id,e.main_script_revision_id,p.id]);
   const recovery=!row?await preserveLegacyWorkspace(c,root,e.id,data.legacyDecision):null;
   const id=row?.id??randomUUID();
   const shots=storyboard.shots as StoryboardShotManifest[];
   const [width,height]=shots[0].targetSpec==='16:9'?[1920,1080]:shots[0].targetSpec==='1:1'?[1080,1080]:[1080,1920];
   const tracks:OpenChatCutProject['timelines'][number]['tracks']={V1:{kind:'video',name:'画面'}};
   let frame=0;
   let clips:WorkspaceClip[]=[];
   const items=shots.flatMap(shot=>{
    if(typeof shot.id!=='string'||typeof shot.scriptSegment!=='string')throw new ConfigurationError(409,'分镜身份无效。');
    const duration=Math.max(1,Math.round(Number(shot.durationSeconds||3)*30));
    const layout=shot.layout&&shotCompositionLayouts.includes(shot.layout)?shot.layout:'full';
    const composition=defaultShotComposition(layout);
    const shotItems=composition.slots.map((slot,index)=>{
     const clipId=randomUUID(),itemId=`shot-${shot.id}-${clipId}`,track=`V${index+1}`;
     const label=shotCompositionSlotLabels[slot.id];
     tracks[track]??={kind:'video',name:`画面 ${index+1}`};
     clips.push({id:clipId,itemId,shotId:shot.id,text:shot.scriptSegment,source:null});
     return {id:itemId,track,kind:'text',name:`${shot.id} · ${label}`,startFrame:frame,durationInFrames:duration,width,height,
      props:{text:`待匹配画面\n${label}`,fontSize:64,color:'#a3acc2',align:'center'},
      transform:{...shotCompositionTransform(shotCompositionRect(layout,slot.id),slot),rotation:0},
      ...(layout!=='full'?{loopControlComposition:{layout,slotId:slot.id}}:{}),
     };
    });
    frame+=duration;
    return shotItems;
   });
   let project:OpenChatCutProject={version:3,loopControl:{version:'four-step-workspace/v1',inputFingerprint:id,transitionMode:'studio'},assets:[],mediaFolders:[],activeTimelineId:`loop-control-${e.id}`,timelines:[{id:`loop-control-${e.id}`,name:'整期剪辑',order:0,fps:30,width,height,fit:'contain',items,trackOrder:Object.keys(tracks),tracks,transitions:[],selectedId:null,captionsHidden:false}]};
   if(recovery?.decision==='preserve'){project=recovery.project;clips=await recoverLegacyBindings(c,root,e.id,id,project,clips);}
   project=withWorkspaceShotMetadata(project,clips);
   if(!row&&!recovery)project=await assembleWorkspaceCaptions(c,root,{id,episode_id:e.id,script_revision_id:e.main_script_revision_id,storyboard_package_id:p.id,bindings:clips},project);
   const file=await persistWorkspaceProject(c,root,e.id,project);
   if(row){
    await c.query('UPDATE local_identity.production_workspaces SET script_revision_id=$2,storyboard_package_id=$3 WHERE id=$1',[row.id,e.main_script_revision_id,p.id]);
    await persistWorkspaceRevision(c,root,row,project,clips,String(data.reason??'依据已确认脚本与分镜更新素材规划'));
   }else{
   row=(await c.query('INSERT INTO local_identity.production_workspaces(id,episode_id,script_revision_id,storyboard_package_id,bindings,project_path,project_sha256,project_size,content_sha256,native_edit_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[id,e.id,e.main_script_revision_id,p.id,JSON.stringify(clips),file.relativePath,file.sha256,file.fileSize,workspaceContentSha256(project),recovery?.decision==='preserve'?1:0])).rows[0];
    await recordWorkspaceVersion(c,row!,'首次组装');
    await syncWorkspaceShotInputs(c,row!,clips);
    // Initial native cues establish timing only; final text approval remains explicit.
    if(!recovery)await syncNativeWorkspaceCaptions(c,root,row!,project);
    if(recovery)await c.query('INSERT INTO local_identity.workspace_legacy_recoveries(workspace_id,decision,relative_path,sha256,file_size) VALUES($1,$2,$3,$4,$5)',[id,recovery.decision,recovery.relativePath,recovery.sha256,recovery.fileSize]);
   }
   return readProductionWorkspace(c,e.id,root);
  }
  if(command==='saveWorkspaceVideoRanges')return saveWorkspaceVideoRanges(c,root,e.id,data);
  if(command==='generateWorkspaceImage')return generateWorkspaceImage(c,root,e,runtime,data);
  if(command==='fillWorkspaceImageResult')return fillWorkspaceImageResult(c,root,e.id,data);
  if(command==='matchWorkspaceImage')return matchWorkspaceImage(c,root,e.id,data);
  const locked=await lockProductionWorkspace(c,root,e.id,data.workspaceId,data.expectedRevision);row=locked.row;const project=locked.project;
  if(command==='prepareWorkspaceCall')return prepareWorkspaceCall(c,root,row,project,data.callCommand,data.callData);
  if(command==='confirmWorkspaceCall'){const call=await consumeWorkspaceCall(c,root,row,project,data.confirmationId,data.reservationCents);return this.execute(c,e,root,runtime,call.command,call.payload,true);}
  if(command==='saveWorkspaceSoundIntent'){
   if(data.expectedProjectSha256!==row.project_sha256)throw new ConfigurationError(409,'镜头信息已变化，请刷新后再保存音效意图。');
   if(isOpenChatCutStudio(e.id))throw new ConfigurationError(409,'请先保存并返回素材准备，再修改音效意图。');
   if(typeof data.shotId!=='string'||!row.bindings.some(b=>b.shotId===data.shotId)||typeof data.soundIntent!=='string'||data.soundIntent.length>240)throw new ConfigurationError(400,'请选择当前镜头，音效意图不超过 240 字。');
   const soundIntent=data.soundIntent.trim(),bindings=row.bindings.map(binding=>{if(binding.shotId!==data.shotId)return binding;const next={...binding};if(soundIntent)next.soundIntent=soundIntent;else delete next.soundIntent;return next;});
   if(JSON.stringify(bindings)===JSON.stringify(row.bindings))return readProductionWorkspace(c,e.id,root);
   return updateWorkspaceProject(c,root,row,project,bindings,'修改镜头音效意图');
  }
  if(Object.hasOwn(workspaceVisualFields,command))return executeWorkspaceVisualCandidate(c,root,row,project,command,data,runtime);
  if(['prepareWorkspaceCandidate','adoptWorkspaceCandidate','rejectWorkspaceCandidate'].includes(command))return executeWorkspaceCandidateCommand(c,root,row,project,command,data);
  if(Object.hasOwn(workspaceAudioFields,command)){await executeWorkspaceAudio(c,root,row,project,runtime,command,data);return readProductionWorkspace(c,e.id,root);}
  if(Object.hasOwn(workspaceDeliveryFields,command)){await executeWorkspaceDelivery(c,root,row,project,command,data);return readProductionWorkspace(c,e.id,root);}
  if(Object.hasOwn(workspaceExportFields,command)){await executeWorkspaceExport(c,root,row,project,runtime,command,data);return readProductionWorkspace(c,e.id,root);}
  if(Object.hasOwn(workspaceCaptionFields,command))return executeWorkspaceCaptionCommand(c,root,row,project,runtime,command,data);
  if(command==='editWorkspaceStructure'){
   if(isOpenChatCutStudio(e.id))throw new ConfigurationError(409,'请在当前编辑器中修改并保存。');
   if(!isWorkspaceShotOperation(data.operation))throw new ConfigurationError(400,'镜头编辑输入无效。');
   let next;try{next=applyWorkspaceShotOperation(migrateWorkspaceCaptionLanes(withWorkspaceShotMetadata(project,row.bindings)),data.operation);}catch(error){throw new ConfigurationError(409,error instanceof Error?error.message:'镜头编辑失败。');}
   return updateWorkspaceProject(c,root,row,next,synchronizeWorkspaceBindings(next,row.bindings),'修改镜头结构',{nativeEdit:true});
  }
  if(command.endsWith('WorkspaceNarration')||command==='saveWorkspaceNarrationDefaults'||command==='setWorkspaceNarrationEnabled'){await executeWorkspaceNarration(c,root,row,project,runtime,command,data);return readProductionWorkspace(c,e.id,root);}
  if(command==='matchWorkspaceMaterial'){
   if(isOpenChatCutStudio(e.id))throw new ConfigurationError(409,'请先保存并返回素材匹配，再填入指定占位。');
   const clip=row.bindings.find(b=>b.id===data.clipId);if(!clip||clip.source)throw new ConfigurationError(409,'占位已变化，请刷新；已有片段请在剪辑中调整。');
   if(typeof data.materialRevisionId!=='string'||!uuid.test(data.materialRevisionId))throw new ConfigurationError(400,'素材标识无效。');
   const m=(await c.query("SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type='video'",[data.materialRevisionId,e.id])).rows[0];if(!m)throw new ConfigurationError(404,'本期视频素材不存在。');
   await verifyEpisodeFile(c,root,e.id,m.storage_path,m.sha256,Number(m.file_size));const observed=await inspectMp4Artifact(await (await episodeFileIO(c,root,e.id)).resolveReference(m.storage_path));
   const timeline=project.timelines.find(t=>t.items.some(i=>i.id===clip.itemId)),item=timeline?.items.find(i=>i.id===clip.itemId);if(!timeline||!item)throw new ConfigurationError(409,'占位已从工程删除，请在当前工程中操作。');
   if(observed.durationSeconds+0.05<Number(item.durationInFrames)/timeline.fps)throw new ConfigurationError(409,'原片短于占位时长，请先明确调整镜头时长。');
   const assetId=`material-${m.id}`;if(!project.assets.some(a=>a.id===assetId))project.assets.push(Object.assign({id:assetId,name:m.source_path.split('/').pop()??clip.shotId,kind:'video' as const,src:m.storage_path,durationInFrames:Math.round(observed.durationSeconds*timeline.fps)},{width:observed.width,height:observed.height,sourceRevision:m.id,sourceContentHash:m.sha256}));
   Object.assign(item,{kind:'video',name:clip.shotId,src:m.storage_path,sourceAssetId:assetId,sourceRevision:m.id,sourceContentHash:m.sha256,width:observed.width,height:observed.height,srcInFrame:0,volume:0});delete item.props;
   const sound=await prepareWorkspaceVideoSound(c,root,e.id,m.storage_path,m.sha256,timeline.fps,0,Number(item.durationInFrames),1,observed.hasAudio);
   applyWorkspaceVideoSound(project,timeline,item,clip.shotId,sound,!!resolveWorkspaceMainVoice(project,clip.shotId).item);
   clip.source={materialRevisionId:m.id,relativePath:m.storage_path,sha256:m.sha256,fileSize:Number(m.file_size),kind:'video'};
   return updateWorkspaceProject(c,root,row,project,row.bindings);
  }
  if(!runtime.studioRuntime)throw new ConfigurationError(503,'本地 Studio 未配置。');const config=await runtime.studioRuntime();
  const validate=async(doc:OpenChatCutProject,observation?:OpenChatCutProjectObservation)=>{await validateWorkspaceProject(c,root,e.id,doc,config,project,observation);await validateWorkspaceCandidateUses(c,row!,project,doc);await validateWorkspaceVisualUses(c,root,row!,project,doc);};
  if(command==='openWorkspaceStudio'){
   const state=await readProductionWorkspace(c,e.id,root);
   if(state?.readiness.placeholders.length||state?.readiness.missingSources.length){const ids=row.bindings.filter(b=>state!.readiness.placeholders.includes(b.itemId)).map(b=>b.shotId);throw new ConfigurationError(409,ids.length?`请先采用有效图片或视频：${[...new Set(ids)].join('、')}。`:'当前采用的画面素材不可读取，请重新匹配后进入剪辑。');}

   if((await c.query("SELECT 1 FROM local_identity.workspace_deliveries d JOIN public.tasks t ON t.id=d.task_id WHERE d.workspace_id=$1 AND t.status IN ('ready','running') LIMIT 1",[row.id])).rowCount)throw new ConfigurationError(409,'交付正在排队或校验，请等待结果后再编辑。');
   const editable=await assembleWorkspaceCaptions(c,root,row,migrateWorkspaceCaptionLanes(withWorkspaceShotMetadata(project,row.bindings))),paths=[...usedWorkspaceContent(editable).paths];for(const asset of editable.assets)if(!paths.includes(asset.src))try{await resolveWorkspaceSource(c,root,e.id,asset.src);paths.push(asset.src);}catch{/* Unused unavailable library media does not block editing. */}const opened=await openOpenChatCutDraftStudio(root,e.id,editable,paths,hash(JSON.stringify({id:row.id,scriptRevisionId:row.script_revision_id,storyboardPackageId:row.storyboard_package_id})),config,validate,await episodeFileIO(c,root,e.id,true));
   this.opened.add(e.id);const current=JSON.parse((await verifyEpisodeFile(c,root,e.id,opened.workspace.relativePath,opened.workspace.sha256,opened.workspace.fileSize)).toString('utf8')) as OpenChatCutProject;
   const savedRow=await persistWorkspaceRevision(c,root,row,current,synchronizeWorkspaceBindings(current,row.bindings),opened.recoveredNativeEdits?'恢复原生剪辑':'更新工作版本',{nativeEdit:opened.recoveredNativeEdits===true});
   if(opened.recoveredNativeEdits)await syncNativeWorkspaceCaptions(c,root,savedRow,current);
   return{...opened,productionWorkspace:await readProductionWorkspace(c,e.id,root)};
  }
  if(command==='closeWorkspaceStudio'){await this.closeEpisode(e.id);return readProductionWorkspace(c,e.id,root);}
  if(command==='saveWorkspaceStudio'){
   if(data.projectId!==`loop-control-${e.id}`||typeof data.workspaceRelativePath!=='string'||data.workspaceRelativePath!==`${(await episodeFileIO(c,root,e.id,true)).relativePath}/openchatcut-work/current/project.json`||data.expectedWorkspaceSha256!==row.project_sha256)throw new ConfigurationError(409,'当前工程身份或文件版本已变化。');
   let file;try{file=await snapshotOpenChatCutStudio(root,e.id,`${(await episodeFileIO(c,root,e.id,true)).relativePath}/openchatcut-work/current/project.json`,row.project_sha256,validate,await episodeFileIO(c,root,e.id,true));}catch(error){if(error instanceof ConfigurationError)throw error;throw new ConfigurationError(409,'Studio 会话或版本已失效，请重新打开当前工程。');}
   const current=JSON.parse((await verifyEpisodeFile(c,root,e.id,file.relativePath,file.sha256,file.fileSize)).toString('utf8')) as OpenChatCutProject;
   const savedRow=await persistWorkspaceRevision(c,root,row,current,synchronizeWorkspaceBindings(current,row.bindings),'保存原生剪辑',{nativeEdit:true});
   await syncNativeWorkspaceCaptions(c,root,savedRow,current);return{...file,productionWorkspace:await readProductionWorkspace(c,e.id,root)};
  }
  throw new ConfigurationError(400,'不支持的工作台操作。');
 }
}
export async function readWorkspaceProject(c:PoolClient,root:string,row:ProductionWorkspaceRecord):Promise<OpenChatCutProject>{
 try{return JSON.parse((await verifyEpisodeFile(c,root,row.episode_id,row.project_path,row.project_sha256,Number(row.project_size))).toString('utf8')) as OpenChatCutProject;}catch(error){if(error instanceof ConfigurationError)throw error;throw new ConfigurationError(409,'工程快照不可用或指纹已变化，原始素材未修改。');}
}
/** Every version is immutable. A rolled-back DB update only leaves an unreferenced snapshot. */
export async function persistWorkspaceProject(c:PoolClient,root:string,episodeId:string,project:OpenChatCutProject){
 const bytes=Buffer.from(JSON.stringify(project,null,2)+'\n'),sha=hash(bytes),path=`${(await episodeFileIO(c,root,episodeId,true)).relativePath}/production-workspace/versions/${sha}.json`,file=await safeAssetOutputPath(root,path);
 await mkdir(dirname(file),{recursive:true});
 try{await writeFile(file,bytes,{flag:'wx'});}catch(error){if((error as {code?:string}).code!=='EEXIST')throw error;await verifyNativeFile(root,path,sha,bytes.length);}
 return{relativePath:path,sha256:sha,fileSize:bytes.length};
}
/** Caller holds the Owner transaction and workspace row lock. Editing state stays in the native document. */
export async function updateWorkspaceProject(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,bindings:WorkspaceClip[]=row.bindings,reason?:string,options:{nativeEdit?:boolean}={}){
 await persistWorkspaceRevision(c,root,row,project,bindings,reason,options);
 return readProductionWorkspace(c,row.episode_id,root);
}
/** Caller holds the Owner transaction and row lock; write later evidence before the final readback. */
export async function persistWorkspaceRevision(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,bindings:WorkspaceClip[]=row.bindings,reason?:string,options:{nativeEdit?:boolean}={}){
 // Existing pre-normalization snapshots retain their confirmed content identity
 // when only the already-bound shot metadata is added. Real metadata/source edits
 // still differ from this normalized previous document and invalidate confirmation.
 const previous=await readWorkspaceProject(c,root,row),normalizedPrevious=withWorkspaceShotMetadata(previous,row.bindings);project=withWorkspaceShotMetadata(project,bindings);
 // Compare the owned extension at a stable key position without changing SDK file bytes.
 const normalizedCurrent=structuredClone(project);for(const comparable of [normalizedPrevious,normalizedCurrent])for(const timeline of comparable.timelines)for(const item of timeline.items){if(item.loopControlShot){const metadata=item.loopControlShot;delete item.loopControlShot;item.loopControlShot=metadata;}}
 const contentSha=workspaceContentSha256(normalizedPrevious)===workspaceContentSha256(normalizedCurrent)?row.content_sha256:workspaceContentSha256(project);
 const file=await persistWorkspaceProject(c,root,row.episode_id,project);
 const changed=await c.query('UPDATE local_identity.production_workspaces SET native_edit_revision=native_edit_revision+CASE WHEN $9 AND content_sha256<>$6 THEN 1 ELSE 0 END,revision=revision+CASE WHEN content_sha256=$6 THEN 0 ELSE 1 END,content_sha256=$6,project_path=$3,project_sha256=$2,project_size=$4,bindings=$5,updated_at=clock_timestamp() WHERE id=$1 AND revision=$7 AND project_sha256=$8',[row.id,file.sha256,file.relativePath,file.fileSize,JSON.stringify(bindings),contentSha,row.revision,row.project_sha256,options.nativeEdit===true]);
 if(!changed.rowCount)throw new ConfigurationError(409,'工程版本已变化，请重新读取当前工程。');
 const current=(await c.query('SELECT * FROM local_identity.production_workspaces WHERE id=$1',[row.id])).rows[0] as ProductionWorkspaceRecord;
 await recordWorkspaceVersion(c,current,reason??null);
 await syncWorkspaceShotInputs(c,current,bindings);
 return current;
}
export async function lockProductionWorkspace(c:PoolClient,root:string,episodeId:string,workspaceId:unknown,expectedRevision:unknown){
 const row=(await c.query('SELECT w.*,e.main_script_revision_id current_script,e.archived_at,e.stage,p.invalidated_at,local_identity.is_historical_episode(e.id) historical FROM local_identity.production_workspaces w JOIN public.episodes e ON e.id=w.episode_id JOIN public.review_packages p ON p.id=w.storyboard_package_id WHERE w.episode_id=$1 FOR UPDATE OF w',[episodeId])).rows[0];
 if(!row||row.id!==workspaceId||!Number.isSafeInteger(expectedRevision)||Number(row.revision)!==expectedRevision)throw new ConfigurationError(409,'工程版本已变化，请重新打开当前工作版本。');
 if(row.archived_at||row.stage==='production_completed'||row.historical)throw new ConfigurationError(409,'历史或已完成生产单只读。');
 if(row.script_revision_id!==row.current_script||row.invalidated_at)throw new ConfigurationError(409,'脚本基准已变化，请明确重新规划，原工程已保留。');
 const project=await readWorkspaceProject(c,root,row);await syncWorkspaceShotInputs(c,row,row.bindings);return{row:row as ProductionWorkspaceRecord,project};
}
async function recordWorkspaceVersion(c:PoolClient,row:ProductionWorkspaceRecord,reason:string|null){
 await c.query('INSERT INTO local_identity.production_workspace_versions(workspace_id,episode_id,revision,script_revision_id,storyboard_package_id,project_path,project_sha256,project_size,content_sha256,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING',[row.id,row.episode_id,row.revision,row.script_revision_id,row.storyboard_package_id,row.project_path,row.project_sha256,row.project_size,row.content_sha256,reason]);
}
export async function readWorkspaceVersion(c:PoolClient,root:string,episodeId:string,sha:string){
 const row=(await c.query('SELECT * FROM local_identity.production_workspace_versions WHERE episode_id=$1 AND project_sha256=$2',[episodeId,sha])).rows[0];
 if(!row){const recovery=(await c.query('SELECT r.* FROM local_identity.workspace_legacy_recoveries r JOIN local_identity.production_workspaces w ON w.id=r.workspace_id WHERE w.episode_id=$1 AND r.sha256=$2',[episodeId,sha])).rows[0];if(!recovery)throw new ConfigurationError(404,'工程版本不可见。');const frozen=JSON.parse((await verifyEpisodeFile(c,root,episodeId,recovery.relative_path,recovery.sha256,Number(recovery.file_size))).toString('utf8'));return frozen.project as OpenChatCutProject;}
 return readWorkspaceProject(c,root,row);
}

export async function validateWorkspaceProject(c:PoolClient,root:string,episodeId:string,doc:OpenChatCutProject,config:OpenChatCutRuntimeConfig,previousProject?:OpenChatCutProject,observation?:OpenChatCutProjectObservation){
   const used=usedWorkspaceContent(doc);for(const path of used.paths)await registerWorkspaceBundledSound(c,root,episodeId,path,config);
   const effective=(item:Record<string,unknown>)=>item.kind==='video'||item.kind==='image';
   if(!used.items.some(effective)&&((previousProject&&usedWorkspaceContent(previousProject).items.some(effective))||!used.items.some(item=>item.kind==='text'&&workspaceShotIdentity(item))))throw new ConfigurationError(409,'不能删除最后一个有效镜头；请在当前编辑器中恢复画面后重试保存。');
   for(const asset of doc.assets)if(!previousProject?.assets.some(a=>a.id===asset.id&&a.src===asset.src))await resolveWorkspaceSource(c,root,episodeId,asset.src);
   const sources=used.paths;
   for(const path of sources)await resolveWorkspaceSource(c,root,episodeId,path);
   if(!(observation??await inspectOpenChatCutProjectWithRuntime(doc,config)).readable)throw new ConfigurationError(409,'当前草稿不能由 Studio 读取。');
}
