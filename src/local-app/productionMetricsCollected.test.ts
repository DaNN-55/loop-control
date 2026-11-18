// @vitest-environment node
import {expect,it} from 'vitest';
import {summarizeCollectedProductionMetrics,type CollectedFacts} from './productionMetricsCollected';
const at=(day:number)=>`2026-11-${String(day).padStart(2,'0')}T00:00:00+08:00`;
const input={from:'2026-11-01',toExclusive:'2026-11-06'};
const base=():CollectedFacts=>({observedAt:at(10),enabled:true,coverage:[{from:at(1),to:at(3)},{from:at(4),to:null}],events:[],resources:[],daily:[]});
it('does not join stage residence across disabled coverage gaps or label observations as occurrences',()=>{
 const facts=base();facts.events=[{episodeId:'a',type:'coverage_observation',at:at(1),payload:{stage:'waiting_input',observed_only:true}},{episodeId:'a',type:'stage_changed',at:at(2),payload:{from_stage:'waiting_input',to_stage:'storyboard_review'}},{episodeId:'a',type:'coverage_observation',at:at(4),payload:{stage:'storyboard_review',observed_only:true}}];
 const s=summarizeCollectedProductionMetrics(facts,input);expect(s.detail.stageResidenceSeconds).toEqual({waiting_input:86400,storyboard_review:3*86400});expect(s.detail.counts).toEqual({stage_changed:1});expect(s.coverage.observations).toBe(2);
});
it('separates unknown estimates, currencies, missing cycles and supplier payment',()=>{
 const facts=base();facts.events=[{episodeId:'a',type:'estimate_frozen',at:at(2),payload:{estimate_known:false,estimated_cents:null}},{episodeId:'a',type:'estimate_frozen',at:at(2),payload:{estimate_known:true,estimated_cents:7,currency:'CNY'}},{episodeId:'a',type:'task_claimed',at:at(2),payload:{observed_only:true,eligible_wait_seconds:0}},{episodeId:'a',type:'task_claimed',at:at(2),payload:{observed_only:false,eligible_wait_seconds:9,backoff_seconds:3}}];
 const s=summarizeCollectedProductionMetrics(facts,input);expect(s.detail.money).toMatchObject({knownEstimatedByCurrency:{CNY:{known:1,cents:7}},unknownEstimates:1,supplierPaid:null});expect(s.detail.queue.eligibleWaitSeconds).toEqual({known:1,mean:9,p95:9});expect(s.detail.queue.observedOrMissingCycles).toBe(1);
});
it('keeps dispatch, response and artifact receipts distinct and leaves absent resources unknown',()=>{
 const facts=base();facts.events=[{episodeId:'a',type:'provider_request_dispatch',at:at(2),payload:{operation:'create'}},{episodeId:'a',type:'provider_response_observed',at:at(2),payload:{operation:'create',http_status:500}}];
 const s=summarizeCollectedProductionMetrics(facts,input);expect(s.detail.requests).toMatchObject({dispatchMarked:1,operations:{create:{dispatchMarked:1,responseObserved:1,outcomeUnknown:0}},artifactReceipts:0});expect(s.resources).toMatchObject({samples:0,gpuPercent:null,maximumMemoryUsedBytes:null,cpuPercent:{known:0,mean:null,p95:null}});
});
it('does not turn a nullable host memory observation into zero usage',()=>{
 const facts=base();facts.resources=[{at:at(2),cpu:null,used:null,total:null,queued:1,running:0,waiting:0,gap:30}];
 expect(summarizeCollectedProductionMetrics(facts,input).resources.maximumMemoryUsedBytes).toBeNull();
 facts.resources.push({...facts.resources[0],at:at(3),used:123,total:456});
 expect(summarizeCollectedProductionMetrics(facts,input).resources.maximumMemoryUsedBytes).toBe(123);
});

it('measures only covered four-step intervals, observes backward transitions and stops at actual delivery',()=>{
 const facts=base(),milestone=(day:number,name:string,phase:string,clock='00:00:00')=>({episodeId:'a',type:'workflow_milestone',at:`2026-11-${String(day).padStart(2,'0')}T${clock}+08:00`,payload:{version:'workflow-milestones/v1',milestone:name,phase}});
 facts.events=[milestone(1,'production_created','script'),milestone(2,'script_confirmed','preparation'),{episodeId:'a',type:'coverage_observation',at:at(4),payload:{stage:'production_ready',observed_only:true}},milestone(5,'editing_opened','editing'),milestone(5,'export_ready','delivery','12:00:00'),milestone(5,'native_edit_saved','editing','18:00:00'),{episodeId:'a',type:'delivery_completed',at:'2026-11-05T20:00:00+08:00',payload:{}}];
 const summary=summarizeCollectedProductionMetrics(facts,input)as any;
 expect(summary.detail.workflow).toMatchObject({version:'workflow-observation/v1',phaseSeconds:{script:86400,preparation:86400,editing:50400,delivery:21600},knownDurationSeconds:244800,backwardTransitions:1,phaseTransitions:3,includesOwnerWait:true,exclusiveWorkTime:false,automaticReworkClassification:false});
 expect(summary.detail.workflow.milestones).toEqual({production_created:1,script_confirmed:1,editing_opened:1,export_ready:1,native_edit_saved:1});
});

it('keeps unknown and disabled workflow prefixes unknown instead of inferring phases from legacy stages or old creation facts',()=>{
 const facts=base();facts.events=[{episodeId:'a',type:'episode_created',at:at(1),payload:{stage:'waiting_input'}},{episodeId:'a',type:'stage_changed',at:at(2),payload:{to_stage:'production_ready'}},{episodeId:'a',type:'coverage_observation',at:at(4),payload:{stage:'qc_review',observed_only:true}}];
 const empty=(summarizeCollectedProductionMetrics(facts,input)as any).detail.workflow;expect(empty.phaseSeconds).toEqual({script:null,preparation:null,editing:null,delivery:null});expect(empty.knownDurationSeconds).toBeNull();
 facts.events.push({episodeId:'a',type:'workflow_milestone',at:at(4),payload:{version:'workflow-milestones/v1',milestone:'editing_opened',phase:'editing'}},{episodeId:'a',type:'workflow_milestone',at:'2026-11-04T12:00:00+08:00',payload:{version:'workflow-milestones/v99',milestone:'export_ready',phase:'delivery'}});
 const unknown=(summarizeCollectedProductionMetrics(facts,input)as any).detail.workflow;expect(unknown.phaseSeconds).toEqual({script:null,preparation:null,editing:43200,delivery:null});expect(unknown.unknownMilestones).toBe(1);
});
