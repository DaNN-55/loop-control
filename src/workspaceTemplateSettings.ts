import type {OpenChatCutProject,OpenChatCutTimeline} from './worker/openchatcutProject.js';
import type {WorkspaceRenderPreferences} from './workspaceRenderPreferences.js';
import {validateWorkspaceRenderPreferences} from './workspaceRenderPreferences.js';
type Item=OpenChatCutTimeline['items'][number];
type Applied={version:'workspace-template-applied/v1';visual?:boolean;transition?:boolean};
const applied=(item:Item)=>item.loopControlTemplate as Applied|undefined;
const preferences=(item:Item)=>(item.loopControlShot as {renderPreferences?:WorkspaceRenderPreferences}|undefined)?.renderPreferences;
const media=(item:Item)=>['image','video'].includes(String(item.kind));

/** First placeholder adoption only. Native edits and subsequent replacements remain authoritative. */
export function applyInitialWorkspaceTemplateSettings(previous:OpenChatCutProject,project:OpenChatCutProject):void{
 if(project.loopControl?.editorAuthority==='native')return;
 const firstAdoptions=new Set<string>();
 for(const timeline of project.timelines)for(const item of timeline.items){
  const old=previous.timelines.find(t=>t.id===timeline.id)?.items.find(i=>i.id===item.id);
  if(old?.kind!=='text'||!media(item)||applied(old)?.visual)continue;
  firstAdoptions.add(String(item.id));const settings=preferences(item);if(!settings)continue;validateWorkspaceRenderPreferences(settings);
  if(settings.scale!==undefined){
   const transform=(item.transform??{}) as Record<string,number>;
   item.transform={...transform,scale:(transform.scale??1)*settings.scale,...(transform.scaleX===undefined?{}:{scaleX:transform.scaleX*settings.scale}),...(transform.scaleY===undefined?{}:{scaleY:transform.scaleY*settings.scale})};
  }
  if(settings.animation!==undefined){
   delete item.zoom;
   const keys={...(item.keyframes as Record<string,unknown>??{})};for(const key of ['scale','scaleX','scaleY','x','y'])delete keys[key];if(Object.keys(keys).length)item.keyframes=keys;else delete item.keyframes;
   if(settings.animation!=='none')item.zoom={magnification:1+(settings.animationAmount??10)/100,envelope:settings.animation==='zoom-out'?[1,0]:[0,1],label:settings.animation};
  }
  item.loopControlTemplate={...applied(item),version:'workspace-template-applied/v1',visual:true};
 }
 if(!firstAdoptions.size)return;
 for(const timeline of project.timelines)for(const incoming of timeline.items){
  const settings=preferences(incoming),type=settings?.transition;
  if(!settings||!type||['cut','fade','studio'].includes(type)||!media(incoming)||applied(incoming)?.transition)continue;
  const previousItems=timeline.items.filter(i=>i.track===incoming.track&&Number(i.startFrame)<Number(incoming.startFrame)&&['image','video','text'].includes(String(i.kind))).sort((a,b)=>Number(b.startFrame)-Number(a.startFrame));
  const outgoing=previousItems[0];
  // A leading shot has no incoming cut. Wait for both placeholders to be adopted.
  if(!outgoing||!media(outgoing)||!firstAdoptions.has(String(incoming.id))&&!firstAdoptions.has(String(outgoing.id)))continue;
  const outgoingShot=(outgoing.loopControlShot as {shotId?:string}|undefined)?.shotId,incomingShot=(incoming.loopControlShot as {shotId?:string}|undefined)?.shotId;
  if(outgoingShot&&outgoingShot===incomingShot)continue;
  if(Number(outgoing.startFrame)+Number(outgoing.durationInFrames)!==Number(incoming.startFrame))throw Error('模板转场需要同轨相邻片段，请先修正镜头接缝。');
  const seconds=settings.transitionDuration??.35,frames=seconds===0?0:Math.max(1,Math.round(seconds*timeline.fps));
  if(frames>Math.min(Number(outgoing.durationInFrames),Number(incoming.durationInFrames)))throw Error('转场时长超过相邻片段可用区间。');
  if(frames>0){
   if(timeline.items.some(i=>i!==incoming&&i!==outgoing&&i.track===incoming.track&&Number(i.startFrame)<Number(incoming.startFrame)&&Number(i.startFrame)+Number(i.durationInFrames)>Number(incoming.startFrame)))throw Error('转场接缝存在重叠片段，不能猜测转场目标。');
   const half=Math.floor(frames/2);
   for(const [item,before,after]of [[incoming,half,0],[outgoing,0,frames-half]] as const){
    if(item.kind!=='video')continue;
    const asset=project.assets.find(a=>a.id===item.sourceAssetId)??project.assets.find(a=>a.src===item.src),rate=Number(item.playbackRate??1),sourceIn=Number(item.srcInFrame??0);
    if(!asset||item.edits||!Number.isFinite(rate)||rate<=0||sourceIn<before*rate||sourceIn+(Number(item.durationInFrames)+after)*rate>asset.durationInFrames)throw Error('原生转场源素材余量不足，请保留前后余量或改用硬切；不会冻结首帧或移动口播。');
   }
   const id=`template-transition-${incoming.id}`;
   if(!timeline.transitions.some(t=>t.incomingItemId===incoming.id))timeline.transitions.push({id,type,durationInFrames:frames,outgoingItemId:outgoing.id,incomingItemId:incoming.id,trackId:incoming.track,...(settings.transitionDirection===undefined?{}:{direction:settings.transitionDirection})});
  }
  incoming.loopControlTemplate={...applied(incoming),version:'workspace-template-applied/v1',transition:true};
 }
}
