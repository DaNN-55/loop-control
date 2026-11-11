// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceAudioFixture} from './workspaceAudio.fixture';
import {nativeWorkerPort} from './workerDatabase';

const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';

it.skipIf(!enabled)('48/27/29/46 independent: persisted source backoff cannot duplicate work, unchanged failure retries, changed or removed targets cannot',async()=>{
 const f=await workspaceAudioFixture();
 try{
  let w=f.made;
  const send=async(command:string,data:Record<string,unknown>={})=>{
   const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});
   expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;return r.body;
  };
  const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'controlled-source.mp4',contentBase64:(await readFile(f.media.video)).toString('base64'),materialType:'video',mimeType:'video/mp4',isMainScript:false,materialPurpose:'a_roll'});
  expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  const clip=w.clips[0];
  await send('matchWorkspaceMaterial',{clipId:clip.id,materialRevisionId:imported.body.id});
  await send('prepareWorkspaceAudio',{kind:'source',shotId:clip.shotId,sourceItemId:clip.itemId});
  const prep=w.audio.preparations[0],source=join(f.assetRoot,imported.body.storage_path);
  await f.c.query("UPDATE public.tasks SET available_at=now()+interval '1 hour' WHERE id=$1",[prep.taskId]);
  w=await f.read();
  expect(w.audio.preparations[0].generationTask).toMatchObject({status:'ready',waitingForRetry:true,invalidated:false,retryAllowed:false});
  const worker=f.workerPool();
  try{expect(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:prep.taskId,p_worker_capacity:1})).toEqual([]);}finally{await worker.end();}
  const taskCount=async()=>Number((await f.c.query('SELECT count(*) n FROM public.tasks WHERE episode_id=$1',[f.episode])).rows[0].n);
  const before=await taskCount();
  await send('prepareWorkspaceAudio',{kind:'source',preparationId:prep.id,retry:true});
  expect(w.audio.preparations[0].taskId).toBe(prep.taskId);expect(await taskCount()).toBe(before);
  await f.c.query("UPDATE public.tasks SET available_at=now()-interval '1 second' WHERE id=$1",[prep.taskId]);
  await rename(source,source+'.held');
  try{expect((await f.executeAudio(prep.taskId,false)).status).not.toBe('completed');}finally{await rename(source+'.held',source);}
  w=await f.read();
  expect(w.audio.preparations[0].generationTask).toMatchObject({invalidated:false,retryAllowed:true});
  await send('prepareWorkspaceAudio',{kind:'source',preparationId:prep.id,retry:true});
  const retried=w.audio.preparations.find((p:any)=>p.id===prep.id);
  expect(retried.taskId).not.toBe(prep.taskId);
  expect((await f.executeAudio(retried.taskId)).status).toBe('completed');

  await send('prepareWorkspaceAudio',{kind:'source',shotId:clip.shotId,sourceItemId:clip.itemId});
  const changed=w.audio.preparations[0];
  await rename(source,source+'.held');
  try{expect((await f.executeAudio(changed.taskId,false)).status).not.toBe('completed');}finally{await rename(source+'.held',source);}
  await send('editWorkspaceStructure',{operation:{kind:'range',itemId:clip.itemId,edge:'out',deltaFrames:-3}});
  expect(w.audio.preparations.find((p:any)=>p.id===changed.id).generationTask).toMatchObject({invalidated:true,retryAllowed:false});
  const prior=await taskCount();
  const retry=()=>f.request('prepareWorkspaceAudio',{workspaceId:w.id,expectedRevision:w.revision,kind:'source',preparationId:changed.id,retry:true});
  const stale=await retry();expect(stale.status,JSON.stringify(stale.body)).toBe(409);expect(stale.body.error).toContain('失效');expect(await taskCount()).toBe(prior);
  await send('editWorkspaceStructure',{operation:{kind:'insert',afterShotId:clip.shotId,text:'保留的有效镜头'}});
  const survivor=w.clips.find((c:any)=>c.shotId.startsWith('added-'));
  await send('matchWorkspaceMaterial',{clipId:survivor.id,materialRevisionId:imported.body.id});
  await send('editWorkspaceStructure',{operation:{kind:'remove',shotId:clip.shotId}});
  const removed=await retry();expect(removed.status,JSON.stringify(removed.body)).toBe(409);expect(removed.body.error).toContain('失效');expect(await taskCount()).toBe(prior);
 }finally{await f.close();}
},180000);
