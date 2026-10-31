import {verifyEpisodeFile,episodeFileIO} from './episodeFiles.js';
import {episodeStorageLocationAtRoot,requireEpisodeStorageDirectory} from './episodeStorageLocation.js';
import {inspectOpenChatCutStoredProject} from '../worker/openchatcutStudio.js';
import {resolveWorkspaceSource} from './workspaceSources.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import type {PoolClient} from 'pg';
import {parseProductionScript} from '../reviews/productionScript.js';
import {verifyReportedStoryboardArtifact} from '../worker/storyboardArtifact.js';
import {storyboardFromScript} from '../worker/scriptPlanning.js';
import {verifyNativeFile} from './localFiles.js';
import {safeAssetOutputPath} from '../worker/controlledMediaExecutor.js';
import {productionHash} from './scriptProductionStore.js';
import {ConfigurationError} from './configurationCommands.js';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import type {WorkspaceClip} from '../productionWorkspace.js';
export async function prepareAuthoredWorkspace(c:PoolClient,root:string,e:{id:string;main_script_revision_id:string|null}){
 const location=await episodeStorageLocationAtRoot(c,root,e.id);await requireEpisodeStorageDirectory(c,location);
 const source=(await c.query('SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2',[e.main_script_revision_id,e.id])).rows[0];
 if(!source)throw new ConfigurationError(409,'请先确认主脚本。');
 const script=parseProductionScript((await verifyEpisodeFile(c,root,e.id,source.storage_path,source.sha256,Number(source.file_size))).toString('utf8'));
 if(!script){
 const planned=(await c.query("SELECT p.*,a.relative_path,a.sha256,a.file_size,t.input_snapshot FROM public.review_packages p JOIN public.tasks t ON t.id=p.task_id JOIN public.artifacts a ON a.id=p.artifact_id WHERE p.episode_id=$1 AND t.input_snapshot#>>'{workspace_preparation,scriptRevisionId}'=$2 AND t.status='completed' AND p.invalidated_at IS NULL ORDER BY p.revision_number DESC LIMIT 1",[e.id,source.id])).rows[0];
 if(!planned){try{const task=(await c.query('SELECT local_identity.queue_workspace_planning($1,$2) id',[e.id,source.id])).rows[0].id;return readWorkspacePlanning(c,task);}catch(error){if((error as Error).message==='Select the registered planning Harness, model, budget and tools')throw new ConfigurationError(409,'请在素材准备与匹配中保存分镜规划模型、Harness、额度与文件工具。');throw error;}}
 await verifyNativeFile(root,planned.relative_path,planned.sha256,Number(planned.file_size));await verifyReportedStoryboardArtifact({assetRoot:root,relativePath:planned.relative_path,frozenInputs:planned.input_snapshot.input_artifacts,storyboard:planned.context_snapshot.worker_result.storyboard});
 await c.query('SELECT local_identity.confirm_workspace_plan($1,$2,$3)',[e.id,source.id,planned.id]);return planned;
 }
 const inputs=[{artifactType:'main_script',relativePath:source.storage_path,sha256:source.sha256,fileSize:Number(source.file_size)}],board=storyboardFromScript(script,inputs,{},true),id=randomUUID(),bytes=Buffer.from(JSON.stringify(board,null,2)+'\n'),path=`${location.relativePath}/preparation/${id}.json`,sha=createHash('sha256').update(bytes).digest('hex'),file=await safeAssetOutputPath(root,path);
 await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes,{flag:'wx'});
 await c.query('SELECT local_identity.register_workspace_preparation($1,$2,$3,$4,$5,$6)',[e.id,source.id,id,{relativePath:path,sha256:sha,fileSize:bytes.length},board,'script-segment']);
 return(await c.query('SELECT p.*,a.relative_path,a.sha256,a.file_size FROM public.review_packages p JOIN public.artifacts a ON a.id=p.artifact_id WHERE p.id=$1',[id])).rows[0];
}
export async function readWorkspacePlanning(c:PoolClient,taskId:string){const task=(await c.query('SELECT status,last_result FROM public.tasks WHERE id=$1',[taskId])).rows[0];return{planning:true as const,taskId,status:task.status,detail:task.last_result?.blockers?.[0]?.detail??task.last_result?.retry?.reason??null};}
export async function syncWorkspaceShotInputs(c:PoolClient,row:ProductionWorkspaceRecord,bindings:WorkspaceClip[]){
 const p=(await c.query('SELECT p.context_snapshot,b.origin FROM public.review_packages p LEFT JOIN local_identity.workspace_preparations b ON b.package_id=p.id WHERE p.id=$1',[row.storyboard_package_id])).rows[0];
 for(const clip of bindings){const shot=p?.context_snapshot?.worker_result?.storyboard?.shots?.find((s:{id:string})=>s.id===clip.shotId);
 await c.query('INSERT INTO local_identity.workspace_shot_inputs(workspace_id,preparation_id,shot_id,origin,baseline_text,shot_type,snapshot) VALUES($1,$7,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[row.id,clip.shotId,shot?p.origin??'legacy-board':'local-added',shot?.scriptSegment??'',shot?.shotType??null,shot??{id:clip.shotId},row.storyboard_package_id]);}
}
export async function resolveWorkspaceShotLineage(c:PoolClient,row:ProductionWorkspaceRecord,shotId:string,preparationId=row.storyboard_package_id){
 let result=(await c.query('SELECT * FROM local_identity.workspace_shot_inputs WHERE workspace_id=$1 AND shot_id=$2 AND preparation_id=$3',[row.id,shotId,preparationId])).rows[0];
 if(!result){const p=(await c.query('SELECT p.context_snapshot,b.origin FROM public.review_packages p LEFT JOIN local_identity.workspace_preparations b ON b.package_id=p.id WHERE p.id=$1 AND p.episode_id=$2',[preparationId,row.episode_id])).rows[0],shot=p?.context_snapshot?.worker_result?.storyboard?.shots?.find((s:{id:string})=>s.id===shotId);if(!shot&&!row.bindings.some(b=>b.shotId===shotId))throw new ConfigurationError(409,'镜头制作依据已变化，请保存并重新确认。');result={origin:shot?p?.origin??'legacy-board':'local-added',baseline_text:shot?.scriptSegment??'',shot_type:shot?.shotType??null,snapshot:shot??{id:shotId}};}
 return{...result,id:shotId,shotType:result.shot_type,scriptSegment:result.baseline_text};
}

export async function authorizeWorkspacePreparation(c:PoolClient,row:ProductionWorkspaceRecord,enabled:unknown){
 if(typeof enabled!=='boolean')throw new ConfigurationError(400,'制作授权无效。');
 const e=(await c.query('SELECT e.*,b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[row.episode_id])).rows[0];
 const inputs=(await c.query('SELECT shot_id,origin,baseline_text,shot_type FROM local_identity.workspace_shot_inputs WHERE workspace_id=$1 AND preparation_id=$2 ORDER BY shot_id',[row.id,row.storyboard_package_id])).rows;
 const plan={version:'workspace/v1',executionFingerprint:productionHash(e.policy),preparationId:row.storyboard_package_id,segments:inputs},authorization=productionHash({script:row.script_revision_id,preparation:row.storyboard_package_id,plan});
 await c.query(`INSERT INTO local_identity.script_productions(episode_id,owner_id,script_revision_id,script_sha256,plan,enabled,authorization_hash,authorized_at,last_status) SELECT $1,local_identity.owner_id(),$2,m.sha256,$3,$4,$5,CASE WHEN $4 THEN clock_timestamp() END,'四步制作授权' FROM public.production_material_revisions m WHERE m.id=$2 ON CONFLICT(episode_id) DO UPDATE SET script_revision_id=excluded.script_revision_id,script_sha256=excluded.script_sha256,plan=excluded.plan,enabled=excluded.enabled,authorization_hash=excluded.authorization_hash,authorized_at=excluded.authorized_at,last_status=excluded.last_status`,[row.episode_id,row.script_revision_id,plan,enabled,authorization]);
 await c.query('SELECT local_identity.record_script_production_configuration($1,$2)',[row.episode_id,authorization]);
}
export async function readWorkspacePreparation(c:PoolClient,row:ProductionWorkspaceRecord){
 const prep=(await c.query('SELECT origin FROM local_identity.workspace_preparations WHERE package_id=$1',[row.storyboard_package_id])).rows[0],auth=(await c.query('SELECT enabled,authorization_hash,plan FROM local_identity.script_productions WHERE episode_id=$1 AND script_revision_id=$2 AND authorized_at IS NOT NULL',[row.episode_id,row.script_revision_id])).rows[0];
 const shots:Array<{shot_id:string;origin:string;shot_type:'a_roll'|'b_roll'|null}>=[];for(const clip of row.bindings){if(shots.some(s=>s.shot_id===clip.shotId))continue;const source=await resolveWorkspaceShotLineage(c,row,clip.shotId);shots.push({shot_id:clip.shotId,origin:source.origin,shot_type:source.shot_type});}
 return{origin:prep?.origin??'legacy-board',scriptRevisionId:row.script_revision_id,authorized:!!auth?.enabled,authorizationHash:auth?.authorization_hash,shots:shots.map(s=>({shotId:s.shot_id,origin:s.origin,shotType:s.shot_type}))};
}

export async function preserveLegacyWorkspace(c:PoolClient,root:string,episodeId:string,decision:unknown){
 const stored=await inspectOpenChatCutStoredProject(root,episodeId,await episodeFileIO(c,root,episodeId));if(!stored||stored.project.loopControl?.version==='four-step-workspace/v1')return null;
 if(!['preserve','fresh'].includes(String(decision)))throw new ConfigurationError(409,'发现旧剪辑工作版本，请明确保留旧编辑或封存后建立初稿。');
 return{...await preserveLegacyDocument(c,root,episodeId,stored),decision:String(decision) as 'preserve'|'fresh'};
}
export async function preserveLegacyDocument(c:PoolClient,root:string,episodeId:string,stored:{project:OpenChatCutProject;metadata?:unknown;source?:unknown}){
 const bytes=Buffer.from(JSON.stringify(stored,null,2)+'\n'),sha=createHash('sha256').update(bytes).digest('hex'),path=`${(await episodeFileIO(c,root,episodeId,true)).relativePath}/production-workspace/recoveries/${sha}.json`,file=await safeAssetOutputPath(root,path);await mkdir(dirname(file),{recursive:true});try{await writeFile(file,bytes,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;await verifyNativeFile(root,path,sha,bytes.length);}
 return{...stored,relativePath:path,sha256:sha,fileSize:bytes.length};
}
export async function recoverLegacyBindings(c:PoolClient,root:string,episodeId:string,workspaceId:string,project:OpenChatCutProject,original:WorkspaceClip[]){
 const bindings:WorkspaceClip[]=[];
 for(const t of project.timelines)for(const item of t.items){
 if(!['video','image'].includes(String(item.kind))||typeof item.src!=='string')continue;
 let source;try{source=await resolveWorkspaceSource(c,root,episodeId,item.src);}catch{
 const tasks=(await c.query('SELECT input_snapshot FROM public.tasks WHERE episode_id=$1',[episodeId])).rows;
 const frozen=tasks.flatMap(t=>t.input_snapshot?.input_artifacts??[]).find((f:{relativePath:string})=>f.relativePath===item.src);if(!frozen)throw new ConfigurationError(409,'旧工程素材没有可验证冻结来源，请先恢复原工程。');await verifyEpisodeFile(c,root,episodeId,frozen.relativePath,frozen.sha256,Number(frozen.fileSize));await c.query('SELECT local_identity.register_workspace_recovery_source($1,$2)',[episodeId,frozen]);source=await resolveWorkspaceSource(c,root,episodeId,item.src);
 }
 const originalClip=original.find(b=>String(item.id).startsWith(`shot-${b.shotId}-`)),clipId=randomUUID(),shotId=originalClip?.shotId??`recovered-${clipId}`,text=originalClip?.text??String(item.name??'恢复画面');
 item.loopControlShot={workspaceId,shotId,clipId,text};bindings.push({id:clipId,itemId:String(item.id),shotId,text,source:{materialRevisionId:source.id,relativePath:item.src,sha256:source.sha256,fileSize:Number(source.file_size),kind:item.kind as 'video'|'image'}});
 }
 // Audio and nested sources also retain their frozen registration.
 const paths=new Set<string>();const visit=(v:unknown)=>{if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){if(k==='src'&&typeof x==='string')paths.add(x);visit(x);}};visit(project);
 for(const path of paths)try{await resolveWorkspaceSource(c,root,episodeId,path);}catch{const tasks=(await c.query('SELECT input_snapshot FROM public.tasks WHERE episode_id=$1',[episodeId])).rows,frozen=tasks.flatMap(t=>t.input_snapshot?.input_artifacts??[]).find((f:{relativePath:string})=>f.relativePath===path);if(!frozen)throw new ConfigurationError(409,'旧工程来源未登记，请先恢复原工程。');await verifyEpisodeFile(c,root,episodeId,path,frozen.sha256,Number(frozen.fileSize));await c.query('SELECT local_identity.register_workspace_recovery_source($1,$2)',[episodeId,frozen]);}
 if(!bindings.length)throw new ConfigurationError(409,'旧工程没有可映射画面，请选择封存后建立初稿。');project.loopControl={version:'four-step-workspace/v1',inputFingerprint:workspaceId,transitionMode:'studio'};return bindings;
}
