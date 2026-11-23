import type {WorkspaceCallSummary} from './workspaceCall.js';
import type {ProductionSelection} from './productionSelection.js';
import type {PromptReferenceBinding} from './promptReferences.js';
import type {VideoVisualInputSelection} from './videoVisualInputs.js';
import type {WanGenerationSettings} from './videoGenerationSettings.js';
import type {WorkspaceVisualTask} from './workspaceVisualCandidates.js';

export type StoryboardBatchKind='speech'|'video';
export interface StoryboardBatchFailure {shotId:string;taskId:string}

export function definiteStoryboardFailure(task:WorkspaceVisualTask|undefined){
 return !!task&&['failed','blocked'].includes(task.status)&&!task.invalidated&&!task.retryTaskId
  &&!task.submissionUnknown&&task.publicationAttempt==null
  &&(task.providerTaskId?task.kind==='video'&&task.submissionOutcome==='terminal_failed':task.submissionOutcome==='rejected'||task.submissionOutcome==='not_sent');
}

export function latestStoryboardTask(tasks:WorkspaceVisualTask[]){
 return tasks.reduce<WorkspaceVisualTask|undefined>((latest,task)=>{
  if(task.retryTaskId)return latest;
  if(!latest||new Date(task.createdAt??0)>new Date(latest.createdAt??0))return task;
  return latest;
 },undefined);
}
export interface StoryboardVideoSettings {
 selection?:ProductionSelection|null;
 durationSeconds?:number;
 videoSettings?:WanGenerationSettings;
 videoResolution?:string;
 firstFrameFit?:'contain'|'cover';
 videoMode?:string;
 reservationCents?:number;
}
export interface StoryboardVideoDraft {
 shotId:string;
 targetItemId:string;
 preparationRevisionId:string;
 inputs:Omit<StoryboardVideoSettings,'videoSettings'>&{
  videoSettings?:Partial<WanGenerationSettings>;
  prompt?:string;
  promptReferences?:PromptReferenceBinding[];
  firstFrameMaterialRevisionId?:string;
  visualInputs?:VideoVisualInputSelection[];
 };
}

/** Scope a browser draft to the exact saved shot inputs it was edited from. */
export interface StoryboardSpeechDraft {
 shotId:string;
 preparationRevisionId:string;
 inputFingerprint:string;
 text:string;
}
export interface StoryboardSpeechSettings {
 selection:ProductionSelection|null;
 voice:string;
 languageCode:string;
 speakingRate:number;
}
export interface StoryboardBatchItem {
 shotId:string;
 state:'ready'|'regenerate'|'skipped';
 reason?:string;
 change?:string;
 source:'draft'|'confirmed';
 text:string;
 characters?:number;
 targetSeconds?:number;
 providerSeconds?:number;
 summary?:WorkspaceCallSummary;
}
export interface StoryboardBatchReview {
 status:'review';
 kind:StoryboardBatchKind;
 confirmationId:string;
 expiresAt:string;
 items:StoryboardBatchItem[];
 changed?:true;
 retry?:true;
}
export interface StoryboardBatchReceipt {
 status:'submitted';
 kind:StoryboardBatchKind;
 episodeId:string;
 confirmationId:string;
 items:Array<{shotId:string;taskId:string;reservationCents:number}>;
}
export type StoryboardBatchResult=StoryboardBatchReview|StoryboardBatchReceipt;
