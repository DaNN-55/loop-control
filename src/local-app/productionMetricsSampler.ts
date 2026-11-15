import {cpus,freemem,totalmem} from 'node:os';
import type {Pool} from 'pg';
import {ownerTransaction} from './ownerTransaction.js';

export const productionMetricsSampleIntervalMs=30_000;
const retentionIntervalMs=24*60*60*1000;
export interface ProductionMetricsActivity {enabled:boolean;queued:number;running:number;resourceWait:number;localExports?:number}
export interface ProductionMetricsResourceSample {
 local_export_count?:number;sampled_at:string;cpu_percent:number|null;memory_used_bytes:number;memory_total_bytes:number;
 queue_count:number;running_count:number;resource_wait_count:number;gpu_percent:null;gap_seconds:number;
}
interface CpuTimes {idle:number;total:number}
export interface ProductionMetricsSamplingPort {
 activity:()=>Promise<ProductionMetricsActivity>;
 record:(sample:ProductionMetricsResourceSample)=>Promise<boolean>;
 prune:()=>Promise<unknown>;
}
interface Options {
 enabled?:boolean;port:ProductionMetricsSamplingPort;now?:()=>number;
 cpu?:()=>CpuTimes;memory?:()=>{totalBytes:number;freeBytes:number};
}
const systemCpu=():CpuTimes=>cpus().reduce((sum,cpu)=>({idle:sum.idle+cpu.times.idle,total:sum.total+Object.values(cpu.times).reduce((a,b)=>a+b,0)}),{idle:0,total:0});
function cpuPercent(previous:CpuTimes|undefined,current:CpuTimes):number|null{
 if(!previous)return null;
 const total=current.total-previous.total,idle=current.idle-previous.idle;
 if(!Number.isFinite(total)||!Number.isFinite(idle)||total<=0||idle<0)return null;
 return Math.round(1000*Math.max(0,Math.min(1,1-idle/total)))/10;
}
function count(value:number){if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid resource count');return value;}

/** Independent, best-effort host observations. No task is claimed, retried or failed here. */
export function startProductionMetricsSampler(options:Options){
 const enabled=options.enabled===true,now=options.now??Date.now,cpu=options.cpu??systemCpu;
 const memory=options.memory??(()=>({totalBytes:totalmem(),freeBytes:freemem()}));
 let stopped=!enabled,pump:Promise<void>|undefined,previousCpu:CpuTimes|undefined,lastSampleAt:number|undefined;
 let failedSince:number|undefined,pendingGapSeconds=0,lastPrunedAt:number|undefined,lastScanAt:number|undefined,lastError:'resource_observation_failed'|'retention_failed'|null=null;
 async function scan(){
  const at=now();
  if(lastScanAt!==undefined&&at>=lastScanAt&&at-lastScanAt<productionMetricsSampleIntervalMs)return;
  lastScanAt=at;
  try{
   const activity=await options.port.activity();
   if(stopped)return;
   if(!activity.enabled){previousCpu=undefined;lastSampleAt=undefined;failedSince=undefined;pendingGapSeconds=0;lastError=null;return;}
   if(lastPrunedAt===undefined||at-lastPrunedAt>=retentionIntervalMs){
    try{await options.port.prune();lastPrunedAt=at;if(lastError==='retention_failed')lastError=null;}
    catch{lastError='retention_failed';}
   }
   if(stopped)return;
   const queued=count(activity.queued),running=count(activity.running),waiting=count(activity.resourceWait),localExports=activity.localExports===undefined?undefined:count(activity.localExports);
   if(queued+running+waiting+(localExports??0)===0){
    if(failedSince!==undefined)pendingGapSeconds+=Math.max(0,(at-failedSince)/1000);
    previousCpu=undefined;lastSampleAt=undefined;failedSince=undefined;return;
   }
   const currentCpu=cpu(),host=memory();
   if(!Number.isSafeInteger(host.totalBytes)||host.totalBytes<=0||!Number.isFinite(host.freeBytes))throw Error('Invalid memory observation');
   const gapSeconds=pendingGapSeconds+Math.max(0,failedSince===undefined?0:(at-failedSince)/1000,lastSampleAt===undefined?0:(at-lastSampleAt-productionMetricsSampleIntervalMs)/1000);
   const sample:ProductionMetricsResourceSample={...(localExports===undefined?{}:{local_export_count:localExports}),sampled_at:new Date(at).toISOString(),cpu_percent:cpuPercent(previousCpu,currentCpu),
    memory_used_bytes:host.totalBytes-Math.max(0,Math.min(host.totalBytes,Math.round(host.freeBytes))),memory_total_bytes:host.totalBytes,
    queue_count:queued,running_count:running,resource_wait_count:waiting,gpu_percent:null,gap_seconds:gapSeconds};
   if(stopped)return;
   if(await options.port.record(sample)){previousCpu=currentCpu;lastSampleAt=at;failedSince=undefined;pendingGapSeconds=0;if(lastError!=='retention_failed')lastError=null;}
   else{previousCpu=undefined;lastSampleAt=undefined;failedSince=undefined;pendingGapSeconds=0;}
  }catch{failedSince??=at;previousCpu=undefined;lastError='resource_observation_failed';}
 }
 function wake(){if(stopped)return Promise.resolve();return pump??=(scan().finally(()=>{pump=undefined;}));}
 const timer=enabled?setInterval(()=>void wake(),productionMetricsSampleIntervalMs):undefined;timer?.unref?.();
 if(enabled)void wake();
 return{wake,status:()=>({enabled,stopped,lastSampleAt:lastSampleAt===undefined?null:new Date(lastSampleAt).toISOString(),lastError}),
  async stop(){stopped=true;if(timer)clearInterval(timer);await pump;}};
}

/** The explicit runtime Owner and the database's opt-in control form separate gates. */
export function startOwnerProductionMetricsSampler(options:{pool:Pool;ownerId:string;enabled?:boolean;localExports?:(ownerId:string)=>number}){
 if(options.enabled===true&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.ownerId))throw Error('Production metrics require an explicit Owner ID');
 const transact=<T>(readOnly:boolean,run:Parameters<typeof ownerTransaction<T>>[3])=>ownerTransaction(options.pool,options.ownerId,readOnly,async c=>{
  await c.query("SET LOCAL statement_timeout='3000ms'");return run(c);
 });
 return startProductionMetricsSampler({enabled:options.enabled,port:{
  activity:()=>transact(true,async c=>{
   const activity=(await c.query('SELECT local_identity.production_metrics_activity() activity')).rows[0].activity as ProductionMetricsActivity;
   if(activity.enabled&&(await c.query("SELECT to_regprocedure('local_identity.record_production_metric_resource_with_exports(jsonb,integer)') IS NOT NULL present")).rows[0]?.present)activity.localExports=options.localExports?.(options.ownerId)??0;
   return activity;
  }),
  record:sample=>transact(false,async c=>{
   const {local_export_count,...resource}=sample;
   const result=local_export_count===undefined?await c.query('SELECT local_identity.record_production_metric_resource($1::jsonb) recorded',[JSON.stringify(resource)]):await c.query('SELECT local_identity.record_production_metric_resource_with_exports($1::jsonb,$2) recorded',[JSON.stringify(resource),local_export_count]);
   return result.rows[0]?.recorded===true;
  }),
  prune:()=>transact(false,async c=>(await c.query('SELECT local_identity.prune_production_metrics() result')).rows[0]?.result),
 }});
}
