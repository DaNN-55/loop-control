import {readWorkspaceShotWindow,readWorkspaceShots,workspaceShotIdentity} from './workspaceShots.js';
import {isValidShotCaptionContract,normalizeShotCaptionContract} from './shotCaptions.js';
import type {ShotCaptionContract} from './shotCaptions.js';
export interface WorkspaceCaptionState {clipId:string;itemId:string;shotId:string;durationMs:number;contract:ShotCaptionContract;inputFingerprint:string;timing:'missing'|'current'|'stale'|'waiting'|'failed';textConfirmed:boolean;audioTrackId:string|null;narrationText:string|null;taskId:string|null;alignmentInputVersion:string|null;detail:string|null}
export const isWorkspaceCaptionContract=isValidShotCaptionContract;
export const workspaceCaptionFields:Record<string,string[]>={
 setWorkspaceCaptionsEnabled:['episodeId','workspaceId','expectedRevision','clipId','enabled'],
 saveWorkspaceNarrationCaptions:['episodeId','workspaceId','expectedRevision','clipId','contentMode','text'],
 saveWorkspaceCaptions:['episodeId','workspaceId','expectedRevision','clipId','captionContract','nativeApplied'],
 requestWorkspaceCaptionAlignment:['episodeId','workspaceId','expectedRevision','clipId','localOnly'],
 prepareWorkspaceCaptionAlignment:['episodeId','workspaceId','expectedRevision','clipId','taskId','expectedInputFingerprint'],
 applyWorkspaceCaptionAlignment:['episodeId','workspaceId','expectedRevision','clipId','taskId','expectedInputFingerprint','nativeApplied'],
 confirmWorkspaceCaptionText:['episodeId','workspaceId','expectedRevision','clipId','expectedInputFingerprint'],
};

