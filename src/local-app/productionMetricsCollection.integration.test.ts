// @vitest-environment node
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {nativeWorkspaceFixture} from './nativeWorkspace.fixture';
import {ownerTransaction} from './ownerTransaction';

const contextPath=process.env.LOOP_METRICS_TEST_CONTEXT;
describe.skipIf(!contextPath)('C collection in an explicitly isolated PostgreSQL fixture',()=>{
 let f:Awaited<ReturnType<typeof nativeWorkspaceFixture>>;
 let account:string,episode:string,otherEpisode:string;
 const own=<T>(run:Parameters<typeof ownerTransaction<T>>[3],owner?:string)=>ownerTransaction(f.pool,owner??f.owner,false,run);
 const query=(sql:string,args:unknown[]=[],owner?:string)=>own(c=>c.query(sql,args),owner);
 beforeAll(async()=>{
  const {runtimeContext}=await import(contextPath!);const context=runtimeContext();
  if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Metrics collection tests cannot use a daily runtime');
  f=await nativeWorkspaceFixture({testContextModule:contextPath});
  account=randomUUID();episode=randomUUID();otherEpisode=randomUUID();const otherAccount=randomUUID();
  await f.c.query("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1::uuid,$1::uuid::text,'Metrics isolated','Asia/Shanghai'),($2::uuid,$2::uuid::text,'Other isolated','Asia/Shanghai')",[account,otherAccount]);
  await f.c.query("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner'),($3,$4,'owner')",[account,f.owner,otherAccount,f.other]);
  await f.c.query('INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES($1,$1,1,$3,true),($2,$2,1,$3,true)',[account,otherAccount,{asset_root:f.root}]);
  await f.c.query('UPDATE public.accounts SET current_blueprint_version_id=id WHERE id=ANY($1::uuid[])',[[account,otherAccount]]);
  await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title) VALUES($1,$2,$2,'Collection isolated'),($3,$4,$4,'Other isolated')",[episode,account,otherEpisode,otherAccount]);
  await f.c.query('INSERT INTO local_identity.input_episodes(episode_id,owner_id) VALUES($1,$2),($3,$4)',[episode,f.owner,otherEpisode,f.other]);
 },90000);
 afterAll(async()=>{await f?.close();},90000);

 it('defaults off, bootstraps observations only, and records activation gaps',async()=>{
  expect((await query('SELECT local_identity.production_metrics_enabled() enabled')).rows[0].enabled).toBe(false);
  await f.c.query("UPDATE public.episodes SET title='Renamed before collection' WHERE id=$1",[episode]);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_metric_events')).rows[0].n).toBe(0);
  await query('SELECT local_identity.set_production_metrics_enabled(true)');
  const observed=(await f.c.query('SELECT event_type,payload FROM local_identity.production_metric_events WHERE owner_id=$1',[f.owner])).rows;
  expect(observed).toHaveLength(1);expect(observed[0]).toMatchObject({event_type:'coverage_observation',payload:{observed_only:true}});
  await query('SELECT local_identity.set_production_metrics_enabled(false)');
  await query('SELECT local_identity.set_production_metrics_enabled(true)');
  const periods=(await f.c.query('SELECT * FROM local_identity.production_metric_coverage_periods WHERE owner_id=$1 ORDER BY started_at',[f.owner])).rows;
  expect(periods).toHaveLength(2);expect(periods[0].ended_at).not.toBeNull();expect(periods[1].ended_at).toBeNull();
 });

 it('keeps events atomic and idempotent, prevents forged relationships and direct writes',async()=>{
  const source=randomUUID(),payload={reason_code:'explicit_retry'};
  const record=()=>query('SELECT local_identity.record_owned_production_metric($1,$2,$3,$4) wrote',[episode,'retry_relation',source,payload]);
  expect((await record()).rows[0].wrote).toBe(true);expect((await record()).rows[0].wrote).toBe(false);
  await expect(query('SELECT local_identity.record_owned_production_metric($1,$2,$3,$4)',[episode,'retry_relation',source,{reason_code:'other'}])).rejects.toMatchObject({code:'23505'});
  const count=(await f.c.query('SELECT count(*)::int n FROM local_identity.production_metric_events WHERE owner_id=$1',[f.owner])).rows[0].n;
  await expect(own(async c=>{await c.query('SELECT local_identity.record_owned_production_metric($1,$2,$3,$4)',[episode,'retry_relation',randomUUID(),payload]);await c.query('SELECT 1/0');})).rejects.toMatchObject({code:'22012'});
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_metric_events WHERE owner_id=$1',[f.owner])).rows[0].n).toBe(count);
  await expect(query('SELECT local_identity.record_owned_production_metric($1,$2,$3,$4)',[otherEpisode,'retry_relation',randomUUID(),payload])).rejects.toMatchObject({code:'42501'});
  await expect(query('SELECT local_identity.record_owned_production_metric($1,$2,$3,$4)',[episode,'retry_relation',randomUUID(),{prompt:'Never store raw prompts'}])).rejects.toThrow();
  await expect(query("INSERT INTO local_identity.production_metric_events(owner_id,episode_id,event_type,source_key,quality_tier,payload) VALUES($1,$2,'forged','forged','unspecified','{}')",[f.owner,episode])).rejects.toMatchObject({code:'42501'});
  await expect(query('SELECT local_identity.append_production_metric($1,$2,$3,$4,$5)',[f.owner,episode,'forged','forged',{}])).rejects.toMatchObject({code:'42501'});
  expect((await query('SELECT count(*)::int n FROM local_identity.production_metric_events WHERE owner_id=$1',[f.owner],f.other)).rows[0].n).toBe(0);
 });

 it('freezes submission quality, separates backoff from eligible wait, and fences Worker events',async()=>{
  await query("SELECT local_identity.set_episode_business_quality($1,'low',0)",[episode]);
  const task=randomUUID(),lease=randomUUID(),run=randomUUID();
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,provider,model,input_snapshot,available_at,max_attempts) VALUES($1,$2,'generate_narration','ready','volcengine_tts','seed-tts-2.0','{}',clock_timestamp()+interval '2 seconds',2)",[task,episode]);
  await query("SELECT local_identity.set_episode_business_quality($1,'high',1)",[episode]);
  expect((await f.c.query('SELECT tier,revision FROM local_identity.production_metric_task_quality WHERE task_id=$1',[task])).rows[0]).toEqual({tier:'low',revision:1});
  await f.c.query("UPDATE public.tasks SET status='running',attempt=1,lease_token=$2,claimed_at=clock_timestamp()+interval '3 seconds' WHERE id=$1",[task,lease]);
  await f.c.query("INSERT INTO public.task_runs(id,task_id,attempt,task_package,status,lease_token) VALUES($1,$2,0,'{}','running',$3)",[run,task,lease]);
  const cycle=(await f.c.query('SELECT payload FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type=\'task_claimed\' AND payload->>\'task_id\'=$2',[episode,task])).rows[0].payload;
  expect(cycle.backoff_seconds).toBeGreaterThan(1);expect(cycle.eligible_wait_seconds).toBeGreaterThanOrEqual(1);expect(cycle.observed_only).toBe(false);
  const worker=f.workerPool(),key=randomUUID(),request={operation:'create',http_status:200,request_key:key};
  expect((await worker.query('SELECT local_identity.record_worker_production_metric($1,0,$2,$3,$4,$5) wrote',[task,lease,'provider_response_observed',key,request])).rows[0].wrote).toBe(true);
  await expect(worker.query('SELECT local_identity.record_worker_production_metric($1,0,$2,$3,$4,$5)',[task,randomUUID(),'provider_response_observed',randomUUID(),request])).rejects.toMatchObject({code:'42501'});
  await expect(worker.query('SELECT local_identity.record_worker_production_metric($1,0,$2,$3,$4,$5)',[task,lease,'supplier_paid',randomUUID(),{paid_cents:1,currency:'CNY',billing_evidence_id:randomUUID()}])).rejects.toMatchObject({code:'0A000'});
  await expect(worker.query('SELECT local_identity.record_owned_production_metric($1,$2,$3,$4)',[episode,'retry_relation',randomUUID(),{}])).rejects.toMatchObject({code:'42501'});
  const alien=randomUUID();await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_narration','completed','{}')",[alien,otherEpisode]);
  await expect(query('SELECT local_identity.record_owned_production_metric($1,$2,$3,$4)',[episode,'retry_relation',randomUUID(),{retry_of_task_id:alien}])).rejects.toMatchObject({code:'42501'});
  await f.c.query("UPDATE public.task_runs SET status='completed',completed_at=clock_timestamp(),actual_cost_cents=7 WHERE id=$1",[run]);
  const finished=(await f.c.query("SELECT quality_tier,payload FROM local_identity.production_metric_events WHERE event_type='attempt_finished' AND payload->>'task_id'=$1",[task])).rows[0];
  expect(finished.quality_tier).toBe('low');expect(finished.payload.reported_cents).toBe(7);
 });

 it('keeps restored past facts and submission quality unknown while collecting later real changes',async()=>{
  const restored=randomUUID(),task=randomUUID(),oldRun=randomUUID(),newRun=randomUUID(),lease=randomUUID(),past=new Date(Date.now()-86400000).toISOString();
  await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,created_at) VALUES($1,$2,$2,'Restored isolated',$3)",[restored,account,past]);
  await f.c.query('INSERT INTO local_identity.input_episodes(episode_id,owner_id) VALUES($1,$2)',[restored,f.owner]);
  expect((await f.c.query("SELECT count(*)::int n FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type='episode_created'",[restored])).rows[0].n).toBe(0);
  await query("SELECT local_identity.set_episode_business_quality($1,'medium',0)",[restored]);
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,provider,input_snapshot,created_at,max_attempts) VALUES($1,$2,'generate_narration','ready','volcengine_tts','{}',$3,2)",[task,restored,past]);
  await f.c.query("INSERT INTO public.task_runs(id,task_id,attempt,task_package,status,started_at,completed_at) VALUES($1,$2,0,'{}','failed',$3,$3)",[oldRun,task,past]);
  await f.c.query("INSERT INTO local_identity.provider_dispatch_facts(task_id,attempt,lease_token,kind,request_hash,phase,updated_at) VALUES($1,0,$2,'speech',repeat('a',32),'preparing',$3)",[task,lease,past]);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_metric_task_quality WHERE task_id=$1',[task])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_metric_queue_cycles WHERE task_id=$1',[task])).rows[0].n).toBe(0);
  expect((await f.c.query("SELECT count(*)::int n FROM local_identity.production_metric_events WHERE payload->>'task_id'=$1",[task])).rows[0].n).toBe(0);
  await f.c.query("UPDATE public.tasks SET status='running',attempt=2,lease_token=$2,claimed_at=clock_timestamp() WHERE id=$1",[task,lease]);
  await f.c.query("INSERT INTO public.task_runs(id,task_id,attempt,task_package,status,lease_token) VALUES($1,$2,1,'{}','running',$3)",[newRun,task,lease]);
  const claim=(await f.c.query("SELECT payload FROM local_identity.production_metric_events WHERE event_type='task_claimed' AND payload->>'task_id'=$1",[task])).rows[0].payload;
  expect(claim).toMatchObject({observed_only:true,backoff_seconds:null,eligible_wait_seconds:null});
  const start=(await f.c.query("SELECT quality_tier,payload FROM local_identity.production_metric_events WHERE event_type='attempt_started' AND payload->>'task_id'=$1",[task])).rows[0];
  expect(start.quality_tier).toBe('unspecified');expect(start.payload.quality_snapshot_known).toBe(false);
  await f.c.query("UPDATE public.task_runs SET status='completed',completed_at=clock_timestamp() WHERE id=$1",[newRun]);
 });

 it('records bounded resource observations, nullable GPU and gaps without changing business records',async()=>{
  const snapshot=async()=> (await f.c.query("SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) digest FROM public.tasks t")).rows[0].digest;
  const before=await snapshot(),sample={sampled_at:new Date().toISOString(),cpu_percent:12.5,memory_used_bytes:100,memory_total_bytes:1000,queue_count:2,running_count:1,resource_wait_count:1,gpu_percent:null,gap_seconds:45};
  expect((await query('SELECT local_identity.record_production_metric_resource($1) wrote',[sample])).rows[0].wrote).toBe(true);
  expect((await query('SELECT local_identity.record_production_metric_resource($1) wrote',[sample])).rows[0].wrote).toBe(false);
  await expect(query('SELECT local_identity.record_production_metric_resource($1)',[{...sample,cpu_percent:13}])).rejects.toMatchObject({code:'23505'});
  await expect(query('SELECT local_identity.record_production_metric_resource($1)',[{...sample,gpu_percent:0}])).rejects.toThrow();
  await expect(query('SELECT local_identity.record_production_metric_resource($1)',[{...sample,prompt:'extra'}])).rejects.toThrow();
  await expect(query('SELECT local_identity.record_production_metric_resource($1)',[{...sample,cpu_percent:'NaN'}])).rejects.toThrow();
  expect((await query('SELECT local_identity.record_production_metric_resource($1) wrote',[{...sample,sampled_at:new Date(Date.now()+1).toISOString()}])).rows[0].wrote).toBe(false);
  const dailyResource=(await query('SELECT samples,cpu_sum,memory_used_peak,gap_seconds FROM local_identity.production_metric_resource_daily')).rows[0];
  expect(Number(dailyResource.samples)).toBe(1);expect(Number(dailyResource.cpu_sum)).toBe(12.5);expect(Number(dailyResource.memory_used_peak)).toBe(100);expect(Number(dailyResource.gap_seconds)).toBe(45);
  const stored=(await query('SELECT gpu_percent,gap_seconds FROM local_identity.production_metric_resources')).rows[0];expect(stored.gpu_percent).toBeNull();expect(Number(stored.gap_seconds)).toBe(45);
  const activity=(await query('SELECT local_identity.production_metrics_activity() value')).rows[0].value;expect(activity.enabled).toBe(true);expect(activity.queued).toBeGreaterThanOrEqual(0);
  expect(await snapshot()).toBe(before);
 });

 it('retains only new statistics, preserves current quality and anonymous totals after permanent deletion',async()=>{
  const disposable=randomUUID();await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title) VALUES($1,$2,$2,'Disposable isolated')",[disposable,account]);
  await f.c.query('INSERT INTO local_identity.input_episodes(episode_id,owner_id) VALUES($1,$2)',[disposable,f.owner]);
  await query("SELECT local_identity.set_episode_business_quality($1,'medium',0)",[disposable]);
  const at=new Date(Date.now()-400*86400000).toISOString();
  await f.c.query("INSERT INTO local_identity.production_metric_events(owner_id,episode_id,event_type,source_key,quality_tier,payload,occurred_at) VALUES($1,$2,'retention_fixture','old','unspecified','{}',$3)",[f.owner,episode,at]);
  await f.c.query("INSERT INTO local_identity.production_metric_resources(owner_id,sampled_at,queue_count,running_count,resource_wait_count) VALUES($1,clock_timestamp()-interval '31 days',0,0,0)",[f.owner]);
  await f.c.query("INSERT INTO local_identity.production_metric_daily(owner_id,day,event_type,quality_tier,count) VALUES($1,current_date-interval '25 months','expired','unspecified',1)",[f.owner]);
  await f.c.query("UPDATE local_identity.production_metric_quality_versions SET created_at=clock_timestamp()-interval '13 months' WHERE owner_id=$1",[f.owner]);
  const before=(await f.c.query("SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) digest FROM public.episodes t")).rows[0].digest;
  const pruned=(await query('SELECT local_identity.prune_production_metrics() result')).rows[0].result;
  expect(pruned).toMatchObject({events:1,resources:1,daily:1});
  expect((await query('SELECT local_identity.episode_business_quality($1) value',[episode])).rows[0].value).toEqual({tier:'high',revision:2});
  expect((await f.c.query("SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) digest FROM public.episodes t")).rows[0].digest).toBe(before);
  const dailyBefore=(await f.c.query('SELECT sum(count)::text n FROM local_identity.production_metric_daily WHERE owner_id=$1',[f.owner])).rows[0].n;
  await f.c.query('UPDATE public.episodes SET archived_at=clock_timestamp() WHERE id=$1',[disposable]);
  await query('SELECT local_identity.delete_owned_input_episode($1)',[disposable]);
  for(const table of ['production_metric_events','production_metric_quality_versions','production_metric_task_quality','production_metric_delivery_quality','production_metric_queue_cycles'])expect((await f.c.query(`SELECT count(*)::int n FROM local_identity.${table} WHERE episode_id=$1`,[disposable])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT sum(count)::text n FROM local_identity.production_metric_daily WHERE owner_id=$1',[f.owner])).rows[0].n).toBe(dailyBefore);
  const columns=(await f.c.query("SELECT column_name FROM information_schema.columns WHERE table_schema='local_identity' AND table_name='production_metric_daily'")).rows.map(r=>r.column_name);
  expect(columns.some(column=>['episode_id','account_id','task_id','payload','title','path'].includes(column))).toBe(false);
 });
});
