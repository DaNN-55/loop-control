import type {Pool} from 'pg';
import {ProviderOutcomeUnknownError,ProviderRequestNotSentError} from '../worker/providerOutcome.js';
import type {NativeAttemptFence} from './nativeAttemptOutput.js';
const transient=new Set(['08000','08001','08003','08006','40001','40P01','57P01','57P02','57P03','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','EBUSY','EMFILE','ENFILE']);
/** Counts are persisted under the logical task, not reset by a browser or new lease. */
export async function prepareProviderDispatch(pool:Pool,fence:NativeAttemptFence,kind:'speech'|'image'){
 const args=[fence.p_task_id,fence.p_attempt,fence.p_lease_token,kind];
 for(;;){
  let decision:{phase:string;route?:'confirmed'|'legacy';reason?:string};
  try{decision=(await pool.query('SELECT local_identity.prepare_provider_dispatch($1,$2,$3,$4) decision',args)).rows[0]?.decision;}
  catch(error){
   const code=(error as {code?:string}).code;
   if(code&&transient.has(code)){
    let allowed=false;
    try{allowed=(await pool.query('SELECT local_identity.allow_provider_preparation_recovery($1,$2,$3,$4) allowed',args)).rows[0]?.allowed===true;}catch{/* Unconfirmed recovery count cannot authorize a retry. */}
    if(allowed)continue;
   }
   throw new ProviderRequestNotSentError(code&&transient.has(code)?'temporary_failure':'input_changed');
  }
  if(decision?.phase==='unknown')throw new ProviderOutcomeUnknownError(undefined,'原请求仍需核对');
  if(decision?.phase!=='reserved'||!['confirmed','legacy'].includes(decision.route??''))throw new ProviderRequestNotSentError(decision?.reason==='input_or_prior_request'?'prior_request':'input_changed');
  return decision.route!;
 }
}
/** A failed/ambiguous write here must not be retried or interpreted as not sent. */
export async function markProviderDispatching(pool:Pool,fence:NativeAttemptFence){
 try{if((await pool.query('SELECT local_identity.mark_provider_dispatching($1,$2,$3) started',[fence.p_task_id,fence.p_attempt,fence.p_lease_token])).rows[0]?.started!==true)throw new ProviderRequestNotSentError('input_changed');}
 catch(error){if(error instanceof ProviderRequestNotSentError)throw error;throw new ProviderOutcomeUnknownError(undefined,'发送阶段未能确认');}
}

/** Local transient IO shares the same persisted recovery budget as reservation. */
export async function recoverProviderPreparation<T>(pool:Pool,fence:NativeAttemptFence,kind:'speech'|'image',operation:()=>Promise<T>):Promise<T>{
 for(;;)try{return await operation();}catch(error){
  const code=(error as {code?:string}).code;
  if(!code||!transient.has(code))throw error;
  let allowed=false;
  try{allowed=(await pool.query('SELECT local_identity.allow_provider_preparation_recovery($1,$2,$3,$4) allowed',[fence.p_task_id,fence.p_attempt,fence.p_lease_token,kind])).rows[0]?.allowed===true;}catch{}
  if(!allowed)throw new ProviderRequestNotSentError('temporary_failure');
 }
}
