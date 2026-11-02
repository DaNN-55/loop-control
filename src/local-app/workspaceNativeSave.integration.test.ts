// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {editStudioDocument} from './studioDocument.fixture';
import * as episodeFiles from './episodeFiles';
import * as mediaTools from '../worker/mediaTools';

const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';

it.skipIf(!enabled)('native save reads the complete final state once, preserves synced captions and reopens the real SDK document',async()=>{
 const f=await productionWorkspaceFixture();
 const verify=vi.spyOn(episodeFiles,'verifyEpisodeFile'),mp3=vi.spyOn(mediaTools,'probeMp3Artifact'),mp4=vi.spyOn(mediaTools,'inspectMp4Artifact');
 const clients=new WeakSet<PoolClient>();let measuring=false,queries=0,completeReads=0;
 f.pool.on('acquire',client=>{
  if(clients.has(client))return;clients.add(client);
  const query=client.query.bind(client) as (...args:any[])=>any;
  // Observe the real query without changing pg's Promise/callback overloads.
  client.query=((...args:any[])=>{if(measuring){queries++;const sql=typeof args[0]==='string'?args[0]:args[0]?.text;if(sql?.startsWith('SELECT w.*,e.main_script_revision_id current_script,e.stage episode_stage,p.invalidated_at'))completeReads++;}return query(...args);}) as typeof client.query;
 });
 try{
  const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(made.status,JSON.stringify(made.body)).toBe(200);
  let w=await f.fillVisuals(made.body),previousRevision=w.revision,previousSha=w.project.sha256;
  const samples:Array<{durationMs:number;queries:number;completeReads:number;fileChecks:number;mp3Probes:number;mp4Probes:number}>=[];
  for(let index=0;index<5;index++){
   const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
   const text=`原生保存第${index+1}次`;
   await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{
    const lane=Object.values(doc.timelines[0].tracks).flatMap((track:any)=>track.captions?.sourceEntries??[]).find((entry:any)=>entry.id===`workspace-caption-shot-${w.clips[0].shotId}`) as any;
    lane.words[0].text=text;lane.words[0].start=100;lane.words[0].end=800;
    doc.timelines[0].items.find((item:any)=>item.id===w.clips[0].itemId).x=index+1;
   });
   previousRevision=w.revision;previousSha=w.project.sha256;
   const before={verify:verify.mock.calls.length,mp3:mp3.mock.calls.length,mp4:mp4.mock.calls.length};queries=0;completeReads=0;measuring=true;const start=performance.now();
   let saved;try{saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});}finally{measuring=false;}
   samples.push({durationMs:Math.round((performance.now()-start)*100)/100,queries,completeReads,fileChecks:verify.mock.calls.length-before.verify,mp3Probes:mp3.mock.calls.length-before.mp3,mp4Probes:mp4.mock.calls.length-before.mp4});
   expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;
   expect(w.captions[0].contract.text).toBe(text);expect(w.captions[0].timing).toBe('current');
   const closed=await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(closed.status).toBe(200);w=closed.body;
  }
  const bytes=await readFile(join(f.assetRoot,w.project.relativePath)),sha=w.project.sha256;
  await f.restart();
  const reopened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(reopened.status,JSON.stringify(reopened.body)).toBe(200);w=reopened.body.productionWorkspace;
  const document=await editStudioDocument(reopened.body.studioUrl,w.project.projectId,()=>{});
  expect(document.timelines[0].items.find((item:any)=>item.id===w.clips[0].itemId).x).toBe(5);
  expect(w.captions[0].contract.text).toBe('原生保存第5次');expect(w.captions[0].timing).toBe('current');expect(w.project.sha256).toBe(sha);
  for(const stale of [{expectedRevision:previousRevision,expectedWorkspaceSha256:sha},{expectedRevision:w.revision,expectedWorkspaceSha256:previousSha}]){
   const refused=await f.request('saveWorkspaceStudio',{workspaceId:w.id,workspaceRelativePath:reopened.body.workspace.relativePath,projectId:w.project.projectId,...stale});expect(refused.status).toBe(409);
  }
  expect((await f.c.query('SELECT project_sha256 FROM local_identity.production_workspaces WHERE id=$1',[w.id])).rows[0].project_sha256).toBe(sha);expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(bytes);
  console.log('NATIVE_SAVE_PROFILE '+JSON.stringify({samples}));
  expect(samples.map(sample=>sample.completeReads)).toEqual([1,1,1,1,1]);
 }finally{vi.restoreAllMocks();await f.close();}
},180000);

it.skipIf(!enabled)('a real final-state database permission failure rolls back the saved row, caption evidence and immutable version registration',async()=>{
 const f=await productionWorkspaceFixture();let revoked=false;
 try{
  let w=await f.fillVisuals((await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body);
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status).toBe(200);w=opened.body.productionWorkspace;
  const before=(await f.c.query('SELECT to_jsonb(w) value FROM local_identity.production_workspaces w WHERE id=$1',[w.id])).rows[0].value,versions=(await f.c.query('SELECT count(*)::int n FROM local_identity.production_workspace_versions WHERE workspace_id=$1',[w.id])).rows[0].n,evidence=(await f.c.query('SELECT * FROM local_identity.workspace_caption_evidence WHERE workspace_id=$1 ORDER BY shot_id',[w.id])).rows,bytes=await readFile(join(f.assetRoot,w.project.relativePath));
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{const lane=Object.values(doc.timelines[0].tracks).flatMap((track:any)=>track.captions?.sourceEntries??[])[0] as any;lane.words[0].text='失败时保留原记录';lane.words[0].start=120;lane.words[0].end=700;});
  await f.c.query('REVOKE SELECT ON local_identity.production_workspace_versions FROM loop_app');revoked=true;
  await expect(f.pool.query('SELECT * FROM local_identity.production_workspace_versions LIMIT 0')).rejects.toThrow(/permission denied/);
  const trace:string[]=[],clients=new WeakSet<PoolClient>();
  f.pool.on('acquire',client=>{if(clients.has(client))return;clients.add(client);const query=client.query.bind(client) as (...args:any[])=>any;client.query=((...args:any[])=>{trace.push(typeof args[0]==='string'?args[0]:args[0].text);return query(...args);}) as typeof client.query;});
  const denied=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});expect(denied.status).toBe(403);
  const captionWrite=trace.findIndex(sql=>sql.startsWith('INSERT INTO local_identity.workspace_caption_evidence'));
  expect(captionWrite).toBeGreaterThanOrEqual(0);
  expect(trace.findIndex(sql=>sql.startsWith('SELECT revision,project_sha256,script_revision_id'))).toBeGreaterThan(captionWrite);
  await f.c.query('GRANT SELECT ON local_identity.production_workspace_versions TO loop_app');revoked=false;
  expect((await f.c.query('SELECT to_jsonb(w) value FROM local_identity.production_workspaces w WHERE id=$1',[w.id])).rows[0].value).toEqual(before);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_workspace_versions WHERE workspace_id=$1',[w.id])).rows[0].n).toBe(versions);
  expect((await f.c.query('SELECT * FROM local_identity.workspace_caption_evidence WHERE workspace_id=$1 ORDER BY shot_id',[w.id])).rows).toEqual(evidence);expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(bytes);
 }finally{if(revoked)await f.c.query('GRANT SELECT ON local_identity.production_workspace_versions TO loop_app');await f.close();}
},120000);
