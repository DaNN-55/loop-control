import {isValidShotCaptionContract,normalizeShotCaptionContract} from './shotCaptions.js';
import type {ShotCaptionContract} from './shotCaptions.js';
export interface WorkspaceCaptionState {clipId:string;itemId:string;shotId:string;durationMs:number;contract:ShotCaptionContract;inputFingerprint:string;timing:'missing'|'current'|'stale'|'waiting'|'failed';textConfirmed:boolean;audioTrackId:string|null;narrationText:string|null;taskId:string|null;alignmentInputVersion:string|null;detail:string|null}
export const isWorkspaceCaptionContract=isValidShotCaptionContract;
export const workspaceCaptionFields:Record<string,string[]>={
 saveWorkspaceCaptions:['episodeId','workspaceId','expectedRevision','clipId','captionContract','nativeApplied'],
 requestWorkspaceCaptionAlignment:['episodeId','workspaceId','expectedRevision','clipId','localOnly'],
 applyWorkspaceCaptionAlignment:['episodeId','workspaceId','expectedRevision','clipId','taskId','expectedInputFingerprint'],
 confirmWorkspaceCaptionText:['episodeId','workspaceId','expectedRevision','clipId','expectedInputFingerprint'],
};

import type {OpenChatCutProject} from './worker/openchatcutProject.js';
// Shared by the Owner boundary and the embedded runtime. Input validation lives
// at those boundaries; this function edits only one native caption lane.
export function applyWorkspaceCaptionEdit(project:OpenChatCutProject,itemId:string,contract:ShotCaptionContract):OpenChatCutProject{
 const next=structuredClone(project),timeline=next.timelines.find(t=>t.items.some(i=>i.id===itemId)),item=timeline?.items.find(i=>i.id===itemId);
 if(!item||!timeline)throw Error('当前工程中找不到字幕所属片段。');
 contract=normalizeShotCaptionContract(contract,{enabled:contract.enabled,text:contract.text,aspectRatio:timeline.width===timeline.height?'1:1':timeline.width>timeline.height?'16:9':'9:16'});
 const laneId=`workspace-caption-${itemId}`,slotId=`${laneId}-slot`;
 const nativeTrack=Object.entries(timeline.tracks).find(([,t])=>t.kind==='caption'&&t.captions?.sourceEntries?.some(e=>e.id===laneId))??Object.entries(timeline.tracks).find(([,t])=>t.kind==='caption'&&t.captions?.sourceEntries?.some(e=>e.loopControl?.version==='workspace-caption/v1'));
 const trackId=nativeTrack?.[0]??'workspace-captions';
 let track=timeline.tracks[trackId];
 if(!track){track=timeline.tracks[trackId]={kind:'caption',name:'字幕',captions:{enabled:true,template:'plain',pacing:'phrase',sourceMode:'item',sourceEntries:[],layoutPolicy:{mode:'manual-slots',slots:[]},perSource:{}}};timeline.trackOrder.push(trackId);}
 const captions=track.captions!,existing=captions.sourceEntries?.find(e=>e.id===laneId),spatial=contract.spatial;
 const insets=spatial.insets!,anchor=spatial.anchor,width=1-insets.left-insets.right,height=1-insets.top-insets.bottom;
 const offsetX=anchor.endsWith('-left')?insets.left-.1:anchor.endsWith('-right')?.1-insets.right:(insets.left-insets.right)/2;
 const offsetY=anchor.startsWith('top-')?insets.top-.08:anchor.startsWith('bottom-')?insets.bottom-.08:(insets.top-insets.bottom)/2;
 const words=contract.cues.flatMap(cue=>{
  const chars=Array.from(cue.text.replace(/\n/g,'')),pageSize=spatial.maxCharactersPerLine*spatial.maxLines,pages=[];
  for(let n=0;n<chars.length;n+=pageSize){const chunk=chars.slice(n,n+pageSize),lines=[];for(let j=0;j<chunk.length;j+=spatial.maxCharactersPerLine)lines.push(chunk.slice(j,j+spatial.maxCharactersPerLine).join(''));
   pages.push({id:chars.length<=pageSize&&/~[0-9]+$/.test(cue.id)?cue.id:`${cue.id}~${pages.length}`,text:lines.join('\n'),start:Number(item.startFrame)*1000/timeline.fps+cue.startMs+(cue.endMs-cue.startMs)*n/chars.length,end:Number(item.startFrame)*1000/timeline.fps+cue.startMs+(cue.endMs-cue.startMs)*Math.min(n+pageSize,chars.length)/chars.length});}
  return pages;
 });
 // Native manual lanes consume explicit newlines. Never rely on the unsupported
 // maxCharactersPerLine knob or on generated-lane fixed 24-character paging.
 const fontSize=Math.min(.045,width*timeline.width/(timeline.height*Math.max(1,spatial.maxCharactersPerLine)*1.1),height/(spatial.maxLines*1.5));
 const lane={...existing,id:laneId,itemId:`manual:${laneId}`,label:'字幕',slotId,visible:contract.enabled,anchor,offsetXRatio:offsetX,offsetYRatio:offsetY,widthRatio:width,heightRatio:height,words,style:{fontFamily:'sans-serif',fontWeight:600,color:'#ffffff',...existing?.style,fontSize,wholeLine:true},loopControl:{version:'workspace-caption/v1',contentMode:contract.contentMode,text:contract.text,spatial:structuredClone(spatial)}};
 captions.sourceEntries=existing?captions.sourceEntries.map(e=>e.id===laneId?lane:e):[...(captions.sourceEntries??[]),lane];
 const oldSlots=captions.layoutPolicy?.mode==='manual-slots'?captions.layoutPolicy.slots:[];
 if(captions.layoutPolicy?.mode==='manual-slots')captions.layoutPolicy={mode:'manual-slots',slots:[...oldSlots.filter(s=>s.id!==slotId),{id:slotId,anchor,offsetXRatio:offsetX,offsetYRatio:offsetY,widthRatio:width,heightRatio:height}]};
 captions.perSource={...captions.perSource,[laneId]:{maxLines:spatial.maxLines}};
 return next;
}
export function readWorkspaceCaption(project:OpenChatCutProject,itemId:string):{laneId:string;words:Array<{id:string;text:string;start:number;end:number}>;contract:ShotCaptionContract}|null{
 const timeline=project.timelines.find(t=>t.items.some(i=>i.id===itemId)),item=timeline?.items.find(i=>i.id===itemId);
 const track=Object.values(timeline?.tracks??{}).find(t=>t.kind==='caption'&&t.captions?.sourceEntries?.some(e=>e.id===`workspace-caption-${itemId}`));
 const lane=track?.captions?.sourceEntries?.find(e=>e.id===`workspace-caption-${itemId}`),meta=lane?.loopControl;
 if(!lane||!meta||!item||!timeline||!track?.captions)return null;
 const raw:ShotCaptionContract={version:'shot-captions/v1',enabled:lane.visible!==false&&track.captions.enabled!==false,contentMode:meta.contentMode,text:lane.words?.length?lane.words.map(w=>w.text.replace(/\n/g,'')).join(''):meta.text,cues:(lane.words??[]).map(w=>({id:w.id,text:w.text.replace(/\n/g,''),startMs:Math.round(w.start-Number(item.startFrame)*1000/timeline.fps),endMs:Math.round(w.end-Number(item.startFrame)*1000/timeline.fps)})),spatial:{...meta.spatial,anchor:(lane.anchor??track.captions.layoutPolicy?.slots?.find(s=>s.id===lane.slotId)?.anchor??meta.spatial.anchor) as ShotCaptionContract['spatial']['anchor']}};
 return {laneId:lane.id,words:lane.words??[],contract:normalizeShotCaptionContract(raw,{enabled:raw.enabled,text:raw.text,aspectRatio:timeline.width===timeline.height?'1:1':timeline.width>timeline.height?'16:9':'9:16'})};
}
