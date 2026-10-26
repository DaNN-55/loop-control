import type {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access} from 'node:fs/promises';
import {consumeNotifications,type EventNotification} from '../orchestration/notificationConsumer.js';
import {recordOperation,readOperationsEvidence} from '../orchestration/operationsEvidence.js';
import {assertPreparedRuntime} from '../orchestration/runtimeBuild.js';
const exec=promisify(execFile);
export interface AutomationJob {id:string;kind:'health'|'backup';due_at:Date;token:string;attempt:number}
export interface NativeAutomationOptions {
 pool:Pool;projectRoot:string;mediaRoot:string;stateDirectory:string;
 now?:()=>Date;intervalMs?:number;recordSchedule?:boolean;
 send?:(message:EventNotification)=>Promise<void>;
 health?:(signal:AbortSignal)=>Promise<{passed:boolean;detail:string}>;
 backup?:(jobId:string,signal:AbortSignal)=>Promise<{passed:boolean;detail:string}>;
}
export async function nativeHealth(options:Pick<NativeAutomationOptions,'pool'|'projectRoot'|'mediaRoot'>){
 try{await options.pool.query('SELECT 1');await access(options.mediaRoot);await assertPreparedRuntime(options.projectRoot);return{passed:true,detail:'数据库、媒体目录和本地运行程序检查通过。'};}
 catch{return{passed:false,detail:'本地数据库、媒体目录或运行程序检查失败，请检查本机部署。'};}
}
export async function desktopNotification(message:EventNotification){await exec('/usr/bin/osascript',['-e','on run argv\n display notification (item 2 of argv) with title (item 1 of argv)\nend run',message.title,message.body],{timeout:10000,maxBuffer:4096});}
export async function startNativeAutomation(options:NativeAutomationOptions){
 const {pool,stateDirectory}=options,now=options.now??(()=>new Date()),controller=new AbortController();
 let stopped=false,pump:Promise<void>|undefined,again=false,lastError:string|null=null,lastScanAt:string|null=null;
 const delivery={
  async initialize(){await pool.query('SELECT local_identity.initialize_native_notifications()');},
  async claim(){if(stopped)return null;const r=(await pool.query('SELECT * FROM local_identity.claim_native_notification()')).rows[0];return r?{id:r.id,createdAt:r.created_at.toISOString(),eventType:r.event_type,payload:r.payload,deliveryToken:r.delivery_token}:null;},
  async finish(event:{id:string;deliveryToken:string},outcome:'accepted'|'skipped'|'uncertain'){const r=(await pool.query('SELECT local_identity.finish_native_notification($1,$2,$3) ok',[event.id,event.deliveryToken,outcome])).rows[0];if(!r.ok)throw Error('Notification completion fence rejected');},
 };
 async function enqueue(at:Date){
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtextextended('native-automation-plans',0))");
   await c.query("INSERT INTO local_identity.automation_plans(kind,next_due_at) SELECT kind,(date_trunc('day',$1::timestamptz AT TIME ZONE 'Asia/Shanghai')+interval '9 hours') AT TIME ZONE 'Asia/Shanghai' FROM unnest(ARRAY['health','backup']) kind ON CONFLICT DO NOTHING",[at]);
   const plans=(await c.query('SELECT * FROM local_identity.automation_plans FOR UPDATE')).rows;
   for(const p of plans){let due=new Date(p.next_due_at);for(let i=0;i<32&&due<=at;i++){
    await c.query('INSERT INTO local_identity.automation_jobs(kind,due_at,available_at) VALUES($1,$2,$2) ON CONFLICT(kind,due_at) DO NOTHING',[p.kind,due]);
    due=new Date(due.getTime()+86400000);
   }await c.query('UPDATE local_identity.automation_plans SET next_due_at=$2 WHERE kind=$1',[p.kind,due]);}
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async function claim(at:Date):Promise<AutomationJob|null>{
  // Short transaction/one statement. Completion/retry remain token-fenced.
  await pool.query(`WITH exhausted AS(UPDATE local_identity.automation_jobs SET status='failed',token=NULL,lease_until=NULL,passed=false,completed_at=$1,detail='运维尝试预算耗尽；需要检查本机配置。' WHERE status='running' AND lease_until<=$1 AND attempt>=3 RETURNING id,attempt) UPDATE local_identity.automation_attempts a SET status='interrupted',passed=false,completed_at=$1,detail='服务中断且运维尝试预算耗尽。' FROM exhausted e WHERE a.job_id=e.id AND a.attempt=e.attempt AND a.status='running'`,[at]);
  const token=randomUUID();const r=await pool.query(`WITH candidate AS(
   SELECT id FROM local_identity.automation_jobs WHERE (status IN ('ready','failed') AND attempt<3 AND available_at<=$1) OR(status='running' AND lease_until<=$1 AND attempt<3)
   ORDER BY due_at,kind FOR UPDATE SKIP LOCKED LIMIT 1
  ), interrupted AS(
   UPDATE local_identity.automation_attempts a SET status='interrupted',passed=false,completed_at=$1,detail='服务中断或租约过期；保留旧尝试。'
   FROM candidate c WHERE a.job_id=c.id AND a.status='running'
  ), claimed AS(
   UPDATE local_identity.automation_jobs j SET status='running',token=$2,lease_until=$1::timestamptz+interval '30 seconds',attempt=attempt+1,completed_at=NULL,passed=NULL,detail=NULL
   FROM candidate c WHERE j.id=c.id RETURNING j.id,j.kind,j.due_at,j.token,j.attempt
  ), started AS(
   INSERT INTO local_identity.automation_attempts(job_id,attempt,token,started_at,status) SELECT id,attempt,token,$1,'running' FROM claimed RETURNING job_id
  ) SELECT claimed.* FROM claimed JOIN started ON started.job_id=claimed.id`,[at,token]);return r.rows[0]??null;
 }
 async function run(job:AutomationJob){
  let lost=false,renewing:Promise<unknown>|undefined;const attemptController=new AbortController(),signal=AbortSignal.any([controller.signal,attemptController.signal]);const leaseLost=()=>{lost=true;attemptController.abort();};
  const timer=setInterval(()=>{if(!renewing)renewing=pool.query("UPDATE local_identity.automation_jobs SET lease_until=$3::timestamptz+interval '30 seconds' WHERE id=$1 AND token=$2 AND status='running' AND lease_until>$3 RETURNING id",[job.id,job.token,now()]).then(r=>{if(!r.rowCount)leaseLost();}).catch(()=>{leaseLost();}).finally(()=>{renewing=undefined;});},5000);timer.unref?.();
  let result:{passed:boolean;detail:string};
  try{result=job.kind==='health'?await(options.health??(()=>nativeHealth(options)))(signal):options.backup?await options.backup(job.id,signal):{passed:false,detail:'本地完整备份尚未配置；未生成可恢复备份。'};}
  catch{result={passed:false,detail:job.kind==='health'?'本地健康检查未完成。':'本地完整备份未完成；没有成功结论。'};}
  finally{clearInterval(timer);await renewing;}
  if(lost)throw Error('Automation lease lost');
  const at=now(),interrupted=controller.signal.aborted;
  const detail=interrupted?'服务停止中断运维，将在重启后续接。':result.detail;
  const r=await pool.query(`WITH finished AS(
   UPDATE local_identity.automation_jobs SET status=$4,passed=$5,detail=$6,completed_at=$3,token=NULL,lease_until=NULL,
   available_at=$3::timestamptz+CASE WHEN $4='ready' THEN interval '0' ELSE interval '1 minute' END
   WHERE id=$1 AND token=$2 AND status='running' AND lease_until>$3 RETURNING id,attempt
  ) UPDATE local_identity.automation_attempts a SET status=$7,passed=$5,detail=$6,completed_at=$3
   FROM finished f WHERE a.job_id=f.id AND a.attempt=f.attempt AND a.token=$2 AND a.status='running' RETURNING a.job_id`,[job.id,job.token,at,interrupted?'ready':result.passed?'completed':'failed',interrupted?false:result.passed,detail,interrupted?'interrupted':result.passed?'completed':'failed']);
  if(!r.rowCount)throw Error('Automation completion fence rejected');
  await recordOperation(stateDirectory,job.kind,result);
 }
 async function scan(){
  do{again=false;lastScanAt=now().toISOString();
   try{await enqueue(now());lastError=null;if(options.recordSchedule!==false)await recordOperation(stateDirectory,'schedule',{passed:true,idle:true,detail:'本地自动化计划扫描完成。'});}catch{lastError='本地自动化计划读取或持久化失败。';await recordOperation(stateDirectory,'schedule',{passed:false,detail:lastError});return;}
   // A broken/uncertain notification never prevents health or backup work.
   try{const r=await consumeNotifications(delivery,options.send??desktopNotification),unknown=Number((await pool.query('SELECT local_identity.unresolved_native_notifications() count')).rows[0].count);
    await recordOperation(stateDirectory,'notification',{passed:unknown===0,idle:r.notifications===0,detail:unknown?`有 ${unknown} 条提醒正在投递或结果未知；不会自动重发，请核对控制台队列。`:r.notifications?`桌面接口接受 ${r.notifications} 条新提醒；不代表可见或已读。`:'没有新提醒；历史消费位置保留。'});
   }catch{await recordOperation(stateDirectory,'notification',{passed:false,detail:'提醒读取或投递结果未知；不自动重发，请核对控制台队列。'});}
   for(let i=0;i<64&&!stopped;i++){const job=await claim(now());if(!job)break;await run(job);}
  }while(again&&!stopped);
 }
 function wake(){if(stopped)return Promise.resolve();again=true;if(!pump)pump=scan().catch(async()=>{lastError='本地自动化执行失败，请检查本机状态。';await recordOperation(stateDirectory,'schedule',{passed:false,detail:lastError}).catch(()=>{});}).finally(()=>{pump=undefined;if(again&&!stopped)void wake();});return pump;}
 const interval=options.intervalMs??4000;if(!Number.isSafeInteger(interval)||interval<10)throw Error('Invalid automation interval');
 const timer=setInterval(()=>void wake(),interval);timer.unref?.();void wake();
 return{wake,status:async()=>{const observedAt=now();const operations=await readOperationsEvidence(stateDirectory,observedAt);const results=(await pool.query("SELECT DISTINCT ON(j.kind,a.passed) j.kind,a.passed,a.detail,a.completed_at FROM local_identity.automation_attempts a JOIN local_identity.automation_jobs j ON j.id=a.job_id WHERE a.completed_at IS NOT NULL AND a.completed_at<=$1 ORDER BY j.kind,a.passed,a.completed_at DESC,a.attempt DESC",[observedAt])).rows;for(const kind of ['health','backup'] as const){const rows=results.filter(r=>r.kind===kind).map(r=>({passed:r.passed,detail:r.detail,at:r.completed_at.toISOString()})).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||Number(a.passed)-Number(b.passed));if(rows.length)operations[kind]={latest:rows[0],lastSuccess:rows.find(r=>r.passed)??null,lastFailure:rows.find(r=>!r.passed)??null};}return({observedAt:observedAt.toISOString(),automation:{stopped,lastScanAt,lastError,timezone:'Asia/Shanghai',hour:9,n8nRequired:false},plans:(await pool.query('SELECT kind,timezone,next_due_at FROM local_identity.automation_plans ORDER BY kind')).rows,jobs:(await pool.query('SELECT id,kind,due_at,status,attempt,completed_at,passed,detail FROM local_identity.automation_jobs ORDER BY due_at DESC,kind LIMIT 50')).rows,operations});},async stop(){stopped=true;clearInterval(timer);controller.abort();await pump;}};
}
export type NativeAutomation=Awaited<ReturnType<typeof startNativeAutomation>>;
