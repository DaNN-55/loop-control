// @vitest-environment node
// Explicit fixture only: real Owner HTTP, PostgreSQL, file verification and 040
// triggers. A surrounding transaction uses savepoints for command transactions
// and always rolls back; readiness/wake ports never execute a Provider.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {Duplex} from 'node:stream';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {it,expect} from 'vitest';
import {createLocalHandler} from './localRoute';
import {LocalEpisodeCommands} from './episodeCommands';
import {LocalConnections} from './connections';
import {createProviderProbe} from './providerProbe';
import {assertMediaReady} from './mediaWorker';
import {nativeWorkerPort} from './workerDatabase';
const fixturePath=process.env.LOOP_CLIP_PREFLIGHT_TEST_FIXTURE;
assert(fixturePath,'Set LOOP_CLIP_PREFLIGHT_TEST_FIXTURE to an explicitly approved private fixture');
const fixture=JSON.parse(await readFile(fixturePath,'utf8'));
assert.equal(fixture.purpose,'native-clip-expired-policy');
assert.equal(fixture.testOnly,true);
const deployment=JSON.parse(await readFile(fixture.deploymentFile,'utf8'));
const owner=JSON.parse(await readFile(fixture.ownerFile,'utf8'));
assert.equal(deployment.database.host,'127.0.0.1');
assert.equal(deployment.database.user,'loop_app');
assert.equal(deployment.database.database,fixture.database);
assert(/^loop_[a-z0-9_]+$/.test(fixture.database),'Only explicitly named isolated loop database');

