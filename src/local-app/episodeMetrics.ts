import type {PoolClient} from 'pg';
import type {EpisodeMetrics} from '../episodes/episodeCatalogTypes.js';
import {estimateWorkspaceCall} from './workspaceCallEstimate.js';

// The Worker protocol's zero cost is also used when a Provider supplies no bill.
// Keep those unknowns separate from free local work and from Owner reservations.
interface MetricTask {
 id:string;episode_id:string;task_type:string;provider:string;model:string;status:string;
 actual_cost_cents:number|null;claimed_at:string|null;completed_at:string|null;
 input_snapshot:Record<string,any>;last_result:Record<string,any>|null;
 runs:Array<{started_at:string;completed_at:string|null;status:string;actual_cost_cents:number}>;
 request:Record<string,any>|null;estimate:{estimatedCents:number}|null;reserved_cents:number|null;
 request_region?:'cn'|'international'|null;
}
const generationKinds:Record<string,'image'|'video'|'narration'|'sound'>={generate_static_visual:'image',generate_a_roll:'video',generate_b_roll:'video',generate_narration:'narration',generate_sound_effect:'sound',generate_music:'sound',generate_soundtrack:'sound'};
function estimateTask(task:MetricTask):{cents:number;recalculated:boolean}|null {
 if(task.estimate&&Number.isSafeInteger(task.estimate.estimatedCents)&&task.estimate.estimatedCents>=0)return {cents:task.estimate.estimatedCents,recalculated:false};
 const request=task.request,input=task.input_snapshot,kind=generationKinds[task.task_type];
 // Older calls have frozen inputs but no frozen tariff. Recalculate only when
 // sufficient inputs exist, and expose that these are today's estimates.
 if(!request||!kind)return null;
 try{
  const text=request.actualPrompt??request.prompt??request.context?.text??'';
  if(kind==='image'&&!request.imageSettings)return null;
  if(kind==='video'&&!(request.providerDurationSeconds>0))return null;
  if(kind==='narration'&&!text)return null;
  const provider=request.selection?.provider??task.provider,region=task.request_region??request.connection?.region??input.production_selection?.region;
  if(provider==='minimax'&&!['cn','international'].includes(region))return null;
  const estimate=estimateWorkspaceCall({kind:kind==='narration'?'speech':kind,provider,model:request.selection?.model??task.model,text,settings:request.imageSettings,seconds:request.providerDurationSeconds,videoSettings:request.videoSettings,region});
  // Old image requests did not persist measured reference dimensions. Do not
  // present a reference-free recalculation as the complete request estimate.
  if(kind==='image'&&(request.references?.length||request.referenceMaterialRevisionIds?.length))return null;
  return {cents:estimate.estimatedCents,recalculated:true};
 }catch{return null;}
}
export function summarizeEpisodeMetrics(tasks:MetricTask[]):Record<string,EpisodeMetrics>{
 const result:Record<string,EpisodeMetrics>={};
 for(const task of tasks){
  const summary=result[task.episode_id]??={cost:{actualCents:null,estimatedCents:null,reservedCents:0,unpricedCount:0,recalculated:false},stageStartedAt:{},finishedAt:null,generations:{image:0,video:0,narration:0,sound:0,failed:0}};
  const runs=task.runs.length?task.runs:task.claimed_at?[{started_at:task.claimed_at,completed_at:task.completed_at,status:task.status,actual_cost_cents:task.actual_cost_cents??0}]:[];
  const kind=generationKinds[task.task_type];
  const local=['manual_upload','local','controlled',''].includes(task.provider)||task.input_snapshot.capability==='narration_manual_upload';
  if(!kind||local)continue;
  // Count execution attempts, including failed and superseded candidates. A
  // queued task is not an attempt; polling and reopening never increase counts.
  const attempts=runs.length;
  summary.generations[kind]+=attempts;
  summary.generations.failed+=runs.filter(run=>run.status==='failed').length;
  if(!attempts)continue;
  summary.cost.reservedCents+=task.reserved_cents??0;
  const actual=runs.reduce((sum,run)=>sum+run.actual_cost_cents,0);
  if(actual>0){summary.cost.actualCents=(summary.cost.actualCents??0)+actual;}
  const unknownAttempts=runs.filter(run=>run.actual_cost_cents===0).length;
  if(unknownAttempts){
   const estimate=estimateTask(task);
   if(estimate){summary.cost.estimatedCents=(summary.cost.estimatedCents??0)+estimate.cents*unknownAttempts;summary.cost.recalculated||=estimate.recalculated;}
   else summary.cost.unpricedCount+=unknownAttempts;
  }
 }
 return result;
}
export async function readEpisodeMetrics(c:PoolClient,ownerId:string,episodeIds?:string[]):Promise<Record<string,EpisodeMetrics>>{
 const {rows}=await c.query<MetricTask>(`
 SELECT t.id,t.episode_id,t.task_type,t.provider,t.model,t.status,t.actual_cost_cents,t.claimed_at,t.completed_at,t.input_snapshot,t.last_result,
 coalesce(r.runs,'[]') runs,coalesce(v.request_snapshot,n.request_snapshot) request,
 confirmation.summary->'estimate' estimate,reservation.reserved_cents,
 (SELECT intent.metadata->>'region' FROM local_identity.connection_intents intent
  WHERE intent.version_id::text=coalesce(v.request_snapshot#>>'{selection,connectionVersionId}',n.request_snapshot#>>'{selection,connectionVersionId}',t.input_snapshot#>>'{production_selection,connectionVersionId}')
   AND intent.owner_id=$1 AND intent.applied_at IS NOT NULL AND intent.metadata->>'region' IN ('cn','international') ORDER BY intent.created_at DESC LIMIT 1) request_region
 FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id
 LEFT JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('started_at',r.started_at,'completed_at',r.completed_at,'status',r.status,'actual_cost_cents',r.actual_cost_cents) ORDER BY r.attempt) runs FROM public.task_runs r WHERE r.task_id=t.id) r ON true
 LEFT JOIN local_identity.workspace_visual_candidates v ON v.task_id=t.id
 LEFT JOIN local_identity.workspace_narration_requests n ON n.task_id=t.id
 LEFT JOIN local_identity.workspace_call_confirmations confirmation ON confirmation.authorization_hash=coalesce(v.request_snapshot->>'authorizationHash',n.authorization_hash) AND confirmation.consumed_at IS NOT NULL
 LEFT JOIN public.paid_generation_reservations reservation ON reservation.task_id=t.id
 WHERE EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=e.account_id AND m.user_id=$1 AND m.role='owner') AND ($2::uuid[] IS NULL OR e.id=ANY($2::uuid[]))`,[ownerId,episodeIds??null]);
 const metrics=summarizeEpisodeMetrics(rows);
 const stages=await c.query(`SELECT e.id,
 jsonb_strip_nulls(jsonb_build_object(
 'script',coalesce((SELECT max(s.created_at) FROM public.state_transitions s WHERE s.episode_id=e.id AND s.to_stage IN ('waiting_input','brief_draft','script_draft','script_review')),e.created_at),
 'preparation',coalesce((SELECT max(s.created_at) FROM public.state_transitions s WHERE s.episode_id=e.id AND s.to_stage='script_approved'),w.created_at),
 'editing',(SELECT min(v.created_at) FROM local_identity.production_workspace_versions v WHERE v.workspace_id=w.id AND v.script_revision_id=w.script_revision_id AND v.reason IN ('保存原生剪辑','恢复原生剪辑','修改镜头结构')),
 'delivery',(SELECT min(x.created_at) FROM local_identity.workspace_exports x WHERE x.workspace_id=w.id AND x.project_content_version=w.revision AND x.content_sha256=w.content_sha256)
 )) starts,
 CASE WHEN e.stage='production_completed' THEN coalesce((SELECT max(s.created_at) FROM public.state_transitions s WHERE s.episode_id=e.id AND s.to_stage='production_completed'),e.updated_at) ELSE e.archived_at END finished_at
 FROM public.episodes e LEFT JOIN local_identity.production_workspaces w ON w.episode_id=e.id
 WHERE EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=e.account_id AND m.user_id=$1 AND m.role='owner') AND ($2::uuid[] IS NULL OR e.id=ANY($2::uuid[]))`,[ownerId,episodeIds??null]);
 for(const row of stages.rows){
  const summary=metrics[row.id]??={cost:{actualCents:null,estimatedCents:null,reservedCents:0,unpricedCount:0,recalculated:false},stageStartedAt:{},finishedAt:null,generations:{image:0,video:0,narration:0,sound:0,failed:0}};
  summary.stageStartedAt=row.starts;summary.finishedAt=row.finished_at?new Date(row.finished_at).toISOString():null;
 }
 return metrics;
}