import type {OpenChatCutProject} from './worker/openchatcutProject.js';
// Shared by the Owner boundary and the embedded runtime. Input validation lives
// at those boundaries; this function edits only one native caption lane.
export function applyWorkspaceCaptionEdit(project:OpenChatCutProject,itemId:string,contract:ShotCaptionContract,options:{timingOnly?:boolean}={}):OpenChatCutProject{
 const next=migrateWorkspaceCaptionLanes(project),window=readWorkspaceShotWindow(next,itemId),timeline=window?.timeline,item=window?.item;
 if(!item||!timeline)throw Error('当前工程中找不到字幕所属片段。');
 contract=normalizeShotCaptionContract(contract,{enabled:contract.enabled,text:contract.text,aspectRatio:timeline.width===timeline.height?'1:1':timeline.width>timeline.height?'16:9':'9:16'});
 const laneId=window?.shotId?`workspace-caption-shot-${window.shotId}`:`workspace-caption-${itemId}`,slotId=`${laneId}-slot`;
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
   pages.push({id:chars.length<=pageSize&&/~[0-9]+$/.test(cue.id)?cue.id:`${cue.id}~${pages.length}`,text:lines.join('\n'),start:Number(window?.startFrame??item.startFrame)*1000/timeline.fps+cue.startMs+(cue.endMs-cue.startMs)*n/chars.length,end:Number(window?.startFrame??item.startFrame)*1000/timeline.fps+cue.startMs+(cue.endMs-cue.startMs)*Math.min(n+pageSize,chars.length)/chars.length});}
  return pages;
 });
 // Native manual lanes consume explicit newlines. Never rely on the unsupported
 // maxCharactersPerLine knob or on generated-lane fixed 24-character paging.
 const fontSize=Math.min(.045,width*timeline.width/(timeline.height*Math.max(1,spatial.maxCharactersPerLine)*1.1),height/(spatial.maxLines*1.5));
 const lane={...existing,id:laneId,itemId:`manual:${laneId}`,label:'字幕',slotId,visible:contract.enabled,anchor,offsetXRatio:offsetX,offsetYRatio:offsetY,widthRatio:width,heightRatio:height,words,style:{fontFamily:'sans-serif',fontWeight:600,color:'#ffffff',...existing?.style,fontSize,wholeLine:true},loopControl:{version:'workspace-caption/v1',contentMode:contract.contentMode,text:contract.text,spatial:structuredClone(spatial)}};
 const applied=options.timingOnly&&existing?{...existing,words,loopControl:lane.loopControl}:lane;
 captions.sourceEntries=existing?captions.sourceEntries.map(e=>e.id===laneId?applied:e):[...(captions.sourceEntries??[]),lane];
 const oldSlots=captions.layoutPolicy?.mode==='manual-slots'?captions.layoutPolicy.slots:[];
 if(!options.timingOnly&&captions.layoutPolicy?.mode==='manual-slots')captions.layoutPolicy={mode:'manual-slots',slots:[...oldSlots.filter(s=>s.id!==slotId),{id:slotId,anchor,offsetXRatio:offsetX,offsetYRatio:offsetY,widthRatio:width,heightRatio:height}]};
 if(!options.timingOnly)captions.perSource={...captions.perSource,[laneId]:{maxLines:spatial.maxLines}};
 return next;
}
export function readWorkspaceCaption(project:OpenChatCutProject,itemId:string):{laneId:string;words:Array<{id:string;text:string;start:number;end:number}>;contract:ShotCaptionContract}|null{
 const window=readWorkspaceShotWindow(project,itemId),timeline=window?.timeline,item=window?.item,laneId=window?.shotId?`workspace-caption-shot-${window.shotId}`:`workspace-caption-${itemId}`;
 const candidates=[laneId,...(window?.items??[]).map(i=>`workspace-caption-${i.id}`),...Object.values(timeline?.tracks??{}).flatMap(t=>t.captions?.sourceEntries??[]).filter(e=>window?.shotId&&workspaceShotIdentity({id:e.id.replace(/^workspace-caption-/, '')})?.shotId===window.shotId).map(e=>e.id)];
 const track=Object.values(timeline?.tracks??{}).find(t=>t.kind==='caption'&&t.captions?.sourceEntries?.some(e=>candidates.includes(e.id)));
 const lane=track?.captions?.sourceEntries?.find(e=>candidates.includes(e.id)),meta=lane?.loopControl;
 if(!lane||!meta||!item||!timeline||!track?.captions)return null;
 const raw:ShotCaptionContract={version:'shot-captions/v1',enabled:timeline.captionsHidden!==true&&lane.visible!==false&&track.captions.enabled!==false,contentMode:meta.contentMode==='follow_tts'&&lane.words?.length&&lane.words.map(w=>w.text.replace(/\s/g,'')).join('')!==meta.text.replace(/\s/g,'')?'independent':meta.contentMode,text:lane.words?.length?lane.words.map(w=>w.text.replace(/\n/g,'')).join(''):meta.text,cues:(lane.words??[]).map(w=>({id:w.id,text:w.text.replace(/\n/g,''),startMs:Math.round(w.start-Number(window?.startFrame??item.startFrame)*1000/timeline.fps),endMs:Math.round(w.end-Number(window?.startFrame??item.startFrame)*1000/timeline.fps)})),spatial:{...meta.spatial,anchor:(lane.anchor??track.captions.layoutPolicy?.slots?.find(s=>s.id===lane.slotId)?.anchor??meta.spatial.anchor) as ShotCaptionContract['spatial']['anchor']}};
 return {laneId:lane.id,words:lane.words??[],contract:normalizeShotCaptionContract(raw,{enabled:raw.enabled,text:raw.text,aspectRatio:timeline.width===timeline.height?'1:1':timeline.width>timeline.height?'16:9':'9:16'})};
}

