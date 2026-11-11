import {verifyEpisodeFile,episodeFileIO} from './episodeFiles.js';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {PoolClient} from 'pg';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';
import type {InputRuntime} from './episodeCommands.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import type {WorkspaceExport,WorkspaceExportCheck,WorkspaceExportIssue} from '../workspaceExport.js';
import {activeOpenChatCutState} from '../worker/openchatcutProject.js';
import {readWorkspaceCaptions,confirmWorkspaceCaptionTexts} from './workspaceCaptionsCommands.js';
import {resolveWorkspaceSource} from './workspaceSources.js';
import {ConfigurationError} from './configurationCommands.js';
import {safeAssetOutputPath} from '../worker/controlledMediaExecutor.js';
import {inspectMp4Artifact} from '../worker/mediaTools.js';
import {isOpenChatCutStudio} from '../worker/openchatcutStudio.js';
import {workspaceVisualGaps} from './workspaceVisualCoverage.js';
import {workspaceExecutionProject} from '../workspaceExecution.js';

/** Native timeline graph, excluding the unused media pool and unreachable sequences. */
export function usedWorkspaceContent(project:OpenChatCutProject){
 project=workspaceExecutionProject(project);
 const timelines=new Map(project.timelines.map(t=>[t.id,t])),ids=new Set<string>(),paths=new Set<string>(),items:Array<Record<string,unknown>>=[],visited=new Set<string>();
 let nodes=0;const visit=(id:string,stack:Set<string>,from=0,to=Infinity)=>{
  if(stack.has(id))throw Error('嵌套序列存在循环引用。');if(stack.size>32||++nodes>4096)throw Error('嵌套序列超出检查范围。');const t=timelines.get(id);if(!t)throw Error('已用嵌套序列不存在。');stack=new Set(stack).add(id);visited.add(id);
  const scan=(value:unknown)=>{if(Array.isArray(value)){value.forEach(scan);return;}if(value&&typeof value==='object')for(const[k,v]of Object.entries(value)){if(k==='src'&&typeof v==='string')paths.add(v);else scan(v);}};
  for(const item of t.items){const start=Number(item.startFrame),end=start+Number(item.durationInFrames);if(end<=from||start>=to)continue;items.push(item);ids.add(String(item.id));if(item.kind==='sequence'){const rate=Number(item.playbackRate??1),source=Number(item.srcInFrame??0);visit(String(item.timelineId),stack,source+(Math.max(from,start)-start)*rate,source+(Math.min(to,end)-start)*rate);continue;}if(['video','audio','image'].includes(String(item.kind))&&!item.src&&!item.sourceAssetId)throw Error('已用媒体缺少来源或指纹身份。');scan(item);if(!item.src&&typeof item.sourceAssetId==='string'){const a=project.assets.find(a=>a.id===item.sourceAssetId);if(!a)throw Error('已用素材身份不存在。');paths.add(a.src);}}
  scan(t.tracks);
 };
 visit(project.activeTimelineId,new Set());return{ids,paths,items,timelineIds:visited};
}
export async function workspaceExportReadiness(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject){
 project=workspaceExecutionProject(project);
 const checks:WorkspaceExportCheck[]=[],sources:Array<{relativePath:string;sha256:string;fileSize:number}>=[];let used:ReturnType<typeof usedWorkspaceContent>|null=null;
 try{used=usedWorkspaceContent(project);if(!used.items.length)throw Error('当前时间线没有内容。');
  const placeholders=row.bindings.filter(b=>used!.items.some(i=>i.id===b.itemId&&i.kind==='text'&&!i.src&&!b.source));if(placeholders.length)throw Error(`还有 ${placeholders.length} 处已用画面占位。`);
  for(const path of used.paths){const s=await resolveWorkspaceSource(c,root,row.episode_id,path);sources.push({relativePath:s.relative_path,sha256:s.sha256,fileSize:Number(s.file_size)});}
  checks.push({name:'used_content',passed:true,detail:`已核对 ${used.paths.size} 个实际来源。`,sources});
 }catch(error){checks.push({name:'used_content',passed:false,detail:error instanceof Error?error.message:'实际来源不可用。'});}
 try{
  const gaps=workspaceVisualGaps(project);
  checks.push({name:'visual_coverage',passed:gaps.length===0,detail:gaps.length?`画面空档 ${gaps.slice(0,6).map(g=>`${g.startSeconds.toFixed(2)}–${g.endSeconds.toFixed(2)} 秒`).join('、')}。请在剪辑工作台合拢片段，或添加明确的背景画面后重新导出。`:'整期画面连续，无未填充空档。',gaps});
 }catch(error){checks.push({name:'visual_coverage',passed:false,detail:error instanceof Error?error.message:'画面覆盖检查未完成。'});}
 try{
  for(const timeline of project.timelines.filter(t=>used?.timelineIds.has(t.id))){
   if(timeline.captionsHidden)continue;const endMs=Math.max(0,...timeline.items.map(i=>Number(i.startFrame)+Number(i.durationInFrames)))*1000/timeline.fps;
   for(const track of Object.values(timeline.tracks))if(track.kind==='caption'&&track.captions?.enabled!==false)for(const lane of track.captions?.sourceEntries??[]){
    if(lane.visible===false)continue;
    if(lane.words.some(word=>!word.text.trim()||!Number.isFinite(word.start)||!Number.isFinite(word.end)||word.start<0||word.end<=word.start||word.end>endMs+1))throw Error('原生字幕存在空正文或越界时序，请在剪辑器调整。');
   }
  }
  const captions=await readWorkspaceCaptions(c,root,{...row,bindings:row.bindings.filter(b=>used?.ids.has(b.itemId))},project);const required=captions.filter(x=>used?.ids.has(x.itemId)&&x.contract.enabled);if(required.some(x=>x.timing!=='current'||!x.contract.cues.length||x.contract.cues.some(q=>q.startMs<0||q.endMs<=q.startMs||q.endMs>x.durationMs+1)))throw Error('必要字幕缺少当前时序，请在剪辑器校时或使用字幕对齐。');checks.push({name:'captions',passed:true,detail:`已核对 ${required.length} 组字幕时序，正文随最终文件一次确认。`,evidence:required});}catch(error){checks.push({name:'captions',passed:false,detail:error instanceof Error?error.message:'字幕不可用。'});}
 return{checks,sources,used};
}
export async function readWorkspaceExports(c:PoolClient,root:string,row:ProductionWorkspaceRecord):Promise<{exports:WorkspaceExport[];exportIssues:WorkspaceExportIssue[]}>{
 if(!(await c.query("SELECT to_regclass('local_identity.workspace_exports') present")).rows[0].present)return{exports:[],exportIssues:[]};
 const rows=(await c.query('SELECT * FROM local_identity.workspace_exports WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC',[row.id])).rows;
 const issues=(await c.query('SELECT * FROM local_identity.workspace_export_issues WHERE workspace_id=$1 ORDER BY created_at DESC',[row.id])).rows;
 const exports:WorkspaceExport[]=[];
 for(const [index,e] of rows.entries()){
  const current=index===0&&e.content_sha256===row.content_sha256&&Number(e.project_content_version)===Number(row.revision);let available=true;
  if(index===0&&e.artifact)try{await verifyEpisodeFile(c,root,row.episode_id,e.artifact.relativePath,e.artifact.sha256,e.artifact.fileSize);}catch{available=false;}
  exports.push({id:e.id,projectContentVersion:Number(e.project_content_version),contentSha256:e.content_sha256,project:e.project,status:e.status,artifact:e.artifact,checks:[...e.checks,...(!available?[{name:'export_file',passed:false,detail:'导出文件缺失或指纹已变化。'}]:[])],createdAt:e.created_at,confirmedAt:e.confirmed_at,confirmed:!!e.confirmed_at&&current&&available&&!issues.some(i=>!i.resolved_at||new Date(i.created_at)>new Date(e.confirmed_at)),current});
 }
 return{exports,exportIssues:issues.map(i=>({id:i.id,exportId:i.export_id,reason:i.reason,resolved:!!i.resolved_at}))};
}
export async function executeWorkspaceExport(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject,runtime:InputRuntime,command:string,data:Record<string,unknown>){
 const storage=await episodeFileIO(c,root,row.episode_id,true);
 if(isOpenChatCutStudio(row.episode_id))throw new ConfigurationError(409,'请先保存并返回，再检查最终文件。');
 if(command==='recordWorkspaceExportIssue'){
  if(data.exportId!==undefined&&(typeof data.exportId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(data.exportId)))throw new ConfigurationError(400,'导出标识无效。');
  if(typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>4000)throw new ConfigurationError(400,'请填写问题内容。');
  if(data.exportId!==undefined&&!(await c.query('SELECT 1 FROM local_identity.workspace_exports WHERE id=$1 AND workspace_id=$2',[data.exportId,row.id])).rowCount)throw new ConfigurationError(409,'导出版本已变化。');
  await c.query('INSERT INTO local_identity.workspace_export_issues(workspace_id,episode_id,export_id,reason) VALUES($1,$2,$3,$4)',[row.id,row.episode_id,data.exportId??null,data.reason.trim()]);return;
 }
 if(command==='resolveWorkspaceExportIssue'){if(typeof data.issueId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(data.issueId))throw new ConfigurationError(400,'问题标识无效。');if(!(await c.query('UPDATE local_identity.workspace_export_issues SET resolved_at=clock_timestamp() WHERE id=$1 AND workspace_id=$2',[data.issueId,row.id])).rowCount)throw new ConfigurationError(404,'问题记录不存在。');return;}
 if(command==='confirmWorkspaceExport'){
  if(typeof data.exportId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(data.exportId)||typeof data.expectedExportSha256!=='string'||!/^[a-f0-9]{64}$/.test(data.expectedExportSha256)||typeof data.expectedContentSha256!=='string'||!/^[a-f0-9]{64}$/.test(data.expectedContentSha256))throw new ConfigurationError(400,'最终文件确认身份无效。');
  const {exports,exportIssues}=await readWorkspaceExports(c,root,row),e=exports[0];
  if(!e||!e.current||e.id!==data.exportId||e.status!=='ready'||e.contentSha256!==data.expectedContentSha256||e.artifact?.sha256!==data.expectedExportSha256||e.checks.some(x=>!x.passed)||exportIssues.some(x=>!x.resolved))throw new ConfigurationError(409,'当前工程、最终文件或检查已变化，请重新检查这份文件。');
  const readiness=await workspaceExportReadiness(c,root,row,project);if(readiness.checks.some(x=>!x.passed))throw new ConfigurationError(409,'当前已用内容或字幕检查未通过。');
  await verifyEpisodeFile(c,root,row.episode_id,e.project.relativePath,e.project.sha256,e.project.fileSize);
  await confirmWorkspaceCaptionTexts(c,root,{...row,bindings:row.bindings.filter(b=>readiness.used?.ids.has(b.itemId))},project);
  await c.query('UPDATE local_identity.workspace_exports SET confirmed_at=clock_timestamp(),confirmed_by=local_identity.owner_id() WHERE id=$1',[e.id]);return;
 }
 const id=randomUUID(),ready=await workspaceExportReadiness(c,root,row,project),checks=ready.checks;let artifact=null;
 if(checks.every(x=>x.passed))try{
  if(!runtime.studioRuntime)throw Error('本机渲染运行时未配置。');const config=await runtime.studioRuntime(),dir=await mkdtemp(join(tmpdir(),'loop-workspace-export-'));
  try{
   const renderProject=workspaceExecutionProject(project);
   renderProject.assets=renderProject.assets.filter(asset=>ready.used?.paths.has(asset.src));
   renderProject.timelines=renderProject.timelines.filter(timeline=>ready.used?.timelineIds.has(timeline.id)) as OpenChatCutProject['timelines'];
   const output=join(dir,'final.mp4'),spec=join(dir,'spec.json');await writeFile(spec,JSON.stringify({openchatcutRoot:config.root,nodePath:config.nodePath,assetRoot:root,outputPath:output,state:activeOpenChatCutState(renderProject),project:renderProject,timelineId:renderProject.activeTimelineId,sources:await Promise.all(ready.sources.map(async source=>({...source,sourcePath:await storage.resolveReference(source.relativePath)})))}));
   await promisify(execFile)(config.nodePath??process.execPath,[resolve('scripts/openchatcut-render.mjs'),spec],{env:{...process.env,...config.environment},timeout:300000,maxBuffer:4*1024*1024});
   const inspection=await inspectMp4Artifact(output),probe=JSON.parse((await promisify(execFile)('ffprobe',['-v','error','-show_entries','stream=codec_type,duration,nb_frames:format=duration','-of','json',output],{timeout:30000})).stdout),video=probe.streams?.find((s:{codec_type:string})=>s.codec_type==='video'),videoDurationSeconds=Number(video?.duration),timeline=renderProject.timelines.find(t=>t.id===renderProject.activeTimelineId)!;
   const duration=Math.max(...timeline.items.map(i=>Number(i.startFrame)+Number(i.durationInFrames)))/timeline.fps;
   const audioExpected=ready.used!.items.some(i=>(i.kind==='audio'||i.kind==='video')&&Number(i.volume??1)>0);
   const passed=inspection.width===timeline.width&&inspection.height===timeline.height&&Number.isFinite(videoDurationSeconds)&&Math.abs(videoDurationSeconds-duration)<Math.max(.15,2/timeline.fps)&&(!audioExpected||inspection.hasAudio)&&inspection.blackFrameCount===0;
   checks.push({name:'technical',passed,detail:passed?'实际 MP4 时长、画幅、音频及黑帧检查通过。':'实际 MP4 技术检查未通过。',inspection,videoDurationSeconds,containerDurationSeconds:Number(probe.format?.duration),videoFrames:Number(video?.nb_frames),expectedDurationSeconds:duration,audioExpected});
   await storage.assertValid();const bytes=await readFile(output),sha=createHash('sha256').update(bytes).digest('hex'),relativePath=`${storage.relativePath}/workspace-exports/${id}/${sha}.mp4`,path=await safeAssetOutputPath(root,relativePath);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes,{flag:'wx'});artifact={relativePath,sha256:sha,fileSize:bytes.length};await verifyEpisodeFile(c,root,row.episode_id,relativePath,sha,bytes.length);
   const framePath=await safeAssetOutputPath(root,`${storage.relativePath}/workspace-exports/${id}/representative.jpg`);await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-ss',String(Math.min(.5,inspection.durationSeconds/2)),'-i',path,'-frames:v','1',framePath],{timeout:30000});const frame=await readFile(framePath);checks.push({name:'representative_frame',passed:frame.length>0,detail:'已实际解码代表帧。',artifact:{relativePath:`${storage.relativePath}/workspace-exports/${id}/representative.jpg`,sha256:createHash('sha256').update(frame).digest('hex'),fileSize:frame.length}});
   checks.push({name:'export_file',passed:true,detail:'最终文件已按字节 SHA-256 与大小不可变登记。'});
  }finally{await rm(dir,{recursive:true,force:true});}
 }catch(error){checks.push({name:'native_export',passed:false,detail:error instanceof Error?error.message.slice(0,4000):'本机导出失败，可重试。'});}
 await c.query('INSERT INTO local_identity.workspace_exports(id,workspace_id,episode_id,project_content_version,content_sha256,project,status,artifact,checks) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,row.id,row.episode_id,row.revision,row.content_sha256,JSON.stringify({relativePath:row.project_path,sha256:row.project_sha256,fileSize:Number(row.project_size)}),artifact&&checks.every(x=>x.passed)?'ready':'failed',JSON.stringify(artifact),JSON.stringify(checks)]);
}
/** T12 consumes this exact identity; it must never re-render approved media. */
export async function requireConfirmedWorkspaceExport(c:PoolClient,root:string,row:ProductionWorkspaceRecord,project:OpenChatCutProject){
 const {exports}=await readWorkspaceExports(c,root,row),current=exports[0];if(!current?.confirmed||!current.artifact)throw new ConfigurationError(409,'请先确认当前最终文件。');
 const readiness=await workspaceExportReadiness(c,root,row,project);if(readiness.checks.some(x=>!x.passed))throw new ConfigurationError(409,'当前实际使用内容检查未通过。');
 await verifyEpisodeFile(c,root,row.episode_id,current.project.relativePath,current.project.sha256,current.project.fileSize);return current as WorkspaceExport&{artifact:NonNullable<WorkspaceExport['artifact']>};
}
