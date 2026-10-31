import {defaultShotComposition,shotCompositionRect,shotCompositionTransform,shotCompositionLayouts,type ShotCompositionLayout} from './shotComposition.js';
import type {OpenChatCutProject} from './worker/openchatcutProject.js';
import type {WorkspaceClip} from './productionWorkspace.js';
import {adjustWorkspaceVideoRange} from './workspaceVideo.js';
/** Stable membership lives in the native instance; bindings remain provenance only. */
export interface WorkspaceShotIdentity {workspaceId:string;shotId:string;clipId:string;text:string;provenance?:Omit<NonNullable<WorkspaceClip['source']>,'relativePath'>}
export interface WorkspaceShot {id:string;text:string;timelineId:string;itemIds:string[];startFrame:number;durationInFrames:number;effective:boolean}
export type WorkspaceShotOperation=
 |{kind:'insert';afterShotId:string|null;text:string;clipId?:string}
 |{kind:'remove';shotId:string}
 |{kind:'composition';shotId:string;layout:ShotCompositionLayout}
 |{kind:'move';shotId:string;beforeShotId:string|null}
 |{kind:'remove-range';itemId:string}
 |{kind:'range';itemId:string;edge:'in'|'out';deltaFrames:number}
 |{kind:'lock';itemId:string;locked:boolean}
 |{kind:'appearance';itemId:string;fit?:'cover'|'contain';focusX?:number;focusY?:number;transition?:'cut'|'fade'};
