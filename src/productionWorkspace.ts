import type {WorkspaceCandidate,WorkspaceUsedNarration} from './workspaceCandidates.js';
import {workspaceExportFields,type WorkspaceExport,type WorkspaceExportIssue} from './workspaceExport.js';
import {workspaceCaptionFields,type WorkspaceCaptionState} from './workspaceCaptions.js';
/** Provenance bindings identify native items; the OpenChatCut document owns editing. */
export interface WorkspaceSource {materialRevisionId:string;relativePath:string;sha256:string;fileSize:number;kind:'video'|'image'|'audio'}
export interface WorkspaceClip {id:string;itemId:string;shotId:string;text:string;source:WorkspaceSource|null;image?:{usage:'still'|'pan-zoom'|'ai-video';durationSeconds:number;providerDurationSeconds?:number;fit:'contain'|'cover';focusX:number;focusY:number;taskId?:string;materialRevisionId?:string}}
export interface ProductionWorkspace {
 id:string;episodeId:string;workflowVersion:'four-step/v1';scriptRevisionId:string;storyboardPackageId:string;revision:number;contentSha256:string;nativeEditRevision?:number;
 usedNarration?:WorkspaceUsedNarration[];candidates?:WorkspaceCandidate[];exports?:WorkspaceExport[];exportIssues?:WorkspaceExportIssue[];captions?:WorkspaceCaptionState[];narration?:WorkspaceNarration[];clips:WorkspaceClip[];project:{relativePath:string;sha256:string;fileSize:number;projectId:string};
 history:Array<{revision:number;sha256:string;scriptRevisionId:string;reason:string|null}>;
 readiness:{deliverable:boolean;placeholders:string[];missingSources:string[]};stale:boolean;
}
export const productionWorkspaceFields:Record<string,string[]>={
 prepareWorkspaceCandidate:['episodeId','workspaceId','expectedRevision','candidateId','durationPolicy'],
 adoptWorkspaceCandidate:['episodeId','workspaceId','expectedRevision','candidateId','adoptionId','nativeApplied'],
 rejectWorkspaceCandidate:['episodeId','workspaceId','expectedRevision','candidateId'],
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
 replanWorkspace:['episodeId','workspaceId','expectedRevision','reviewPackageId','expectedScriptRevisionId','reason'],
 prepareWorkspace:['episodeId','reviewPackageId','expectedScriptRevisionId'],
 matchWorkspaceMaterial:['episodeId','workspaceId','expectedRevision','clipId','materialRevisionId'],
 openWorkspaceStudio:['episodeId','workspaceId','expectedRevision'],
 saveWorkspaceStudio:['episodeId','workspaceId','expectedRevision','workspaceRelativePath','projectId','expectedWorkspaceSha256'],
 closeWorkspaceStudio:['episodeId','workspaceId','expectedRevision'],
};

export interface WorkspaceNarration {videoWindow?:{durationSeconds:number;generationSeconds:number;maximumSeconds:number};clipId:string;shotId:string;mode:'tts'|'manual'|'none';text:string;voice:string|null;languageCode:string|null;speakingRate:number|null;override:boolean;inputFingerprint:string;confirmed:boolean;taskId:string|null;status:string;error:string|null;audioTrackId:string|null;artifactId:string|null;relativePath:string|null;sha256:string|null;fileSize:number|null;durationSeconds:number|null;itemId:string;adoptedAudioTrackId:string|null}
