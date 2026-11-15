import {summarizeProductionWorkflow} from './productionWorkflowMetrics.js';
import {summarizeSoundUse} from './productionSoundUse.js';
import type {Pool} from 'pg';
import {ownerTransaction} from './ownerTransaction.js';
import {readProductionMetricsSnapshot,productionMetricsWindow,type MetricsWindow} from './productionMetrics.js';

interface Event {episodeId:string;type:string;at:string|Date;tier:string;payload:Record<string,unknown>}
interface Resource {at:string|Date;cpu:number|null;used:number|null;total:number|null;queued:number;running:number;waiting:number;gap:number;localExports?:number|null}
interface Daily {day:string;type:string;tier:string;currency:string;count:number;amount:number}
interface ResourceDaily {day:string;samples:number;cpuSamples:number;cpuSum:number;cpuMax:number|null;memorySamples:number;memoryUsedPeak:number|null;queuePeak:number;runningPeak:number;resourceWaitPeak:number;gapSeconds:number}
export interface CollectedFacts {
 observedAt:string|Date;enabled:boolean;coverage:Array<{from:string|Date;to:string|Date|null}>;
 events:Event[];resources:Resource[];daily:Daily[];resourceDaily?:ResourceDaily[];
}
const epoch=(value:string|Date)=>value instanceof Date?value.getTime():Date.parse(value);
const count=(rows:Event[],type:string)=>rows.filter(e=>e.type===type).length;
const numbers=(rows:Event[],key:string)=>rows.map(e=>e.payload[key]).filter((n):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0);
const stats=(values:number[])=>({known:values.length,mean:values.length?values.reduce((s,n)=>s+n,0)/values.length:null,p95:values.length?[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]:null});

