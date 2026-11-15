// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {narrationFixture,adoptInitialNarration} from './workspaceNarration.fixture';
import {nativeWorkspaceFixture} from './nativeWorkspace.fixture';
import {ownerTransaction} from './ownerTransaction';
import {observeProductionRequest} from './productionMetricWrites';
import {readProductionMetricsV2} from './productionMetricsCollected';
import {startOwnerProductionMetricsSampler} from './productionMetricsSampler';
import {ProviderOutcomeUnknownError} from '../worker/providerOutcome';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
const contextPath=process.env.LOOP_METRICS_TEST_CONTEXT;
async function isolated(){const {runtimeContext}=await import(contextPath!);const c=runtimeContext();if(c.dailyRuntime!==false||c.isolatedFixtureContainer!==true)throw Error('Only isolated fixtures');}
it.skipIf(!contextPath)('collects real controlled Chinese narration, frozen estimate, adoption, withdrawal, re-adoption and reopen without storing text',async()=>{
 await isolated();const f=await narrationFixture();
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  await f.authorize();let w=f.made;const clip=w.clips[0];
  const send=async(command:string,extra:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...(['saveWorkspaceNarration','confirmWorkspaceNarration','generateWorkspaceNarration','withdrawWorkspaceNarration'].includes(command)?{clipId:clip.id}:{}),...extra});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;return r;};
  await send('saveWorkspaceNarration',{mode:'tts',...f.narrationSettings,text:'隔离样例，只验证统计事实，不调用真实供应商。'});
  await send('confirmWorkspaceNarration');await send('generateWorkspaceNarration',{reservationCents:100});const task=w.narration[0].taskId;
  const estimate=(await f.c.query("SELECT payload FROM local_identity.production_metric_events WHERE event_type='estimate_frozen' AND payload->>'task_id'=$1",[task])).rows[0]?.payload;
  expect(estimate).toMatchObject({task_id:task,estimate_known:true,currency:'CNY',pricing:{sourceCurrency:'CNY',conversionRate:1,rateSource:'published_list'}});expect(estimate.pricing.units.characters).toBeGreaterThan(0);
  const sampler=startOwnerProductionMetricsSampler({pool:f.pool,ownerId:f.owner,enabled:true});await sampler.wake();await sampler.stop();
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_metric_resources WHERE owner_id=$1',[f.owner])).rows[0].n).toBe(1);
  await f.execute(task);await send('refreshWorkspaceNarration');w=await adoptInitialNarration(f,w);const candidate=w.candidates.find((v:any)=>v.taskId===task);
  const events=async()=> (await f.c.query("SELECT event_type type,payload FROM local_identity.production_metric_events WHERE episode_id=$1 ORDER BY id",[f.episode])).rows;
  expect((await events()).filter(e=>e.type==='candidate_adopted')).toHaveLength(1);
  await send('withdrawWorkspaceNarration',{audioTrackId:w.narration[0].adoptedAudioTrackId});
  expect((await events()).filter(e=>e.type==='candidate_withdrawn')).toHaveLength(1);
  const prep=await f.request('prepareWorkspaceCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'use-candidate'});expect(prep.status,JSON.stringify(prep.body)).toBe(200);
  await send('adoptWorkspaceCandidate',{candidateId:candidate.id,adoptionId:prep.body.adoptionId});
  expect((await events()).filter(e=>e.type==='candidate_adopted')).toHaveLength(2);
  const baseline=await events();await f.restart();w=await f.read();expect(w.narration[0].adoptedAudioTrackId).toBe(candidate.id);expect(await events()).toEqual(baseline);
  expect(JSON.stringify(baseline)).not.toContain('隔离样例，只验证统计事实');
  const now=new Date(),date=new Date(now.getTime()+8*3600000).toISOString().slice(0,10),tomorrow=new Date(Date.parse(date+'T00:00:00+08:00')+86400000+8*3600000).toISOString().slice(0,10);
  const summary=await readProductionMetricsV2(f.pool,f.owner,{from:date,toExclusive:tomorrow,includeTestEpisodes:true});
  expect(summary.collected?.detail.candidates).toMatchObject({adopted:2,withdrawn:1});expect(summary.collected?.detail.requests.operations.create).toMatchObject({dispatchMarked:1,responseObserved:1});expect(summary.collected?.detail.money.supplierPaid).toBeNull();
  expect(summary.collected?.anonymousResourceDaily[0]).toMatchObject({samples:1,cpuSamples:0,cpuMean:null});
  const snapshot=await f.c.query("SELECT md5(jsonb_agg(to_jsonb(e) ORDER BY id)::text) value FROM local_identity.production_metric_events e");await readProductionMetricsV2(f.pool,f.owner,{from:date,toExclusive:tomorrow,includeTestEpisodes:true});expect((await f.c.query("SELECT md5(jsonb_agg(to_jsonb(e) ORDER BY id)::text) value FROM local_identity.production_metric_events e")).rows).toEqual(snapshot.rows);
  // A retained silent node is not an adopted main voice; restoring audibility is.
  const {persistWorkspaceRevision,readWorkspaceProject}=await import('./productionWorkspaceCommands');
  await ownerTransaction(f.pool,f.owner,false,async c=>{const row=(await c.query('SELECT * FROM local_identity.production_workspaces WHERE id=$1',[w.id])).rows[0];const p=await readWorkspaceProject(c,f.assetRoot,row);const voice=p.timelines.flatMap(t=>t.items).find(v=>v.sourceAssetId===`audio-track-${candidate.id}`)!;voice.volume=0;await persistWorkspaceRevision(c,f.assetRoot,row,p,row.bindings,'隔离静音测试',{nativeEdit:true});});
  expect((await events()).filter(e=>e.type==='candidate_withdrawn')).toHaveLength(2);
  await ownerTransaction(f.pool,f.owner,false,async c=>{const row=(await c.query('SELECT * FROM local_identity.production_workspaces WHERE id=$1',[w.id])).rows[0];const p=await readWorkspaceProject(c,f.assetRoot,row);p.timelines.flatMap(t=>t.items).find(v=>v.sourceAssetId===`audio-track-${candidate.id}`)!.volume=1;await persistWorkspaceRevision(c,f.assetRoot,row,p,row.bindings,'隔离恢复主声',{nativeEdit:true});});
  expect((await events()).filter(e=>e.type==='candidate_adopted')).toHaveLength(3);
  await writeFile(join(f.root,'metrics-summary.json'),JSON.stringify(summary));
 }finally{await f.close();}
},150000);

