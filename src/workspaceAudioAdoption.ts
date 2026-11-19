import {setWorkspaceSoundEnabled} from './workspaceAudio.js';
import type {OpenChatCutProject} from './worker/openchatcutProject.js';
type Item=OpenChatCutProject['timelines'][number]['items'][number];
export interface WorkspaceAudioAdoptionEdit {
 version:'workspace-audio-adoption/v1';workspaceId:string;preparationId:string;timelineId:string;
 expectedItems:Item[];items:Item[];tracks:OpenChatCutProject['timelines'][number]['tracks'];asset:OpenChatCutProject['assets'][number];
}
/** Source URLs differ between the registered project and its native media cache. */
export function workspaceAudioAdoptionItemState(item:Item){
 const keys=['id','kind','track','sourceAssetId','sourceContentHash','startFrame','durationInFrames','srcInFrame','playbackRate','volume','fadeInFrames','fadeOutFrames','keyframes','loopControlAudio'];
 const defaults:Record<string,unknown>={srcInFrame:0,playbackRate:1,volume:1,fadeInFrames:0,fadeOutFrames:0};
 const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>[key,stable(child)])):value;
 return JSON.stringify(keys.map(key=>stable(item[key]??defaults[key]??null)));
}
export function isWorkspaceAudioAdoptionEdit(value:unknown):value is WorkspaceAudioAdoptionEdit {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const edit=value as WorkspaceAudioAdoptionEdit;
 return edit.version==='workspace-audio-adoption/v1'&&[edit.workspaceId,edit.preparationId,edit.timelineId].every(id=>typeof id==='string'&&!!id)&&Array.isArray(edit.expectedItems)&&Array.isArray(edit.items)&&edit.items.length>0&&edit.items.length<=1000&&edit.expectedItems.length<=1000&&!!edit.tracks&&typeof edit.tracks==='object'&&!!edit.asset&&typeof edit.asset.src==='string'&&typeof edit.asset.id==='string'&&edit.asset.kind==='audio'&&edit.items.every(item=>item&&item.kind==='audio'&&item.sourceAssetId===edit.asset.id&&item.src===edit.asset.src&&typeof item.id==='string'&&Number.isSafeInteger(item.startFrame)&&Number.isSafeInteger(item.durationInFrames)&&Number(item.durationInFrames)>0&&(item.loopControlAudio as {workspaceId?:string;preparationId?:string})?.workspaceId===edit.workspaceId&&(item.loopControlAudio as {preparationId?:string})?.preparationId===edit.preparationId);
}
export function applyWorkspaceAudioAdoption(project:OpenChatCutProject,edit:WorkspaceAudioAdoptionEdit):OpenChatCutProject {
 if(!isWorkspaceAudioAdoptionEdit(edit))throw Error('音频采用输入无效。');
 let next=structuredClone(project),timeline=next.timelines.find(t=>t.id===edit.timelineId);
 if(!timeline||next.activeTimelineId!==edit.timelineId)throw Error('当前时间线已变化，请重新采用。');
 const kind=(edit.items[0].loopControlAudio as {kind?:string})?.kind;
 const targets=timeline.items.filter(item=>kind==='bgm'?item.kind==='audio'&&(item.loopControlAudio as {workspaceId?:string;kind?:string})?.workspaceId===edit.workspaceId&&(item.loopControlAudio as {kind?:string})?.kind==='bgm':edit.items.some(target=>target.id===item.id));
 if(JSON.stringify(targets.map(workspaceAudioAdoptionItemState).sort())!==JSON.stringify(edit.expectedItems.map(workspaceAudioAdoptionItemState).sort()))throw Error('配乐或音效实例已有变化，请重新核对采用。');
 for(const item of [...targets,...edit.items])if((timeline.tracks[String(item.track)] as {locked?:boolean}|undefined)?.locked)throw Error('目标声音轨已锁定，请先解锁。');
 if(kind==='bgm'||kind==='sfx'){next=setWorkspaceSoundEnabled(next,kind,true);timeline=next.timelines.find(t=>t.id===edit.timelineId)!;}
 const removed=new Set(targets.map(item=>item.id));
 if(edit.items.some(item=>timeline.items.some(existing=>existing.id===item.id&&!removed.has(existing.id))))throw Error('音频实例身份冲突。');
 timeline.items=timeline.items.filter(item=>!removed.has(item.id));timeline.items.push(...structuredClone(edit.items));
 for(const [id,track]of Object.entries(edit.tracks)){if(!timeline.tracks[id])timeline.tracks[id]=structuredClone(track);if(!timeline.trackOrder.includes(id))timeline.trackOrder.push(id);}
 const asset=next.assets.find(asset=>asset.id===edit.asset.id);
 if(asset&&asset.src!==edit.asset.src)throw Error('音频来源已有变化。');
 if(!asset)next.assets.push(structuredClone(edit.asset));
 return next;
}