/** Detail-derived measures are labelled separately from anonymous retained daily totals. */
export function summarizeCollectedProductionMetrics(facts:CollectedFacts,input:MetricsWindow){
 const window=productionMetricsWindow(input),end=Math.min(window.to,epoch(facts.observedAt));
 if(!Number.isFinite(end)||end<=window.from)throw Error('统计窗口尚未开始');
 const events=facts.events.filter(e=>epoch(e.at)>=window.from&&epoch(e.at)<end),real=events.filter(e=>e.type!=='coverage_observation');
 const claims=real.filter(e=>e.type==='task_claimed'&&e.payload.observed_only===false);
 const estimates=real.filter(e=>e.type==='estimate_frozen'),knownEstimates=estimates.filter(e=>e.payload.estimate_known===true&&typeof e.payload.estimated_cents==='number');
 const byCurrency:Record<string,{known:number;cents:number}>={};
 for(const e of knownEstimates){const c=String(e.payload.currency);const current=byCurrency[c]??={known:0,cents:0};current.known++;current.cents+=Number(e.payload.estimated_cents);}
 const retryReasons:Record<string,number>={};for(const e of real.filter(e=>e.type==='retry_relation')){const reason=String(e.payload.reason_code??'not_recorded');retryReasons[reason]=(retryReasons[reason]??0)+1;}
 const requests=real.filter(e=>e.type==='provider_request_dispatch');
 const operations:Record<string,{dispatchMarked:number;responseObserved:number;outcomeUnknown:number}>={};
 for(const e of real.filter(e=>['provider_request_dispatch','provider_response_observed','provider_outcome_unknown'].includes(e.type))){const key=String(e.payload.operation);const row=operations[key]??={dispatchMarked:0,responseObserved:0,outcomeUnknown:0};row[e.type==='provider_request_dispatch'?'dispatchMarked':e.type==='provider_response_observed'?'responseObserved':'outcomeUnknown']++;}
 const stageSeconds:Record<string,number>={};
 const anchors=facts.events.filter(e=>['stage_changed','episode_created','coverage_observation'].includes(e.type)).sort((a,b)=>epoch(a.at)-epoch(b.at));
 const nextByEpisode=new Map<string,Event>();
 for(let i=anchors.length-1;i>=0;i--){
  const e=anchors[i],next=nextByEpisode.get(e.episodeId);nextByEpisode.set(e.episodeId,e);
  const stage=e.payload.to_stage??e.payload.stage;if(typeof stage!=='string')continue;
  // A stopped coverage period ends observation; a later period cannot fill its gap.
  const period=facts.coverage.find(p=>epoch(p.from)<=epoch(e.at)&&(p.to===null||epoch(p.to)>epoch(e.at)));
  if(!period)continue;
  const to=Math.min(end,next?epoch(next.at):end,period.to===null?end:epoch(period.to));
  const seconds=Math.max(0,to-Math.max(window.from,epoch(e.at)))/1000;stageSeconds[stage]=(stageSeconds[stage]??0)+seconds;
 }
 const resources=facts.resources.filter(r=>epoch(r.at)>=window.from&&epoch(r.at)<end);
 const cpu=resources.map(r=>r.cpu).filter((n):n is number=>typeof n==='number'&&Number.isFinite(n));
 const resourcesObserved=resources.length>0,memory=resources.map(r=>r.used).filter((n):n is number=>typeof n==='number'&&Number.isFinite(n));
 const exportMarkers=real.filter(e=>e.type.startsWith('local_export_')),exports=exportMarkers.filter(e=>e.payload.version==='local-export/v1'),exportFinishes=exports.filter(e=>e.type==='local_export_finished');
 const typeCounts:Record<string,number>={};for(const e of real)typeCounts[e.type]=(typeCounts[e.type]??0)+1;
 return{
  enabled:facts.enabled,coverage:{periods:facts.coverage,detailRetentionMonths:12,resourceRetentionDays:30,dailyRetentionMonths:24,observations:count(events,'coverage_observation'),historyBackfilled:false},
  detail:{counts:typeCounts,workflow:summarizeProductionWorkflow(facts.events,facts.coverage,window.from,end),soundUse:summarizeSoundUse(real),localExports:{version:'local-export/v1' as const,started:count(exports,'local_export_started'),finished:exportFinishes.length,ready:exportFinishes.filter(e=>e.payload.outcome==='ready').length,failed:exportFinishes.filter(e=>e.payload.outcome==='failed').length,rejected:count(exports,'local_export_rejected'),durationSeconds:stats(numbers(exportFinishes.filter(e=>e.payload.start_observed===true),'duration_seconds')),durationCohort:'finishes_in_window',unknownDurationFinishes:exportFinishes.filter(e=>e.payload.start_observed!==true||typeof e.payload.duration_seconds!=='number').length,unknownMarkers:exportMarkers.length-exports.length},stageResidenceSeconds:stageSeconds,stageResidenceIncludesOwnerWait:true,
   queue:{eligibleWaitSeconds:stats(numbers(claims,'eligible_wait_seconds')),backoffSeconds:stats(numbers(claims,'backoff_seconds')),observedOrMissingCycles:count(real,'task_claimed')-claims.length,waitReason:'eligible_wait_includes_capacity_and_scheduler_wait'},
   candidates:{adopted:count(real,'candidate_adopted'),withdrawn:count(real,'candidate_withdrawn'),rejected:count(real,'candidate_rejected'),explicitRetryRelations:count(real,'retry_relation'),retryReasons,automaticReworkClassification:false},
   requests:{dispatchMarked:requests.length,operations,dispatchDoesNotProveSupplierReceipt:true,artifactReceipts:count(real,'provider_receipt_persisted')},
   money:{frozenEstimates:estimates.length,knownEstimatedByCurrency:byCurrency,unknownEstimates:estimates.length-knownEstimates.length,supplierPaid:null,reservationIsNotPayment:true}},
  resources:{samples:resources.length,maximumLocalExports:resources.some(r=>r.localExports!=null)?Math.max(...resources.filter(r=>r.localExports!=null).map(r=>r.localExports!)):null,localExportCountKnownSamples:resources.filter(r=>r.localExports!=null).length,localExportAttribution:'current_application_instance',cpuPercent:stats(cpu),gpuPercent:null,maximumMemoryUsedBytes:memory.length?Math.max(...memory):null,maximumQueue:resourcesObserved?Math.max(...resources.map(r=>r.queued)):null,maximumRunning:resourcesObserved?Math.max(...resources.map(r=>r.running)):null,maximumResourceWait:resourcesObserved?Math.max(...resources.map(r=>r.waiting)):null,recordedGapSeconds:resources.reduce((s,r)=>s+r.gap,0),idleSamplesExpected:false,attribution:'host_observation_not_per_task'},
  anonymousDaily:facts.daily,
  anonymousResourceDaily:(facts.resourceDaily??[]).map(r=>({...r,cpuMean:r.cpuSamples?r.cpuSum/r.cpuSamples:null})),
  limits:['停用、启用前及过期明细不提供精确分位数或完整对象历史。','匿名日汇总保留已永久删除生产单的计数，不与保留对象的 A/B 指标相加。','请求标记不能证明实际发送，HTTP 响应不能证明收费或有效产物。','本机资源样本不能代表单任务用量；进程重启缺口需结合样本时间判断。'],
 };
}

