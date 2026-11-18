// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {ownerTransaction} from './ownerTransaction';
import {csrfFor} from './sessions';
import {inspectMediaRoot} from './mediaRootSettings';

async function fixture(contextPath:string){
 const {runtimeContext}=await import(contextPath),context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Explicit isolated fixture required');
 const runtime={mountPath:''};
 return productionWorkspaceFixture({testContextModule:contextPath,runtime,onSetup:async point=>{
  if(point.stage==='directory'&&point.root)runtime.mountPath=(await inspectMediaRoot(point.root)).mountPath;
 }});
}
it.skipIf(!process.env.LOOP_METRICS_TEST_CONTEXT)('rejects retired quality reads, writes and creation fields while preserving ordinary idempotent creation and generation settings',async()=>{
 const f=await fixture(process.env.LOOP_METRICS_TEST_CONTEXT!);
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  const post=async(command:string,data:Record<string,unknown>,key=randomUUID())=>{
   const r=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data,idempotencyKey:key})});return{status:r.status,body:await r.json()};
  };
  const read=await fetch(f.origin+'/api/local/production-quality?episodeId='+f.episode,{headers:{Cookie:'loop_owner_session='+f.token}});expect(read.status).toBe(404);
  const settings=(await f.c.query('SELECT input_snapshot,provider,model,budget_limit_cents,max_attempts FROM public.tasks WHERE id=$1',[f.task])).rows[0];
  expect((await post('setProductionQuality',{episodeId:f.episode,tier:'high',expectedRevision:0})).status).toBe(400);
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  expect((await post('create',{accountId:account,title:'retired field',businessQualityTier:'high'})).status).toBe(400);
  const key=randomUUID(),data={accountId:account,title:'No business quality'};
  const created=await post('create',data,key);expect(created.status,JSON.stringify(created.body)).toBe(200);expect(await post('create',data,key)).toEqual(created);
  expect((await f.c.query('SELECT input_snapshot,provider,model,budget_limit_cents,max_attempts FROM public.tasks WHERE id=$1',[f.task])).rows[0]).toEqual(settings);
  expect((await f.c.query("SELECT count(*)::int n FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type='episode_created'",[created.body.id])).rows[0].n).toBe(1);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_QUALITY_PRE_CONTEXT)('contracts a populated quality schema atomically and merges daily counts and money without changing production rows',async()=>{
 const f=await fixture(process.env.LOOP_QUALITY_PRE_CONTEXT!);
 try{
  const own=(run:(c:import('pg').PoolClient)=>Promise<unknown>)=>ownerTransaction(f.pool,f.owner,false,run);
  await own(async c=>{await c.query('SELECT local_identity.set_production_metrics_enabled(true)');await c.query("SELECT local_identity.set_episode_business_quality($1,'low',0)",[f.episode]);});
  const task=randomUUID();await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_narration','ready','{}')",[task,f.episode]);
  await own(c=>c.query("SELECT local_identity.set_episode_business_quality($1,'high',1)",[f.episode]));
  await f.c.query("INSERT INTO local_identity.production_metric_daily(owner_id,day,event_type,quality_tier,currency,count,amount_cents) VALUES($1,current_date,'retained_fixture','low','CNY',2,7),($1,current_date,'retained_fixture','high','CNY',3,11),($1,current_date,'retained_fixture','high','USD',1,5)",[f.owner]);
  await f.c.query("UPDATE local_identity.production_metric_events SET payload=payload||'{\"quality_snapshot_known\":true}' WHERE episode_id=$1 AND event_type='queue_entered'",[f.episode]);
  expect((await f.c.query("SELECT count(*)::int n FROM local_identity.production_metric_events WHERE payload ? 'quality_snapshot_known'")).rows[0].n).toBeGreaterThan(0);
  const production=async()=>{
   const result:Record<string,unknown>={};for(const table of ['public.episodes','public.tasks','public.task_runs','local_identity.workspace_deliveries'])result[table]=(await f.c.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')::text) digest FROM ${table} t`)).rows[0];return result;
  };
  const daily=async()=> (await f.c.query("SELECT owner_id,day,event_type,currency,is_test,sum(count)::text count,sum(amount_cents)::text amount FROM local_identity.production_metric_daily WHERE event_type<>'quality_changed' GROUP BY owner_id,day,event_type,currency,is_test ORDER BY 1,2,3,4,5")).rows;
  const before=await production(),totals=await daily(),events=(await f.c.query("SELECT id,owner_id,episode_id,event_type,source_key,occurred_at,payload-'quality_snapshot_known' payload FROM local_identity.production_metric_events WHERE event_type<>'quality_changed' ORDER BY id")).rows;
  const migration=await readFile(new URL('../../db/current/206-remove-business-quality.sql',import.meta.url),'utf8');
  await f.c.query('BEGIN');try{await f.c.query(migration);await expect(f.c.query('SELECT 1/0')).rejects.toMatchObject({code:'22012'});}finally{await f.c.query('ROLLBACK');}
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_metric_quality_versions')).rows[0].n).toBe(2);
  expect(await production()).toEqual(before);expect(await daily()).toEqual(totals);
  await f.c.query('BEGIN');try{await f.c.query(migration);await f.c.query('COMMIT');}catch(error){await f.c.query('ROLLBACK');throw error;}
  expect(await production()).toEqual(before);expect(await daily()).toEqual(totals);
  expect((await f.c.query('SELECT id,owner_id,episode_id,event_type,source_key,occurred_at,payload FROM local_identity.production_metric_events ORDER BY id')).rows).toEqual(events);
  for(const name of ['production_metric_quality_versions','production_metric_task_quality','production_metric_delivery_quality'])expect((await f.c.query('SELECT to_regclass($1) value',['local_identity.'+name])).rows[0].value).toBeNull();
  for(const name of ['episode_business_quality','set_episode_business_quality'])expect((await f.c.query("SELECT count(*)::int n FROM pg_proc WHERE pronamespace='local_identity'::regnamespace AND proname=$1",[name])).rows[0].n).toBe(0);
  expect((await f.c.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='local_identity' AND column_name='quality_tier'")).rows[0].n).toBe(0);
  await own(c=>c.query('SELECT local_identity.prune_production_metrics()'));
  const next=randomUUID();await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_narration','ready','{}')",[next,f.episode]);
  expect((await f.c.query("SELECT count(*)::int n FROM local_identity.production_metric_events WHERE event_type='queue_entered' AND payload->>'task_id'=$1",[next])).rows[0].n).toBe(1);
 }finally{await f.close();}
},120000);
