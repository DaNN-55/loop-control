import type {Pool} from 'pg';
import type {MetricsWindow} from './productionMetrics.js';
import {readProductionMetricsV2} from './productionMetricsCollected.js';

/** A read-only entry point over the existing Owner-scoped V1/V2 snapshot.
 * Deployment configuration is reported as configuration, never sampler health. */
export async function readProductionMetricsReport(pool:Pool,ownerId:string,window:MetricsWindow,resourceSamplingConfigured:boolean){
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ownerId))throw Error('显式 Owner 标识无效');
 ownerId=ownerId.toLowerCase();
 const summary=await readProductionMetricsV2(pool,ownerId,window),collected=summary.collected;
 const eventsInWindow=collected?Object.values(collected.detail.counts).reduce((sum,n)=>sum+n,0):null;
 return{
  schemaVersion:'production-metrics-report/v1',
  collection:{state:!collected?'not_installed':collected.enabled?'enabled':'disabled',
   enabled:collected?.enabled??false,activityEventsInWindow:eventsInWindow,coverage:collected?.coverage??null,
   resourceSampling:{configuredForRequestedOwner:resourceSamplingConfigured,samplesInWindow:collected?.resources.samples??null,health:'not_observed_by_this_report'}},
  definitions:{taskTime:'任务累计与区间并集合计分别显示；不是纯供应商时间或人工净工时。',
   stageTime:'阶段经过时间包含等待和并行工作，缺口不补零。',
   exportTime:'本机导出流程包含渲染、检查和文件登记；不是纯渲染时间。',
   money:'预留、估算及任务上报金额均不等于供应商实扣；未知费用不代表免费。'},
  summary,
 };
}
