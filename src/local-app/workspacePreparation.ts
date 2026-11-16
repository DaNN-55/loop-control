import {productionRenderPreferences} from '../workspaceRenderPreferences.js';
import {verifyEpisodeFile,episodeFileIO} from './episodeFiles.js';
import {adoptProductionPreparation,registerProductionPreparation,verifyProductionPreparationSource} from './productionPreparationStore.js';
import {episodeStorageLocationAtRoot,requireEpisodeStorageDirectory} from './episodeStorageLocation.js';
import {inspectOpenChatCutStoredProject} from '../worker/openchatcutStudio.js';
import {resolveWorkspaceSource} from './workspaceSources.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import type {PoolClient} from 'pg';
import {parseStoryboardScript,segmentSettings,productionVisualSources,type ProductionVisualSource} from '../reviews/productionScript.js';
import {plainScriptParagraphs} from '../reviews/mainScript.js';
import {verifyNativeFile} from './localFiles.js';
import {safeAssetOutputPath} from '../worker/controlledMediaExecutor.js';
import {ConfigurationError} from './configurationCommands.js';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import type {WorkspaceClip} from '../productionWorkspace.js';
export async function prepareAuthoredWorkspace(c:PoolClient,root:string,e:{id:string;main_script_revision_id:string|null}){
 const location=await episodeStorageLocationAtRoot(c,root,e.id);await requireEpisodeStorageDirectory(c,location);
 const source=(await c.query('SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2',[e.main_script_revision_id,e.id])).rows[0];
 if(!source)throw new ConfigurationError(409,'请先确认主脚本。');
 const text=(await verifyEpisodeFile(c,root,e.id,source.storage_path,source.sha256,Number(source.file_size))).toString('utf8');
 const script=parseStoryboardScript(text);
 if(script?.version===2)throw new ConfigurationError(409,'旧 v2 脚本仅保留历史读取，请修订为模板版本 3 后再准备新工程。');
 const inputs=[{artifactType:'main_script',relativePath:source.storage_path,sha256:source.sha256,fileSize:Number(source.file_size)}];
 const paragraphs=script?[]:plainScriptParagraphs(text);
 if(!script&&!paragraphs.length)throw new ConfigurationError(409,'脚本正文为空，请补充正文后重新确认。');
 const manifest={version:'production-preparation/v1',shots:script?script.segments.map(segment=>{
  const settings=segmentSettings(script,segment),renderPreferences=productionRenderPreferences(settings);
  return{id:segment.id,scriptSegment:segment.narration,durationSeconds:settings.duration??5,targetSpec:settings.aspectRatio??'9:16',visualSource:segment.visualSource??'unassigned',...(renderPreferences?{renderPreferences}:{}),visualIntent:segment.visual||segment.videoPrompt||'待匹配素材',inputBasis:inputs.map(({relativePath,sha256})=>({relativePath,sha256})),...(settings.layout?{layout:settings.layout}:{}),...(settings.materialReference?{materialReference:settings.materialReference}:{})};
 }):paragraphs.map((scriptSegment,index)=>({id:'shot-'+String(index+1).padStart(2,'0'),scriptSegment,durationSeconds:5,targetSpec:'9:16',visualSource:'unassigned',visualIntent:'待匹配素材',inputBasis:[{relativePath:source.storage_path,sha256:source.sha256}]}))};
 const id=randomUUID(),bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n'),path=`${location.relativePath}/preparation/${id}.json`,sha=createHash('sha256').update(bytes).digest('hex'),file=await safeAssetOutputPath(root,path);
 await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes,{flag:'wx'});
 await registerProductionPreparation(c,root,{episodeId:e.id,scriptRevisionId:source.id,preparationRevisionId:id,file:{relativePath:path,sha256:sha,fileSize:bytes.length},manifest});
 return{id,manifest,relative_path:path,sha256:sha,file_size:bytes.length,legacy_package_id:null};
}
export async function readWorkspacePlanning(c:PoolClient,taskId:string){const task=(await c.query('SELECT status,last_result FROM public.tasks WHERE id=$1',[taskId])).rows[0];return{planning:true as const,taskId,status:task.status,detail:task.last_result?.blockers?.[0]?.detail??task.last_result?.retry?.reason??null};}
export async function syncProductionWorkspaceShots(c:PoolClient,row:ProductionWorkspaceRecord,root:string){
 const preparationId=row.preparation_revision_id??row.storyboard_package_id;
 const known=(await c.query('SELECT 1 FROM local_identity.production_preparation_revisions WHERE id=$1 AND episode_id=$2 AND script_revision_id=$3',[preparationId,row.episode_id,row.script_revision_id])).rowCount;
 if(!known)await adoptProductionPreparation(c,root,row.episode_id,row.script_revision_id,preparationId!);
 else await verifyProductionPreparationSource(c,root,row.episode_id,preparationId!);
 await c.query('SELECT local_identity.sync_production_workspace_shots($1)',[row.id]);
 row.preparation_revision_id=preparationId;
 await c.query('SELECT local_identity.sync_workspace_caption_inputs($1)',[row.id]);
 await c.query('SELECT local_identity.sync_workspace_narration_inputs($1)',[row.id]);
}
function preparationOrigin(origin:string,format:string,protocol?:string){return origin==='script'?'script-segment':origin==='plan-import'?format==='production-preparation/v1'&&protocol==='saved-production-plan/v1'?'saved-plan':'planner':'legacy-board';}
export async function resolveWorkspaceShotLineage(c:PoolClient,row:Pick<ProductionWorkspaceRecord,'id'|'episode_id'|'storyboard_package_id'|'preparation_revision_id'|'bindings'>,shotId:string,preparationId=row.preparation_revision_id??row.storyboard_package_id){
 const result=(await c.query("SELECT s.*,p.origin preparation_origin,p.source_format preparation_format,p.source_evidence->>'version' preparation_protocol,local_identity.historical_preparation_shot_classification(p.id,s.shot_id) historical_classification FROM local_identity.production_shot_versions s JOIN local_identity.production_preparation_revisions p ON p.id=s.preparation_revision_id WHERE s.preparation_revision_id=$1 AND s.episode_id=$2 AND s.shot_id=$3",[preparationId,row.episode_id,shotId])).rows[0];
 if(!result)throw new ConfigurationError(409,'镜头制作依据尚未接入，请先确认当前制作基准。');
 return{...result,origin:result.origin==='local'?'local-added':preparationOrigin(result.preparation_origin,result.preparation_format,result.preparation_protocol),shot_type:result.historical_classification??null,id:shotId,scriptSegment:result.baseline_text};
}