export function workspaceShotIdentity(item:Record<string,unknown>,workspaceId=''):WorkspaceShotIdentity|null{
 const meta=item.loopControlShot as WorkspaceShotIdentity|undefined;if(meta&&typeof meta.shotId==='string'&&typeof meta.clipId==='string'){const nativeId=String(item.id).match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/)?.[1];return nativeId&&nativeId!==meta.clipId?{...meta,clipId:nativeId}:meta;}
 const match=String(item.id).match(/^shot-(.+)-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/);
 return match?{workspaceId,shotId:match[1],clipId:match[2],text:String(item.name??match[1])}:null;
}
// The owned extension has one stable key position, including SDK documents that inserted it before source metadata.
export function withWorkspaceShotMetadata(project:OpenChatCutProject,bindings:WorkspaceClip[]):OpenChatCutProject{
 const next=structuredClone(project);for(const timeline of next.timelines)for(const item of timeline.items){const binding=bindings.find(b=>b.itemId===item.id);if(binding){delete item.loopControlShot;item.loopControlShot={workspaceId:next.loopControl?.inputFingerprint??'',shotId:binding.shotId,clipId:binding.id,text:binding.text,...(binding.source?{provenance:{materialRevisionId:binding.source.materialRevisionId,sha256:binding.source.sha256,fileSize:binding.source.fileSize,kind:binding.source.kind}}:{})};}}return next;
}
export function readWorkspaceShots(project:OpenChatCutProject):WorkspaceShot[]{
 const shots:WorkspaceShot[]=[];for(const timeline of project.timelines){for(const item of [...timeline.items].sort((a,b)=>Number(a.startFrame)-Number(b.startFrame))){const meta=workspaceShotIdentity(item);if(!meta||!['video','image','text'].includes(String(item.kind)))continue;
 let shot=shots.find(s=>s.id===meta.shotId&&s.timelineId===timeline.id);if(!shot){shot={id:meta.shotId,text:meta.text,timelineId:timeline.id,itemIds:[],startFrame:Number(item.startFrame),durationInFrames:0,effective:false};shots.push(shot);}shot.itemIds.push(String(item.id));shot.durationInFrames=Math.max(shot.startFrame+shot.durationInFrames,Number(item.startFrame)+Number(item.durationInFrames))-shot.startFrame;shot.effective||=item.kind==='video'||item.kind==='image';}}
 return shots;
}
export function readWorkspaceShotWindow(project:OpenChatCutProject,itemId:string){
 const timeline=project.timelines.find(t=>t.items.some(i=>i.id===itemId)),item=timeline?.items.find(i=>i.id===itemId),meta=item&&workspaceShotIdentity(item);
 if(!timeline||!item)return null;
 const items=meta?timeline.items.filter(i=>workspaceShotIdentity(i)?.shotId===meta.shotId&&['video','image','text'].includes(String(i.kind))):[item];
 const startFrame=Math.min(...items.map(i=>Number(i.startFrame))),endFrame=Math.max(...items.map(i=>Number(i.startFrame)+Number(i.durationInFrames)));
 return{timeline,item,items,shotId:meta?.shotId??null,startFrame,endFrame,durationInFrames:endFrame-startFrame};
}
export function synchronizeWorkspaceBindings(project:OpenChatCutProject,previous:WorkspaceClip[]):WorkspaceClip[]{
 return readWorkspaceShots(project).flatMap(shot=>shot.itemIds.map(itemId=>{const item=project.timelines.flatMap(t=>t.items).find(i=>i.id===itemId)!,meta=workspaceShotIdentity(item)!,old=previous.find(b=>b.id===meta.clipId);return old?{...old,text:meta.text}:{id:meta.clipId,itemId,shotId:meta.shotId,text:meta.text,source:meta.provenance&&typeof item.src==='string'?{...meta.provenance,relativePath:item.src}:null};}));
}
/** Constrained native edits. Unrelated nodes, pool assets and source files are never reconstructed. */
export function applyWorkspaceShotOperation(project:OpenChatCutProject,operation:WorkspaceShotOperation):OpenChatCutProject{
 if(!isWorkspaceShotOperation(operation))throw Error('镜头编辑输入无效。');
 const next=structuredClone(project),shots=readWorkspaceShots(next);
 if(operation.kind==='insert'){
  const after=operation.afterShotId===null?null:shots.find(s=>s.id===operation.afterShotId);if(operation.afterShotId&&!after)throw Error('当前镜头不存在。');
  const timeline=next.timelines.find(t=>t.id===(after?.timelineId??next.activeTimelineId));if(!timeline)throw Error('当前时间线不存在。');
  const clipId=operation.clipId??crypto.randomUUID(),shotId=`added-${clipId}`,at=after?after.startFrame+after.durationInFrames:0,duration=Math.round(timeline.fps*3),track=after?String(timeline.items.find(i=>i.id===after.itemIds[0])!.track):timeline.trackOrder.find(id=>timeline.tracks[id].kind==='video');
  if(timeline.items.some(i=>workspaceShotIdentity(i)?.clipId===clipId))return next;
  if(!track)throw Error('当前时间线没有画面轨。');
  for(const item of timeline.items)if(Number(item.startFrame)>=at&&(workspaceShotIdentity(item)||shots.some(shot=>shotAudio(item,shot))))item.startFrame=Number(item.startFrame)+duration;
  retimeLanes(timeline,entry=>entry.words.map(w=>w.start>=at*1000/timeline.fps?{...w,start:w.start+duration*1000/timeline.fps,end:w.end+duration*1000/timeline.fps}:w));
  const id=`shot-${shotId}-${clipId}`;timeline.items.push({id,track,kind:'text',name:'待匹配画面',startFrame:at,durationInFrames:duration,width:timeline.width,height:timeline.height,props:{text:'待匹配画面',fontSize:56,color:'#a3acc2',align:'center'},loopControlShot:{workspaceId:next.loopControl?.inputFingerprint??'',shotId,clipId,text:operation.text}});timeline.selectedId=id as never;(timeline as unknown as {selectedIds:string[]}).selectedIds=[id];return next;
 }
 if(operation.kind==='composition'){
  const shot=shots.find(s=>s.id===operation.shotId);if(!shot)throw Error('当前镜头不存在。');const timeline=next.timelines.find(t=>t.id===shot.timelineId)!,items=shot.itemIds.map(id=>timeline.items.find(i=>i.id===id)!),composition=defaultShotComposition(operation.layout,items.length);
  if(operation.layout!=='full'&&items.length<composition.slots.length)throw Error('画面引用不足，请先增加片段再选择构图。');
  const duration=operation.layout==='full'?items.reduce((sum,i)=>sum+Number(i.durationInFrames),0):Math.max(...items.map(i=>Number(i.durationInFrames)));
  const voice=timeline.items.find(i=>i.id===`workspace-narration-shot-${shot.id}`);if(voice&&Number(voice.durationInFrames)>duration)throw Error('新构图短于完整主声，请先调整画面或主声时长。');
  const lanes=Object.values(timeline.tracks).flatMap(t=>t.captions?.sourceEntries??[]).filter(e=>laneBelongs(e.id,shot));if(lanes.some(e=>e.words.some(w=>w.end>(shot.startFrame+duration)*1000/timeline.fps)))throw Error('新构图短于完整字幕，请先明确调整字幕或画面时长。');
  const delta=duration-shot.durationInFrames;for(const other of timeline.items)if(!items.includes(other)&&!shotAudio(other,shot)&&Number(other.startFrame)>=shot.startFrame+shot.durationInFrames&&(workspaceShotIdentity(other)||shots.some(s=>shotAudio(other,s))))other.startFrame=Number(other.startFrame)+delta;
  retimeLanes(timeline,e=>laneBelongs(e.id,shot)?e.words:e.words.map(w=>w.start>=(shot.startFrame+shot.durationInFrames)*1000/timeline.fps?{...w,start:w.start+delta*1000/timeline.fps,end:w.end+delta*1000/timeline.fps}:w));
  let frame=shot.startFrame;for(const [index,item] of items.entries()){
   const slot=composition.slots[Math.min(index,composition.slots.length-1)],trackId=operation.layout==='full'?String(items[0].track):`workspace-visual-${index}`;
   if(!timeline.tracks[trackId]){timeline.tracks[trackId]={kind:'video',name:`画面 ${index+1}`};timeline.trackOrder.push(trackId);}
   item.track=trackId;item.startFrame=operation.layout==='full'?frame:shot.startFrame;frame+=Number(item.durationInFrames);item.transform={...(item.transform as object),...shotCompositionTransform(shotCompositionRect(operation.layout,slot.id),slot)};item.loopControlComposition={layout:operation.layout};
  }return next;
 }
 if(operation.kind==='move'||operation.kind==='remove'){
  const shot=shots.find(s=>s.id===operation.shotId);if(!shot)throw Error('当前镜头不存在。');
  const timeline=next.timelines.find(t=>t.id===shot.timelineId)!,local=shots.filter(s=>s.timelineId===shot.timelineId);
  if(operation.kind==='remove'){
   if(shots.length<=1||shot.effective&&shots.filter(s=>s.effective).length<=1)throw Error('不能删除最后一个有效镜头。');
   const ids=new Set(shot.itemIds);timeline.items=timeline.items.filter(i=>!ids.has(String(i.id))&&!shotAudio(i,shot));
   timeline.transitions=timeline.transitions.filter(t=>!Object.values(t).some(v=>typeof v==='string'&&ids.has(v)));clearSelection(timeline,ids);removeLanes(timeline,shot);
   moveBlocks(timeline,local.filter(s=>s!==shot),local[0].startFrame);return next;
  }
  const before=operation.beforeShotId===null?null:local.find(s=>s.id===operation.beforeShotId);if(operation.beforeShotId&&!before)throw Error('目标镜头不属于当前时间线。');if(before===shot)return next;
  const order=local.filter(s=>s!==shot);order.splice(before?order.indexOf(before):order.length,0,shot);moveBlocks(timeline,order,local[0].startFrame);return next;
 }
 const x=readWorkspaceShotWindow(next,operation.itemId);if(!x)throw Error('当前片段不存在。');
 const {item,timeline}=x;
 if(operation.kind==='remove-range'){
  if(x.items.length<=1)throw Error('请使用删除镜头移除最后一个画面引用。');
  const remaining=x.items.filter(i=>i!==item),removedStart=Number(item.startFrame),removedEnd=removedStart+Number(item.durationInFrames),overlaps=remaining.some(i=>Number(i.startFrame)<removedEnd&&Number(i.startFrame)+Number(i.durationInFrames)>removedStart),delta=overlaps?0:Number(item.durationInFrames),end=x.endFrame-delta,start=x.startFrame;
  const voice=timeline.items.find(i=>i.id===`workspace-narration-shot-${x.shotId}`);if(voice&&(Number(voice.startFrame)<start||Number(voice.startFrame)+Number(voice.durationInFrames)>end))throw Error('删除后画面短于完整主声，请先明确调整画面或主声时长。');
  const lanes=Object.values(timeline.tracks).flatMap(t=>t.captions?.sourceEntries??[]).filter(e=>e.id===`workspace-caption-shot-${x.shotId}`||x.items.some(i=>e.id===`workspace-caption-${i.id}`));if(lanes.some(e=>e.words.some(w=>w.start<start*1000/timeline.fps||w.end>end*1000/timeline.fps)))throw Error('删除后画面短于完整字幕，请先明确调整字幕或画面时长。');
  for(const other of timeline.items)if(other!==item&&!shotAudio(other,{id:x.shotId!,itemIds:x.items.map(i=>String(i.id))} as WorkspaceShot)&&Number(other.startFrame)>=removedEnd&&(workspaceShotIdentity(other)||shots.some(shot=>shotAudio(other,shot))))other.startFrame=Number(other.startFrame)-delta;
  retimeLanes(timeline,e=>e.id===`workspace-caption-shot-${x.shotId}`?e.words:e.words.map(w=>w.start>=x.endFrame*1000/timeline.fps?{...w,start:w.start-delta*1000/timeline.fps,end:w.end-delta*1000/timeline.fps}:w));
  timeline.items=timeline.items.filter(i=>i!==item);timeline.transitions=timeline.transitions.filter(t=>!Object.values(t).includes(item.id));clearSelection(timeline,new Set([String(item.id)]));return next;
 }
 if(operation.kind==='lock'){item.loopControlVideo={...(item.loopControlVideo as object),durationLocked:operation.locked};return next;}
 if(operation.kind==='range'){
  if(item.kind!=='video')throw Error('只有视频片段可以调整源区间。');
  const asset=next.assets.find(a=>a.id===item.sourceAssetId);if(!asset||!Number.isFinite(asset.durationInFrames))throw Error('当前原片时长不可用。');
  const range=adjustWorkspaceVideoRange({sourceInFrame:Number(item.srcInFrame??0),durationInFrames:Number(item.durationInFrames),durationLocked:(item.loopControlVideo as {durationLocked?:boolean})?.durationLocked===true},operation.edge,operation.deltaFrames,asset.durationInFrames);
  const voice=timeline.items.find(i=>i.id===`workspace-narration-shot-${x.shotId}`),newEnd=Math.max(...x.items.map(i=>Number(i.startFrame)+(i===item?range.durationInFrames:Number(i.durationInFrames))));
  if(voice&&newEnd<Number(voice.startFrame)+Number(voice.durationInFrames))throw Error('画面不能短于完整主声，请先调整主声。');
  item.srcInFrame=range.sourceInFrame;item.durationInFrames=range.durationInFrames;return next;
 }
 if(operation.fit!==undefined){
  const asset=next.assets.find(a=>a.id===item.sourceAssetId) as (OpenChatCutProject['assets'][number]&{width?:number;height?:number})|undefined,width=Number(asset?.width??item.width??timeline.width),height=Number(asset?.height??item.height??timeline.height),contain=Math.min(timeline.width/width,timeline.height/height),cover=Math.max(timeline.width/width,timeline.height/height),previous=item.fit??timeline.fit,ratio=(operation.fit==='contain'?contain:cover)/(previous==='contain'?contain:cover),transform=(item.transform??{}) as Record<string,unknown>;
  item.transform={...transform,scale:Number(transform.scale??1)*ratio};const keyframes=item.keyframes as {scale?:Array<{value:number}>}|undefined;if(keyframes?.scale)for(const key of keyframes.scale)key.value*=ratio;item.fit=operation.fit;
 }
 if(operation.focusX!==undefined||operation.focusY!==undefined)item.transform={...(item.transform as object),...(operation.focusX!==undefined?{x:operation.focusX}:{}),...(operation.focusY!==undefined?{y:operation.focusY}:{})};
 if(operation.transition!==undefined){item.fadeInFrames=operation.transition==='fade'?Math.round(timeline.fps*.35):0;item.fadeOutFrames=operation.transition==='fade'?Math.round(timeline.fps*.35):0;}
 return next;
}
export function isWorkspaceShotOperation(value:unknown):value is WorkspaceShotOperation{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const v=value as Record<string,unknown>;
 const keys:Record<string,string[]>={insert:['kind','afterShotId','text','clipId'],composition:['kind','shotId','layout'],remove:['kind','shotId'],move:['kind','shotId','beforeShotId'],'remove-range':['kind','itemId'],range:['kind','itemId','edge','deltaFrames'],lock:['kind','itemId','locked'],appearance:['kind','itemId','fit','focusX','focusY','transition']};
 if(typeof v.kind!=='string'||!keys[v.kind]||Object.keys(v).some(k=>!keys[v.kind as string].includes(k)))return false;
 const id=(x:unknown)=>typeof x==='string'&&x.length>0&&x.length<=300;
 if(v.kind==='insert')return(v.afterShotId===null||id(v.afterShotId))&&typeof v.text==='string'&&!!v.text.trim()&&v.text.length<=100000&&(v.clipId===undefined||typeof v.clipId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.clipId));
 if(v.kind==='composition')return id(v.shotId)&&shotCompositionLayouts.includes(v.layout as ShotCompositionLayout);
 if(v.kind==='remove')return id(v.shotId);if(v.kind==='move')return id(v.shotId)&&(v.beforeShotId===null||id(v.beforeShotId));if(!id(v.itemId))return false;
 if(v.kind==='remove-range')return true;if(v.kind==='range')return['in','out'].includes(String(v.edge))&&Number.isSafeInteger(v.deltaFrames)&&Math.abs(Number(v.deltaFrames))<=1000000;if(v.kind==='lock')return typeof v.locked==='boolean';
 return(v.fit===undefined||['contain','cover'].includes(String(v.fit)))&&(v.transition===undefined||['cut','fade'].includes(String(v.transition)))&&['focusX','focusY'].every(k=>v[k]===undefined||typeof v[k]==='number'&&Number.isFinite(v[k])&&Math.abs(Number(v[k]))<=100);
}
function shotAudio(item:Record<string,unknown>,shot:WorkspaceShot){return item.id===`workspace-narration-shot-${shot.id}`||item.id===`workspace-source-shot-${shot.id}`||(item.kind==='audio'&&(item.loopControlAudio as {shotId?:string}|undefined)?.shotId===shot.id)||shot.itemIds.some(id=>item.id===`workspace-narration-${workspaceShotIdentity({id})?.clipId}`)||((item.loopControlShot as WorkspaceShotIdentity|undefined)?.shotId===shot.id&&item.kind==='audio');}
type Timeline=OpenChatCutProject['timelines'][number];
function clearSelection(timeline:Timeline,removed:Set<string>){if(removed.has(String(timeline.selectedId)))timeline.selectedId=null;const t=timeline as unknown as {selectedIds?:string[]};if(t.selectedIds)t.selectedIds=t.selectedIds.filter(id=>!removed.has(id));}
function laneBelongs(id:string,shot:WorkspaceShot){return id===`workspace-caption-shot-${shot.id}`||shot.itemIds.some(itemId=>id===`workspace-caption-${itemId}`);}
function retimeLanes(timeline:Timeline,transform:(entry:NonNullable<Timeline['tracks'][string]['captions']>['sourceEntries'][number])=>NonNullable<Timeline['tracks'][string]['captions']>['sourceEntries'][number]['words']){for(const track of Object.values(timeline.tracks))if(track.captions)for(const entry of track.captions.sourceEntries)entry.words=transform(entry);}
function removeLanes(timeline:Timeline,shot:WorkspaceShot){for(const track of Object.values(timeline.tracks))if(track.captions){const captions=track.captions,removed=captions.sourceEntries.filter(e=>laneBelongs(e.id,shot));captions.sourceEntries=captions.sourceEntries.filter(e=>!removed.includes(e));if(captions.layoutPolicy?.mode==='manual-slots')captions.layoutPolicy.slots=captions.layoutPolicy.slots.filter(s=>!removed.some(e=>e.slotId===s.id));for(const lane of removed)delete captions.perSource[lane.id];}}
function moveBlocks(timeline:Timeline,order:WorkspaceShot[],start:number){let frame=start;for(const shot of order){const delta=frame-shot.startFrame;for(const item of timeline.items)if(shot.itemIds.includes(String(item.id))||shotAudio(item,shot))item.startFrame=Number(item.startFrame)+delta;retimeLanes(timeline,e=>laneBelongs(e.id,shot)?e.words.map(w=>({...w,start:w.start+delta*1000/timeline.fps,end:w.end+delta*1000/timeline.fps})):e.words);frame+=shot.durationInFrames;}}