async function runCase(localClip=true,mediaWasEnabled=true){
 const privateProfile=JSON.parse(await readFile(fixture.profileFile,'utf8'));let secretReads=0,providerCalls=0;
 const policy=JSON.parse(await readFile(privateProfile.network.directory+'/policy.json','utf8'));assert(Date.parse(policy.expiresAt)<Date.now(),'Use the actual naturally expired policy; never extend authorization');
 const probe=createProviderProbe(privateProfile.network,async()=>{providerCalls++;throw Error('No Provider calls permitted');});assert.equal(probe.networkAvailable,false);const providerLedgerBefore=await readFile(privateProfile.network.directory+'/state.json');
 const realPool=new Pool({...deployment.database,max:3});
 const {assertDatabase,env:containerEnvironment}=await import(fixture.nativeEnvironmentModule);assertDatabase();
 // The approved container exposes local peer/trust admin only. No host password,
 // pg_hba change or role grant: forward the existing Unix socket to node-pg.
 const bridges:ReturnType<typeof spawn>[]=[];
 const adminPool=new Pool({...deployment.database,user:'postgres',password:undefined,max:1,stream:()=>{
  const bridge=spawn('docker',['exec','-i','loop-control-stage-d-postgres','perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die 'socket'; my $sel=IO::Select->new(\\*STDIN,$s); while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die 'write' unless $w;substr($b,0,$w,'');}}}"],{env:containerEnvironment,stdio:['pipe','pipe','pipe']});bridges.push(bridge);
  const stream=Duplex.from({readable:bridge.stdout!,writable:bridge.stdin!});
  return Object.assign(stream,{connect(){queueMicrotask(()=>stream.emit('connect'));return stream;},setNoDelay(){return stream;},setKeepAlive(){return stream;}});
 }} as ConstructorParameters<typeof Pool>[0]);
 const client=await adminPool.connect();await client.query('SET SESSION AUTHORIZATION loop_app');
 let commandOpen=false,wakes=0,testActive=false;
 const scopedClient={
  async query(text:string,values?:unknown[]){
   if(text==='BEGIN'){assert(!commandOpen);commandOpen=true;return client.query('SAVEPOINT native_tts_command');}
   if(text==='COMMIT'){assert(commandOpen);commandOpen=false;return client.query('RELEASE SAVEPOINT native_tts_command');}
   if(text==='ROLLBACK'){assert(commandOpen);commandOpen=false;await client.query('ROLLBACK TO SAVEPOINT native_tts_command');return client.query('RELEASE SAVEPOINT native_tts_command');}
   return client.query(text,values);
  },release(){},
 } as unknown as PoolClient;
 const commandPool={query:realPool.query.bind(realPool),connect:async()=>testActive?scopedClient:realPool.connect()} as unknown as Pool;
 const connections=new LocalConnections(commandPool,{mode:'keychain',async get(){secretReads++;throw Error('Store locked');},async putImmutable(){throw Error('No writes');}},probe);
 const commands=new LocalEpisodeCommands(commandPool,deployment.mediaRoot,{ready:async()=>{},narrationReady:async()=>{throw Error('Local clip must not prepare narration');},mediaReady:async()=>{throw Error('Local clip must not prepare Blueprint external media');},localClipReady:async()=>assertMediaReady({mode:'local'}),mountPath:fixture.mountPath,minimumFreeBytes:0,checkReferences:connections.assertBlueprintReferences.bind(connections),wake(){wakes++;}});
 let handler:ReturnType<typeof createLocalHandler>;
 const server=createServer((req,res)=>handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 handler=createLocalHandler({pool:commandPool,episodes:commands,origin,mediaRoot:deployment.mediaRoot});
 // Login uses the ordinary route and real pool, outside the rolled-back command.
 const login=await fetch(origin+'/api/local/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:owner.email,password:owner.password})});
 assert.equal(login.status,200);
 const headers={Origin:origin,'Content-Type':'application/json',Cookie:login.headers.get('set-cookie')!.split(';')[0],'X-CSRF-Token':(await login.json()).csrfToken};
 testActive=true;await client.query('BEGIN');await client.query("SELECT set_config('loop.owner_id',$1,true)",[owner.id]);
 const before=(await client.query('SELECT to_jsonb(i) snapshot FROM local_identity.input_episodes i WHERE episode_id=$1',[fixture.episodeId])).rows[0].snapshot;
 const draft=(await client.query('SELECT * FROM public.shot_preparation_drafts WHERE episode_id=$1 AND review_package_id=$2 AND shot_id=$3',[fixture.episodeId,fixture.reviewPackageId,fixture.shotId])).rows[0];
 const originalRows=(await client.query('SELECT to_jsonb(t) snapshot FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[fixture.episodeId])).rows;
 const originalTasks=(await client.query('SELECT count(*)::integer n FROM public.tasks WHERE episode_id=$1',[fixture.episodeId])).rows[0].n;
 try{
  let pendingExternalTaskId:string|undefined;
  if(!mediaWasEnabled){
   await client.query('RESET SESSION AUTHORIZATION');
   await client.query('UPDATE local_identity.input_episodes SET media_enabled=false WHERE episode_id=$1',[fixture.episodeId]);
   const unplannedShot='unplanned-external-'+randomUUID();
   await client.query("UPDATE public.review_packages SET context_snapshot=jsonb_set(context_snapshot,'{worker_result,storyboard,shots}',(context_snapshot#>'{worker_result,storyboard,shots}')||jsonb_build_array(jsonb_set(context_snapshot#>'{worker_result,storyboard,shots,0}','{id}',to_jsonb($2::text)))) WHERE id=$1",[fixture.reviewPackageId,unplannedShot]);
   pendingExternalTaskId=randomUUID();
   await client.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version) SELECT $1::uuid,episode_id,task_type,'ready',(input_snapshot-'native_output_namespace')||jsonb_build_object('configuration_hash',$1::uuid::text,'shot',jsonb_set(input_snapshot->'shot','{id}',to_jsonb($3::text))),0,1,provider,model,prompt_version FROM public.tasks WHERE id=$2",[pendingExternalTaskId,fixture.externalTaskId,'pending-external-'+randomUUID()]);
   await client.query('SET SESSION AUTHORIZATION loop_app');
  }
  const taskCountBeforeCommand=(await client.query('SELECT count(*)::integer n FROM public.tasks WHERE episode_id=$1',[fixture.episodeId])).rows[0].n;
  const dispatchBefore=(await client.query('SELECT to_jsonb(i) snapshot FROM local_identity.input_episodes i WHERE episode_id=$1',[fixture.episodeId])).rows[0].snapshot;
  const response=await fetch(origin+'/api/local/episode-commands',{method:'POST',headers,body:JSON.stringify({command:localClip?'generateClip':'planMedia',idempotencyKey:randomUUID(),data:{episodeId:fixture.episodeId,reviewPackageId:fixture.reviewPackageId,...(localClip?{shotId:fixture.shotId,retry:true}:{})}})});
  const result=await response.json();
  expect(secretReads).toBe(0);expect(providerCalls).toBe(0);
  if(localClip&&mediaWasEnabled){
   expect(response.status,JSON.stringify(result)).toBe(200);expect(result.id).not.toBe(fixture.oldClipTaskId);expect(result.provider).toBe('ffmpeg');expect(result.input_snapshot.media.adapter).toBe('ffmpeg_trim_video');expect(result.input_snapshot.native_output_namespace).toBe(result.id);expect(wakes).toBe(1);expect((await client.query('SELECT to_jsonb(i) snapshot FROM local_identity.input_episodes i WHERE episode_id=$1',[fixture.episodeId])).rows[0].snapshot).toEqual(dispatchBefore);
  }else{
   expect(response.status).toBe(409);expect(result.preflight.checks).toContainEqual(expect.objectContaining({check:'provider_network_policy',status:'unavailable'}));expect(wakes).toBe(0);expect((await client.query('SELECT count(*)::integer n FROM public.tasks WHERE episode_id=$1',[fixture.episodeId])).rows[0].n).toBe(taskCountBeforeCommand);
   if(!mediaWasEnabled){
    expect((await client.query('SELECT media_enabled FROM local_identity.input_episodes WHERE episode_id=$1',[fixture.episodeId])).rows[0].media_enabled).toBe(false);
    await client.query('RESET SESSION AUTHORIZATION');await client.query('SET SESSION AUTHORIZATION loop_worker');
    const worker=nativeWorkerPort({query:client.query.bind(client)} as unknown as Pool);
    expect(await worker.plan({episodeId:fixture.episodeId})).toBe(0);
    expect(await worker.rpc('claim_next_worker_task',{p_task_id:pendingExternalTaskId,p_worker_capacity:1})).toEqual([]);
    await client.query('RESET SESSION AUTHORIZATION');await client.query('SET SESSION AUTHORIZATION loop_app');
    expect((await client.query('SELECT count(*)::integer n FROM public.tasks WHERE episode_id=$1',[fixture.episodeId])).rows[0].n).toBe(taskCountBeforeCommand);
    expect((await client.query('SELECT status,attempt FROM public.tasks WHERE id=$1',[pendingExternalTaskId])).rows[0]).toEqual({status:'ready',attempt:0});
    expect(secretReads).toBe(0);expect(providerCalls).toBe(0);
   }
  }
 }finally{
  await client.query('ROLLBACK');await client.query('RESET SESSION AUTHORIZATION');await client.query('SET SESSION AUTHORIZATION loop_app');
  await client.query('BEGIN');await client.query("SELECT set_config('loop.owner_id',$1,true)",[owner.id]);
  const after=(await client.query('SELECT to_jsonb(i) snapshot FROM local_identity.input_episodes i WHERE episode_id=$1',[fixture.episodeId])).rows[0].snapshot;
  expect(after).toEqual(before);
  expect((await client.query('SELECT * FROM public.shot_preparation_drafts WHERE episode_id=$1 AND review_package_id=$2 AND shot_id=$3',[fixture.episodeId,fixture.reviewPackageId,fixture.shotId])).rows[0]).toEqual(draft);
  expect((await client.query('SELECT count(*)::integer n FROM public.tasks WHERE episode_id=$1',[fixture.episodeId])).rows[0].n).toBe(originalTasks);
  expect((await client.query('SELECT to_jsonb(t) snapshot FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[fixture.episodeId])).rows).toEqual(originalRows);
  expect(await readFile(privateProfile.network.directory+'/state.json')).toEqual(providerLedgerBefore);
  await client.query('ROLLBACK');
  await fetch(origin+'/api/local/logout',{method:'POST',headers});
  client.release();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await commands.close();await realPool.end();await adminPool.end();for(const bridge of bridges)bridge.kill();
 }
}

it('rejects first media opt-in from a local clip when the Provider policy has expired',async()=>{await runCase(true,false);});
it('creates a local FFmpeg clip through Owner HTTP with the actual expired Provider policy and locked store',async()=>{await runCase();});
it('keeps external media planning blocked by that expired policy without reading secrets or transport',async()=>{await runCase(false);});
