// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {nativeWorkerPort} from './workerDatabase';

const retired=['generateOfficialVideo','generateWan','resumeWan','annotateAudio','requestQcMemberRevision','saveTtsSettings','saveTtsDraft','registerManualMedia','saveAudioSelection','planMedia','retryMedia','saveMediaDraft','generateClip','setAudioSourceMode','generateSourceAudio','requestAlignment','saveManualAlignment','confirmCaptionText','generateSyncPreview','confirmSyncPreview','openStudio','saveStudio','generateReviewVideo','submitStudioRevision','requestStudioCompositionRevision','createQcIssue','resolveQcIssue','approveQc','retryFinalRender','preparePublishPackage'];

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('retired manual HTTP commands preserve authentication and ownership and never write or wake a Worker',async()=>{
 let wakes=0;
 const f=await embeddedStudioFixture({runtime:{wake(){wakes++;}}});
 try{
  const snapshot=async()=>(await f.c.query("SELECT jsonb_build_object('episodes',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.episodes t),'tasks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tasks t),'drafts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.shot_preparation_drafts t),'receipts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY idempotency_key) FROM local_identity.command_receipts t),'audit',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.audit_events t)) value")).rows[0].value;
  const before=await snapshot();
  for(const command of retired){
   const data={reviewPackageId:f.board,shotId:'shot-1',taskId:f.task};
   expect((await f.request(command,data,{token:f.otherToken})).status,command+' foreign Owner').toBe(404);
   expect((await f.request(command,data,{csrf:false})).status,command+' CSRF').toBe(403);
   expect((await f.request(command,data)).status,command).toBe(410);
  }
  expect(await snapshot()).toEqual(before);expect(wakes).toBe(0);
  expect((await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json'},body:JSON.stringify({command:'planMedia',idempotencyKey:randomUUID(),data:{episodeId:f.episode}})})).status).toBe(401);
  expect((await fetch(`${f.origin}/api/local/episodes/${f.episode}/legacy-project`,{headers:{Cookie:'loop_owner_session='+f.token}})).status).toBe(200);
 }finally{await f.close();}
},60000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('a previously leased legacy task cannot execute or read credentials but its exact terminal result can still be reconciled',async()=>{
 const f=await embeddedStudioFixture(),worker=f.workerPool();try{
  const lease=randomUUID();
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,1) ON CONFLICT(singleton) DO NOTHING');
  await f.c.query('UPDATE local_identity.input_episodes SET enabled=true,studio_enabled=true WHERE episode_id=$1',[f.episode]);
  await f.c.query("UPDATE public.tasks SET status='running',provider='openchatcut',prompt_version='review-render-v1',attempt=1,lease_token=$2,claimed_at=clock_timestamp() WHERE id=$1",[f.task,lease]);
  await f.c.query("INSERT INTO public.task_runs(task_id,attempt,status,lease_token,task_package) VALUES($1,0,'running',$2,'{}')",[f.task,lease]);
  for(const sql of ['SELECT local_identity.assert_current_worker_execution($1,0,$2)','SELECT * FROM local_identity.input_media_connection($1,0,$2,NULL)','SELECT local_identity.reserve_wan_generation($1,0,$2)'])await expect(worker.query(sql,[f.task,lease])).rejects.toMatchObject({code:'55000'});
  await expect(worker.query('SELECT local_identity.assert_current_worker_execution($1,0,$2)',[f.task,randomUUID()])).rejects.toMatchObject({code:'42501'});
  const result={version:'worker-result/v1',taskId:f.task,status:'failed',actualCostCents:0,artifacts:[],validation:{passed:false,checks:[]},blockers:[],retry:{shouldRetry:false,reason:'Retired task reconciled without executing'},nextStep:'Use the current workspace'};
  await nativeWorkerPort(worker).rpc('report_worker_result',{p_task_id:f.task,p_attempt:0,p_lease_token:lease,p_result:result});
  expect((await f.c.query('SELECT status,lease_token,last_result FROM public.tasks WHERE id=$1',[f.task])).rows[0]).toMatchObject({status:'failed',lease_token:null,last_result:result});
  expect((await f.c.query('SELECT count(*)::int n FROM public.paid_generation_reservations WHERE task_id=$1',[f.task])).rows[0].n).toBe(0);
  expect(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:f.task,p_worker_capacity:1})).toEqual([]);
 }finally{await worker.end();await f.close();}
},60000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('retained ready legacy tasks are not claimable through managed or public Worker entrypoints',async()=>{
 const f=await embeddedStudioFixture();try{
  await f.c.query('UPDATE local_identity.input_episodes SET enabled=true,media_enabled=true,preview_enabled=true,studio_enabled=true,delivery_enabled=true WHERE episode_id=$1',[f.episode]);
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2) ON CONFLICT(singleton) DO NOTHING');
  const id=f.task;
  await f.c.query("UPDATE public.tasks SET status='ready',provider='openchatcut',prompt_version='review-render-v1' WHERE id=$1",[id]);
  const before=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=$1',[id])).rows[0].value;
  const worker=f.workerPool();try{
   expect((await f.c.query('SELECT local_identity.current_worker_task(t) allowed FROM public.tasks t WHERE id=$1',[id])).rows[0].allowed).toBe(false);
   expect(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:id,p_worker_capacity:2})).toEqual([]);
   await expect(worker.query('SELECT * FROM public.claim_next_worker_task($1,2)',[id])).rejects.toMatchObject({code:'42501'});
  }finally{await worker.end();}
  expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=$1',[id])).rows[0].value).toEqual(before);
 }finally{await f.close();}
},60000);
