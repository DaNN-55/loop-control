import {applyWorkspaceAudioMix} from './workspaceAudio.js';
import type {OpenChatCutProject} from './worker/openchatcutProject.js';
export interface WorkspaceUsedNarration {shotId:string;itemId:string;audioTrackId:string;sha256:string;taskId:string|null;text:string|null;mainScriptText:string;inputFingerprint:string|null;sourceInFrame:number;durationInFrames:number;fps:number;fullSourceUsed:boolean;provenance:'owner_adoption'|'immutable_task'|'not_recorded'}
export interface WorkspaceCandidateVisual {usage:'video'|'still'|'pan-zoom';motionPolicy:'preserve-target'|'replace-motion';acceptTimelineImpact:boolean;expectedAppearance:string;placeholder:boolean}
export interface WorkspaceCandidate {visual?:WorkspaceCandidateVisual;width?:number;height?:number;id:string;kind:'audio'|'video'|'image';shotId:string;clipId:string;targetItemId:string;taskId:string|null;inputFingerprint:string;text:string;mainScriptText:string;audioTrackId:string|null;relativePath:string;sha256:string;fileSize:number;durationSeconds:number;status:'available'|'stale'|'adopted'|'rejected';currentDurationSeconds:number|null;currentVoiceMode?:'tts'|'source'|'none';targetDurationSeconds?:number;pendingConfirmation?:boolean;durationImpact?:{deltaSeconds:number;overlapItemIds:string[]}}
/** Only source identity is compared; all editing properties remain native-owned. */
export function workspaceCandidateTarget(item:Record<string,unknown>){return {id:item.id,kind:item.kind,src:item.src??null,sourceAssetId:item.sourceAssetId??null,sourceRevision:item.sourceRevision??null,sourceContentHash:item.sourceContentHash??null,startFrame:item.startFrame,durationInFrames:item.durationInFrames,srcInFrame:item.srcInFrame??0,playbackRate:item.playbackRate??1};}
export interface WorkspaceCandidateMainVoice {workspaceId:string;shotId:string;visualItemIds:string[];expectedRoute:string;activate:boolean;volume:number;window:{startFrame:number;durationInFrames:number}}
export function workspaceCandidateAppearance(item:Record<string,unknown>){return JSON.stringify({transform:item.transform??null,keyframes:item.keyframes??null,zoom:item.zoom??null},(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);}
export interface WorkspaceCandidateEdit {visual?:WorkspaceCandidateVisual;mainVoice?:WorkspaceCandidateMainVoice;shotWindow?:{startFrame:number;durationInFrames:number};targetItemId:string;expectedTarget:ReturnType<typeof workspaceCandidateTarget>|null;source:{id:string;kind:'audio'|'video'|'image';src:string;sha256:string;inputFingerprint:string;durationSeconds:number;width?:number;height?:number};durationPolicy:'keep-target'|'use-candidate'}
export function isWorkspaceCandidateEdit(value:unknown):value is WorkspaceCandidateEdit {if(!value||typeof value!=='object')return false;const e=value as WorkspaceCandidateEdit;return typeof e.targetItemId==='string'&&(!!e.expectedTarget||!!e.mainVoice)&&typeof e.source?.id==='string'&&['audio','video','image'].includes(e.source.kind)&&typeof e.source.src==='string'&&/^[a-f0-9]{64}$/.test(e.source.sha256)&&typeof e.source.inputFingerprint==='string'&&Number.isFinite(e.source.durationSeconds)&&e.source.durationSeconds>0&&['keep-target','use-candidate'].includes(e.durationPolicy)&&(!e.mainVoice||e.source.kind==='audio'&&e.targetItemId===`workspace-narration-shot-${e.mainVoice.shotId}`&&typeof e.mainVoice.workspaceId==='string'&&Array.isArray(e.mainVoice.visualItemIds)&&e.mainVoice.visualItemIds.length>0&&e.mainVoice.visualItemIds.every(id=>typeof id==='string')&&typeof e.mainVoice.expectedRoute==='string'&&typeof e.mainVoice.activate==='boolean'&&Number.isFinite(e.mainVoice.volume)&&e.mainVoice.volume>0&&Number.isSafeInteger(e.mainVoice.window?.startFrame)&&e.mainVoice.window.startFrame>=0&&Number.isSafeInteger(e.mainVoice.window?.durationInFrames)&&e.mainVoice.window.durationInFrames>0);}
/** Native route identity excludes unrelated editing fields but includes gain, mute and used windows. */
export function workspaceCandidateVoiceRoute(project:OpenChatCutProject,shotId:string,visualItemIds:string[]){
 const ids=new Set(visualItemIds),voiceIds=new Set([`workspace-narration-shot-${shotId}`,`workspace-source-shot-${shotId}`,`workspace-ambience-shot-${shotId}`]);
 return JSON.stringify(project.timelines.filter(t=>t.items.some(i=>ids.has(String(i.id)))).map(t=>({id:t.id,visuals:t.items.filter(i=>ids.has(String(i.id))).sort((a,b)=>String(a.id).localeCompare(String(b.id))).map(i=>({id:i.id,startFrame:i.startFrame,durationInFrames:i.durationInFrames,volume:i.volume??1})),voices:t.items.filter(i=>voiceIds.has(String(i.id))).sort((a,b)=>String(a.id).localeCompare(String(b.id))).map(i=>({...workspaceCandidateTarget(i),volume:i.volume??1,track:i.track})),tracks:[...new Set(t.items.filter(i=>voiceIds.has(String(i.id))).map(i=>String(i.track)))].sort().map(id=>({id,muted:(t.tracks[id] as {muted?:boolean}|undefined)?.muted??false}))})));
}
export function workspaceCandidateDurationFrames(edit:WorkspaceCandidateEdit,fps:number){
 const full=Math.max(1,Math.ceil(edit.source.durationSeconds*fps)),window=Number(edit.mainVoice?.window.durationInFrames??edit.expectedTarget?.durationInFrames);
 return edit.durationPolicy==='use-candidate'?full:edit.mainVoice?Math.min(full,window):window;
}
/** Restricted shared audio/video adoption. No pool-wide relink, ripple or project reconstruction. */
export function applyWorkspaceCandidate(project:OpenChatCutProject,edit:WorkspaceCandidateEdit):OpenChatCutProject {
 let next=structuredClone(project);const targets=next.timelines.flatMap(t=>t.items.filter(i=>i.id===edit.targetItemId).map(item=>({timeline:t,item})));
 if(targets.length>1||!targets.length&&!edit.mainVoice||targets.length===0&&edit.expectedTarget||targets.length===1&&!edit.expectedTarget)throw Error('候选目标已删除或不唯一，请重新读取。');
 const main=edit.mainVoice;if(main&&workspaceCandidateVoiceRoute(project,main.shotId,main.visualItemIds)!==main.expectedRoute)throw Error('当前主声路由、增益或镜头窗口已变化，请重新比较。');
 let timeline=targets[0]?.timeline;let item:Record<string,unknown>|undefined=targets[0]?.item;
 if(item&&(Object.entries(workspaceCandidateTarget(item)).some(([key,value])=>value!==(edit.expectedTarget as Record<string,unknown>)[key])||item.kind!==edit.source.kind&&!(edit.visual&&['video','image'].includes(String(item.kind))&&edit.source.kind!=='audio')&&!(edit.visual?.placeholder&&item.kind==='text'&&edit.source.kind!=='audio')))throw Error('目标输入或源身份已变化，请重新比较候选。');
 if(!timeline&&main){const timelines=next.timelines.filter(t=>t.items.some(i=>main.visualItemIds.includes(String(i.id))));if(timelines.length!==1)throw Error('镜头画面跨时间线或已删除。');timeline=timelines[0];}
 if(!timeline)throw Error('候选目标不存在。');
 if(edit.visual&&edit.visual.motionPolicy==='replace-motion'&&item&&workspaceCandidateAppearance(item)!==edit.visual.expectedAppearance)throw Error('目标人工构图或运动已变化，请重新比较。');
 const timelineId=timeline.id,frames=Math.max(1,Math.ceil(edit.source.durationSeconds*timeline.fps)),appliedDuration=workspaceCandidateDurationFrames(edit,timeline.fps);
 if(item&&(Number(item.playbackRate??1)!==1||item.edits))throw Error('目标已变速或分段，请先在原生编辑器明确恢复完整区间。');
 if(edit.durationPolicy==='keep-target'&&!main&&edit.source.kind!=='image'&&Number(item?.durationInFrames)>frames)throw Error('候选短于目标窗口，请明确采用候选时长。');
 if(edit.visual&&edit.durationPolicy==='use-candidate'&&Number(item?.durationInFrames)!==frames&&!edit.visual.acceptTimelineImpact)throw Error('候选时长将改变空隙或覆盖，请明确接受其它片段位置保持。');
 const asset={...(edit.visual?{width:edit.source.width,height:edit.source.height,sourceContentHash:edit.source.sha256,sourceRevision:`source-sha256-${edit.source.sha256}`}:{ }),id:edit.source.id,name:String(item?.name??edit.targetItemId),kind:edit.source.kind,src:edit.source.src,durationInFrames:frames};
 const existing=next.assets.find(a=>a.id===asset.id);if(existing&&existing.src!==asset.src)throw Error('候选素材身份已变化。');if(!existing)next.assets.push(asset);
 const ambience=main?timeline.items.find(i=>i.id===`workspace-ambience-shot-${main.shotId}`):undefined,ambienceTrack=ambience?structuredClone(timeline.tracks[String(ambience.track)]):undefined;
 const activate=()=>{if(!main)return;next=applyWorkspaceAudioMix(next,{kind:'voice',workspaceId:main.workspaceId,shotId:main.shotId,visualItemIds:main.visualItemIds,mode:'tts',gainDb:0,ambienceGainDb:null,narrationAssetId:edit.source.id},{narrationDurationInFrames:appliedDuration});timeline=next.timelines.find(t=>t.id===timelineId)!;item=timeline.items.find(i=>i.id===edit.targetItemId);if(item)item.volume=main.volume;if(ambience){timeline.items.push(ambience);if(ambienceTrack)timeline.tracks[String(ambience.track)]=ambienceTrack;}};
 const created=!item;if(created)activate();if(!item)throw Error('主声音轨未建立。');
 if(main?.activate)item.startFrame=main.window.startFrame;
 Object.assign(item,{src:edit.source.src,sourceAssetId:asset.id,sourceRevision:`source-sha256-${edit.source.sha256}`,sourceContentHash:edit.source.sha256,loopControlCandidate:{inputFingerprint:edit.source.inputFingerprint,sourceId:edit.source.id,durationPolicy:edit.durationPolicy,startFrame:Number(item.startFrame),durationInFrames:appliedDuration,shotWindow:edit.shotWindow},srcInFrame:0,durationInFrames:appliedDuration});
 if(edit.visual){
  const wasPlaceholder=item.kind==='text';Object.assign(item,{kind:edit.source.kind,width:edit.source.width,height:edit.source.height});if(wasPlaceholder){delete item.props;item.volume=0;}
  if(edit.visual.usage==='pan-zoom'&&edit.visual.motionPolicy==='replace-motion'){
   const transform=item.transform as {scale?:number;x?:number}|undefined,scale=Number(transform?.scale??1),x=Number(transform?.x??0);item.keyframes={...(item.keyframes as object??{}),scale:[{frame:0,value:scale,easing:'linear'},{frame:appliedDuration-1,value:scale*1.15,easing:'linear'}],x:[{frame:0,value:x,easing:'linear'},{frame:appliedDuration-1,value:Math.min(100,x+3),easing:'linear'}]};delete item.zoom;
  }
 }
 if(main?.activate&&!created)activate();
 return next;
}

/** Registered Owner pool imports never relink an existing master. */
export function addWorkspaceRegisteredSource(project:OpenChatCutProject,value:unknown):OpenChatCutProject {
 const asset=value as OpenChatCutProject['assets'][number]&{sourceContentHash?:string;width?:number;height?:number};
 if(!asset||!/^material-[a-f0-9-]{36}$/.test(asset.id)||!['image','video'].includes(asset.kind)||!/^\/media\/uploads\/[a-f0-9]+\.[a-z0-9]+$/.test(asset.src)||!/^[a-f0-9]{64}$/.test(asset.sourceContentHash??'')||!Number.isInteger(asset.durationInFrames)||asset.durationInFrames<1||!(Number(asset.width)>0&&Number(asset.height)>0))throw Error('登记素材输入无效。');
 const next=structuredClone(project),old=next.assets.find(a=>a.id===asset.id);if(old){if(old.src!==asset.src||(old as {sourceContentHash?:string}).sourceContentHash!==asset.sourceContentHash)throw Error('池中来源已变化，请保留原素材。');return next;}next.assets.push(structuredClone(asset));return next;
}
