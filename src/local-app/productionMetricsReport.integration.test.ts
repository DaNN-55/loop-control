// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {nativeWorkspaceFixture} from './nativeWorkspace.fixture';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {narrationFixture} from './workspaceNarration.fixture';
import {readProductionMetricsReport} from './productionMetricsReport';
import {ownerTransaction} from './ownerTransaction';
import {LocalEpisodeCommands} from './episodeCommands';
import {createLocalHandler} from './localRoute';
import {csrfFor} from './sessions';
import type {RuntimeRequestLogEvent} from './runtimeRequestLog';
const contextPath=process.env.LOOP_METRICS_TEST_CONTEXT;
async function isolated(){const {runtimeContext}=await import(contextPath!);const context=runtimeContext();if(context.dailyRuntime!==false||context.isolatedFixtureNative!==true)throw Error('Only an owned isolated native cluster is permitted');return context;}
async function digest(f:Awaited<ReturnType<typeof nativeWorkspaceFixture>>){
 const rows=(await f.c.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN('public','local_identity','loop_internal') ORDER BY 1,2")).rows;
 const snapshot:Record<string,unknown>={};
 for(const row of rows){const table='"'+row.schemaname+'"."'+row.tablename+'"';snapshot[table]=(await f.c.query(`SELECT count(*)::int n,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) hash FROM ${table} t`)).rows[0];}
 return snapshot;
}

it.skipIf(!contextPath)('exports the existing Owner snapshot through the real CLI without changing any database table or enabling collection',async()=>{
 const context=await isolated(),f=await nativeWorkspaceFixture({testContextModule:contextPath});
 try{
  const account=randomUUID(),episode=randomUUID(),task=randomUUID();
  await f.c.query("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1::uuid,$1::uuid::text,'Isolated report','Asia/Shanghai')",[account]);
  await f.c.query("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner')",[account,f.owner]);
  await f.c.query("INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES($1,$1,1,'{}',true)",[account]);
  await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,created_at) VALUES($1,$2,$2,'Private title must not leak','2025-11-01T00:00:00Z')",[episode,account]);
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,provider,model,input_snapshot) VALUES($1,$2,'generate_narration','completed','volcengine_tts','seed-tts-2.0','{}')",[task,episode]);
  for(const [attempt,start,end]of [[0,'2025-11-01T00:00:00Z','2025-11-01T00:00:20Z'],[1,'2025-11-01T00:00:10Z','2025-11-01T00:00:30Z']])await f.c.query("INSERT INTO public.task_runs(task_id,attempt,task_package,status,started_at,completed_at,actual_cost_cents) VALUES($1,$2,'{}','completed',$3,$4,0)",[task,attempt,start,end]);
  const deployment=join(f.root,'report-deployment.json');await writeFile(deployment,JSON.stringify({database:{host:'127.0.0.1',port:context.nativeConnection.port,database:f.database,user:'loop_app',password:'isolated-observability'}}),{mode:0o600});
  const before=await digest(f);
  const args=['scripts/production-metrics.mjs','--deployment',deployment,'--owner',f.owner,'--from','2025-11-01','--to-exclusive','2025-12-01'];
  const result=await promisify(execFile)(process.execPath,args,{cwd:process.cwd(),timeout:15000});
  expect(result.stderr).toBe('');const report=JSON.parse(result.stdout);
  expect(report.collection).toMatchObject({state:'disabled',enabled:false,activityEventsInWindow:0,resourceSampling:{configuredForRequestedOwner:false,samplesInWindow:0}});
  expect(report.summary.retained.time).toMatchObject({recordedRunSlotSeconds:40,recordedRunUnionSeconds:30});
  expect(report.summary.retained.money).toMatchObject({supplierPaidCents:null,reportedPositiveCentsForStartedAttempts:null,unpricedGenerationAttemptsStarted:2});
  expect(report.summary.collected.detail.money.supplierPaid).toBeNull();
  expect(result.stdout).not.toMatch(/Private title must not leak|isolated-observability|password|lease_token/);
  await writeFile(deployment,JSON.stringify({database:{host:'127.0.0.1',port:context.nativeConnection.port,database:f.database,user:'loop_app',password:'isolated-observability'},productionMetrics:{enabled:true,ownerId:f.owner.toUpperCase()}}),{mode:0o600});
  const configured=JSON.parse((await promisify(execFile)(process.execPath,args,{cwd:process.cwd(),timeout:15000})).stdout);
  expect(configured.collection).toMatchObject({enabled:false,resourceSampling:{configuredForRequestedOwner:true,samplesInWindow:0}});
  const other=await readProductionMetricsReport(f.pool,f.other,{from:'2025-11-01',toExclusive:'2025-12-01'},false);expect(other.summary.retained.attempts.started).toBe(0);
  const worker=f.workerPool();await expect(readProductionMetricsReport(worker,f.owner,{from:'2025-11-01',toExclusive:'2025-12-01'},false)).rejects.toThrow();
  expect(await digest(f)).toEqual(before);
  await expect(ownerTransaction(f.pool,f.owner,true,c=>c.query("UPDATE public.tasks SET model='forbidden' WHERE id=$1",[task]))).rejects.toMatchObject({code:'25006'});
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  const enabledBefore=await digest(f),enabled=await readProductionMetricsReport(f.pool,f.owner.toUpperCase(),{from:'2025-11-01',toExclusive:'2025-12-01'},true);
  expect(enabled.collection).toMatchObject({state:'enabled',activityEventsInWindow:0,resourceSampling:{configuredForRequestedOwner:true,samplesInWindow:0,health:'not_observed_by_this_report'}});
  expect(await digest(f)).toEqual(enabledBefore);
 }finally{await f.close();}
},60000);

