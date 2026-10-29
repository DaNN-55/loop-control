import {executeWorkspaceExport,readWorkspaceExports,usedWorkspaceContent} from './workspaceExportCommands.js';
import {workspaceExportFields} from '../workspaceExport.js';
import {executeWorkspaceCaptionCommand,readWorkspaceCaptions} from './workspaceCaptionsCommands.js';
import {workspaceCaptionFields} from '../workspaceCaptions.js';
import {resolveWorkspaceSource} from './workspaceSources.js';
import {executeWorkspaceNarration,readWorkspaceNarration} from './workspaceNarration.js';
import type {InputRuntime} from './episodeCommands.js';
import {matchWorkspaceImage,generateWorkspaceImage,fillWorkspaceImageResult} from './workspaceImages.js';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import type {PoolClient} from 'pg';
import {ConfigurationError} from './configurationCommands.js';
import {verifyNativeFile} from './localFiles.js';
import {safeAssetOutputPath} from '../worker/controlledMediaExecutor.js';
import {inspectMp4Artifact} from '../worker/mediaTools.js';
import {inspectOpenChatCutProjectWithRuntime} from '../worker/openchatcutProjectReader.js';
import {openOpenChatCutDraftStudio,snapshotOpenChatCutStudio,closeOpenChatCutStudio,isOpenChatCutStudio,type OpenChatCutRuntimeConfig} from '../worker/openchatcutStudio.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import type {ProductionWorkspace,WorkspaceClip} from '../productionWorkspace.js';
interface Episode {id:string;account_id:string;policy:Record<string,unknown>;main_script_revision_id:string|null;stage:string;archived_at?:string|null}
export interface ProductionWorkspaceRecord {id:string;episode_id:string;workflow_version:'four-step/v1';script_revision_id:string;storyboard_package_id:string;revision:string|number;native_edit_revision:string|number;bindings:WorkspaceClip[];project_path:string;project_sha256:string;content_sha256:string;project_size:string|number}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
export async function readProductionWorkspace(c:PoolClient,episodeId:string,root:string):Promise<ProductionWorkspace|null>{
 const row=(await c.query('SELECT w.*,e.main_script_revision_id current_script,p.invalidated_at FROM local_identity.production_workspaces w JOIN public.episodes e ON e.id=w.episode_id JOIN public.review_packages p ON p.id=w.storyboard_package_id WHERE w.episode_id=$1',[episodeId])).rows[0];
 if(!row)return null;
 const project=JSON.parse((await verifyNativeFile(root,row.project_path,row.project_sha256,Number(row.project_size))).toString('utf8')) as OpenChatCutProject;
 const used=new Set(project.timelines.flatMap(t=>t.items.map(i=>String(i.id)))),placeholders=row.bindings.filter((b:WorkspaceClip)=>used.has(b.itemId)&&!b.source).map((b:WorkspaceClip)=>b.itemId),missingSources:string[]=[];
 for(const clip of row.bindings as WorkspaceClip[]){if(clip.source&&used.has(clip.itemId))try{await verifyNativeFile(root,clip.source.relativePath,clip.source.sha256,clip.source.fileSize);}catch{missingSources.push(clip.itemId);}}
 const history=(await c.query('SELECT revision,project_sha256,script_revision_id,reason FROM local_identity.production_workspace_versions WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 50',[row.id])).rows.map(v=>({revision:Number(v.revision),sha256:v.project_sha256,scriptRevisionId:v.script_revision_id,reason:v.reason}));
 return{...await readWorkspaceExports(c,root,row),captions:await readWorkspaceCaptions(c,root,row,project),id:row.id,episodeId,workflowVersion:row.workflow_version,scriptRevisionId:row.script_revision_id,storyboardPackageId:row.storyboard_package_id,revision:Number(row.revision),contentSha256:row.content_sha256,narration:await readWorkspaceNarration(c,row),clips:row.bindings,project:{relativePath:row.project_path,sha256:row.project_sha256,fileSize:Number(row.project_size),projectId:`loop-control-${episodeId}`},history,readiness:{deliverable:false,placeholders,missingSources},stale:row.current_script!==row.script_revision_id||!!row.invalidated_at};
}
export function workspaceContentSha256(project:OpenChatCutProject):string{
 const content=structuredClone(project);for(const timeline of content.timelines){delete (timeline as unknown as Record<string,unknown>).selectedId;delete (timeline as unknown as Record<string,unknown>).selectedIds;}
 return hash(JSON.stringify(content));
}
export class ProductionWorkspaceCommands{
 private opened=new Set<string>();
 isOpen(id:string){return this.opened.has(id)&&isOpenChatCutStudio(id);}
 async closeEpisode(id:string){await closeOpenChatCutStudio(id);this.opened.delete(id);}
 async close(){await Promise.all([...this.opened].map(id=>this.closeEpisode(id)));}

