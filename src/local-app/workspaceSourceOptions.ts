import type {PoolClient} from 'pg';
import type {WorkspaceSourceOptions,WorkspaceSourceOption} from '../workspaceSourceOptions.js';
import {ScriptProductionStore} from './scriptProductionStore.js';
import {readLegacyStudioProject} from './legacyStudioProject.js';
import {ConfigurationError} from './configurationCommands.js';
import {readLegacyWorkbenchSource} from './legacyWorkbenchSource.js';

/** Called in the same Owner read as the absent workspace, before any preparation. */
export async function readWorkspaceSourceOptions(c:PoolClient,root:string,episode:{id:string;main_script_revision_id:string|null}):Promise<WorkspaceSourceOptions>{
 const options:WorkspaceSourceOption[]=[],result:WorkspaceSourceOptions={version:'workspace-source-options/v1',scriptRevisionId:episode.main_script_revision_id,options};
 const board=(await c.query("SELECT id FROM public.review_packages WHERE episode_id=$1 AND stage='storyboard_review' AND invalidated_at IS NULL ORDER BY revision_number DESC LIMIT 1",[episode.id])).rows[0];
 let native;
 try{native=await readLegacyStudioProject(c,root,episode.id);}catch(error){
  if(!(error instanceof ConfigurationError))throw error;
  options.push({id:'saved-native',label:'原生剪辑工程',summary:'原文件保留。',source:null,unavailableReason:error.message});return result;
 }
 if(native){
  const unavailableReason=!board||!episode.main_script_revision_id?'原生工程缺少当前脚本或分镜基准，请先核对原版本。':undefined;
  options.push({id:'saved-native',label:'最近保存的原生工程',summary:'保留原编辑继续制作，接入时重新核验来源与文件。',source:unavailableReason?null:{kind:'saved-native',reviewPackageId:board.id,savedProjectSha256:native.sha256},...(unavailableReason?{unavailableReason}:{})});return result;
 }
 const projects=(await c.query("SELECT a.id,a.relative_path,a.sha256,t.input_snapshot FROM public.artifacts a JOIN public.tasks t ON t.id=a.producer_task_id AND t.episode_id=a.episode_id AND t.status='completed' WHERE a.episode_id=$1 AND a.artifact_type IN ('review_render_project','final_render_project') AND a.relative_path ~ '\\.(json|html)$' ORDER BY a.created_at DESC,a.id",[episode.id])).rows;
 if(projects.length){
  const preIds=projects.map(p=>(p.input_snapshot?.review_render??p.input_snapshot?.final_render?.review_render)?.pre_render_review_package_id).filter((id:unknown)=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id));
  const bases=(await c.query("SELECT id,CASE WHEN stage='storyboard_review' THEN id::text ELSE context_snapshot->>'storyboard_review_package_id' END board FROM public.review_packages WHERE episode_id=$1 AND id=ANY($2::uuid[])",[episode.id,preIds])).rows;
  projects.forEach((project,index)=>{
   const pre=(project.input_snapshot?.review_render??project.input_snapshot?.final_render?.review_render)?.pre_render_review_package_id,origin=bases.find(p=>p.id===pre)?.board;
   const unavailableReason=!episode.main_script_revision_id||!board||origin!==board.id?'原工程与当前分镜的来源关系不可核验，请先核对原版本。':undefined;
   options.push({id:project.id,label:`原 ${project.relative_path.endsWith('.html')?'HTML':'JSON'} 工程 · 版本 ${projects.length-index}`,summary:'接入原工程继续编辑，接入时重新核验文件与来源。',source:unavailableReason?null:{kind:'rendered-project',reviewPackageId:board.id,artifactId:project.id,expectedSourceSha256:project.sha256},...(unavailableReason?{unavailableReason}:{})});
  });
  return result;
 }
 const saved=await new ScriptProductionStore().read(c,episode.id);
 if(saved.plan){
  const current=(await c.query('SELECT sha256 FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2',[episode.main_script_revision_id,episode.id])).rows[0];
  const unavailableReason=!saved.v2?'原计划格式尚未支持接入。':!current||current.sha256!==saved.savedScriptSha256?'当前脚本与原计划正文不同，请先核对原版本。':undefined;
  options.push({id:'saved-plan',label:'原保存计划',summary:'导入原镜头输入与素材候选，仍需明确采用。',source:unavailableReason?null:{kind:'saved-plan',expectedPlanSha256:saved.planSha256!},...(unavailableReason?{unavailableReason}:{})});
 }
 if(board){
  const supported=(await c.query("SELECT to_regprocedure('local_identity.read_legacy_workbench_source(uuid,boolean)') IS NOT NULL present")).rows[0].present;
  const source=supported?await readLegacyWorkbenchSource(c,episode.id):null,record=source?.record;
  const raw=record?.board.context_snapshot as {worker_result?:{storyboard?:{shots?:Array<{id:string}>}};storyboard?:{shots?:Array<{id:string}>}}|null|undefined;
  const shots=raw?.worker_result?.storyboard?.shots??raw?.storyboard?.shots;
  const unavailableReason=!supported?'当前服务尚未支持原工作版本读取，请先更新本地服务。':!record||!Array.isArray(shots)||!shots.length||record.drafts.length!==shots.length||new Set(record.drafts.map(d=>d.shot_id)).size!==shots.length||shots.some(shot=>!record.drafts.some(d=>d.shot_id===shot.id))?'原镜头记录不完整，请先核对原版本。':!episode.main_script_revision_id||record.scriptRevisionId!==episode.main_script_revision_id?'原镜头与当前脚本基准不同，请先核对原版本。':record.drafts.some(d=>!['confirmed','pending','skipped'].includes(d.confirmation_status))?'原镜头确认状态尚未支持接入。':undefined;
  const confirmed=record?.drafts.filter(d=>d.confirmation_status==='confirmed').length??0,allConfirmed=!!record&&confirmed===record.drafts.length;
  options.push({id:'shot-workbench',label:'原镜头工作版本',summary:allConfirmed?'保留原确认的素材与声音，接入时重新核验来源。':`保留 ${confirmed} 个原确认镜头，其余只导入输入与候选，仍需明确采用。`,source:unavailableReason?null:{kind:'shot-workbench',reviewPackageId:board.id,workbenchSha256:source!.sha256,mode:allConfirmed?'confirmed':'inputs'},...(unavailableReason?{unavailableReason}:{})});
 }
 return result;
}