export async function readWorkspacePreparation(c:PoolClient,row:ProductionWorkspaceRecord){
 const prep=(await c.query('SELECT origin,source_format,source_evidence FROM local_identity.production_preparation_revisions WHERE id=$1 AND episode_id=$2',[row.preparation_revision_id??row.storyboard_package_id,row.episode_id])).rows[0],auth=(await c.query('SELECT enabled,authorization_hash,plan FROM local_identity.script_productions WHERE episode_id=$1 AND script_revision_id=$2 AND authorized_at IS NOT NULL',[row.episode_id,row.script_revision_id])).rows[0];
 if(!prep)throw new ConfigurationError(409,'制作基准尚未接入，请先确认当前版本。');
 const shots:Array<{shotId:string;origin:string;visualSource?:ProductionVisualSource;materialReference?:string}>=[];
 for(const clip of row.bindings){
  if(shots.some(s=>s.shotId===clip.shotId))continue;
  const source=await resolveWorkspaceShotLineage(c,row,clip.shotId),intent=source.snapshot;
  shots.push({shotId:clip.shotId,origin:source.origin,...(productionVisualSources.includes(intent?.visualSource)?{visualSource:intent.visualSource}:{}),...(typeof intent?.materialReference==='string'?{materialReference:intent.materialReference}:{})});
 }
 const origin=preparationOrigin(prep.origin,prep.source_format,prep.source_evidence?.version);
 return{origin,scriptRevisionId:row.script_revision_id,authorized:origin!=='saved-plan'&&!!auth?.enabled,authorizationHash:origin==='saved-plan'?undefined:auth?.authorization_hash,...(origin==='saved-plan'?{planSha256:prep.source_evidence?.plan_sha256}:{}),shots};
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
