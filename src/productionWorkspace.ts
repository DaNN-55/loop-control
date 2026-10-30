import {workspaceVisualFields,type WorkspaceVisualCandidate,type WorkspaceVisualTask,type WorkspaceVisualTarget} from './workspaceVisualCandidates.js';
import type {WorkspaceCandidate,WorkspaceUsedNarration} from './workspaceCandidates.js';
import {workspaceAudioFields,type WorkspaceAudioMix} from './workspaceAudio.js';
import {workspaceDeliveryFields,type WorkspaceDelivery} from './workspaceDelivery.js';
import {workspaceExportFields,type WorkspaceExport,type WorkspaceExportIssue} from './workspaceExport.js';
import {workspaceCaptionFields,type WorkspaceCaptionState} from './workspaceCaptions.js';
/** Provenance bindings identify native items; the OpenChatCut document owns editing. */
export interface WorkspaceSource {materialRevisionId:string;relativePath:string;sha256:string;fileSize:number;kind:'video'|'image'|'audio'}
export interface WorkspaceClip {id:string;itemId:string;shotId:string;text:string;source:WorkspaceSource|null;image?:{usage:'still'|'pan-zoom'|'ai-video';durationSeconds:number;providerDurationSeconds?:number;fit:'contain'|'cover';focusX:number;focusY:number;taskId?:string;materialRevisionId?:string}}
export interface ProductionWorkspace {
 scriptResume?:{canReuse:boolean;reason:string};
 selectedImages?:Array<{targetItemId:string;candidateId:string;materialRevisionId:string}>;
 visualConfiguration?:{imageModel:string|null;videoModel:string|null;videoProvider:string|null};
 recovery?:{decision:'preserve'|'fresh';relativePath:string;sha256:string;fileSize:number};
 preparation?:{origin:string;authorized:boolean;authorizationHash?:string;scriptRevisionId:string;shots:Array<{shotId:string;origin:string;shotType:'a_roll'|'b_roll'|null}>};
 visualCandidates?:WorkspaceVisualCandidate[];visualTasks?:WorkspaceVisualTask[];visualTargets?:WorkspaceVisualTarget[];
 id:string;episodeId:string;workflowVersion:'four-step/v1';scriptRevisionId:string;storyboardPackageId:string;revision:number;contentSha256:string;nativeEditRevision?:number;
 audio?:{mix:WorkspaceAudioMix;preparations:Array<{id:string;kind:string;shotId:string|null;sourceItemId:string|null;description:string;query:string|null;anchor:string;offsetSeconds:number;durationSeconds:number;taskId:string|null;status:string;error:string|null;audioTrackId:string|null;relativePath:string|null;sha256:string|null;fileSize:number;adoptedItemId:string|null;source:Record<string,unknown>|null}>};usedNarration?:WorkspaceUsedNarration[];candidates?:WorkspaceCandidate[];deliveries?:WorkspaceDelivery[];exports?:WorkspaceExport[];exportIssues?:WorkspaceExportIssue[];captions?:WorkspaceCaptionState[];narration?:WorkspaceNarration[];clips:WorkspaceClip[];project:{relativePath:string;sha256:string;fileSize:number;projectId:string};
 history:Array<{revision:number;sha256:string;scriptRevisionId:string;reason:string|null;createdAt?:string}>;
 readiness:{deliverable:boolean;placeholders:string[];missingSources:string[]};stale:boolean;
}
export const productionWorkspaceFields:Record<string,string[]>={
 resumeWorkspaceEditing:['episodeId','workspaceId','expectedRevision','expectedScriptRevisionId','expectedProjectSha256'],
 adoptLegacyWorkspace:['episodeId','artifactId','savedProjectSha256','expectedSourceSha256','expectedScriptRevisionId','reviewPackageId'],
 authorizeWorkspacePreparation:['episodeId','workspaceId','expectedRevision','enabled'],
 confirmWorkspaceShot:['episodeId','workspaceId','expectedRevision','clipId','shotType'],
 ...workspaceVisualFields,
 prepareWorkspaceCandidate:['episodeId','workspaceId','expectedRevision','candidateId','durationPolicy'],
 adoptWorkspaceCandidate:['episodeId','workspaceId','expectedRevision','candidateId','adoptionId','nativeApplied'],
 rejectWorkspaceCandidate:['episodeId','workspaceId','expectedRevision','candidateId'],
 ...workspaceAudioFields,
 ...workspaceDeliveryFields,
 ...workspaceExportFields,
 saveWorkspaceNarration:['episodeId','workspaceId','expectedRevision','clipId','mode','text','voice','speakingRate','audioTrackId'],
 confirmWorkspaceNarration:['episodeId','workspaceId','expectedRevision','clipId'],
 generateWorkspaceNarration:['episodeId','workspaceId','expectedRevision','clipId','retry'],
 adoptWorkspaceNarration:['episodeId','workspaceId','expectedRevision','clipId','inputFingerprint','audioTrackId'],
 refreshWorkspaceNarration:['episodeId','workspaceId','expectedRevision'],
 editWorkspaceStructure:['episodeId','workspaceId','expectedRevision','operation'],
 saveWorkspaceVideoRanges:['episodeId','workspaceId','expectedRevision','shotId','ranges'],
 ...workspaceCaptionFields,
 generateWorkspaceImage:['episodeId','workspaceId','expectedRevision','clipId','materialRevisionId','prompt','durationSeconds','reservationCents'],
 fillWorkspaceImageResult:['episodeId','workspaceId','expectedRevision','taskId'],
 matchWorkspaceImage:['episodeId','workspaceId','expectedRevision','clipId','materialRevisionId','usage','durationSeconds','fit','focusX','focusY'],
 replanWorkspace:['episodeId','workspaceId','expectedRevision','reviewPackageId','expectedScriptRevisionId','reason','legacyDecision'],
 retryWorkspacePlanning:['episodeId','expectedScriptRevisionId','taskId'],
 prepareWorkspace:['episodeId','reviewPackageId','expectedScriptRevisionId','legacyDecision'],
 matchWorkspaceMaterial:['episodeId','workspaceId','expectedRevision','clipId','materialRevisionId'],
 openWorkspaceStudio:['episodeId','workspaceId','expectedRevision'],
 saveWorkspaceStudio:['episodeId','workspaceId','expectedRevision','workspaceRelativePath','projectId','expectedWorkspaceSha256'],
 closeWorkspaceStudio:['episodeId','workspaceId','expectedRevision'],
};

export interface WorkspaceNarration {requiresCandidateAdoption?:boolean;videoWindow?:{durationSeconds:number;generationSeconds:number;maximumSeconds:number};clipId:string;shotId:string;mode:'tts'|'manual'|'none';text:string;voice:string|null;languageCode:string|null;speakingRate:number|null;override:boolean;inputFingerprint:string;confirmed:boolean;taskId:string|null;status:string;error:string|null;audioTrackId:string|null;artifactId:string|null;relativePath:string|null;sha256:string|null;fileSize:number|null;durationSeconds:number|null;itemId:string;adoptedAudioTrackId:string|null}
