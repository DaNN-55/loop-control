/** Safe video diagnostics that may cross Worker, task and UI boundaries. */
export class VideoGenerationError extends Error {
 readonly code:string;
 constructor(message:string,readonly outcome:'not_sent'|'rejected'|'unknown'|'accepted'|'terminal_failed',options?:ErrorOptions){
  super(message,options);this.name='VideoGenerationError';
  this.code=outcome==='not_sent'?'VIDEO_REQUEST_NOT_SENT':outcome==='rejected'?'VIDEO_PROVIDER_REJECTED':outcome==='terminal_failed'?'VIDEO_PROVIDER_TERMINAL_FAILURE':'VIDEO_GENERATION_FAILED';
 }
}
