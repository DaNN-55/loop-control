/** These fields come from the persisted task, not a guessed browser retry counter. */
export const workspaceTaskRetryColumns=`t.attempt,t.max_attempts "maxAttempts",t.invalidated_at "invalidatedAt",CASE WHEN isfinite(t.available_at) THEN t.available_at END "retryAt"`;
export function projectWorkspaceTaskRetry<T extends {status:string;attempt?:number;maxAttempts?:number;invalidatedAt?:Date|string|null;retryAt?:Date|string|null}>(task:T,now=Date.now()){
 const invalidated=task.invalidatedAt!=null;
 const waitingForRetry=task.status==='ready'&&task.retryAt!=null&&new Date(task.retryAt).getTime()>now;
 const stopped=task.status==='failed'||task.status==='blocked';
 return{...task,retryAt:waitingForRetry?new Date(task.retryAt!).toISOString():null,invalidated,waitingForRetry,
  retryAllowed:stopped&&!invalidated,
  automaticRetryExhausted:stopped&&task.attempt!=null&&task.maxAttempts!=null&&task.attempt>=task.maxAttempts};
}

/** Received is retryable only for stopped legacy records without any new fact. */
export function workspaceUnknownRetryAllowed(task:{status:string;submissionUnknown?:boolean;submissionOutcome?:string|null;publicationAttempt?:number|null;retryTaskId?:string|null;providerTaskId?:string|null;invalidated?:boolean;dispatchObservation?:unknown}){
 return !!task.submissionUnknown&&['failed','blocked'].includes(task.status)&&!task.invalidated&&task.publicationAttempt==null&&!task.retryTaskId&&!task.providerTaskId&&(task.submissionOutcome!=='received'||task.dispatchObservation==null);
}
