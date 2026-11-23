import type {WorkspaceCallSummary} from './workspaceCall.js';
import type {ProductionSelection} from './productionSelection.js';

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
 summary?:WorkspaceCallSummary;
}
export interface StoryboardBatchReview {
 status:'review';
 kind:'speech';
 confirmationId:string;
 expiresAt:string;
 items:StoryboardBatchItem[];
 changed?:true;
}
export interface StoryboardBatchReceipt {
 status:'submitted';
 kind:'speech';
 episodeId:string;
 confirmationId:string;
 items:Array<{shotId:string;taskId:string;reservationCents:number}>;
}
export type StoryboardBatchResult=StoryboardBatchReview|StoryboardBatchReceipt;
