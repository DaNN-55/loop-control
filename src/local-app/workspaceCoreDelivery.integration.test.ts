// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
import type {ClaimedTaskRow} from '../orchestration/workerDispatch';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('confirms and completes the exact video without publication inputs, preserving duplicate-request recovery',async()=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){}}}),worker=f.workerPool();
 try{
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2)');
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const send=(command:string,data:Record<string,unknown>={})=>f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});
  w=await f.fillVisuals(w);
  for(const clip of w.clips){const r=await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;}
  const rendered=await send('exportWorkspace');expect(rendered.status,JSON.stringify(rendered.body)).toBe(200);w=rendered.body;
  expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');
  const approved=w.exports[0],input={exportId:approved.id,expectedExportSha256:approved.artifact.sha256,expectedContentSha256:w.contentSha256};
  const result=await send('completeWorkspaceExport',input);expect(result.status,JSON.stringify(result.body)).toBe(200);w=result.body;
  expect(w.exports[0].confirmed).toBe(true);expect(w.deliveries).toHaveLength(1);
  const repeated=await send('completeWorkspaceExport',input);expect(repeated.status,JSON.stringify(repeated.body)).toBe(200);expect(repeated.body.deliveries).toHaveLength(1);
  const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_worker_capacity:2}))[0] as ClaimedTaskRow;
  const completed=await runWorkspaceDeliveryProcess(f,task);expect(completed.status,JSON.stringify(completed)).toBe('completed');
  const pack=completed.artifacts.find((a:{artifactType:string})=>a.artifactType==='publish_package');
  const manifest=JSON.parse(await readFile(join(f.assetRoot,pack.relativePath),'utf8'));
  expect(manifest.version).toBe('publish-package/v3');expect(manifest.artifacts.map((a:{artifactType:string})=>a.artifactType).sort()).toEqual(['editable_project','final_qc_report','final_render']);
  const response=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});w=(await response.json()).workspace;
  expect(w.deliveries[0].verified).toBe(true);
  expect((await f.c.query('SELECT stage FROM public.episodes WHERE id=$1',[f.episode])).rows[0].stage).toBe('production_completed');
  const zip=await fetch(f.origin+`/api/local/episodes/${f.episode}/delivery-download?delivery=${w.deliveries[0].id}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(zip.status).toBe(200);expect((await zip.arrayBuffer()).byteLength).toBeGreaterThan(0);
 }finally{await worker.end();await f.close();}
},300000);