it.skipIf(!contextPath)('logs only verified identities on real commands, replays and denied requests while leaving collection off',async()=>{
 await isolated();const f=await productionWorkspaceFixture({testContextModule:contextPath});
 const events:RuntimeRequestLogEvent[]=[];let failSink=false;
 const commands=new LocalEpisodeCommands(f.pool,f.root,{ready:async()=>{},wake(){throw Error('No Provider allowed');},mountPath:f.root,minimumFreeBytes:0,checkReferences:async()=>{throw Error('No Provider allowed');},openDirectory:async()=>{}});
 const server=createServer();
 try{
  const prepared=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(prepared.status).toBe(200);const workspace=prepared.body;
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  server.on('request',createLocalHandler({pool:f.pool,origin,mediaRoot:f.root,episodes:commands,log:event=>{events.push(event);if(failSink)throw Error('log sink failure');}}));
  const key=randomUUID(),send=async(command:string,data:Record<string,unknown>,token=f.token,idempotencyKey=randomUUID(),endpoint='episode-commands')=>{
   const response=await fetch(origin+'/api/local/'+endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+token,'X-CSRF-Token':csrfFor(token)},body:JSON.stringify({command,data,idempotencyKey})});return{status:response.status,body:await response.json()};
  };
  const sound={episodeId:f.episode,workspaceId:workspace.id,expectedRevision:workspace.revision,expectedProjectSha256:workspace.project.sha256,shotId:workspace.clips[0].shotId,soundIntent:'private content excluded'};
  expect((await send('saveWorkspaceSoundIntent',sound,f.token,key)).status).toBe(200);
  const saved=events.at(-1)!;expect(saved).toMatchObject({operation:'episode.saveWorkspaceSoundIntent',episodeId:f.episode,workspaceId:workspace.id,shotId:sound.shotId,phase:'responded',httpStatus:200});expect(saved.accountId).toMatch(/^[0-9a-f-]{36}$/);
  expect((await send('saveWorkspaceSoundIntent',sound,f.token,key)).status).toBe(200);
  expect(events.at(-1)).toMatchObject({episodeId:f.episode,workspaceId:workspace.id});
  expect((await send('saveWorkspaceSoundIntent',sound,f.otherToken)).status).toBe(404);
  expect(events.at(-1)).not.toHaveProperty('episodeId');expect(events.at(-1)).not.toHaveProperty('workspaceId');
  expect((await send('private-secret-operation',{episodeId:f.episode})).status).toBe(400);expect(events.at(-1)).not.toHaveProperty('operation');
  expect((await send('readAssetDirectory',{accountId:saved.accountId},f.token,randomUUID(),'account-commands')).status).toBe(200);
  expect(events.at(-1)).toMatchObject({operation:'account.readAssetDirectory',accountId:saved.accountId,route:'/api/local/account-commands'});
  expect(events.at(-1)).not.toHaveProperty('episodeId');
  expect((await send('readAssetDirectory',{accountId:saved.accountId},f.otherToken,randomUUID(),'account-commands')).status).toBe(404);
  expect(events.at(-1)).not.toHaveProperty('accountId');
  failSink=true;expect((await send('openDirectory',{episodeId:f.episode})).status).toBe(200);
  expect(JSON.stringify(events)).not.toMatch(/private content excluded|private-secret-operation|idempotencyKey|password|loop_owner_session/);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_metric_controls')).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_metric_events')).rows[0].n).toBe(0);
 }finally{server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));await commands.close();await f.close();}
},60000);