/** Seed changed text within the shot or voice window. Real timing is reviewed separately. */
export function setWorkspaceCaptionText(
 project:OpenChatCutProject,itemId:string,contract:ShotCaptionContract,text:string,voice?:Record<string,unknown>,
):OpenChatCutProject{
 if(contract.cues.length&&text.replace(/\s/gu,'')===contract.text.replace(/\s/gu,'')){
  return applyWorkspaceCaptionEdit(project,itemId,contract);
 }
 const window=readWorkspaceShotWindow(project,itemId);
 if(!window)throw Error('当前工程中找不到字幕所属片段。');
 const start=voice?Math.max(window.startFrame,Number(voice.startFrame)):window.startFrame;
 const end=voice?Math.min(window.startFrame+window.durationInFrames,Number(voice.startFrame)+Number(voice.durationInFrames)):window.startFrame+window.durationInFrames;
 const ms=(frame:number)=>Math.round((frame-window.startFrame)*1000/window.timeline.fps);
 const cues=text.trim()&&end>start?[{id:'narration-caption',text,startMs:ms(start),endMs:ms(end)}]:[];
 return applyWorkspaceCaptionEdit(project,itemId,{...contract,text,cues});
}

export function followWorkspaceNarrationCaption(project:OpenChatCutProject,itemId:string,text:string,voice:Record<string,unknown>,initialContract?:ShotCaptionContract):OpenChatCutProject{
 const existing=readWorkspaceCaption(project,itemId)?.contract,contract=existing??initialContract;
 if(!contract?.enabled||contract.contentMode!=='follow_tts'||!text.trim()||existing&&contract.cues.length&&text.replace(/\s/gu,'')===contract.text.replace(/\s/gu,''))return project;
 return setWorkspaceCaptionText(project,itemId,contract,text,voice);
}

/** Upgrade old visual-bound lanes without rebuilding words or their absolute timing. */
export function migrateWorkspaceCaptionLanes(project:OpenChatCutProject):OpenChatCutProject{
 const next=structuredClone(project);
 for(const shot of readWorkspaceShots(next)){
  const timeline=next.timelines.find(t=>t.id===shot.timelineId)!,stable=`workspace-caption-shot-${shot.id}`;
  const matches=Object.values(timeline.tracks).flatMap(track=>(track.captions?.sourceEntries??[]).filter(lane=>lane.id===stable||workspaceShotIdentity({id:lane.id.replace(/^workspace-caption-/, '')})?.shotId===shot.id).map(lane=>({track,lane})));
  if(!matches.length||matches.length===1&&matches[0].lane.id===stable)continue;
  const chosen=matches.find(x=>x.lane.id===stable)??[...matches].sort((a,b)=>(a.lane.words?.[0]?.start??0)-(b.lane.words?.[0]?.start??0))[0],lane=chosen.lane,oldId=lane.id,oldSlot=lane.slotId;
  const sameFollowing=matches.every(x=>x.lane.loopControl?.contentMode==='follow_tts'&&x.lane.loopControl.text.replace(/\s/gu,'')===lane.loopControl?.text.replace(/\s/gu,''));
  const words=sameFollowing?lane.words:matches.flatMap(x=>x.lane.words??[]),seen=new Set<string>();
  lane.words=words.filter(w=>{const key=JSON.stringify([w.text,w.start,w.end]);if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>a.start-b.start);
  for(const {track,lane:old}of matches){const captions=track.captions!;captions.sourceEntries=captions.sourceEntries.filter(e=>e!==old);if(captions.layoutPolicy?.mode==='manual-slots')captions.layoutPolicy.slots=captions.layoutPolicy.slots.filter(s=>s.id!==old.slotId);if(old.id!==stable)delete captions.perSource[old.id];}
  lane.id=stable;lane.itemId=`manual:${stable}`;lane.slotId=`${stable}-slot`;
  const captions=chosen.track.captions!;captions.sourceEntries.push(lane);
  const slot=project.timelines.find(t=>t.id===timeline.id)?.tracks;const previousSlot=Object.values(slot??{}).flatMap(t=>t.captions?.layoutPolicy.slots??[]).find(s=>s.id===oldSlot);
  if(previousSlot&&captions.layoutPolicy?.mode==='manual-slots')captions.layoutPolicy.slots.push({...previousSlot,id:lane.slotId});
  captions.perSource[stable]=captions.perSource[stable]??Object.values(project.timelines.find(t=>t.id===timeline.id)?.tracks??{}).map(t=>t.captions?.perSource[oldId]).find(Boolean)??{maxLines:lane.loopControl?.spatial.maxLines??2};
 }
 return next;
}
