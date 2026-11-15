import type {Pool,PoolClient} from 'pg';
import {ownerTransaction} from './ownerTransaction.js';

/** Retained-fact read model. C adds a separately labelled collected-fact extension. */
export interface MetricsWindow {from:string;toExclusive:string;includeTestEpisodes?:boolean}
type Time=string|Date;
interface EpisodeFact {id:string;createdAt:Time}
interface TaskFact {id:string;createdAt:Time;status:string;generation:boolean;retryLinked:boolean}
interface RunFact {
 taskId:string;attempt:number;accountId:string;taskType:string;provider:string;model:string;
 startedAt:Time;completedAt:Time|null;status:string;active:boolean;generation:boolean;mayHaveExternalCost:boolean;reportedCostCents:number;
}
interface ReservationFact {taskId:string;createdAt:Time;reservedCents:number;requestState:string;dispatchPhase:string|null;submissionOutcome:string|null}
interface DeliveryFact {episodeId:string;firstCompletedAt:Time;completedJobsInPeriod:number}
interface DecisionFact {workspaceId:string;candidateId:string;createdAt:Time;decision:string}
export interface ProductionMetricFacts {
 observedAt:Time;episodes:EpisodeFact[];tasks:TaskFact[];runs:RunFact[];
 reservations:ReservationFact[];deliveries:DeliveryFact[];decisions:DecisionFact[];
}
const generationTypes=['generate_static_visual','generate_shot_video','generate_a_roll','generate_b_roll','generate_narration','generate_sound_effect','generate_music','generate_soundtrack'];
const time=(value:Time)=>value instanceof Date?value.getTime():Date.parse(value);
const day=(value:number)=>new Date(value+8*3600_000).toISOString().slice(0,10);
export function productionMetricsWindow(input:MetricsWindow){
 const parse=(value:string)=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('统计日期必须为 YYYY-MM-DD');const n=Date.parse(value+'T00:00:00+08:00');if(!Number.isFinite(n)||day(n)!==value)throw Error('统计日期无效');return n;};
 const from=parse(input.from),to=parse(input.toExclusive);
 if(to<=from||to-from>366*86400_000)throw Error('统计窗口须为 1 至 366 天，结束日期不包含在内');
 if(input.includeTestEpisodes!==undefined&&typeof input.includeTestEpisodes!=='boolean')throw Error('测试生产单选项无效');
 return{from,to};
}
const increment=(counts:Record<string,number>,key:string)=>{counts[key]=(counts[key]??0)+1;};
const percentile=(values:number[],p:number)=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]:null;
function unionSeconds(intervals:Array<[number,number]>){let total=0,end=-Infinity;for(const [a,b]of [...intervals].sort((x,y)=>x[0]-y[0])){total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}return total/1000;}

