// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,access,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {Pool,type PoolClient} from 'pg';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';
import {defaultShotCaptionContract} from '../shotCaptions';
import {ownerTransaction} from './ownerTransaction';
import {readProductionMetricsV2} from './productionMetricsCollected';
import {csrfFor} from './sessions';
import {startOwnerProductionMetricsSampler} from './productionMetricsSampler';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('records actual local export start and finish once, preserving real output, receipt replay and reopen',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:productionScriptTemplate.replace('镜头时长（秒）：5','镜头时长（秒）：1')});
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+': '+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const image=await f.send('importMaterial',{sourceKind:'file',sourcePath:'still.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(image.status).toBe(200);
  const clip=w.clips[0];await send('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image.body.id,usage:'still',durationSeconds:1,fit:'contain',focusX:0,focusY:0});await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  const body={command:'exportWorkspace',idempotencyKey:randomUUID(),data:{episodeId:f.newEpisode,workspaceId:w.id,expectedRevision:w.revision}};
  const exportRequest=async()=>{const r=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify(body)});expect(r.status,await r.clone().text()).toBe(200);return r.json();};
  w=await exportRequest();expect(w.exports[0].status).toBe('ready');expect(w.exports[0].artifact.fileSize).toBeGreaterThan(1000);
  const summary=async()=>{const now=Date.now();return(await readProductionMetricsV2(f.pool,f.owner,{from:new Date(now-16*3600000).toISOString().slice(0,10),toExclusive:new Date(now+32*3600000).toISOString().slice(0,10),includeTestEpisodes:true})).collected!.detail;};
  const observed=await summary();expect(observed.localExports).toMatchObject({version:'local-export/v1',started:1,finished:1,ready:1,failed:0,rejected:0,durationSeconds:{known:1}});expect(observed.localExports.durationSeconds.mean).toBeGreaterThan(0);
  const events=(await f.c.query("SELECT event_type,payload FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type LIKE 'local_export_%' ORDER BY id",[f.newEpisode])).rows;expect(events.map(e=>e.event_type)).toEqual(['local_export_started','local_export_finished']);expect(events[1].payload).toMatchObject({version:'local-export/v1',export_id:w.exports[0].id,outcome:'ready',start_observed:true});expect(JSON.stringify(events)).not.toContain('relativePath');
  expect((await exportRequest()).exports[0].id).toBe(w.exports[0].id);await f.restart();expect((await summary()).localExports).toEqual(observed.localExports);
  expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
 }finally{await f.close();}
},180000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('samples a real in-flight local export through an independent connection while the business pool is full without inventing Worker activity',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:productionScriptTemplate.replace('镜头时长（秒）：5','镜头时长（秒）：1')}),metrics=new Pool({...f.pool.options,max:1}),held:PoolClient[]=[];
 const release=join(f.root,'release-render'),started=join(f.root,'render-started');let pending:ReturnType<typeof f.send>|undefined,sampler:ReturnType<typeof startOwnerProductionMetricsSampler>|undefined;
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+': '+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const image=await f.send('importMaterial',{sourceKind:'file',sourcePath:'still.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(image.status).toBe(200);const clip=w.clips[0];await send('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image.body.id,usage:'still',durationSeconds:1,fit:'contain',focusX:0,focusY:0});await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  const barrier=join(f.root,'render-barrier.mjs'),node=join(f.root,'controlled-node');
  await writeFile(barrier,`import{existsSync,writeFileSync}from'node:fs';import{spawn}from'node:child_process';const args=process.argv.slice(2);if(args[0]?.endsWith('/scripts/openchatcut-render.mjs')){writeFileSync(${JSON.stringify(started)},'started');const end=Date.now()+45000;while(!existsSync(${JSON.stringify(release)})){if(Date.now()>end)throw Error('Test render release not observed');await new Promise(r=>setTimeout(r,20));}}const child=spawn(process.execPath,args,{stdio:'inherit',env:process.env});for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));process.exitCode=await new Promise(r=>child.once('close',code=>r(code??1)));`);
  const quote=(v:string)=>"'"+v.replaceAll("'","'\\''")+"'";await writeFile(node,'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(barrier)+' "$@"\n');await chmod(node,0o700);f.runtime.nodePath=node;
  pending=f.send('exportWorkspace',{workspaceId:w.id,expectedRevision:w.revision});
  let running=false;for(let n=0;n<500;n++){try{await access(started);running=true;break;}catch{await new Promise(r=>setTimeout(r,20));}}expect(running).toBe(true);
  const available=f.pool.options.max!-(f.pool.totalCount-f.pool.idleCount);for(let n=0;n<available;n++)held.push(await f.pool.connect());expect(f.pool.idleCount).toBe(0);expect(f.activeLocalExports(f.owner)).toBe(1);expect(f.activeLocalExports(f.other)).toBe(0);
  sampler=startOwnerProductionMetricsSampler({pool:metrics,ownerId:f.owner,enabled:true,localExports:f.activeLocalExports});await sampler.wake();expect(sampler.status().lastError).toBeNull();
  // Host samples allow a small clock lead over PostgreSQL. A read deliberately
  // excludes future observations: wait for the actual sample's DB clock boundary.
  const stored=(await f.c.query('SELECT sampled_at,active_exports,clock_timestamp() observed_at FROM local_identity.production_metric_resources JOIN local_identity.production_metric_export_resources USING(owner_id,sampled_at) WHERE owner_id=$1',[f.owner])).rows;
  expect(stored).toHaveLength(1);expect(stored[0].active_exports).toBe(1);
  for(let n=0;n<300;n++){if((await f.c.query('SELECT clock_timestamp()>=$1::timestamptz ready',[stored[0].sampled_at])).rows[0].ready)break;await new Promise(r=>setTimeout(r,20));}
  const now=Date.now(),observed=await readProductionMetricsV2(metrics,f.owner,{from:new Date(now-16*3600000).toISOString().slice(0,10),toExclusive:new Date(now+32*3600000).toISOString().slice(0,10),includeTestEpisodes:true});
  expect(observed.collected!.resources).toMatchObject({samples:1,maximumQueue:0,maximumRunning:0,maximumLocalExports:1,localExportCountKnownSamples:1});expect(observed.collected!.resources.maximumMemoryUsedBytes).toBeGreaterThan(0);
  if(process.env.LOOP_STORY_EVIDENCE)await writeFile(join(process.env.LOOP_STORY_EVIDENCE,'export-resource-observation.json'),JSON.stringify({stored,sampler:sampler.status(),resources:observed.collected!.resources},null,2));
  await sampler.stop();sampler=undefined;await writeFile(release,'continue');const done=await pending;pending=undefined;expect(done.status,JSON.stringify(done.body)).toBe(200);expect(done.body.exports[0].status).toBe('ready');
 }finally{
  await sampler?.stop();await writeFile(release,'continue').catch(()=>{});for(const client of held)client.release();await pending?.catch(()=>{});await metrics.end();await f.close();
 }
},180000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('allows two same-Owner independent exports to enter the actual renderer concurrently without a shared statistics lock',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:productionScriptTemplate.replace('镜头时长（秒）：5','镜头时长（秒）：1')}),metrics=new Pool({...f.pool.options,max:1}),held:PoolClient[]=[];
 const release=join(f.root,'release-render'),started=join(f.root,'render-started');let pending2:ReturnType<typeof f.send>|undefined;let pending:ReturnType<typeof f.send>|undefined,sampler:ReturnType<typeof startOwnerProductionMetricsSampler>|undefined;
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+': '+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const image=await f.send('importMaterial',{sourceKind:'file',sourcePath:'still.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(image.status).toBe(200);const clip=w.clips[0];await send('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image.body.id,usage:'still',durationSeconds:1,fit:'contain',focusX:0,focusY:0});await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});

  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.newEpisode])).rows[0].account_id;
  const made=await f.request('create',{episodeId:undefined,accountId:account,title:'同Owner第二张并发测试单'});expect(made.status,JSON.stringify(made.body)).toBe(200);const secondEpisode=made.body.id;
  const second=(cmd:string,data:Record<string,unknown>={})=>f.request(cmd,{episodeId:secondEpisode,...data});
  const script=await second('importMaterial',{sourceKind:'file',sourcePath:'second.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from(productionScriptTemplate.replace('镜头时长（秒）：5','镜头时长（秒）：1')).toString('base64')});expect(script.status).toBe(200);expect((await second('start')).status).toBe(200);
  let secondW=(await second('prepareWorkspace',{expectedScriptRevisionId:script.body.id})).body;
  const image2=await second('importMaterial',{sourceKind:'file',sourcePath:'second.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(image2.status).toBe(200);
  const match2=await second('matchWorkspaceImage',{workspaceId:secondW.id,expectedRevision:secondW.revision,clipId:secondW.clips[0].id,materialRevisionId:image2.body.id,usage:'still',durationSeconds:1,fit:'contain',focusX:0,focusY:0});expect(match2.status).toBe(200);secondW=match2.body;
  const caption2=await second('saveWorkspaceCaptions',{workspaceId:secondW.id,expectedRevision:secondW.revision,clipId:secondW.clips[0].id,captionContract:defaultShotCaptionContract(secondW.clips[0].text,'independent',false)});expect(caption2.status).toBe(200);secondW=caption2.body;
  const barrier=join(f.root,'render-barrier.mjs'),node=join(f.root,'controlled-node');
  await writeFile(barrier,`import{existsSync,appendFileSync}from'node:fs';import{spawn}from'node:child_process';const args=process.argv.slice(2);if(args[0]?.endsWith('/scripts/openchatcut-render.mjs')){appendFileSync(${JSON.stringify(started)},String(process.pid)+'\\n');const end=Date.now()+45000;while(!existsSync(${JSON.stringify(release)})){if(Date.now()>end)throw Error('Test render release not observed');await new Promise(r=>setTimeout(r,20));}}const child=spawn(process.execPath,args,{stdio:'inherit',env:process.env});for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));process.exitCode=await new Promise(r=>child.once('close',code=>r(code??1)));`);
  const quote=(v:string)=>"'"+v.replaceAll("'","'\\''")+"'";await writeFile(node,'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(barrier)+' "$@"\n');await chmod(node,0o700);f.runtime.nodePath=node;
  pending=f.send('exportWorkspace',{workspaceId:w.id,expectedRevision:w.revision});
  let running=false;for(let n=0;n<500;n++){try{await access(started);running=true;break;}catch{await new Promise(r=>setTimeout(r,20));}}expect(running).toBe(true);
  pending2=second('exportWorkspace',{workspaceId:secondW.id,expectedRevision:secondW.revision});
  let starts=0;for(let n=0;n<250;n++){starts=(await readFile(started,'utf8')).trim().split('\n').length;if(starts===2)break;await new Promise(r=>setTimeout(r,20));}expect(starts).toBe(2);
  await writeFile(release,'continue');const done=await pending;pending=undefined;expect(done.status,JSON.stringify(done.body)).toBe(200);expect(done.body.exports[0].status).toBe('ready');const done2=await pending2;pending2=undefined;expect(done2.status,JSON.stringify(done2.body)).toBe(200);expect(done2.body.exports[0].status).toBe('ready');
 }finally{
  await sampler?.stop();await writeFile(release,'continue').catch(()=>{});for(const client of held)client.release();await pending?.catch(()=>{});await pending2?.catch(()=>{});await metrics.end();await f.close();
 }
},180000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('annotates an exact host resource sample once without changing CPU counts, old validation or Owner boundaries',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true}),worker=f.workerPool();
 try{
  const own=<T>(run:Parameters<typeof ownerTransaction<T>>[3],owner=f.owner)=>ownerTransaction(f.pool,owner,false,run);
  await own(c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  const sample={sampled_at:new Date().toISOString(),cpu_percent:null,memory_used_bytes:512,memory_total_bytes:1024,queue_count:0,running_count:0,resource_wait_count:0,gpu_percent:null,gap_seconds:null};
  const record=(count:number,value=sample)=>own(c=>c.query('SELECT local_identity.record_production_metric_resource_with_exports($1,$2) recorded',[value,count]));
  expect((await record(2)).rows[0].recorded).toBe(true);expect((await record(2)).rows[0].recorded).toBe(false);
  await expect(record(1)).rejects.toMatchObject({code:'23505'});
  await expect(record(2,{...sample,memory_used_bytes:100})).rejects.toMatchObject({code:'23505'});
  await expect(own(c=>c.query('SELECT local_identity.record_production_metric_resource($1)',[{...sample,local_export_count:2}]))).rejects.toThrow('Invalid resource sample');
  await expect(record(-1)).rejects.toMatchObject({code:'22023'});
  expect((await f.c.query('SELECT samples::int FROM local_identity.production_metric_resource_daily WHERE owner_id=$1',[f.owner])).rows[0].samples).toBe(1);
  expect((await own(c=>c.query('SELECT active_exports FROM local_identity.production_metric_export_resources'))).rows).toEqual([{active_exports:2}]);
  expect((await own(c=>c.query('SELECT active_exports FROM local_identity.production_metric_export_resources'),f.other)).rows).toEqual([]);
  await expect(own(c=>c.query('INSERT INTO local_identity.production_metric_export_resources VALUES($1,$2,1)',[f.owner,sample.sampled_at]))).rejects.toMatchObject({code:'42501'});
  await expect(worker.query('SELECT local_identity.record_production_metric_resource_with_exports($1,1)',[sample])).rejects.toMatchObject({code:'42501'});
  await own(c=>c.query('SELECT local_identity.set_production_metrics_enabled(false)'));expect((await record(2,{...sample,sampled_at:new Date(Date.now()+1000).toISOString()})).rows[0].recorded).toBe(false);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_metric_export_resources')).rows[0].n).toBe(1);
 }finally{await worker.end();await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('keeps preflight rejection distinct from a failed renderer and never backfills exports made while off',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:productionScriptTemplate.replace('镜头时长（秒）：5','镜头时长（秒）：1')}),worker=f.workerPool();
 try{
  const own=<T>(run:Parameters<typeof ownerTransaction<T>>[3])=>ownerTransaction(f.pool,f.owner,false,run);
  await own(c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const facts=async()=>(await f.c.query("SELECT event_type,payload FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type LIKE 'local_export_%' ORDER BY id",[f.newEpisode])).rows;
  await send('exportWorkspace');expect(w.exports[0].status).toBe('failed');expect((await facts()).map(e=>e.event_type)).toEqual(['local_export_rejected']);expect(f.activeLocalExports(f.owner)).toBe(0);
  const image=await f.send('importMaterial',{sourceKind:'file',sourcePath:'still.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(image.status).toBe(200);const clip=w.clips[0];await send('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image.body.id,usage:'still',durationSeconds:1,fit:'contain',focusX:0,focusY:0});await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  const realNode=f.runtime.nodePath;f.runtime.nodePath='/usr/bin/false';await send('exportWorkspace');f.runtime.nodePath=realNode;expect(w.exports[0].status).toBe('failed');expect(f.activeLocalExports(f.owner)).toBe(0);
  const failed=await facts();expect(failed.map(e=>e.event_type)).toEqual(['local_export_rejected','local_export_started','local_export_finished']);expect(failed[2].payload).toMatchObject({outcome:'failed',start_observed:true,reason_code:'render_or_checks_failed'});
  const args=[w.id,w.exports[0].id,'finished',failed[2].payload.started_at];
  expect((await own(c=>c.query('SELECT local_identity.record_workspace_local_export($1,$2,$3,$4) recorded',args))).rows[0].recorded).toBe(false);
  await expect(own(c=>c.query('SELECT local_identity.record_workspace_local_export($1,$2,$3,$4)',[...args.slice(0,3),new Date(Date.parse(String(args[3]))-1000).toISOString()]))).rejects.toMatchObject({code:'23505'});
  await expect(ownerTransaction(f.pool,f.other,false,c=>c.query('SELECT local_identity.record_workspace_local_export($1,$2,$3,$4)',args))).rejects.toMatchObject({code:'42501'});
  await expect(worker.query('SELECT local_identity.record_workspace_local_export($1,$2,$3,$4)',args)).rejects.toMatchObject({code:'42501'});
  await own(c=>c.query('SELECT local_identity.set_production_metrics_enabled(false)'));await send('exportWorkspace');expect(w.exports[0].status).toBe('ready');expect(await facts()).toEqual(failed);
  await own(c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));await f.restart();expect(await facts()).toEqual(failed);expect(f.activeLocalExports(f.owner)).toBe(0);
  const rowsBefore=(await f.c.query('SELECT count(*)::int n FROM local_identity.workspace_exports WHERE workspace_id=$1',[w.id])).rows[0].n;
  await f.c.query("CREATE FUNCTION local_identity.c2_reject_export_metric()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type LIKE 'local_export_%' THEN RAISE EXCEPTION 'forced export observation failure';END IF;RETURN NEW;END$$;CREATE TRIGGER c2_reject_export_metric BEFORE INSERT ON local_identity.production_metric_events FOR EACH ROW EXECUTE FUNCTION local_identity.c2_reject_export_metric()");
  const rejected=await f.send('exportWorkspace',{workspaceId:w.id,expectedRevision:w.revision});expect(rejected.status).toBeGreaterThanOrEqual(400);expect(await facts()).toEqual(failed);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.workspace_exports WHERE workspace_id=$1',[w.id])).rows[0].n).toBe(rowsBefore);expect(f.activeLocalExports(f.owner)).toBe(0);
  await f.c.query('DROP TRIGGER c2_reject_export_metric ON local_identity.production_metric_events;DROP FUNCTION local_identity.c2_reject_export_metric()');
 }finally{await worker.end();await f.close();}
},180000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('does not invent a start or duration when collection is disabled and re-enabled across a real in-flight export',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:productionScriptTemplate.replace('镜头时长（秒）：5','镜头时长（秒）：1')});
 const release=join(f.root,'release-coverage-render'),started=join(f.root,'coverage-render-started');let pending:ReturnType<typeof f.send>|undefined;
 try{
  const own=<T>(run:Parameters<typeof ownerTransaction<T>>[3])=>ownerTransaction(f.pool,f.owner,false,run);
  await own(c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const image=await f.send('importMaterial',{sourceKind:'file',sourcePath:'still.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(image.status).toBe(200);const clip=w.clips[0];await send('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image.body.id,usage:'still',durationSeconds:1,fit:'contain',focusX:0,focusY:0});await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  const barrier=join(f.root,'coverage-render.mjs'),node=join(f.root,'coverage-node');
  await writeFile(barrier,`import{existsSync,writeFileSync}from'node:fs';import{spawn}from'node:child_process';const args=process.argv.slice(2);if(args[0]?.endsWith('/scripts/openchatcut-render.mjs')){writeFileSync(${JSON.stringify(started)},'started');const end=Date.now()+45000;while(!existsSync(${JSON.stringify(release)})){if(Date.now()>end)throw Error('Test render release not observed');await new Promise(r=>setTimeout(r,20));}}const child=spawn(process.execPath,args,{stdio:'inherit',env:process.env});for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));process.exitCode=await new Promise(r=>child.once('close',code=>r(code??1)));`);
  const quote=(v:string)=>"'"+v.replaceAll("'","'\\''")+"'";await writeFile(node,'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(barrier)+' "$@"\n');await chmod(node,0o700);f.runtime.nodePath=node;
  pending=f.send('exportWorkspace',{workspaceId:w.id,expectedRevision:w.revision});let running=false;for(let n=0;n<500;n++){try{await access(started);running=true;break;}catch{await new Promise(r=>setTimeout(r,20));}}expect(running).toBe(true);expect(f.activeLocalExports(f.owner)).toBe(1);
  await own(c=>c.query('SELECT local_identity.set_production_metrics_enabled(false)'));await own(c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  await writeFile(release,'continue');const result=await pending;pending=undefined;expect(result.status).toBe(200);expect(result.body.exports[0].status).toBe('ready');expect(f.activeLocalExports(f.owner)).toBe(0);
  const events=(await f.c.query("SELECT event_type,payload FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type LIKE 'local_export_%' ORDER BY id",[f.newEpisode])).rows;expect(events).toHaveLength(1);expect(events[0]).toMatchObject({event_type:'local_export_finished',payload:{outcome:'ready',start_observed:false,duration_seconds:null}});
 }finally{await writeFile(release,'continue').catch(()=>{});await pending?.catch(()=>{});await f.close();}
},180000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('retains an allowed future host sample while a read snapshot excludes it until the database clock reaches it',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true});
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  const time=(await f.c.query("SELECT (clock_timestamp()+interval '2 seconds')::text sampled_at")).rows[0].sampled_at;
  const sample={sampled_at:time,queue_count:0,running_count:0,resource_wait_count:0,gpu_percent:null,gap_seconds:null};
  expect((await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.record_production_metric_resource_with_exports($1,1) recorded',[sample]))).rows[0].recorded).toBe(true);
  const summary=()=>{const now=Date.now();return readProductionMetricsV2(f.pool,f.owner,{from:new Date(now-16*3600000).toISOString().slice(0,10),toExclusive:new Date(now+32*3600000).toISOString().slice(0,10),includeTestEpisodes:true});};
  const early=await summary();expect(Date.parse(String(early.retained.observedAt))).toBeLessThan(Date.parse(time));expect(early.collected!.resources.samples).toBe(0);
  for(let n=0;n<300;n++){if((await f.c.query('SELECT clock_timestamp()>=$1::timestamptz ready',[time])).rows[0].ready)break;await new Promise(r=>setTimeout(r,20));}
  expect((await summary()).collected!.resources).toMatchObject({samples:1,maximumLocalExports:1,localExportCountKnownSamples:1});
 }finally{await f.close();}
},120000);
