import {expect,it} from 'vitest';
import {productionMetricsWindow,summarizeProductionMetrics,type ProductionMetricFacts} from './productionMetrics.js';
const window={from:'2026-11-01',toExclusive:'2026-12-01'};
const run=(taskId:string,attempt:number,start:string,end:string|null,cost=0,status='completed',extra={})=>({taskId,attempt,accountId:'account',taskType:'generate_narration',provider:'volcengine_tts',model:'seed-tts-2.0',startedAt:start,completedAt:end,status,active:false,generation:true,mayHaveExternalCost:true,reportedCostCents:cost,...extra});
function facts():ProductionMetricFacts{return{observedAt:'2026-12-02T00:00:00Z',episodes:[],tasks:[],runs:[],reservations:[],deliveries:[],decisions:[]};}
it('counts retained delivery identities, retries and Shanghai-calendar boundaries without multiplying reservations',()=>{
 const f=facts();f.episodes=[{id:'new',createdAt:'2026-10-31T16:00:00Z'},{id:'old',createdAt:'2026-10-31T15:59:59Z'}];
 f.tasks=[{id:'task',createdAt:'2026-10-31T16:00:00Z',status:'completed',generation:true,retryLinked:false}];
 f.runs=[run('old',0,'2026-10-31T15:59:50Z','2026-10-31T16:00:10Z',3),run('task',0,'2026-10-31T16:00:00Z','2026-10-31T16:00:20Z',7,'failed'),run('task',1,'2026-10-31T16:00:10Z','2026-10-31T16:00:30Z'),run('orphan',0,'2026-10-31T16:01:00Z',null,0,'failed',{generation:false,mayHaveExternalCost:false}),run('live',0,'2026-11-30T15:59:50Z',null,0,'running',{active:true,generation:false,mayHaveExternalCost:false})];
 f.reservations=[{taskId:'task',createdAt:'2026-10-31T16:00:00Z',reservedCents:100,requestState:'submitting',dispatchPhase:'dispatching',submissionOutcome:'started'}];
 f.deliveries=[{episodeId:'old',firstCompletedAt:'2026-10-31T15:59:59Z',completedJobsInPeriod:1},{episodeId:'new',firstCompletedAt:'2026-10-31T16:00:00Z',completedJobsInPeriod:2}];
 f.decisions=[{workspaceId:'w',candidateId:'c',createdAt:'2026-10-31T16:00:00Z',decision:'adopted'}];
 const s=summarizeProductionMetrics(f,window);
 expect(s.production).toEqual({episodesCreated:1,firstDeliveredEpisodes:1,completedDeliveryJobs:3});
 expect(s.tasks.created).toBe(1);expect(s.attempts.started).toBe(4);expect(s.attempts.finished).toBe(3);expect(s.attempts.generationAttemptsStarted).toBe(2);
 expect(s.attempts.successRateKnownOutcomes).toBeCloseTo(2/3);expect(s.attempts.durationSeconds).toEqual({sample:3,p50:20,p95:20});
 expect(s.time).toMatchObject({recordedRunSlotSeconds:60,recordedRunUnionSeconds:40,unclosedInactiveIntervals:1,perAttemptQueueWaitSeconds:null});
 expect(s.money).toMatchObject({grossReservedCentsCreated:100,reservationsCreated:1,reportedPositiveCentsForStartedAttempts:7,unpricedGenerationAttemptsStarted:1,supplierPaidCents:null,releasedCents:null,estimatedCents:null});
 expect(s.byDay[0]).toMatchObject({date:'2026-11-01',episodesCreated:1,firstDeliveries:1,attemptsStarted:3});expect(s.byDay.at(-1)?.date).toBe('2026-11-30');expect(s).not.toHaveProperty('businessQualityTier');
 expect(s.candidates).toMatchObject({retainedDecisionRecords:1,fullAdoptionEventCount:null,reworkCount:null});
});
it('keeps all-zero external costs unknown and omits fallback attempts absent from task_runs',()=>{const f=facts();f.tasks=[{id:'no-run',createdAt:'2026-11-02T00:00:00Z',status:'completed',generation:true,retryLinked:true}];f.runs=[run('unknown',0,'2026-11-02T00:00:00Z','2026-11-02T00:00:10Z')];const s=summarizeProductionMetrics(f,window);expect(s.money.reportedPositiveCentsForStartedAttempts).toBeNull();expect(s.money.unpricedGenerationAttemptsStarted).toBe(1);expect(s.attempts.started).toBe(1);expect(s.tasks.retryLinkedTasksCreated).toBe(1);});
it('clips a current period to one observed snapshot and excludes the end boundary',()=>{const f=facts();f.observedAt='2026-11-01T16:00:00Z';f.episodes=[{id:'future',createdAt:f.observedAt}];f.runs=[run('active',0,'2026-11-01T15:59:50Z',null,0,'running',{active:true})];const s=summarizeProductionMetrics(f,window);expect(s.window.complete).toBe(false);expect(s.production.episodesCreated).toBe(0);expect(s.time.recordedRunSlotSeconds).toBe(10);expect(s.byDay).toHaveLength(1);});
it('reports invalid and abandoned run intervals instead of manufacturing execution time',()=>{const f=facts();f.runs=[run('negative',0,'2026-11-02T00:00:10Z','2026-11-02T00:00:00Z'),run('abandoned',0,'2026-11-02T00:00:00Z',null,0,'failed')];const s=summarizeProductionMetrics(f,window);expect(s.time).toMatchObject({invalidIntervals:1,unclosedInactiveIntervals:1,recordedRunSlotSeconds:0});expect(s.attempts.durationSeconds.sample).toBe(0);});
it.each([{from:'2026-02-30',toExclusive:'2026-03-02'},{from:'2026-11-01',toExclusive:'2026-11-01'},{from:'2026-11-01T00:00:00Z',toExclusive:'2026-12-01'},{from:'2025-01-01',toExclusive:'2026-12-01'}])('rejects invalid or unbounded windows %j',input=>{expect(()=>productionMetricsWindow(input)).toThrow();});
it('returns known empty counts but unavailable monetary settlement and rates remain null',()=>{const s=summarizeProductionMetrics(facts(),window);expect(s.attempts.successRateKnownOutcomes).toBeNull();expect(s.money.grossReservedCentsCreated).toBe(0);expect(s.money.supplierPaidCents).toBeNull();expect(s.byDay).toHaveLength(30);});
