import type {VideoGenerationPhase} from './worker/wanVideoProvider.js';
import {resolveWorkspaceMainVoice} from './workspaceAudio.js';
import type {OpenChatCutProject} from './worker/openchatcutProject.js';
import type {WorkspaceCandidate} from './workspaceCandidates.js';
export interface WorkspaceVisualCandidate extends WorkspaceCandidate {source?:import('./workspacePexels.js').WorkspacePexelsSource;usage:'video'|'still'|'pan-zoom';materialRevisionId?:string;generation?:{selection?:import('./productionSelection.js').ProductionSelection;connectionName?:string;actualPrompt?:string;prompt:string;firstFrameMaterialRevisionId:string;durationSeconds:number;imageSettings?:import('./imageGeneration.js').ImageGenerationSettings;imageBrief?:import('./imageGeneration.js').ImageBrief;referenceMaterialRevisionIds?:string[];videoResolution?:string;videoSettings?:import('./videoGenerationSettings.js').WanGenerationSettings;firstFrameFit?:'contain'|'cover'};width:number;height:number}
export interface WorkspaceVisualTask {generation?:WorkspaceVisualCandidate['generation'];id:string;taskId:string;shotId?:string;kind?:'image'|'video';status:string;error:string|null;canResume?:boolean;provider?:string;model?:string;connectionName?:string|null;reservationCents?:number|null;createdAt?:string;targetItemId?:string;submissionOutcome?:'started'|'received'|'rejected'|'not_sent'|null;providerTaskId?:string|null;videoPhase?:VideoGenerationPhase|null;requestState?:string|null;submissionUnknown?:boolean;retryTaskId?:string|null;publicationAttempt?:number|null}
export const workspaceVisualFields:Record<string,string[]>={
 searchWorkspacePexelsVideos:['episodeId','workspaceId','expectedRevision','targetItemId','selection','query','orientation','size','page'],
 previewWorkspacePexelsVideo:['episodeId','workspaceId','expectedRevision','searchId','resultId'],
 importWorkspacePexelsVideo:['episodeId','workspaceId','expectedRevision','previewId'],
 requestWorkspaceVisualCandidate:['selection','episodeId','workspaceId','expectedRevision','targetItemId','firstFrameMaterialRevisionId','videoMode','visualInputs','prompt','promptReferences','durationSeconds','reservationCents','videoSettings','videoResolution','firstFrameFit'],
 retainWorkspaceImageCandidate:['episodeId','workspaceId','expectedRevision','candidateId'],
 requestWorkspaceImageCandidates:['episodeId','workspaceId','expectedRevision','targetItemId','selection','model','prompt','promptReferences','settings','imageBrief','referenceMaterialRevisionIds','reservationCents','retryOfTaskId'],
 retryWorkspaceVisualCandidate:['episodeId','workspaceId','expectedRevision','candidateId'],
 prepareWorkspaceVisualPool:['episodeId','workspaceId','expectedRevision','materialRevisionId'],
 registerWorkspaceVisualCandidate:['episodeId','workspaceId','expectedRevision','targetItemId','materialRevisionId','usage','durationSeconds'],
 prepareWorkspaceVisualCandidate:['episodeId','workspaceId','expectedRevision','candidateId','durationPolicy','acceptTimelineImpact','motionPolicy','imageUsage','replaceCurrentVisual','sourceInSeconds','sourceOutSeconds'],
 adoptWorkspaceVisualCandidate:['episodeId','workspaceId','expectedRevision','candidateId','adoptionId','nativeApplied'],
 rejectWorkspaceVisualCandidate:['episodeId','workspaceId','expectedRevision','candidateId'],
 splitWorkspaceVideoSound:['episodeId','workspaceId','expectedRevision','targetItemId'],
 clearWorkspaceVisualCandidate:['episodeId','workspaceId','expectedRevision','targetItemId','candidateId','sourcePath','sourceSha256'],
};

export interface WorkspaceVisualTarget {defaultSelection?:import('./productionSelection.js').ProductionSelection;targetItemId:string;voiceMode:'source'|'tts'|'none';durationSeconds:number|null;providerDurationSeconds:number|null;minimumSeconds:number;maximumSeconds:number;model?:string;provider?:string;width?:number;height?:number}

/** Visual generation follows audible content/window, not independent gain or BGM edits. */
export function workspaceVisualVoiceIdentity(project:OpenChatCutProject,shotId:string){
 const route=resolveWorkspaceMainVoice(project,shotId),item=route.item;if(!item)return JSON.stringify({mode:'none'});
 const timeline=project.timelines.find(t=>t.items.includes(item))!,asset=project.assets.find(a=>a.id===item.sourceAssetId) as {sourceContentHash?:string}|undefined;
 return JSON.stringify({mode:item.id===`workspace-source-shot-${shotId}`?'source':'tts',id:item.id,src:item.src,sourceAssetId:item.sourceAssetId,sha256:item.sourceContentHash??asset?.sourceContentHash??null,startFrame:item.startFrame,durationInFrames:item.durationInFrames,srcInFrame:item.srcInFrame??0,playbackRate:item.playbackRate??1,edits:item.edits??null,fps:timeline.fps});
}