it.skipIf(!contextPath)('correlates a confirmed real SQL generation queue and its replay without sending any Provider request',async()=>{
 await isolated();const f=await narrationFixture(),events:RuntimeRequestLogEvent[]=[];
 const commands=new LocalEpisodeCommands(f.pool,f.root,{ready:async()=>{},wake(){},mountPath:f.root,minimumFreeBytes:0,checkReferences:async()=>{},narrationReady:async()=>{}}),server=createServer();
 try{
  await f.authorize();let workspace=f.made;const clip=workspace.clips[0];
  for(const [command,extra]of [['saveWorkspaceNarration',{mode:'tts',...f.narrationSettings,text:'只入队，不调用供应商。'}],['confirmWorkspaceNarration',{}]]as const){const r=await f.request(command,{workspaceId:workspace.id,expectedRevision:workspace.revision,clipId:clip.id,...extra});expect(r.status).toBe(200);workspace=r.body;}
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  server.on('request',createLocalHandler({pool:f.pool,origin,mediaRoot:f.root,episodes:commands,log:e=>events.push(e)}));
  const send=async(command:string,data:Record<string,unknown>,key=randomUUID())=>{const r=await fetch(origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:key,data:{episodeId:f.episode,workspaceId:workspace.id,expectedRevision:workspace.revision,...data}})});return{status:r.status,body:await r.json()};};
  const proposal=await send('prepareWorkspaceCall',{callCommand:'generateWorkspaceNarration',callData:{episodeId:f.episode,workspaceId:workspace.id,expectedRevision:workspace.revision,clipId:clip.id,reservationCents:100}});expect(proposal.status,JSON.stringify(proposal.body)).toBe(200);
  const key=randomUUID(),data={confirmationId:proposal.body.confirmationId};const queued=await send('confirmWorkspaceCall',data,key);expect(queued.status,JSON.stringify(queued.body)).toBe(200);
  const taskId=queued.body.narration.find((n:{clipId:string})=>n.clipId===clip.id).taskId;
  expect(events.at(-1)).toMatchObject({operation:'episode.confirmWorkspaceCall',episodeId:f.episode,workspaceId:workspace.id,shotId:clip.shotId,taskId});
  expect((await send('confirmWorkspaceCall',data,key)).status).toBe(200);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.workspace_narration_requests WHERE workspace_id=$1',[workspace.id])).rows[0].n).toBe(1);
  expect((await f.c.query('SELECT count(*)::int n FROM public.task_runs WHERE task_id=$1',[taskId])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_metric_events')).rows[0].n).toBe(0);
 }finally{server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));await commands.close();await f.close();}
},60000);
