import {resolveWorkspaceMainVoice} from './workspaceAudio.js';
import type {OpenChatCutProject} from './worker/openchatcutProject.js';
import type {WorkspaceCandidate} from './workspaceCandidates.js';
export interface WorkspaceVisualCandidate extends WorkspaceCandidate {usage:'video'|'still'|'pan-zoom';width:number;height:number}
export interface WorkspaceVisualTask {id:string;taskId:string;status:string;error:string|null;canResume?:boolean}
export const workspaceVisualFields:Record<string,string[]>={
 requestWorkspaceVisualCandidate:['episodeId','workspaceId','expectedRevision','targetItemId','firstFrameMaterialRevisionId','prompt','durationSeconds','reservationCents'],
 retryWorkspaceVisualCandidate:['episodeId','workspaceId','expectedRevision','candidateId'],
 prepareWorkspaceVisualPool:['episodeId','workspaceId','expectedRevision','materialRevisionId'],
 registerWorkspaceVisualCandidate:['episodeId','workspaceId','expectedRevision','targetItemId','materialRevisionId','usage','durationSeconds'],
 prepareWorkspaceVisualCandidate:['episodeId','workspaceId','expectedRevision','candidateId','durationPolicy','acceptTimelineImpact','motionPolicy'],
 adoptWorkspaceVisualCandidate:['episodeId','workspaceId','expectedRevision','candidateId','adoptionId','nativeApplied'],
 rejectWorkspaceVisualCandidate:['episodeId','workspaceId','expectedRevision','candidateId'],
};

export interface WorkspaceVisualTarget {targetItemId:string;voiceMode:'source'|'tts'|'none';durationSeconds:number|null;providerDurationSeconds:number|null;minimumSeconds:number;maximumSeconds:number}

/** Visual generation follows audible content/window, not independent gain or BGM edits. */
export function workspaceVisualVoiceIdentity(project:OpenChatCutProject,shotId:string){
 const route=resolveWorkspaceMainVoice(project,shotId),item=route.item;if(!item)return JSON.stringify({mode:'none'});
 const timeline=project.timelines.find(t=>t.items.includes(item))!,asset=project.assets.find(a=>a.id===item.sourceAssetId) as {sourceContentHash?:string}|undefined;
 return JSON.stringify({mode:item.id===`workspace-source-shot-${shotId}`?'source':'tts',id:item.id,src:item.src,sourceAssetId:item.sourceAssetId,sha256:item.sourceContentHash??asset?.sourceContentHash??null,startFrame:item.startFrame,durationInFrames:item.durationInFrames,srcInFrame:item.srcInFrame??0,playbackRate:item.playbackRate??1,edits:item.edits??null,fps:timeline.fps});
}