export function summarizeProductionMetrics(facts:ProductionMetricFacts,input:MetricsWindow){
 const window=productionMetricsWindow(input),observed=time(facts.observedAt);
 if(!Number.isFinite(observed))throw Error('统计观察时间无效');
 if(window.from>=observed)throw Error('统计窗口尚未开始');
 const end=Math.min(window.to,observed),inPeriod=(value:Time|null)=>value!==null&&time(value)>=window.from&&time(value)<end;
 const days:Record<string,{episodesCreated:number;firstDeliveries:number;attemptsStarted:number;attemptsCompleted:number}>={};
 for(let t=window.from;t<end;t+=86400_000)days[day(t)]={episodesCreated:0,firstDeliveries:0,attemptsStarted:0,attemptsCompleted:0};
 const created=facts.episodes.filter(e=>inPeriod(e.createdAt)),tasks=facts.tasks.filter(t=>inPeriod(t.createdAt));
 for(const e of created)days[day(time(e.createdAt))].episodesCreated++;
 const statuses:Record<string,number>={},outcomes:Record<string,number>={},requestStates:Record<string,number>={},dispatchPhases:Record<string,number>={},submissionOutcomes:Record<string,number>={};
 for(const t of tasks)increment(statuses,t.status);
 const intervals:Array<[number,number]>=[],durations:number[]=[],services=new Map<string,{accountId:string;taskType:string;provider:string;model:string;attemptsStarted:number;generationAttemptsStarted:number;attemptsCompleted:number;failedAttemptsCompleted:number}>();
 let started=0,finished=0,generationStarted=0,positiveCost=0,unknownExternalCost=0,invalidIntervals=0,unfinishedIntervals=0,slotSeconds=0;
 for(const r of facts.runs){
  const starts=inPeriod(r.startedAt),finishes=inPeriod(r.completedAt),start=time(r.startedAt),finish=r.completedAt===null?null:time(r.completedAt);
  if(starts||finishes){const key=JSON.stringify([r.accountId,r.taskType,r.provider,r.model]);let group=services.get(key);if(!group){group={accountId:r.accountId,taskType:r.taskType,provider:r.provider,model:r.model,attemptsStarted:0,generationAttemptsStarted:0,attemptsCompleted:0,failedAttemptsCompleted:0};services.set(key,group);}
   if(starts){started++;group.attemptsStarted++;if(r.generation){generationStarted++;group.generationAttemptsStarted++;}days[day(start)].attemptsStarted++;
    if(r.reportedCostCents>0)positiveCost+=r.reportedCostCents;
    if(r.mayHaveExternalCost&&r.reportedCostCents===0)unknownExternalCost++;
   }
   if(finishes){finished++;group.attemptsCompleted++;if(r.status==='failed')group.failedAttemptsCompleted++;increment(outcomes,r.status);days[day(finish!)].attemptsCompleted++;
    if(Number.isFinite(start)&&Number.isFinite(finish)&&finish!>=start)durations.push((finish!-start)/1000);
   }
  }
  if(!Number.isFinite(start)||finish!==null&&(!Number.isFinite(finish)||finish<start)){invalidIntervals++;continue;}
  if(finish===null&&!r.active){unfinishedIntervals++;continue;}
  const a=Math.max(window.from,start),b=Math.min(end,finish??end);
  if(b>a){intervals.push([a,b]);slotSeconds+=(b-a)/1000;}
 }
 const firstDeliveries=facts.deliveries.filter(d=>inPeriod(d.firstCompletedAt));for(const d of firstDeliveries)days[day(time(d.firstCompletedAt))].firstDeliveries++;
 const reservations=facts.reservations.filter(r=>inPeriod(r.createdAt));for(const r of reservations){increment(requestStates,r.requestState);increment(dispatchPhases,r.dispatchPhase??'not_recorded');increment(submissionOutcomes,r.submissionOutcome??'not_recorded');}
 const decisions=facts.decisions.filter(d=>inPeriod(d.createdAt)),decisionCounts:Record<string,number>={};for(const d of decisions)increment(decisionCounts,d.decision);
 const knownOutcomes=(outcomes.completed??0)+(outcomes.failed??0);
 return{
  schemaVersion:'production-metrics/v1',observedAt:new Date(observed).toISOString(),window:{from:input.from,toExclusive:input.toExclusive,timezone:'Asia/Shanghai',complete:window.to<=observed,includeTestEpisodes:input.includeTestEpisodes===true},
  coverage:{basis:'currently_retained_owner_visible_records',historicalMonthEndSnapshot:false,standaloneHistoryIncluded:false,recordedAttemptsOnly:true},
  production:{episodesCreated:created.length,firstDeliveredEpisodes:firstDeliveries.length,completedDeliveryJobs:facts.deliveries.reduce((n,d)=>n+d.completedJobsInPeriod,0)},
  tasks:{created:tasks.length,generationTasksCreated:tasks.filter(t=>t.generation).length,retryLinkedTasksCreated:tasks.filter(t=>t.retryLinked).length,createdCohortCurrentStatuses:statuses},
  attempts:{started,finished,generationAttemptsStarted:generationStarted,finishedOutcomes:outcomes,successRateKnownOutcomes:knownOutcomes?(outcomes.completed??0)/knownOutcomes:null,successRateSample:knownOutcomes,durationSeconds:{sample:durations.length,p50:percentile(durations,.5),p95:percentile(durations,.95)}},
  time:{recordedRunSlotSeconds:slotSeconds,recordedRunUnionSeconds:unionSeconds(intervals),invalidIntervals,unclosedInactiveIntervals:unfinishedIntervals,cpuGpuUsage:null,perAttemptQueueWaitSeconds:null},
  money:{unit:'application_cents',supplierPaidCents:null,reportedPositiveCentsForStartedAttempts:positiveCost|| (unknownExternalCost?null:0),unpricedGenerationAttemptsStarted:unknownExternalCost,reservationsCreated:reservations.length,grossReservedCentsCreated:reservations.reduce((n,r)=>n+r.reservedCents,0),releasedCents:null,estimatedCents:null,requestStatesSnapshot:requestStates,dispatchPhasesSnapshot:dispatchPhases,submissionOutcomesSnapshot:submissionOutcomes},
  candidates:{retainedDecisionRecords:decisions.length,firstRecordedDecisions:decisionCounts,fullAdoptionEventCount:null,reworkCount:null},
  businessQualityTier:null,
  byDay:Object.entries(days).map(([date,value])=>({date,...value})),byService:[...services.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),
  unavailable:['stage_residence_history','per_attempt_queue_wait','supplier_paid_settlement_and_currency','reservation_release_history','complete_adoption_and_rework_history','business_quality_tier','provider_http_request_count','cpu_gpu_utilization','deleted_or_standalone_history','historical_month_end_state','unambiguous_frozen_estimate_aggregation'],
 };
}