/** A/B and C use one Owner-scoped repeatable read snapshot; no route or Dashboard is installed. */
export async function readProductionMetricsV2(pool:Pool,ownerId:string,input:MetricsWindow){
 const window=productionMetricsWindow(input);
 return ownerTransaction(pool,ownerId,true,async c=>{
  const retained=await readProductionMetricsSnapshot(c,ownerId,input);
  if(!(await c.query("SELECT to_regclass('local_identity.production_metric_controls') IS NOT NULL present")).rows[0]?.present)return{schemaVersion:'production-metrics/v2',retained,collected:null};
  const args=[ownerId,new Date(window.from),new Date(Math.min(window.to,epoch(retained.observedAt))),input.includeTestEpisodes===true];
  const query=async<T>(sql:string):Promise<T[]>=>{const rows=(await c.query(sql,args)).rows;if(rows.length>100000)throw Error('统计事实超过 100000 行上限，请缩短日期范围');return rows as T[];};
  const controls=(await c.query('SELECT enabled FROM local_identity.production_metric_controls WHERE owner_id=$1',[ownerId])).rows[0];
  const coverage=await query<{from:string|Date;to:string|Date|null}>(`SELECT started_at "from",ended_at "to" FROM local_identity.production_metric_coverage_periods WHERE owner_id=$1 AND started_at<$3 AND (ended_at IS NULL OR ended_at>$2) AND $4::boolean IS NOT NULL ORDER BY started_at LIMIT 100001`);
  const events=await query<Event>(`WITH scoped AS(SELECT v.* FROM local_identity.production_metric_events v JOIN public.episodes e ON e.id=v.episode_id WHERE v.owner_id=$1 AND ($4 OR NOT e.is_test) AND EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=e.account_id AND m.user_id=$1 AND m.role='owner')), anchors AS(SELECT DISTINCT ON(episode_id) * FROM scoped WHERE occurred_at<$2 AND event_type IN ('stage_changed','episode_created','coverage_observation') ORDER BY episode_id,occurred_at DESC,id DESC), workflow_anchors AS(SELECT DISTINCT ON(episode_id) * FROM scoped WHERE occurred_at<$2 AND event_type IN ('workflow_milestone','delivery_completed') ORDER BY episode_id,occurred_at DESC,id DESC) SELECT episode_id "episodeId",event_type type,occurred_at at,quality_tier tier,payload FROM(SELECT * FROM scoped WHERE occurred_at >=$2 AND occurred_at<$3 UNION ALL SELECT * FROM anchors UNION ALL SELECT * FROM workflow_anchors)s ORDER BY occurred_at,id LIMIT 100001`);
  const exportResources=(await c.query("SELECT to_regclass('local_identity.production_metric_export_resources') IS NOT NULL present")).rows[0]?.present;
  const resources=await query<Resource>(`SELECT r.sampled_at at,cpu_percent::float8 cpu,memory_used_bytes::float8 used,memory_total_bytes::float8 total,queue_count queued,running_count running,resource_wait_count waiting,gap_seconds::float8 gap,${exportResources?'x.active_exports':'NULL::integer'} AS "localExports" FROM local_identity.production_metric_resources r ${exportResources?'LEFT JOIN local_identity.production_metric_export_resources x USING(owner_id,sampled_at)':''} WHERE r.owner_id=$1 AND r.sampled_at >=$2 AND r.sampled_at<$3 AND $4::boolean IS NOT NULL ORDER BY r.sampled_at LIMIT 100001`);
  const daily=await query<Daily>(`SELECT day::text AS "day",event_type type,quality_tier tier,currency,sum(count)::float8 count,sum(amount_cents)::float8 amount FROM local_identity.production_metric_daily WHERE owner_id=$1 AND day>=($2::timestamptz AT TIME ZONE 'Asia/Shanghai')::date AND day<($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::date+CASE WHEN ($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::time>'00:00:00' THEN 1 ELSE 0 END AND ($4 OR NOT is_test) GROUP BY day,event_type,quality_tier,currency ORDER BY day,event_type,quality_tier,currency LIMIT 100001`);
  const resourceDaily=await query<ResourceDaily>(`SELECT day::text AS "day",samples::float8 samples,cpu_samples::float8 "cpuSamples",cpu_sum::float8 "cpuSum",cpu_max::float8 "cpuMax",memory_samples::float8 "memorySamples",memory_used_peak::float8 "memoryUsedPeak",queue_peak "queuePeak",running_peak "runningPeak",resource_wait_peak "resourceWaitPeak",gap_seconds::float8 "gapSeconds" FROM local_identity.production_metric_resource_daily WHERE owner_id=$1 AND day>=($2::timestamptz AT TIME ZONE 'Asia/Shanghai')::date AND day<($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::date+CASE WHEN ($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::time>'00:00:00' THEN 1 ELSE 0 END AND $4::boolean IS NOT NULL ORDER BY day LIMIT 100001`);
  return{schemaVersion:'production-metrics/v2',retained,collected:summarizeCollectedProductionMetrics({observedAt:retained.observedAt,enabled:controls?.enabled===true,coverage,events,resources,daily,resourceDaily},input)};
 });
}
