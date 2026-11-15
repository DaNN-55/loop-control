// @vitest-environment node
import {expect,it} from 'vitest';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {readFile} from 'node:fs/promises';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {editStudioDocument} from './studioDocument.fixture';
import {readProductionMetricsV2} from './productionMetricsCollected';
import {ownerTransaction} from './ownerTransaction';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('real script confirmation and workspace creation record distinct current workflow milestones exactly once',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true});
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  const facts=async()=>(await f.c.query("SELECT payload FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type='workflow_milestone' ORDER BY id",[f.newEpisode])).rows.map(r=>r.payload);
  expect(await facts()).toEqual([]);expect((await f.send('start')).status).toBe(200);
  const result=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect(await facts()).toEqual([
   expect.objectContaining({version:'workflow-milestones/v1',milestone:'script_confirmed',phase:'preparation',script_revision_id:f.main}),
   expect.objectContaining({version:'workflow-milestones/v1',milestone:'workspace_prepared',phase:'preparation',script_revision_id:f.main,workspace_id:result.body.id,preparation_revision_id:result.body.preparationRevisionId}),
  ]);
  const before=await facts();expect((await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).status).toBe(200);await f.restart();expect(await facts()).toEqual(before);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('actual editor work and exact export confirmations produce milestones while blocked opens and repeated opens do not',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true});
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(name:string,data:Record<string,unknown>={})=>{const r=await f.send(name,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,name+': '+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const events=async()=>(await f.c.query("SELECT payload FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type='workflow_milestone' ORDER BY id",[f.newEpisode])).rows.map(r=>r.payload);
  expect((await f.send('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision})).status).toBe(409);expect((await events()).map(e=>e.milestone)).toEqual(['script_confirmed','workspace_prepared']);
  const blocked=await send('exportWorkspace');expect(blocked.exports[0].status).toBe('failed');expect((await events()).map(e=>e.milestone)).toEqual(['script_confirmed','workspace_prepared']);
  const image=await f.send('importMaterial',{sourceKind:'file',sourcePath:'image.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(image.status).toBe(200);
  const clip=w.clips[0];await send('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image.body.id,usage:'still',durationSeconds:2,fit:'contain',focusX:0,focusY:0});await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  const first=await send('openWorkspaceStudio');w=first.productionWorkspace;expect((await events()).map(e=>e.milestone)).toEqual(['script_confirmed','workspace_prepared','editing_opened']);
  await send('closeWorkspaceStudio');const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;expect((await events()).filter(e=>e.milestone==='editing_opened')).toHaveLength(1);
  await editStudioDocument(opened.studioUrl,w.project.projectId,document=>{document.timelines[0].items.find((item:any)=>item.id===w.clips[0].itemId).transform.x=8;});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256})).productionWorkspace;await send('closeWorkspaceStudio');
  expect((await events()).filter(e=>e.milestone==='native_edit_saved')).toHaveLength(1);
  await send('exportWorkspace');const output=w.exports[0];expect(output.status,JSON.stringify(output)).toBe('ready');await send('confirmWorkspaceExport',{exportId:output.id,expectedExportSha256:output.artifact.sha256,expectedContentSha256:w.contentSha256});
  expect((await events()).map(e=>e.milestone)).toEqual(['script_confirmed','workspace_prepared','editing_opened','native_edit_saved','export_ready','export_confirmed']);
  const before=await events();await send('confirmWorkspaceExport',{exportId:output.id,expectedExportSha256:output.artifact.sha256,expectedContentSha256:w.contentSha256});await f.restart();expect(await events()).toEqual(before);
  expect(JSON.stringify(before)).not.toContain('填写本段完整口播');expect(JSON.stringify(before)).not.toContain('relativePath');
  const back=await send('openWorkspaceStudio');w=back.productionWorkspace;await editStudioDocument(back.studioUrl,w.project.projectId,document=>{document.timelines[0].items.find((item:any)=>item.id===w.clips[0].itemId).transform.x=9;});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:back.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:back.workspace.sha256})).productionWorkspace;await send('closeWorkspaceStudio');
  expect((await f.send('confirmWorkspaceExport',{workspaceId:w.id,expectedRevision:w.revision,exportId:output.id,expectedExportSha256:output.artifact.sha256,expectedContentSha256:output.contentSha256})).status).toBe(409);
  const observed=Date.now(),date=new Date(observed-16*3600000).toISOString().slice(0,10),to=new Date(observed+32*3600000).toISOString().slice(0,10),summary=await readProductionMetricsV2(f.pool,f.owner,{from:date,toExclusive:to,includeTestEpisodes:true});
  expect(summary.collected?.detail.workflow).toMatchObject({backwardTransitions:1,milestones:{native_edit_saved:2,editing_opened:2},phaseSeconds:{script:null}});
  const beforeOff=await events();await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(false)'));
  const off=await send('openWorkspaceStudio');w=off.productionWorkspace;await editStudioDocument(off.studioUrl,w.project.projectId,document=>{document.timelines[0].items.find((item:any)=>item.id===w.clips[0].itemId).transform.x=10;});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:off.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:off.workspace.sha256})).productionWorkspace;await send('closeWorkspaceStudio');expect(await events()).toEqual(beforeOff);
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));expect(await events()).toEqual(beforeOff);
  const active=await send('openWorkspaceStudio');w=active.productionWorkspace;await send('closeWorkspaceStudio');expect((await events()).filter(e=>e.milestone==='editing_opened')).toHaveLength(3);expect((await events()).filter(e=>e.milestone==='native_edit_saved')).toHaveLength(2);
  const {productionScriptTemplate}=await import('../reviews/productionScript'),revision=await f.send('reconfirmScript',{expectedScriptRevisionId:f.main,text:productionScriptTemplate.replace('填写本段完整口播。','保存新正文，暂不启动。'),reason:'新正文待确认'});expect(revision.status,JSON.stringify(revision.body)).toBe(200);
  expect((await events()).at(-1)).toMatchObject({milestone:'script_revision_saved',phase:'script',script_revision_id:revision.body.id});
  const revised=await readProductionMetricsV2(f.pool,f.owner,{from:date,toExclusive:to,includeTestEpisodes:true});expect(revised.collected?.detail.workflow).toMatchObject({backwardTransitions:2,milestones:{script_revision_saved:1}});

 }finally{await f.close();}
},180000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('only newly created orders get a script-phase milestone and activation never invents an old creation',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,blank:true});
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.newEpisode])).rows[0].account_id;
  const made=await f.send('create',{episodeId:undefined,accountId:account,title:'New observed order'});expect(made.status,JSON.stringify(made.body)).toBe(200);
  expect((await f.c.query("SELECT episode_id,payload FROM local_identity.production_metric_events WHERE episode_id=ANY($1::uuid[]) AND event_type='workflow_milestone' ORDER BY id",[[f.newEpisode,made.body.id]])).rows).toEqual([{episode_id:made.body.id,payload:expect.objectContaining({version:'workflow-milestones/v1',milestone:'production_created',phase:'script',script_revision_id:null})}]);
  const imported=await f.send('importMaterial',{episodeId:made.body.id,sourceKind:'file',sourcePath:'new.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from('# 新正文\n\n## 正文\n\n保存后仍待确认。\n').toString('base64')});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  expect((await f.c.query("SELECT payload->>'milestone' milestone,payload->>'script_revision_id' script FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type='workflow_milestone' ORDER BY id",[made.body.id])).rows).toEqual([{milestone:'production_created',script:null},{milestone:'script_revision_saved',script:imported.body.id}]);

 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('milestone privileges and a failed metric transaction cannot authorize another Owner or leave a false successful start',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true}),worker=f.workerPool();
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  const before=(await f.c.query('SELECT stage,main_script_revision_id FROM public.episodes WHERE id=$1',[f.newEpisode])).rows;
  await f.c.query("CREATE FUNCTION local_identity.c1_reject_metric()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='workflow_milestone' THEN RAISE EXCEPTION 'forced milestone persistence failure';END IF;RETURN NEW;END$$;CREATE TRIGGER c1_reject_metric BEFORE INSERT ON local_identity.production_metric_events FOR EACH ROW EXECUTE FUNCTION local_identity.c1_reject_metric()");
  const failed=await f.send('start');expect(failed.status).toBeGreaterThanOrEqual(400);expect((await f.c.query('SELECT stage,main_script_revision_id FROM public.episodes WHERE id=$1',[f.newEpisode])).rows).toEqual(before);
  expect((await f.c.query("SELECT count(*)::int n FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type IN('workflow_milestone','stage_changed')",[f.newEpisode])).rows[0].n).toBe(0);
  await f.c.query('DROP TRIGGER c1_reject_metric ON local_identity.production_metric_events;DROP FUNCTION local_identity.c1_reject_metric()');expect((await f.send('start')).status).toBe(200);
  const w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  await expect(ownerTransaction(f.pool,f.other,false,c=>c.query("SELECT local_identity.record_workspace_editing_milestone($1,'editing_opened')",[w.id]))).rejects.toMatchObject({code:'42501'});
  await expect(worker.query("SELECT local_identity.record_workspace_editing_milestone($1,'editing_opened')",[w.id])).rejects.toMatchObject({code:'42501'});
  await expect(ownerTransaction(f.pool,f.owner,false,c=>c.query("SELECT local_identity.append_production_workflow_milestone($1,'script_confirmed')",[f.newEpisode]))).rejects.toMatchObject({code:'42501'});
  await expect(ownerTransaction(f.pool,f.owner,false,c=>c.query("SELECT local_identity.record_owned_production_metric($1,'workflow_milestone','forged','{}')",[f.newEpisode]))).rejects.toThrow('Owner metric type invalid');
  await expect(ownerTransaction(f.pool,f.owner,false,c=>c.query("SELECT local_identity.record_workspace_editing_milestone($1,'export_ready')",[w.id]))).rejects.toMatchObject({code:'22023'});
  const other=await readProductionMetricsV2(f.pool,f.other,{from:new Date(Date.now()+8*3600000).toISOString().slice(0,10),toExclusive:new Date(Date.now()+32*3600000).toISOString().slice(0,10),includeTestEpisodes:true});expect(other.collected?.detail.workflow.milestones).toEqual({});
 }finally{await worker.end();await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('the actual Owner read retains a prior workflow anchor without counting it as a new occurrence or carrying another Owner',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true});
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));expect((await f.send('start')).status).toBe(200);expect((await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).status).toBe(200);
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10),midnight=Date.parse(today+'T00:00:00+08:00'),old=new Date(midnight-86400000).toISOString(),to=new Date(midnight+86400000+8*3600000).toISOString().slice(0,10);
  // Isolated retained-event fixture: exact dates distinguish prior anchors from window counts.
  await f.c.query('UPDATE local_identity.production_metric_controls SET updated_at=$2 WHERE owner_id=$1',[f.owner,old]);await f.c.query('UPDATE local_identity.production_metric_coverage_periods SET started_at=$2 WHERE owner_id=$1',[f.owner,old]);
  await f.c.query("UPDATE local_identity.production_metric_events SET occurred_at=$2::timestamptz+CASE payload->>'milestone' WHEN 'script_confirmed' THEN interval '12 hours' ELSE interval '13 hours' END WHERE episode_id=$1 AND event_type='workflow_milestone'",[f.newEpisode,old]);
  const hash=async()=>(await f.c.query('SELECT md5(jsonb_agg(to_jsonb(e) ORDER BY id)::text) value FROM local_identity.production_metric_events e')).rows,before=await hash();
  const result=await readProductionMetricsV2(f.pool,f.owner,{from:today,toExclusive:to,includeTestEpisodes:true});expect(result.collected?.detail.workflow.milestones).toEqual({});
  expect(result.collected?.detail.workflow.phaseSeconds.preparation).toBeCloseTo((Math.min(Number(new Date(String(result.retained.observedAt))),midnight+86400000)-midnight)/1000,3);expect(result.collected?.detail.workflow.phaseSeconds.script).toBeNull();
  const other=await readProductionMetricsV2(f.pool,f.other,{from:today,toExclusive:to,includeTestEpisodes:true});expect(other.collected?.detail.workflow.knownDurationSeconds).toBeNull();expect(await hash()).toEqual(before);
 }finally{await f.close();}
},120000);
