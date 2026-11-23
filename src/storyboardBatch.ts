import type {WorkspaceCallSummary} from './workspaceCall.js';
import type {ProductionSelection} from './productionSelection.js';
import type {PromptReferenceBinding} from './promptReferences.js';
import type {VideoVisualInputSelection} from './videoVisualInputs.js';
import type {WanGenerationSettings} from './videoGenerationSettings.js';

export type StoryboardBatchKind='speech'|'video';
export interface StoryboardVideoSettings {
 selection?:ProductionSelection|null;
 durationSeconds?:number;
 videoSettings?:WanGenerationSettings;
 videoResolution?:string;
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
  firstFrameFit?:'contain'|'cover';
  videoMode?:string;
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
}
export interface StoryboardBatchReceipt {
 status:'submitted';
 kind:StoryboardBatchKind;
 episodeId:string;
 confirmationId:string;
 items:Array<{shotId:string;taskId:string;reservationCents:number}>;
}
export type StoryboardBatchResult=StoryboardBatchReview|StoryboardBatchReceipt;
