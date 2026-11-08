import type {OpenChatCutProject} from './worker/openchatcutProject.js';

/** Enablement belongs to the native shot; muting retains the original media and gain. */
export function readWorkspaceNarrationEnabled(project:OpenChatCutProject,visualItemIds:string[],fallback=true){
 const ids=new Set(visualItemIds);
 const marker=project.timelines.flatMap(t=>t.items).find(item=>ids.has(String(item.id))&&typeof item.loopControlNarrationEnabled==='boolean');
 return typeof marker?.loopControlNarrationEnabled==='boolean'?marker.loopControlNarrationEnabled:fallback;
}
export function setWorkspaceNarrationEnabled(project:OpenChatCutProject,shotId:string,visualItemIds:string[],clipIds:string[],enabled:boolean){
 const next=structuredClone(project),ids=new Set(visualItemIds),voiceIds=new Set([`workspace-narration-shot-${shotId}`,...clipIds.map(id=>`workspace-narration-${id}`)]);
 const visuals=next.timelines.flatMap(t=>t.items).filter(item=>ids.has(String(item.id)));
 if(!visuals.length)throw Error('镜头画面已删除，请重新读取。');
 for(const item of visuals)item.loopControlNarrationEnabled=enabled;
 for(const timeline of next.timelines)for(const item of timeline.items){
  if(!voiceIds.has(String(item.id)))continue;
  const previous=item.loopControlNarrationMute as {hadVolume:boolean;volume:number}|undefined;
  if(!enabled&&!previous){item.loopControlNarrationMute={hadVolume:item.volume!==undefined,volume:Number(item.volume??1)};item.volume=0;}
  if(enabled&&previous){if(previous.hadVolume)item.volume=previous.volume;else delete item.volume;delete item.loopControlNarrationMute;}
 }
 return next;
}
