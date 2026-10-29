// @vitest-environment node
// All fixture rows stay in one uncommitted transaction and are rolled back.
import {it,expect} from 'vitest';
import {Pool,type PoolClient} from 'pg';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {Duplex} from 'node:stream';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRuntimeStatusReader} from './runtimeStatus';
import {createLocalHandler} from './localRoute';
import {tokenHash,sessionCookie} from './sessions';
import {hashPassword} from './password';

it.skipIf(process.env.LOOP_RUNTIME_STATUS_ACCEPTANCE!=='1')('reads scoped current queue through authenticated HTTP and actual OS resources without changing persisted data',async()=>{
 const {runtimeContext}=await import(new URL('../../scripts/runtime/environment.mjs',import.meta.url).href);
 const context=runtimeContext();context.assertDatabase();
 const bridge=spawn('docker',['exec','-i',context.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die 'socket'; my $sel=IO::Select->new(\\*STDIN,$s); while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die 'write' unless $w;substr($b,0,$w,'');}}}"],{env:context.env,stdio:['pipe','pipe','pipe']});
 const stream=Duplex.from({readable:bridge.stdout!,writable:bridge.stdin!});
 const admin=new Pool({database:context.database,user:'postgres',max:1,stream:()=>Object.assign(stream,{connect(){queueMicrotask(()=>stream.emit('connect'));return stream;},setNoDelay(){return stream;},setKeepAlive(){return stream;}})} as ConstructorParameters<typeof Pool>[0]);
 const c=await admin.connect(),temp=await mkdtemp(join(tmpdir(),'loop-status-'));
 const owner=randomUUID(),other=randomUUID(),member=randomUUID(),account=randomUUID(),foreign=randomUUID(),memberAccount=randomUUID(),episode=randomUUID(),archived=randomUUID();
 const token=randomBytes(32).toString('hex');let server:ReturnType<typeof createServer>|undefined;
 const fingerprint=async()=>{const values=[];for(const table of ['accounts','episodes','tasks'])values.push((await c.query(`SELECT count(*)::int n,md5(coalesce(string_agg(row_to_json(t)::text,E'\n' ORDER BY row_to_json(t)::text),'')) sha FROM public.${table} t`)).rows[0]);return values;};
 const before=await fingerprint();
 try{
  await c.query('BEGIN');
  for(const id of [owner,other,member])await c.query('INSERT INTO local_identity.owners(id,email) VALUES($1,$2)',[id,id+'@example.invalid']);
  for(const [id,user,role] of [[account,owner,'owner'],[foreign,other,'owner'],[memberAccount,owner,'worker']]){
   await c.query("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1,$2,'Runtime fixture','Asia/Shanghai')",[id,'runtime-'+id]);
   await c.query('INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,$3)',[id,user,role]);
   await c.query("INSERT INTO public.account_blueprint_versions(id,account_id,version,policy) VALUES($1,$1,1,'{}')",[id]);
  }
  const episodes=[episode,archived,randomUUID(),randomUUID(),randomUUID()];
  for(let i=0;i<episodes.length;i++)await c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage,archived_at) VALUES($1,$2,$2,$3,'waiting_input',$4)",[episodes[i],i===2?foreign:i===3?memberAccount:account,'Runtime '+i,i===1?new Date():null]);
  let sequence=0;const base=Date.now();
  async function task(status:string,input:unknown={},type='generate_narration',ep=episode,extra=''){
   return (await c.query(`INSERT INTO public.tasks(episode_id,task_type,status,input_snapshot,created_at${extra?',invalidated_at,invalidated_reason':''}) VALUES($1,$2,$3,$4,$5${extra?",now(),'fixture invalidation'":''}) RETURNING id`,[ep,type,status,input,new Date(base+sequence++)])).rows[0].id;
  }
  await task('running');for(let i=0;i<21;i++)await task('ready');await task('blocked');
  await task('failed',{output:{relative_path:'resolved.wav'}});await task('completed',{output:{relative_path:'resolved.wav'}});
  const recovered=await task('failed',{},'generate_a_roll');await task('completed',{recovered_from_task_id:recovered},'generate_a_roll');
  await task('failed',{},'generate_review_render');await task('superseded',{},'generate_review_render');
  await task('ready',{},'generate_narration',episode,'invalidate');
  for(const ep of episodes.slice(1))await task('ready',{},'generate_narration',ep);
  await c.query('INSERT INTO local_identity.historical_episodes(episode_id) VALUES($1)',[episodes[4]]);
  const historical=await task('ready');await c.query('INSERT INTO local_identity.historical_tasks(task_id) VALUES($1)',[historical]);
  await c.query('INSERT INTO local_identity.credentials(owner_id,password_digest) VALUES($1,$2)',[owner,await hashPassword(randomBytes(24).toString('hex'))]);
  await c.query("INSERT INTO local_identity.sessions(token_hash,owner_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[tokenHash(token),owner]);
  await c.query('SET SESSION AUTHORIZATION loop_app');
  const scoped={query:async(text:string,values?:unknown[])=>{if(text.startsWith('BEGIN'))return c.query('SAVEPOINT runtime_read');if(text==='COMMIT')return c.query('RELEASE SAVEPOINT runtime_read');if(text==='ROLLBACK'){await c.query('ROLLBACK TO SAVEPOINT runtime_read');return c.query('RELEASE SAVEPOINT runtime_read');}return c.query(text,values);},release(){}} as unknown as PoolClient;
  const pool={connect:async()=>scoped,query:(text:string,values?:unknown[])=>c.query(text,values)} as unknown as Pool;
  const now=new Date().toISOString();
  const reader=createRuntimeStatusReader({pool,projectRoot:process.cwd(),mediaRoot:context.mediaRoot,mountPath:dirname(context.mediaRoot),minimumFreeBytes:1,worker:()=>({stopped:false,lastHeartbeatAt:now,lastScanAt:now,lastError:null,activeWorkers:0,capacity:1})});
  let handler:ReturnType<typeof createLocalHandler>;server=createServer((req,res)=>handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  handler=createLocalHandler({pool,origin,mediaRoot:context.mediaRoot,runtimeStatus:reader});
  const get=(suffix='',cookie=true)=>fetch(origin+'/api/local/system-status'+suffix,{headers:cookie?{Cookie:sessionCookie+'='+token}:undefined});
  expect((await get('',false)).status).toBe(401);
  for(const query of ['?queuePage=0','?queuePage=1&queuePage=2','?unknown=1']){const reply=await get(query);expect({status:reply.status,body:await reply.json()}).toMatchObject({status:400});}
  const response=await get();expect(response.status).toBe(200);const result=await response.json();
  expect(result.maintenanceAvailable).toBe(false);
  expect(result.runtime.queue).toMatchObject({running:1,queued:21,blocked:1,failed:0,total:23,page:1,pageSize:20});
  expect(result.runtime.queue.items).toHaveLength(20);expect(result.runtime.queue.items.every((item:{episodeId:string})=>item.episodeId===episode)).toBe(true);
  expect(result.runtime.worker).toMatchObject({state:'healthy',active:0,capacity:1});
  expect(result.runtime.resources.memory.totalBytes).toBeGreaterThan(0);expect(result.runtime.resources.disk.availableBytes).toBeGreaterThan(0);
  expect(result.runtime.resources.media.state).toBe('healthy');
  expect(result.runtime.resources.media.availableBytes).toBeGreaterThan(0);
  const second=await (await get('?queuePage=2')).json();expect(second.runtime.queue.items).toHaveLength(3);
  expect(JSON.stringify(result)).not.toContain('input_snapshot');expect(JSON.stringify(result)).not.toContain('lease_token');
  const disconnected=await createRuntimeStatusReader({pool,projectRoot:temp,mediaRoot:temp,mountPath:temp})(owner);
  expect(disconnected.resources?.media.state).toBe('offline');expect(disconnected.worker.state).toBe('unknown');
  const unavailable=await createRuntimeStatusReader({pool:{connect:async()=>{throw Error('private db error');}} as unknown as Pool,projectRoot:temp,mediaRoot:temp})(owner);
  expect(unavailable.queue).toBeNull();expect(unavailable.resources?.disk?.availableBytes).toBeGreaterThan(0);expect(JSON.stringify(unavailable)).not.toContain('private db error');
 }finally{
  server?.closeAllConnections();if(server?.listening)await new Promise<void>(resolve=>server!.close(()=>resolve()));
  await c.query('ROLLBACK');await c.query('SET SESSION AUTHORIZATION DEFAULT');
  try{expect(await fingerprint()).toEqual(before);}finally{c.release();await admin.end();bridge.kill();await rm(temp,{recursive:true,force:true});}
 }
},30000);
