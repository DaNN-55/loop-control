// @vitest-environment node
// Opt-in, real PostgreSQL, all migration/fixture changes rolled back. No sends or providers.
import {it,expect} from 'vitest';
import {Pool,type PoolClient} from 'pg';
import {spawn} from 'node:child_process';
import {Duplex} from 'node:stream';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startNativeAutomation,type NativeAutomation} from './nativeAutomation';
import {recordOperation} from '../orchestration/operationsEvidence';
import {healthCheckLabels,type HealthCheck} from '../observability/healthChecks';

it.skipIf(process.env.LOOP_AUTOMATION_HISTORY_ACCEPTANCE!=='1')('isolates original maintenance history, respects due times and preserves daily once-per-slot execution',async()=>{
 const root=process.cwd();
 const {runtimeContext}=await import(join(root,'scripts/runtime/environment.mjs'));
 const context=runtimeContext();context.assertDatabase();
 const bridge=spawn('docker',['exec','-i',context.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die 'socket'; my $sel=IO::Select->new(\\*STDIN,$s); while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die 'write' unless $w;substr($b,0,$w,'');}}}"],{env:context.env,stdio:['pipe','pipe','pipe']});
 const stream=Duplex.from({readable:bridge.stdout!,writable:bridge.stdin!});
 const admin=new Pool({database:context.database,user:'postgres',max:1,stream:()=>Object.assign(stream,{connect(){queueMicrotask(()=>stream.emit('connect'));return stream;},setNoDelay(){return stream;},setKeepAlive(){return stream;}})} as ConstructorParameters<typeof Pool>[0]);
 const c=await admin.connect(),stateDirectory=await mkdtemp(join(tmpdir(),'loop-health-history-'));
 let automation:NativeAutomation|undefined;
 const hashes=async(tables:string[])=>{const rows=[];for(const table of tables)rows.push(await hash(table));return rows;};
 const hash=async(table:string)=>(await c.query(`SELECT count(*)::int count,md5(coalesce(string_agg(row_to_json(t)::text,E'\n' ORDER BY row_to_json(t)::text),'')) sha FROM ${table} t`)).rows[0];
 try{
  await c.query('BEGIN');
  const tables=['automation_plans','automation_jobs','automation_attempts'];
  const archived=(await c.query("SELECT to_regclass('local_identity.historical_automation_jobs') present")).rows[0].present;
  if(!archived){
   const original=await hashes(tables.map(t=>'local_identity.'+t));
   await c.query(readFileSync(join(root,'db/local/062-isolate-historical-automation.sql'),'utf8'));
   expect(await hashes(tables.map(t=>'local_identity.historical_'+t))).toEqual(original);
  }
  if(!(await c.query("SELECT 1 FROM information_schema.columns WHERE table_schema='local_identity' AND table_name='automation_attempts' AND column_name='checks'")).rowCount)await c.query(readFileSync(join(root,'db/local/081-health-check-details.sql'),'utf8'));
  const historical=await hashes(tables.map(t=>'local_identity.historical_'+t));
  const business=await hashes(['public.tasks','public.notification_delivery_events','public.episodes','public.accounts']);
  // Rollback-only fixtures, never touch the original historical rows.
  await c.query('TRUNCATE local_identity.automation_attempts,local_identity.automation_jobs,local_identity.automation_plans');
  const slot=new Date((await c.query("SELECT max(due_at) due FROM local_identity.historical_automation_jobs WHERE kind='health'")).rows[0].due);
  expect(Number.isFinite(slot.getTime())).toBe(true);
  let clock=new Date(slot.getTime()+3600000),healthCalls=0,backupCalls=0,sends=0;
  await c.query("INSERT INTO local_identity.automation_plans(kind,next_due_at) VALUES('health',$1)",[slot]);
  await c.query("INSERT INTO local_identity.automation_jobs(kind,due_at,available_at) VALUES('health',$1,$2)",[new Date(slot.getTime()+86400000),new Date(slot.getTime()-86400000)]);
  await c.query('SET SESSION AUTHORIZATION loop_app');
  const scoped={async query(text:string,values?:unknown[]){if(text==='BEGIN')return c.query('SAVEPOINT automation_scan');if(text==='COMMIT')return c.query('RELEASE SAVEPOINT automation_scan');if(text==='ROLLBACK'){await c.query('ROLLBACK TO SAVEPOINT automation_scan');return c.query('RELEASE SAVEPOINT automation_scan');}return c.query(text,values);},release(){}} as unknown as PoolClient;
  const query=async(text:string,values?:unknown[])=>{
   if(text==='SELECT local_identity.initialize_native_notifications()')return {rows:[]};
   if(text==='SELECT * FROM local_identity.claim_native_notification()')return {rows:[]};
   if(text==='SELECT local_identity.unresolved_native_notifications() count')return {rows:[{count:0}]};
   return c.query(text,values);
  };
  const pool={query,connect:async()=>scoped} as unknown as Pool;
  const checks=(Object.keys(healthCheckLabels) as HealthCheck['id'][]).map(id=>({id,passed:true,detail:'通过'}));
  const options={pool,projectRoot:root,mediaRoot:context.mediaRoot,stateDirectory,backupsEnabled:false,now:()=>clock,intervalMs:60000,recordSchedule:false,send:async()=>{sends++;},health:async()=>{healthCalls++;const passed=healthCalls!==2;return{passed,detail:passed?'3 项检查通过。':'1 项检查失败。',checks:checks.map(check=>({...check,passed:passed||check.id!=='runtime',detail:!passed&&check.id==='runtime'?'运行程序未准备。':check.detail}))};},backup:async()=>{backupCalls++;return{passed:true,detail:'Must not run'};}};
  automation=await startNativeAutomation(options);await automation.wake();
  expect(healthCalls,'future available_at must not bypass due_at; old same-day history must not suppress current check').toBe(1);
  await automation.wake();expect(healthCalls).toBe(1);
  const status=await automation.status();expect(status.jobs).toHaveLength(1);expect(status.operations.health?.latest.passed).toBe(true);
  expect(status.operations.health?.latest.at).toBe(clock.toISOString());
  expect(status.operations.health?.latest.checks).toEqual(checks);
  expect((await c.query('SELECT checks FROM local_identity.automation_jobs WHERE passed=true')).rows[0].checks).toEqual(checks);
  expect((await c.query("SELECT count(*)::int n FROM local_identity.automation_plans WHERE kind='backup'")).rows[0].n).toBe(0);
  clock=new Date(clock.getTime()+86400000);await automation.wake();await automation.wake();expect(healthCalls).toBe(2);
  const failed=(await automation.status()).operations.health!.lastFailure!;expect(failed.checks?.[2]).toMatchObject({id:'runtime',passed:false});
  clock=new Date(clock.getTime()+60001);await automation.wake();expect(healthCalls).toBe(3);
  const retried=await automation.status();expect(retried.operations.health?.latest.checks).toEqual(checks);expect(retried.operations.health?.lastFailure?.checks).toEqual(failed.checks);
  const attempts=(await c.query('SELECT passed,checks FROM local_identity.automation_attempts ORDER BY started_at,attempt')).rows;expect(attempts.map(r=>r.passed)).toEqual([true,false,true]);expect(attempts[1].checks).toEqual(failed.checks);
  expect(backupCalls).toBe(0);expect(sends).toBe(0);
  await automation.stop();automation=undefined;
  await c.query('SAVEPOINT history_readonly');
  await expect(c.query("UPDATE local_identity.historical_automation_jobs SET detail='overwrite'")).rejects.toThrow(/permission denied/);
  await c.query('ROLLBACK TO SAVEPOINT history_readonly');
  await c.query('SET SESSION AUTHORIZATION DEFAULT');
  expect(await hashes(tables.map(t=>'local_identity.historical_'+t))).toEqual(historical);
  expect(await hashes(['public.tasks','public.notification_delivery_events','public.episodes','public.accounts'])).toEqual(business);
  // Stale filesystem evidence and invalid attempt dates must not become current health.
  await c.query('TRUNCATE local_identity.automation_attempts,local_identity.automation_jobs');
  await c.query("UPDATE local_identity.automation_plans SET next_due_at=$1",[new Date(clock.getTime()+86400000)]);
  await recordOperation(stateDirectory,'health',{passed:false,detail:'Old acceptance cache'});
  const invalidJob=(await c.query("INSERT INTO local_identity.automation_jobs(kind,due_at,available_at,status,attempt) VALUES('health',$1,$1,'completed',3) RETURNING id",[new Date(clock.getTime()-7200000)])).rows[0].id;
  await c.query(`INSERT INTO local_identity.automation_attempts(job_id,attempt,token,started_at,completed_at,status,passed)
   VALUES($1,1,gen_random_uuid(),$2::timestamptz+interval '1 hour',$2,'completed',true),
    ($1,2,gen_random_uuid(),$2::timestamptz-interval '3 hours',$2,'completed',true),
    ($1,3,gen_random_uuid(),$2,$2::timestamptz+interval '1 hour','completed',true)`,[invalidJob,clock]);
  await c.query('SET SESSION AUTHORIZATION loop_app');
  automation=await startNativeAutomation(options);await automation.wake();
  expect((await automation.status()).operations.health).toBeUndefined();
  expect(healthCalls).toBe(3);
 }finally{
  await automation?.stop();await c.query('SET SESSION AUTHORIZATION DEFAULT');await c.query('ROLLBACK');c.release();await admin.end();bridge.kill();await rm(stateDirectory,{recursive:true,force:true});
 }
},60000);