 async execute(c:PoolClient,e:Episode,root:string,runtime:InputRuntime,command:string,data:Record<string,unknown>){
  if(e.archived_at||e.stage==='production_completed'||(await c.query('SELECT local_identity.is_historical_episode($1) historical',[e.id])).rows[0].historical)throw new ConfigurationError(409,'历史或已完成生产单只读。');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[e.id+':studio']);
  let row=(await c.query('SELECT * FROM local_identity.production_workspaces WHERE episode_id=$1 FOR UPDATE',[e.id])).rows[0] as ProductionWorkspaceRecord|undefined;
  if(command==='prepareWorkspace'||command==='replanWorkspace'){
   if(!e.main_script_revision_id||e.main_script_revision_id!==data.expectedScriptRevisionId)throw new ConfigurationError(409,'脚本基准已变化，请先确认当前脚本。');
   const p=(await c.query("SELECT p.*,a.relative_path,a.sha256,a.file_size FROM public.review_packages p JOIN public.artifacts a ON a.id=p.artifact_id WHERE p.id=$1 AND p.episode_id=$2 AND p.stage='storyboard_review' AND p.invalidated_at IS NULL",[data.reviewPackageId,e.id])).rows[0];
   if(!p||!['storyboard_approved','production_ready','render_ready','qc_review'].includes(e.stage))throw new ConfigurationError(409,'请先确认脚本与分镜匹配基准。');
   if(row){
    const same=row.script_revision_id===e.main_script_revision_id&&row.storyboard_package_id===p.id;
    if(same)return readProductionWorkspace(c,e.id,root);
    if(command!=='replanWorkspace'||data.workspaceId!==row.id||data.expectedRevision!==Number(row.revision))throw new ConfigurationError(409,'已有工程使用旧基准，请明确重新规划；不会覆盖原工程。');
    if(typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>4000)throw new ConfigurationError(400,'请填写重规划原因。');
    if(isOpenChatCutStudio(e.id))throw new ConfigurationError(409,'请先保存并返回，再重新规划。');
   }else if(command==='replanWorkspace')throw new ConfigurationError(409,'原工程不存在，请先建立初稿。');
   const storyboard=JSON.parse((await verifyNativeFile(root,p.relative_path,p.sha256,Number(p.file_size))).toString('utf8'));
   if(!Array.isArray(storyboard.shots)||!storyboard.shots.length||new Set(storyboard.shots.map((s:{id:string})=>s.id)).size!==storyboard.shots.length)throw new ConfigurationError(409,'分镜基准无效。');
   const id=row?.id??randomUUID(),clips:WorkspaceClip[]=storyboard.shots.map((s:{id:string;scriptSegment:string})=>{if(typeof s.id!=='string'||typeof s.scriptSegment!=='string')throw new ConfigurationError(409,'分镜身份无效。');const clip=randomUUID();return{id:clip,itemId:`shot-${s.id}-${clip}`,shotId:s.id,text:s.scriptSegment,source:null};});
   let frame=0;const project:OpenChatCutProject={version:3,loopControl:{version:'four-step-workspace/v1',inputFingerprint:id,transitionMode:'studio'},assets:[],mediaFolders:[],activeTimelineId:`loop-control-${e.id}`,timelines:[{id:`loop-control-${e.id}`,name:'整期剪辑',order:0,fps:30,width:1080,height:1920,fit:'contain',items:clips.map((clip,i)=>{const duration=Math.max(1,Math.round(Number(storyboard.shots[i].durationSeconds||3)*30)),item={id:clip.itemId,track:'V1',kind:'text',name:`${clip.shotId} · 待匹配画面`,startFrame:frame,durationInFrames:duration,width:1080,height:1920,props:{text:`待匹配画面\n${clip.shotId}`,fontSize:64,color:'#a3acc2',align:'center'},transform:{scale:1,x:0,y:0,rotation:0}};frame+=duration;return item;}),trackOrder:['V1'],tracks:{V1:{kind:'video',name:'画面'}},transitions:[],selectedId:null,captionsHidden:false}]};
   const file=await persistWorkspaceProject(root,e.id,project);
   if(row){
    await c.query('UPDATE local_identity.production_workspaces SET script_revision_id=$2,storyboard_package_id=$3 WHERE id=$1',[row.id,e.main_script_revision_id,p.id]);
    await updateWorkspaceProject(c,root,row,project,clips,String(data.reason));
   }else{
   row=(await c.query('INSERT INTO local_identity.production_workspaces(id,episode_id,script_revision_id,storyboard_package_id,bindings,project_path,project_sha256,project_size,content_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[id,e.id,e.main_script_revision_id,p.id,JSON.stringify(clips),file.relativePath,file.sha256,file.fileSize,workspaceContentSha256(project)])).rows[0];
    await recordWorkspaceVersion(c,row!,'首次组装');
   }
   return readProductionWorkspace(c,e.id,root);
  }
  if(command==='generateWorkspaceImage')return generateWorkspaceImage(c,root,e,runtime,data);
  if(command==='fillWorkspaceImageResult')return fillWorkspaceImageResult(c,root,e.id,data);
  if(command==='matchWorkspaceImage')return matchWorkspaceImage(c,root,e.id,data);
  const locked=await lockProductionWorkspace(c,root,e.id,data.workspaceId,data.expectedRevision);row=locked.row;const project=locked.project;
  if(Object.hasOwn(workspaceExportFields,command)){await executeWorkspaceExport(c,root,row,project,runtime,command,data);return readProductionWorkspace(c,e.id,root);}
  if(Object.hasOwn(workspaceCaptionFields,command))return executeWorkspaceCaptionCommand(c,root,row,project,runtime,command,data);
  if(command.endsWith('WorkspaceNarration')){await executeWorkspaceNarration(c,root,row,project,runtime,command,data);return readProductionWorkspace(c,e.id,root);}
  if(command==='matchWorkspaceMaterial'){
   if(isOpenChatCutStudio(e.id))throw new ConfigurationError(409,'请先保存并返回素材匹配，再填入指定占位。');
   const clip=row.bindings.find(b=>b.id===data.clipId);if(!clip||clip.source)throw new ConfigurationError(409,'占位已变化，请刷新；已有片段请在剪辑中调整。');
   if(typeof data.materialRevisionId!=='string'||!uuid.test(data.materialRevisionId))throw new ConfigurationError(400,'素材标识无效。');
   const m=(await c.query("SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2 AND material_type='video'",[data.materialRevisionId,e.id])).rows[0];if(!m)throw new ConfigurationError(404,'本期视频素材不存在。');
   await verifyNativeFile(root,m.storage_path,m.sha256,Number(m.file_size));const observed=await inspectMp4Artifact(join(root,m.storage_path));
   const timeline=project.timelines.find(t=>t.items.some(i=>i.id===clip.itemId)),item=timeline?.items.find(i=>i.id===clip.itemId);if(!timeline||!item)throw new ConfigurationError(409,'占位已从工程删除，请在当前工程中操作。');
   if(observed.durationSeconds+0.05<Number(item.durationInFrames)/timeline.fps)throw new ConfigurationError(409,'原片短于占位时长，请先明确调整镜头时长。');
   const assetId=`material-${m.id}`;if(!project.assets.some(a=>a.id===assetId))project.assets.push({id:assetId,name:m.source_path.split('/').pop()??clip.shotId,kind:'video',src:m.storage_path,durationInFrames:Math.round(observed.durationSeconds*timeline.fps)});
   Object.assign(item,{kind:'video',name:clip.shotId,src:m.storage_path,sourceAssetId:assetId,srcInFrame:0,volume:0});delete item.props;
   clip.source={materialRevisionId:m.id,relativePath:m.storage_path,sha256:m.sha256,fileSize:Number(m.file_size),kind:'video'};
   await updateWorkspaceProject(c,root,row,project,row.bindings);return readProductionWorkspace(c,e.id,root);
  }
  if(!runtime.studioRuntime)throw new ConfigurationError(503,'本地 Studio 未配置。');const config=await runtime.studioRuntime();
  const validate=(doc:OpenChatCutProject)=>validateWorkspaceProject(c,root,e.id,doc,config);
  if(command==='openWorkspaceStudio'){
   const paths=[...usedWorkspaceContent(project).paths];const opened=await openOpenChatCutDraftStudio(root,e.id,project,paths,hash(JSON.stringify({id:row.id,bindings:row.bindings})),config,validate);
   this.opened.add(e.id);const current=JSON.parse((await verifyNativeFile(root,opened.workspace.relativePath,opened.workspace.sha256,opened.workspace.fileSize)).toString('utf8')) as OpenChatCutProject;await updateWorkspaceProject(c,root,row,current,row.bindings);return{...opened,productionWorkspace:await readProductionWorkspace(c,e.id,root)};
  }
  if(command==='closeWorkspaceStudio'){await this.closeEpisode(e.id);return readProductionWorkspace(c,e.id,root);}
  if(command==='saveWorkspaceStudio'){
   if(data.projectId!==`loop-control-${e.id}`||typeof data.workspaceRelativePath!=='string'||data.workspaceRelativePath!==`episodes/${e.id}/openchatcut-work/current/project.json`||data.expectedWorkspaceSha256!==row.project_sha256)throw new ConfigurationError(409,'当前工程身份或文件版本已变化。');
   let file;try{file=await snapshotOpenChatCutStudio(root,e.id,`episodes/${e.id}/openchatcut-work/current/project.json`,row.project_sha256,validate);}catch(error){if(error instanceof ConfigurationError)throw error;throw new ConfigurationError(409,'Studio 会话或版本已失效，请重新打开当前工程。');}
   const current=JSON.parse((await verifyNativeFile(root,file.relativePath,file.sha256,file.fileSize)).toString('utf8')) as OpenChatCutProject;
   if(workspaceContentSha256(current)!==row.content_sha256)await c.query('UPDATE local_identity.production_workspaces SET native_edit_revision=native_edit_revision+1 WHERE id=$1',[row.id]);
   await updateWorkspaceProject(c,root,row,current,row.bindings);return{...file,productionWorkspace:await readProductionWorkspace(c,e.id,root)};
  }
  throw new ConfigurationError(400,'不支持的工作台操作。');
 }
}
export async function readWorkspaceProject(root:string,row:ProductionWorkspaceRecord):Promise<OpenChatCutProject>{
 try{return JSON.parse((await verifyNativeFile(root,row.project_path,row.project_sha256,Number(row.project_size))).toString('utf8')) as OpenChatCutProject;}catch{throw new ConfigurationError(409,'工程快照不可用或指纹已变化，原始素材未修改。');}
}
/** Every version is immutable. A rolled-back DB update only leaves an unreferenced snapshot. */
export async function persistWorkspaceProject(root:string,episodeId:string,project:OpenChatCutProject){
 const bytes=Buffer.from(JSON.stringify(project,null,2)+'\n'),sha=hash(bytes),path=`episodes/${episodeId}/production-workspace/versions/${sha}.json`,file=await safeAssetOutputPath(root,path);
 await mkdir(dirname(file),{recursive:true});
 try{await writeFile(file,bytes,{flag:'wx'});}catch(error){if((error as {code?:string}).code!=='EEXIST')throw error;await verifyNativeFile(root,path,sha,bytes.length);}
 return{relativePath:path,sha256:sha,fileSize:bytes.length};
}
/** Caller holds the Owner transaction and workspace row lock. Editing state stays in the native document. */
export async function updateWorkspaceProject(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,bindings:WorkspaceClip[]=row.bindings,reason?:string){
 const file=await persistWorkspaceProject(root,row.episode_id,project);
 const changed=await c.query('UPDATE local_identity.production_workspaces SET revision=revision+CASE WHEN content_sha256=$6 THEN 0 ELSE 1 END,content_sha256=$6,project_path=$3,project_sha256=$2,project_size=$4,bindings=$5,updated_at=clock_timestamp() WHERE id=$1 AND revision=$7 AND project_sha256=$8',[row.id,file.sha256,file.relativePath,file.fileSize,JSON.stringify(bindings),workspaceContentSha256(project),row.revision,row.project_sha256]);
 if(!changed.rowCount)throw new ConfigurationError(409,'工程版本已变化，请重新读取当前工程。');
 const current=(await c.query('SELECT * FROM local_identity.production_workspaces WHERE id=$1',[row.id])).rows[0] as ProductionWorkspaceRecord;
 await recordWorkspaceVersion(c,current,reason??null);
 return readProductionWorkspace(c,row.episode_id,root);
}
export async function lockProductionWorkspace(c:PoolClient,root:string,episodeId:string,workspaceId:unknown,expectedRevision:unknown){
 const row=(await c.query('SELECT w.*,e.main_script_revision_id current_script,e.archived_at,e.stage,p.invalidated_at,local_identity.is_historical_episode(e.id) historical FROM local_identity.production_workspaces w JOIN public.episodes e ON e.id=w.episode_id JOIN public.review_packages p ON p.id=w.storyboard_package_id WHERE w.episode_id=$1 FOR UPDATE OF w',[episodeId])).rows[0];
 if(!row||row.id!==workspaceId||!Number.isSafeInteger(expectedRevision)||Number(row.revision)!==expectedRevision)throw new ConfigurationError(409,'工程版本已变化，请重新打开当前工作版本。');
 if(row.archived_at||row.stage==='production_completed'||row.historical)throw new ConfigurationError(409,'历史或已完成生产单只读。');
 if(row.script_revision_id!==row.current_script||row.invalidated_at)throw new ConfigurationError(409,'脚本基准已变化，请明确重新规划，原工程已保留。');
 return{row:row as ProductionWorkspaceRecord,project:await readWorkspaceProject(root,row)};
}
async function recordWorkspaceVersion(c:PoolClient,row:ProductionWorkspaceRecord,reason:string|null){
 await c.query('INSERT INTO local_identity.production_workspace_versions(workspace_id,episode_id,revision,script_revision_id,storyboard_package_id,project_path,project_sha256,project_size,content_sha256,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING',[row.id,row.episode_id,row.revision,row.script_revision_id,row.storyboard_package_id,row.project_path,row.project_sha256,row.project_size,row.content_sha256,reason]);
}
export async function readWorkspaceVersion(c:PoolClient,root:string,episodeId:string,sha:string){
 const row=(await c.query('SELECT * FROM local_identity.production_workspace_versions WHERE episode_id=$1 AND project_sha256=$2',[episodeId,sha])).rows[0];
 if(!row)throw new ConfigurationError(404,'工程版本不可见。');
 return readWorkspaceProject(root,row);
}

export async function validateWorkspaceProject(c:PoolClient,root:string,episodeId:string,doc:OpenChatCutProject,config:OpenChatCutRuntimeConfig){
   const sources=new Set<string>();const visit=(value:unknown)=>{if(Array.isArray(value)){value.forEach(visit);return;}if(value&&typeof value==='object')for(const[key,v]of Object.entries(value)){if(key==='src'&&typeof v==='string')sources.add(v);visit(v);}};for(const path of usedWorkspaceContent(doc).paths)sources.add(path);
   for(const path of sources)await resolveWorkspaceSource(c,root,episodeId,path);
   if(!(await inspectOpenChatCutProjectWithRuntime(doc,config)).readable)throw new ConfigurationError(409,'当前草稿不能由 Studio 读取。');
}
