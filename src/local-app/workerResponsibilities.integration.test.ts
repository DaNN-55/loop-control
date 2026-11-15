// @vitest-environment node
import {expect,it} from 'vitest';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {ownerTransaction} from './ownerTransaction';
import {nativeWorkerPort} from './workerDatabase';
import {randomUUID} from 'node:crypto';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('current Worker exposes responsibility boundaries without predecessor chains or private bypass grants',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true});const worker=f.workerPool();try{
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,1) ON CONFLICT DO NOTHING');
  for(const signature of ['local_identity.claim_managed_worker_task(uuid,integer)','local_identity.execute_managed_worker_command(text,jsonb)','local_identity.initialize_historical_shot_inputs()','local_identity.validate_historical_visual_receipt(public.tasks)','local_identity.validate_historical_storyboard_receipt(public.tasks)'])expect((await f.c.query('SELECT to_regprocedure($1) target',[signature])).rows[0].target,signature).not.toBeNull();
  for(const signature of ['local_identity.claim_input_task(uuid,integer)','local_identity.claim_input_task_pre_lease(uuid,integer)','public.claim_next_worker_task_pre_lease(uuid,integer)','public.claim_next_worker_task_legacy(uuid)','local_identity.input_worker_call(text,jsonb)','local_identity.input_worker_call_before_publication_fence(text,jsonb)','local_identity.input_worker_call_before_workspace_delivery(text,jsonb)','local_identity.input_media_connection_before_audio_selection(uuid,integer,uuid,uuid)','local_identity.input_media_connection_before_images(uuid,integer,uuid,uuid)','local_identity.input_media_connection_before_video_selection(uuid,integer,uuid,uuid)','local_identity.record_workspace_narration_submission_before_dispatch_facts(uuid,integer,uuid,text)','local_identity.record_workspace_visual_submission_before_dispatch_facts(uuid,integer,uuid,text)','local_identity.queue_workspace_visual_before_shot_protocol(uuid)','local_identity.queue_workspace_visual_before_selection(uuid)','local_identity.queue_workspace_visual_before_settings(uuid)','local_identity.queue_workspace_pexels_before_shot_protocol(uuid)'])expect((await f.c.query('SELECT to_regprocedure($1) target',[signature])).rows[0].target,signature).toBeNull();
  for(const signature of ['local_identity.claim_scheduled_worker_task(uuid,integer,boolean)','local_identity.validate_historical_visual_receipt(public.tasks)','local_identity.validate_historical_storyboard_receipt(public.tasks)'])for(const role of ['loop_app','loop_worker','loop_owner','loop_anonymous'])expect((await f.c.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).rows[0].allowed,role+signature).toBe(false);
  await expect(ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT * FROM local_identity.claim_managed_worker_task(NULL,1)'))).rejects.toMatchObject({code:'42501'});
  await expect(worker.query('SELECT * FROM local_identity.claim_managed_worker_task(NULL,0)')).rejects.toMatchObject({code:'22023'});
  expect((await worker.query('SELECT * FROM local_identity.claim_managed_worker_task(NULL,1)')).rows).toEqual([]);
 }finally{await worker.end();await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('a normal poll claims only the candidate whose availability and resource checks just passed',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,controlled:true}),worker=f.workerPool();try{
  expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(command:string,data:Record<string,unknown>)=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;return w;};
  const clip=w.clips[0];await send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',...f.controlled!.narrationSettings,text:'只领取已核准且可执行的这个请求。'});await send('confirmWorkspaceNarration',{clipId:clip.id});await send('generateWorkspaceNarration',{clipId:clip.id,reservationCents:100});
  const eligible=w.narration[0].taskId,future=randomUUID();
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version,available_at,created_at) SELECT $1,episode_id,task_type,'ready',input_snapshot,budget_limit_cents,max_attempts,provider,model,prompt_version,clock_timestamp()+interval '1 day',clock_timestamp()-interval '1 day' FROM public.tasks WHERE id=$2",[future,eligible]);
  const before=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=$1',[future])).rows[0].value;
  const claimed=await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:null,p_worker_capacity:1}) as any[];
  expect(claimed).toHaveLength(1);expect(claimed[0].task_id).toBe(eligible);expect(claimed[0].lease_token).toMatch(/^[0-9a-f-]{36}$/);
  expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=$1',[future])).rows[0].value).toEqual(before);
 }finally{await worker.end();await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['visual','storyboard'] as const)('historical %s receipts still reject forged frozen evidence before projecting a review package',async(kind)=>{
 const f=await formalWorkflowFixture({freshAccount:true});try{
  const id=randomUUID(),artifact=randomUUID(),main=(await f.c.query('SELECT storage_path,sha256 FROM public.production_material_revisions WHERE id=$1',[f.main])).rows[0],type=kind==='visual'?'visual_brief':'storyboard',path='historical-receipt-'+id+'.json';
  const inputs=[{artifactType:'main_script',relativePath:main.storage_path,sha256:main.sha256},{artifactType:'visual_brief',relativePath:'frozen-visual.md',sha256:'b'.repeat(64)}];
  const output={artifactType:type,relativePath:path,sha256:'a'.repeat(64),fileSize:7},result:any={artifacts:[output],storyboard:{version:'storyboard/v1',shots:[{id:'old-shot-01',scriptSegment:'原冻结镜头',productionMethod:'manual',targetSpec:'portrait',durationSeconds:2,shotType:'b_roll',inputBasis:inputs}]}};
  const wrong=structuredClone(result);if(kind==='visual')wrong.artifacts[0].sha256='c'.repeat(64);else wrong.storyboard.shots[0].inputBasis[0].sha256='c'.repeat(64);
  await f.c.query('BEGIN');await f.c.query('SET LOCAL session_replication_role=replica');
  await f.c.query('UPDATE public.episodes SET stage=$2 WHERE id=$1',[f.newEpisode,kind==='visual'?'visual_draft':'storyboard_draft']);
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,attempt,input_snapshot) VALUES($1,$2,$3,'running',1,$4)",[id,f.newEpisode,kind==='visual'?'prepare_visual_brief':'draft_storyboard',{input_artifacts:inputs,output:{relative_path:path,required_artifact_types:[type]}}]);
  await f.c.query("INSERT INTO public.task_runs(task_id,attempt,status,task_package,result) VALUES($1,0,'completed','{}',$2)",[id,wrong]);
  await f.c.query('INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,$4,$5,$6,7)',[artifact,f.newEpisode,id,type,path,'a'.repeat(64)]);await f.c.query('COMMIT');
  await expect(f.c.query("UPDATE public.tasks SET status='completed' WHERE id=$1",[id])).rejects.toMatchObject({code:'22023'});
  expect((await f.c.query('SELECT status FROM public.tasks WHERE id=$1',[id])).rows[0].status).toBe('running');expect((await f.c.query('SELECT id FROM public.review_packages WHERE task_id=$1',[id])).rows).toEqual([]);
  await f.c.query('UPDATE public.task_runs SET result=$2 WHERE task_id=$1',[id,result]);await f.c.query("UPDATE public.tasks SET status='completed' WHERE id=$1",[id]);
  const packages=(await f.c.query('SELECT artifact_id,context_snapshot FROM public.review_packages WHERE task_id=$1',[id])).rows;expect(packages).toHaveLength(1);expect(packages[0].artifact_id).toBe(artifact);expect(packages[0].context_snapshot.worker_result).toEqual(result);
 }finally{await f.close();}
},90000);
