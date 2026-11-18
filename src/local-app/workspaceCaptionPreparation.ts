import type {ShotCaptionContract} from '../shotCaptions.js';
import type {WorkspaceCaptionState} from '../workspaceCaptions.js';

/** Align the complete audible file; silence before/after it is part of the shot, not the source. */
export function captionAlignmentWindow({audioItem,audible,assetDurationInFrames,registeredDurationSeconds,fps,shotStartFrame,shotDurationInFrames}:{audioItem?:Record<string,unknown>;audible:boolean;assetDurationInFrames?:number;registeredDurationSeconds?:number;fps:number;shotStartFrame:number;shotDurationInFrames:number}){
 const unavailable=(detail:string)=>({ready:false,offsetMs:0,detail});
 if(!audioItem||audioItem.kind!=='audio'||!audible)return unavailable('请先使用口播或视频原声，再自动同步字幕。');
 const start=Number(audioItem.startFrame),duration=Number(audioItem.durationInFrames),sourceStart=Number(audioItem.srcInFrame??0),rate=Number(audioItem.playbackRate??1);
 if(!Number.isFinite(fps)||fps<=0||!Number.isFinite(shotStartFrame)||!Number.isFinite(shotDurationInFrames)||shotDurationInFrames<=0||!Number.isFinite(start)||!Number.isFinite(duration)||duration<=0||!Number.isFinite(registeredDurationSeconds)||registeredDurationSeconds!<=0||!Number.isFinite(assetDurationInFrames))return unavailable('声音长度尚未确认，请重新选择声音或手工调整字幕。');
 if(rate!==1||sourceStart!==0||audioItem.edits||Math.abs(duration-registeredDurationSeconds!*fps)>2||Math.abs(assetDurationInFrames!-registeredDurationSeconds!*fps)>2)return unavailable('声音已裁切或变速，请重新使用完整声音，或手工调整字幕。');
 if(start<shotStartFrame||start+duration>shotStartFrame+shotDurationInFrames)return unavailable('声音超出当前镜头范围，请在剪辑台调整，或手工调整字幕。');
 return {ready:true,offsetMs:Math.round((start-shotStartFrame)*1000/fps),detail:null};
}

export function captionCuesInShot(cues:ShotCaptionContract['cues'],offsetMs:number,sourceDurationMs:number,shotDurationMs:number,toleranceMs=1):ShotCaptionContract['cues']|null{
 if(!Number.isFinite(offsetMs)||offsetMs<0||!Number.isFinite(sourceDurationMs)||sourceDurationMs<=0||!Number.isFinite(shotDurationMs)||shotDurationMs<=0)return null;
 let previous=0;
 const mapped=[];
 for(const cue of cues){
  if(cue.startMs<0||cue.endMs>sourceDurationMs+toleranceMs)return null;
  const next={...cue,startMs:cue.startMs+offsetMs,endMs:cue.endMs+offsetMs};
  if(next.startMs<previous||next.endMs<=next.startMs||next.endMs>shotDurationMs+1)return null;
  mapped.push(next);previous=next.endMs;
 }
 return mapped;
}

/** A small correction can keep its phrase window; changing several phrases needs review. */
export function editCaptionTextKeepingTiming(contract:ShotCaptionContract,text:string):ShotCaptionContract|null{
 if(!contract.cues.length||contract.cues.map(c=>c.text).join('')!==contract.text)return null;
 const before=Array.from(contract.text),after=Array.from(text);
 let prefix=0,suffix=0;
 while(prefix<before.length&&prefix<after.length&&before[prefix]===after[prefix])prefix++;
 if(prefix===before.length&&prefix===after.length)return {...contract,text};
 while(suffix<before.length-prefix&&suffix<after.length-prefix&&before[before.length-1-suffix]===after[after.length-1-suffix])suffix++;
 let start=0;
 for(let index=0;index<contract.cues.length;index++){
  const cue=contract.cues[index],end=start+Array.from(cue.text).length;
  if(prefix>=start&&before.length-suffix<=end){
   const replacement=after.slice(start,after.length-(before.length-end)).join('');
   if(!replacement.trim())return null;
   return {...contract,text,cues:contract.cues.map((c,i)=>i===index?{...c,text:replacement}:c)};
  }
  start=end;
 }
 return null;
}

/** Approximate phrase windows are drafts until the owner edits and saves them. */
export function captionDraftCues(text:string,durationMs:number):ShotCaptionContract['cues']{
 if(!text.trim()||!Number.isFinite(durationMs)||durationMs<1)return [];
 const parts=text.match(/[^，。！？；：,.!?;:]+[，。！？；：,.!?;:]*/gu)??[text];
 return parts.map((part,index)=>({id:`manual-${index+1}`,text:part,startMs:Math.round(durationMs*index/parts.length),endMs:Math.round(durationMs*(index+1)/parts.length)}));
}

export function nextAutomaticCaption(states:readonly WorkspaceCaptionState[]){
 const completed=states.find(c=>c.contract.enabled&&c.audioTrackId&&c.alignmentReady!==false&&c.timing==='waiting'&&c.taskId&&c.alignmentStatus==='completed');
 if(completed)return {name:'applyWorkspaceCaptionAlignment' as const,caption:completed};
 const missing=states.find(c=>c.contract.enabled&&c.contract.text.trim()&&c.audioTrackId&&c.alignmentReady!==false&&['missing','stale'].includes(c.timing));
 return missing?{name:'requestWorkspaceCaptionAlignment' as const,caption:missing}:null;
}
