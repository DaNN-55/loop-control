import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {ProviderOutcomeUnknownError,ProviderRequestNotSentError} from '../worker/providerOutcome.js';
import {productionMetricsEnabled} from './productionQuality.js';
import {resolveWorkspaceMainVoice} from '../workspaceAudio.js';
import type {NativeAttemptFence} from './nativeAttemptOutput.js';

/** Only machine facts cross this boundary. The SQL boundary validates scope and keys. */
export async function recordOwnedProductionMetric(c:PoolClient,episodeId:string,type:string,key:string,payload:Record<string,unknown>){
 if(!await productionMetricsEnabled(c))return;
 await c.query('SELECT local_identity.record_owned_production_metric($1,$2,$3,$4)',[episodeId,type,key,JSON.stringify(payload)]);
}

/** An observed HTTP response must not be lost by turning a persistence error into a retry. */
export async function recordWorkerProductionMetric(pool:Pool,fence:NativeAttemptFence,type:string,key:string,payload:Record<string,unknown>){
 try{
  if(!(await pool.query("SELECT to_regprocedure('local_identity.record_worker_production_metric(uuid,integer,uuid,text,text,jsonb)') IS NOT NULL present")).rows[0]?.present)return false;
  return (await pool.query('SELECT local_identity.record_worker_production_metric($1,$2,$3,$4,$5,$6) recorded',[fence.p_task_id,fence.p_attempt,fence.p_lease_token,type,key,JSON.stringify(payload)])).rows[0]?.recorded===true;
 }catch{throw new ProviderOutcomeUnknownError(undefined,'请求统计回执未能保存，请恢复或核对原请求');}
}

/** A marker records the local boundary only. One invocation never resends its transport. */
export async function observeProductionRequest(pool:Pool,fence:NativeAttemptFence,operation:'create'|'poll'|'download',transport:()=>Promise<Response>){
 const requestKey=randomUUID(),payload={operation,request_key:requestKey};
 let recorded:boolean;
 try{recorded=await recordWorkerProductionMetric(pool,fence,'provider_request_dispatch',requestKey,payload);}
 catch{throw new ProviderRequestNotSentError('temporary_failure');}
 if(!recorded)return transport();
 let response:Response;
 try{response=await transport();}catch(error){
  if(!(error instanceof ProviderRequestNotSentError))try{await recordWorkerProductionMetric(pool,fence,'provider_outcome_unknown',requestKey,payload);}catch{/* The existing result/recovery classification remains authoritative. */}
  throw error;
 }
 await recordWorkerProductionMetric(pool,fence,'provider_response_observed',requestKey,{...payload,http_status:response.status});
 return response;
}

export function metricRequestKey(taskId:string,attempt:number,operation:string,sequence:number){return createHash('sha256').update(`${taskId}:${attempt}:${operation}:${sequence}`).digest('hex');}

type ProjectItem=OpenChatCutProject['timelines'][number]['items'][number];
const candidateIdentity=(item:ProjectItem)=>{
 const id=typeof item.sourceAssetId==='string'?item.sourceAssetId.match(/^(candidate-|audio-track-)([0-9a-f-]{36})$/i):null;
 return id&&typeof item.sourceContentHash==='string'?{id:id[2],audio:id[1]==='audio-track-',sha:item.sourceContentHash}:null;
};
/** Called only after the authoritative project revision is persisted in the same transaction. */
export async function recordProjectCandidateChanges(c:PoolClient,row:{id:string;episode_id:string;revision:number|string;project_sha256:string;bindings:Array<{shotId:string}>},before:OpenChatCutProject,after:OpenChatCutProject,beforeBindings:ReadonlyArray<{shotId:string}>){
 if(!await productionMetricsEnabled(c))return;
 const used=(project:OpenChatCutProject,bindings:typeof beforeBindings)=>{
  const voices=new Set(bindings.map(b=>resolveWorkspaceMainVoice(project,b.shotId).item));
  return project.timelines.flatMap(t=>t.items).filter(item=>!candidateIdentity(item)?.audio||voices.has(item));
 };
 const previous=used(before,beforeBindings),next=used(after,row.bindings);
 for(const [items,other,type]of [[previous,next,'candidate_withdrawn'],[next,previous,'candidate_adopted']]as const){
  for(const item of items){
   const identity=candidateIdentity(item);if(!identity)continue;
   const same=other.find(v=>v.id===item.id),otherIdentity=same&&candidateIdentity(same);
   if(otherIdentity?.id===identity.id&&otherIdentity.sha===identity.sha)continue;
   const source=identity.audio?(await c.query('SELECT source_task_id task_id FROM public.audio_tracks WHERE id=$1 AND episode_id=$2 AND sha256=$3',[identity.id,row.episode_id,identity.sha])).rows[0]
    :(await c.query(`SELECT v.task_id FROM local_identity.workspace_visual_candidates v LEFT JOIN public.paid_generation_reservations r ON r.task_id=v.task_id LEFT JOIN public.production_material_revisions m ON m.id=coalesce(v.material_revision_id,r.material_revision_id) LEFT JOIN public.artifacts a ON a.id=v.source_artifact_id WHERE v.id=$1 AND v.workspace_id=$2 AND v.episode_id=$3 AND coalesce(m.sha256,a.sha256)=$4`,[identity.id,row.id,row.episode_id,identity.sha])).rows[0];
   if(!source)continue; // A retained extension alone is not a verified candidate use.
   const target=String(item.id),key=metricRequestKey(row.id,Number(row.revision),identity.id+':'+target,0);
   await c.query('SELECT local_identity.record_owned_production_metric($1,$2,$3,$4)',[row.episode_id,type,key,JSON.stringify({workspace_id:row.id,candidate_id:identity.id,...(source.task_id?{source_task_id:source.task_id}:{}),target_id:target,project_revision:Number(row.revision),project_sha256:row.project_sha256,change_reason:type==='candidate_adopted'?'native_project_save':same?'source_replaced':'explicit_withdrawal'})]);
  }
 }
}
