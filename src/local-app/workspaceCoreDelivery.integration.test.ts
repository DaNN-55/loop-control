// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
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
  const publicationPath=`episodes/${f.episode}/publication`,packagePath=`episodes/${f.episode}/publication-package`;
  const beforeBytes=await readFile(join(f.assetRoot,pack.relativePath));
  const text={title:'第一版发布标题',description:'可独立更新',tags:['测试'],instruction:''};
  expect((await f.post(publicationPath,'save',{expectedRevision:0,content:text})).status).toBe(200);
  const firstPackage=await f.post(packagePath,'create',{expectedRevision:1});expect(firstPackage.status,JSON.stringify(firstPackage.body)).toBe(200);
  const getPackage=async(id:string)=>(await f.c.query('SELECT * FROM local_identity.workspace_publication_packages WHERE id=$1',[id])).rows[0];
  const firstSnapshot=await getPackage(firstPackage.body.id),firstMetadata=firstSnapshot.artifacts.find((a:{artifactType:string})=>a.artifactType==='metadata');
  expect(JSON.parse(await readFile(join(f.assetRoot,firstMetadata.relativePath),'utf8')).title).toBe(text.title);
  expect((await f.post(publicationPath,'save',{expectedRevision:1,content:{...text,title:'完成后新标题'}})).status).toBe(200);
  const secondPackage=await f.post(packagePath,'create',{expectedRevision:2});expect(secondPackage.status,JSON.stringify(secondPackage.body)).toBe(200);expect(secondPackage.body.id).not.toBe(firstPackage.body.id);
  const secondSnapshot=await getPackage(secondPackage.body.id),secondMetadata=secondSnapshot.artifacts.find((a:{artifactType:string})=>a.artifactType==='metadata');
  expect(JSON.parse(await readFile(join(f.assetRoot,secondMetadata.relativePath),'utf8')).title).toBe('完成后新标题');
  expect(await readFile(join(f.assetRoot,pack.relativePath))).toEqual(beforeBytes);expect(JSON.parse(await readFile(join(f.assetRoot,firstMetadata.relativePath),'utf8')).title).toBe(text.title);
  expect(secondSnapshot.artifacts.find((a:{artifactType:string})=>a.artifactType==='final_render')).toEqual(firstSnapshot.artifacts.find((a:{artifactType:string})=>a.artifactType==='final_render'));
  const publishedZip=await fetch(f.origin+secondPackage.body.downloadUrl,{headers:{Cookie:'loop_owner_session='+f.token}});expect(publishedZip.status).toBe(200);expect((await publishedZip.arrayBuffer()).byteLength).toBeGreaterThan(0);
  expect((await f.post(packagePath,'create',{expectedRevision:1})).status).toBe(409);
  const zip=await fetch(f.origin+`/api/local/episodes/${f.episode}/delivery-download?delivery=${w.deliveries[0].id}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(zip.status).toBe(200);expect((await zip.arrayBuffer()).byteLength).toBeGreaterThan(0);
  const historicalId=w.deliveries[0].id,nextTask=randomUUID(),nextDelivery=randomUUID();
  await f.c.query("INSERT INTO public.tasks SELECT (jsonb_populate_record(NULL::public.tasks,to_jsonb(t)||jsonb_build_object('id',$2::uuid,'status','failed','last_result',jsonb_build_object('retry',jsonb_build_object('reason','最新收尾失败')),'created_at',clock_timestamp()+interval '1 second'))).* FROM public.tasks t WHERE id=$1",[w.deliveries[0].taskId,nextTask]);
  await f.c.query("INSERT INTO local_identity.workspace_deliveries(id,workspace_id,episode_id,export_id,task_id,created_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 second')",[nextDelivery,w.id,f.episode,w.exports[0].id,nextTask]);
  const historyRead=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}}),history=(await historyRead.json()).workspace.deliveries;
  expect(history[0].status).toBe('failed');expect(history[1]).toMatchObject({id:historicalId,verified:false,verificationDeferred:true});
  const historyZip=()=>fetch(f.origin+`/api/local/episodes/${f.episode}/delivery-download?delivery=${historicalId}`,{headers:{Cookie:'loop_owner_session='+f.token}});
  const validHistory=await historyZip();expect(validHistory.status).toBe(200);expect((await validHistory.arrayBuffer()).byteLength).toBeGreaterThan(0);
  await writeFile(join(f.assetRoot,pack.relativePath),'tampered');expect((await historyZip()).status).toBe(409);await writeFile(join(f.assetRoot,pack.relativePath),beforeBytes);expect((await historyZip()).status).toBe(200);
 }finally{await worker.end();await f.close();}
},300000);