// Each fact family is queried separately: retries/candidates cannot fan out money rows.
// All values are parameterized. No prompts, secret references, lease tokens or media paths are selected.
const owned=`WITH owned AS (SELECT e.id,e.account_id,e.created_at FROM public.episodes e
 WHERE ($4::boolean OR NOT e.is_test) AND EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=e.account_id AND m.user_id=$1 AND m.role='owner')) `;
const generation=`t.task_type=ANY($5::text[]) AND coalesce(t.provider,'') NOT IN ('manual_upload','pexels','freesound') AND coalesce(t.input_snapshot->>'capability','')<>'narration_manual_upload'`;
const limited=' LIMIT 100001';
export async function readProductionMetrics(pool:Pool,ownerId:string,input:MetricsWindow){
 return ownerTransaction(pool,ownerId,true,c=>readProductionMetricsSnapshot(c,ownerId,input));
}

/** Shares the caller's Owner read-only snapshot with the C extension. */
export async function readProductionMetricsSnapshot(c:PoolClient,ownerId:string,input:MetricsWindow){
 const window=productionMetricsWindow(input);
  await c.query("SET LOCAL statement_timeout='10s'");
  const scope=(await c.query("SELECT local_identity.owner_id()::text owner,current_setting('transaction_read_only') read_only,transaction_timestamp() observed")).rows[0];
  if(scope.owner!==ownerId||scope.read_only!=='on')throw Error('统计必须使用对应 Owner 的只读事务');
  const end=new Date(Math.min(window.to,time(scope.observed))),args=[ownerId,new Date(window.from),end,input.includeTestEpisodes===true,generationTypes];
  const query=async<T>(sql:string,params:unknown[]=args):Promise<T[]>=>{const rows=(await c.query(sql,params)).rows;if(rows.length>100000)throw Error('统计事实超过单次 100000 行上限，请缩短日期范围');return rows as T[];};
  const episodes=await query<EpisodeFact>(owned+`SELECT e.id,e.created_at "createdAt" FROM owned e WHERE e.created_at >= $2 AND e.created_at < $3`+limited,args.slice(0,4));
  const tasks=await query<TaskFact>(owned+`SELECT t.id,t.created_at "createdAt",t.status,(${generation}) generation,
   (EXISTS(SELECT 1 FROM local_identity.workspace_visual_candidates v WHERE v.task_id=t.id AND v.request_snapshot->>'retryOfTaskId' IS NOT NULL) OR EXISTS(SELECT 1 FROM local_identity.workspace_narration_requests n WHERE n.task_id=t.id AND n.request_snapshot->>'retryOfTaskId' IS NOT NULL)) "retryLinked"
   FROM owned e JOIN public.tasks t ON t.episode_id=e.id
   WHERE t.created_at >= $2 AND t.created_at < $3`+limited);
  const runs=await query<RunFact>(owned+`SELECT t.id "taskId",r.attempt,e.account_id "accountId",t.task_type "taskType",coalesce(t.provider,'') provider,coalesce(t.model,'') model,
   r.started_at "startedAt",r.completed_at "completedAt",r.status,r.actual_cost_cents "reportedCostCents",(${generation}) generation,
   (${generation} AND coalesce(t.provider,'') NOT IN ('local','controlled','manual_upload') AND coalesce(t.input_snapshot->>'capability','')<>'narration_manual_upload') "mayHaveExternalCost",
   (r.status='running' AND t.status='running' AND r.lease_token IS NOT NULL AND r.lease_token=t.lease_token) active
   FROM owned e JOIN public.tasks t ON t.episode_id=e.id JOIN public.task_runs r ON r.task_id=t.id
   WHERE (r.started_at >= $2 AND r.started_at < $3) OR (r.completed_at >= $2 AND r.completed_at < $3) OR (r.started_at < $3 AND (r.completed_at > $2 OR r.completed_at IS NULL))`+limited);
  const reservations=await query<ReservationFact>(owned+`SELECT p.task_id "taskId",p.created_at "createdAt",p.reserved_cents "reservedCents",p.request_state "requestState",
   local_identity.provider_dispatch_observation(t.id)->>'phase' "dispatchPhase",coalesce(n.outcome,v.outcome) "submissionOutcome"
   FROM owned e JOIN public.tasks t ON t.episode_id=e.id JOIN public.paid_generation_reservations p ON p.task_id=t.id
   LEFT JOIN local_identity.workspace_narration_submissions n ON n.task_id=t.id LEFT JOIN local_identity.workspace_visual_submissions v ON v.task_id=t.id
   WHERE p.created_at >= $2 AND p.created_at < $3`+limited,args.slice(0,4));
  const deliveries=await query<DeliveryFact>(owned+`SELECT e.id "episodeId",min(t.completed_at) "firstCompletedAt",count(*) FILTER(WHERE t.completed_at >= $2)::int "completedJobsInPeriod"
   FROM owned e JOIN local_identity.workspace_deliveries d ON d.episode_id=e.id JOIN public.tasks t ON t.id=d.task_id
   WHERE t.task_type='prepare_publish_package' AND t.status='completed' AND t.completed_at < $3
   GROUP BY e.id HAVING max(t.completed_at) >= $2`+limited,args.slice(0,4));
  const decisions=await query<DecisionFact>(owned+`SELECT d.workspace_id "workspaceId",d.candidate_id "candidateId",d.created_at "createdAt",d.decision
   FROM owned e JOIN local_identity.production_workspaces w ON w.episode_id=e.id JOIN local_identity.workspace_candidate_decisions d ON d.workspace_id=w.id
   WHERE d.created_at >= $2 AND d.created_at < $3`+limited,args.slice(0,4));
  return summarizeProductionMetrics({observedAt:scope.observed,episodes,tasks,runs,reservations,deliveries,decisions},input);
}
