/** An explicit request, never an episode-wide or future-call authorization. */
export const workspaceCallKinds=['requestWorkspaceImageCandidates','requestWorkspaceVisualCandidate','generateWorkspaceImage','generateWorkspaceNarration','prepareWorkspaceAudio'] as const;
export function requiresWorkspaceCall(command:string,data:Record<string,unknown>):boolean {
 return workspaceCallKinds.includes(command as typeof workspaceCallKinds[number])&&(command!=='prepareWorkspaceAudio'||data.kind!=='source'&&!data.materialRevisionId);
}
export interface WorkspaceCallSummary {
 kind:'图片生成'|'视频生成'|'口播生成'|'在线音效';target:string;provider:string;model:string;connection:string;
 parameters:string[];inputs:string[];prompt:string;reservationCents:number;estimate?:WorkspaceCallEstimate;retryOfTaskId?:string;
}
export interface WorkspaceCallProposal {confirmationId:string;expiresAt:string;summary:WorkspaceCallSummary}

export interface WorkspaceCallEstimate {
 version:string;estimatedCents:number;suggestedCents:number;minimumCents:number;maximumCents:number;
 basis:string;sourceUrl?:string;conservative:boolean;bufferPercent:number;manualReservation?:boolean;
 imageInputs?:{textCharacters:number;textTokens:number;referenceTokens:number;references:Array<{width:number;height:number;tokens:number}>;outputTokensPerImage:number;quality:'low'|'medium'|'high'};
}

export const gptImage2EstimateRates={textInput:5,imageInput:8,imageOutput:30,usdCny:7.2} as const;
