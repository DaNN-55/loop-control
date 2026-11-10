// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {narrationFixture} from './workspaceNarration.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {nativeWorkerPort} from './workerDatabase';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['current','mixed','legacy'])('shot protocol %s tasks share the same actual resource limit and immutable lease fence',async protocol=>{
 const f=await narrationFixture(undefined,undefined,true),worker=f.workerPool();
 try{
  await f.authorize();let w=await f.read();
  const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'concurrency.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(image.status).toBe(200);
  const ids:string[]=[];
  for(let index=0;index<2;index++){
   const legacy=protocol==='legacy'||protocol==='mixed'&&index===1;
   if(legacy)await f.c.query('ALTER TABLE public.tasks DISABLE TRIGGER aaa_workspace_shot_video_protocol');
   const r=await f.chosenRequest('requestWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[index].itemId,firstFrameMaterialRevisionId:image.body.id,prompt:'同一连接的镜头 '+index,durationSeconds:4,reservationCents:90});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;
   if(legacy)await f.c.query('ALTER TABLE public.tasks ENABLE TRIGGER aaa_workspace_shot_video_protocol');
   const task=w.visualTasks.find((t:any)=>!ids.includes(t.taskId));ids.push(task.taskId);expect((await f.c.query('SELECT task_type FROM public.tasks WHERE id=$1',[task.taskId])).rows[0].task_type).toBe(legacy?'generate_b_roll':'generate_shot_video');
  }
  const port=nativeWorkerPort(worker),first=(await port.rpc('claim_next_worker_task',{p_task_id:ids[0],p_worker_capacity:4}) as any[])[0];expect(first).toBeTruthy();expect(first.input_snapshot.runtime_constraints.effective_concurrency).toBe(1);
  expect(await port.rpc('claim_next_worker_task',{p_task_id:ids[1],p_worker_capacity:4})).toEqual([]);
  await expect(f.c.query("UPDATE public.tasks SET input_snapshot=jsonb_set(input_snapshot,'{output,relative_path}',to_jsonb((input_snapshot#>>'{output,relative_path}')||'.changed')) WHERE id=$1",[ids[0]])).rejects.toThrow('Claimed native output is immutable');
  await port.rpc('report_worker_result',{p_task_id:first.task_id,p_attempt:first.attempt,p_lease_token:first.lease_token,p_result:{version:'worker-result/v1',taskId:first.task_id,status:'blocked',artifacts:[],validation:{passed:false,checks:[]},actualCostCents:0,blockers:[{code:'fixture_release',detail:'Controlled resource test finished without provider submission.'}],retry:{shouldRetry:false,reason:'No generation requested.'},nextStep:'Test second task claim.'}});
  const second=(await port.rpc('claim_next_worker_task',{p_task_id:ids[1],p_worker_capacity:4}) as any[])[0];expect(second).toBeTruthy();expect(second.input_snapshot.runtime_constraints.effective_concurrency).toBe(1);
 }finally{await worker.end();await f.close();}
},120000);
