import type {PoolClient} from 'pg';
import {buildOpenChatCutProject} from '../worker/openchatcutProject.js';
import type {StoryboardManifest,WorkerTaskPackage} from '../worker/contracts.js';
import type {WorkspaceClip} from '../productionWorkspace.js';
import {createProductionWorkspaceProject,type WorkspaceInitialInputs} from './workspaceInitialProject.js';
import {recoverImportedWorkspaceProject} from './legacyWorkspaceProject.js';
import {readWorkspaceShots,withWorkspaceShotMetadata,workspaceShotIdentity} from '../workspaceShots.js';
import {ConfigurationError} from './configurationCommands.js';

type Render=NonNullable<WorkerTaskPackage['reviewRender']>;
/** Preserve verified old uses; insert genuinely empty slots for unfinished shots. */
export async function mixedLegacyWorkspace(c:PoolClient,root:string,episodeId:string,workspaceId:string,board:StoryboardManifest,render:Render,initialInputs?:WorkspaceInitialInputs){
 const frozen=buildOpenChatCutProject(render,`loop-control-${episodeId}`),canvas=frozen.timelines[0];
 const base=createProductionWorkspaceProject(episodeId,workspaceId,board.shots,canvas,initialInputs);
 base.project=withWorkspaceShotMetadata(base.project,base.clips);
 const adopted=await recoverImportedWorkspaceProject(c,root,episodeId,workspaceId,frozen,base.clips,render);
 const confirmed=new Set(render.confirmedShots.map(s=>s.shotId)),native=readWorkspaceShots(frozen),pending=readWorkspaceShots(base.project);
 const windows=new Map<string,{start:number;duration:number;previous:number;confirmed:boolean}>();let frame=0;
 for(const shot of board.shots){
  const known=confirmed.has(shot.id),window=(known?native:pending).find(s=>s.id===shot.id);
  if(!window)throw new ConfigurationError(409,'原镜头的确认子集无法映射到完整作品。');
  windows.set(shot.id,{start:frame,duration:window.durationInFrames,previous:window.startFrame,confirmed:known});frame+=window.durationInFrames;
 }
 const project=structuredClone(frozen),timeline=project.timelines[0];timeline.name='整期剪辑';
 const items:typeof timeline.items=[];
 for(const item of timeline.items){
  const meta=item.loopControlAudio as {shotId?:string;kind?:string}|undefined,shotId=workspaceShotIdentity(item)?.shotId??meta?.shotId;
  if(shotId){
   const window=windows.get(shotId);if(!window?.confirmed)throw new ConfigurationError(409,'原采用内容没有准确的确认镜头。');
   item.startFrame=Number(item.startFrame)+window.start-window.previous;
   // A pending gap moves the adopted instance, never its verified source interval.
   items.push(item);continue;
  }
  // The original selection contract permits episode BGM and shot SFX only.
  if(item.kind!=='audio'||meta?.kind!=='sfx')throw new ConfigurationError(409,'原工程存在尚不能映射的采用内容。');
  const member=render.members.find(m=>m.memberKind==='soundtrack'&&item.id===`soundtrack-${m.memberKey.replace(/[^a-zA-Z0-9_-]/g,'-')}`);
  const targetId=member?.memberKey.slice(member.memberKey.indexOf(':')+1),target=targetId?windows.get(targetId):undefined;
  if(!target?.confirmed)throw new ConfigurationError(409,'原音效缺少准确的确认镜头，未静默丢弃。');
  const offset=Number(item.startFrame)-target.previous;
  if(offset<0||offset+Number(item.durationInFrames)>target.duration)throw new ConfigurationError(409,'原镜头音效超出准确确认窗口，请保留原版核对。');
  items.push({...item,startFrame:target.start+offset,loopControlAudio:{...meta,workspaceId,shotId:targetId,kind:'sfx',anchor:'shot',offsetSeconds:offset/timeline.fps}});
 }
 for(const item of base.project.timelines[0].items){
  const id=workspaceShotIdentity(item)?.shotId,window=id?windows.get(id):undefined;if(!window||window.confirmed)continue;
  items.push({...item,startFrame:Number(item.startFrame)+window.start-window.previous});
  const track=String(item.track);timeline.tracks[track]??=base.project.timelines[0].tracks[track];if(!timeline.trackOrder.includes(track))timeline.trackOrder.unshift(track);
 }
 timeline.items=items;
 for(const track of Object.values(timeline.tracks))for(const lane of track.captions?.sourceEntries??[]){
  const id=render.confirmedShots.find(s=>lane.id===`workspace-caption-shot-${s.shotId}`)?.shotId,window=id?windows.get(id):undefined;
  if(!window)throw new ConfigurationError(409,'原字幕不能映射到确认镜头。');
  const shift=(window.start-window.previous)*1000/timeline.fps;for(const word of lane.words){word.start+=shift;word.end+=shift;}
 }
 for(const item of items){
  const asset=project.assets.find(a=>a.id===item.sourceAssetId||a.src===item.src);
  if(asset&&(Number(item.srcInFrame??0)<0||Number(item.srcInFrame??0)+Number(item.durationInFrames)>asset.durationInFrames+1))throw new ConfigurationError(409,'原声音或画面在完整作品中的使用窗口超出文件，未循环或重发。');
 }
 const clips:WorkspaceClip[]=board.shots.flatMap(s=>(confirmed.has(s.id)?adopted:base.clips).filter(b=>b.shotId===s.id));
 return{project,clips};
}