it.skipIf(!contextPath)('a real SQL response-write failure never repeats a Provider transport and keeps the request marker',async()=>{
 await isolated();const f=await nativeWorkspaceFixture({testContextModule:contextPath});
 try{
  const account=randomUUID(),episode=randomUUID(),task=randomUUID(),lease=randomUUID();
  await f.c.query("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1::uuid,$1::uuid::text,'Isolated metrics','Asia/Shanghai')",[account]);await f.c.query("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner')",[account,f.owner]);await f.c.query("INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES($1,$1,1,'{}',true)",[account]);await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title) VALUES($1,$2,$2,'Isolated')",[episode,account]);
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,attempt,lease_token,claimed_at) VALUES($1,$2,'generate_narration','running','{}',1,$3,clock_timestamp())",[task,episode,lease]);await f.c.query("INSERT INTO public.task_runs(task_id,attempt,task_package,status,lease_token) VALUES($1,0,'{}','running',$2)",[task,lease]);
  await f.c.query("CREATE FUNCTION local_identity.metrics_test_reject_response() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='provider_response_observed' THEN RAISE EXCEPTION 'Isolated forced response persistence failure';END IF;RETURN NEW;END$$;CREATE TRIGGER metrics_test_reject_response BEFORE INSERT ON local_identity.production_metric_events FOR EACH ROW EXECUTE FUNCTION local_identity.metrics_test_reject_response()");
  const transport=vi.fn().mockResolvedValue(new Response('{}',{status:200})),worker=f.workerPool();
  await expect(observeProductionRequest(worker,{p_task_id:task,p_attempt:0,p_lease_token:lease},'create',transport)).rejects.toBeInstanceOf(ProviderOutcomeUnknownError);expect(transport).toHaveBeenCalledTimes(1);
  expect((await f.c.query("SELECT count(*)::int n FROM local_identity.production_metric_events WHERE event_type='provider_request_dispatch'")).rows[0].n).toBe(1);
 }finally{await f.close();}
},120000);

it.skipIf(!contextPath)('freezes the confirmed delivery tier while a real isolated Worker verifies and completes the package',async()=>{
 await isolated();const f=await productionWorkspaceFixture({testContextModule:contextPath,runtime:{wake(){}}});
 try{
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2)');
  await ownerTransaction(f.pool,f.owner,false,async c=>{await c.query('SELECT local_identity.set_production_metrics_enabled(true)');await c.query("SELECT local_identity.set_episode_business_quality($1,'low',0)",[f.episode]);});
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);
  const send=async(command:string,extra:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...extra});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;};
  for(const clip of w.clips)await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');
  const output=w.exports[0];await send('confirmWorkspaceExport',{exportId:output.id,expectedExportSha256:output.artifact.sha256,expectedContentSha256:w.contentSha256});
  await send('prepareWorkspaceDelivery',{exportId:output.id,expectedExportSha256:output.artifact.sha256,expectedContentSha256:w.contentSha256,title:'隔离统计交付',description:'',tags:[],coverBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});
  const delivery=w.deliveries[0];
  expect((await f.c.query('SELECT tier,revision FROM local_identity.production_metric_delivery_quality WHERE delivery_id=$1',[delivery.id])).rows[0]).toEqual({tier:'low',revision:1});
  await ownerTransaction(f.pool,f.owner,false,c=>c.query("SELECT local_identity.set_episode_business_quality($1,'high',1)",[f.episode]));
  const worker=f.workerPool(),claimed=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_worker_capacity:2}))[0]as any;expect(claimed?.task_id).toBe(delivery.taskId);
  const result=await runWorkspaceDeliveryProcess(f,claimed);expect(result.status,JSON.stringify(result)).toBe('completed');
  expect((await f.c.query("SELECT quality_tier,payload->>'quality_snapshot_known' known FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type='delivery_completed'",[f.episode])).rows).toEqual([{quality_tier:'low',known:'true'}]);
  expect((await f.c.query('SELECT tier FROM local_identity.production_metric_task_quality WHERE task_id=$1',[delivery.taskId])).rows[0].tier).toBe('low');
 }finally{await f.close();}
},180000);
