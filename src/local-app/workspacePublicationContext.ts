import type {PoolClient} from 'pg';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {workspaceExecutionProject,isWorkspaceVideoTrack} from '../workspaceExecution.js';
import {workspaceShotIdentity} from '../workspaceShots.js';
import {usedWorkspaceContent} from './workspaceExportCommands.js';
import {usedNarrationWindows} from './workspaceDeliveryCommands.js';
import {readWorkspaceNarrationSource} from './workspaceNarrationSource.js';
import {readWorkspaceProject,type ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';

/** Only reachable, displayed source windows are context. Deleted script is never sent. */
export function publicationTimelineContext(original:OpenChatCutProject){
 const project=workspaceExecutionProject(original),visuals:Array<{shotId:string|null;description:string;startSeconds:number;durationSeconds:number;kind:string}>=[],subtitles:string[]=[];
 let nodes=0;
 const visit=(id:string,from=0,to=Infinity,depth=0)=>{
  if(depth>32||++nodes>4096)throw Error('当前时间线超出发布文案检查范围。');
  const t=project.timelines.find(t=>t.id===id);if(!t)throw Error('当前时间线不存在。');
  for(const item of [...t.items].sort((a,b)=>Number(a.startFrame)-Number(b.startFrame))){
   const start=Number(item.startFrame),end=start+Number(item.durationInFrames),left=Math.max(from,start),right=Math.min(to,end),track=t.tracks[String(item.track)];
   if(right<=left||track?.hidden||!isWorkspaceVideoTrack(t,String(item.track)))continue;
   if(item.kind==='sequence'){const rate=Number(item.playbackRate??1),source=Number(item.srcInFrame??0)+(left-start)*rate;visit(String(item.timelineId),source,source+(right-left)*rate,depth+1);continue;}
   if(!['video','image','text'].includes(String(item.kind)))continue;
   const identity=workspaceShotIdentity(item),text=item.kind==='text'?(item.props as {text?:string}|undefined)?.text:undefined;
   visuals.push({shotId:identity?.shotId??null,description:String(text??identity?.text??item.name??'已保留画面'),startSeconds:left/t.fps,durationSeconds:(right-left)/t.fps,kind:String(item.kind)});
  }
  if(!t.captionsHidden)for(const track of Object.values(t.tracks))if(track.kind==='caption'&&!track.hidden&&track.captions?.enabled!==false)for(const lane of track.captions?.sourceEntries??[])if(lane.visible!==false)for(const word of lane.words)if(word.start<to*1000/t.fps&&word.end>from*1000/t.fps)subtitles.push(word.text);
 };
 visit(project.activeTimelineId);return{visuals,subtitles:[...new Set(subtitles)],limitation:'画面描述来自当前保留的制作安排；未观看视频，未知台词不作为事实。'};
}
export async function buildPublicationContext(c:PoolClient,root:string,row:ProductionWorkspaceRecord){
 const project=await readWorkspaceProject(c,root,row),timeline=publicationTimelineContext(project),used=usedWorkspaceContent(project),narration=[];
 for(const item of used.items.filter(item=>item.kind==='audio'&&typeof item.id==='string'&&item.id.startsWith('workspace-narration-'))){
  const source=await readWorkspaceNarrationSource(c,row,item),windows=usedNarrationWindows(project,String(item.id));
  const full=!!source?.track&&windows.length===1&&windows[0].audible&&windows[0].textCoverageVerified&&windows[0].srcInFrame===0&&windows[0].playbackRate===1&&Math.abs(windows[0].sourceDurationSeconds-Number(source.track.duration_seconds))<=1/windows[0].fps;
  narration.push({text:full?source?.text??null:null,coverage:full?'complete_source':'partial_or_muted_or_retimed_unknown',windows});
 }
 const rules=(await c.query('SELECT b.policy account_rules,s.rules series_rules FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id LEFT JOIN public.series_versions s ON s.id=e.series_version_id WHERE e.id=$1',[row.episode_id])).rows[0];
 return{...timeline,narration,accountRules:rules?.account_rules??{},seriesRules:rules?.series_rules??{}};
}
