// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceImageGenerationFixture} from './workspaceImageGeneration.fixture';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
async function evidence(name:string,value:unknown){if(process.env.LOOP_GENERATION_EVIDENCE)await writeFile(join(process.env.LOOP_GENERATION_EVIDENCE,name+'.json'),JSON.stringify(value,null,2));}
it.skipIf(!enabled).each(['unknown','reject'])('HTTP image %s preserves the original submission and a successful retry can supply a video first frame',async mode=>{
 const {f,ref,submissions}=await workspaceImageGenerationFixture();try{
 let w=await f.read();const module=join(f.root,'controlled-video.mjs');await writeFile(module,(await readFile(module,'utf8')).replace("if(readFileSync(","if(readFileSync(").replace("return Response.json({data:",`if(readFileSync(${JSON.stringify(f.responseMode)},'utf8')==='reject')return new Response('controlled rejection',{status:400});return Response.json({data:`));await writeFile(f.responseMode,mode);
 const args={workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection:{capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='openai_images'")).rows[0].id},prompt:'核对原图片请求',settings:{size:'1152x2048',quality:'high',count:1},referenceMaterialRevisionIds:[ref.body.id],reservationCents:100};
 const queued=await f.request('requestWorkspaceImageCandidates',args);expect(queued.status,JSON.stringify(queued.body)).toBe(200);w=queued.body;const job=w.visualTasks[0];await f.execute(job.taskId,false);await f.restart();await f.restartWorker();w=await f.read();
 expect(w.visualTasks[0]).toMatchObject({taskId:job.taskId,status:'failed',submissionOutcome:mode==='unknown'?'started':'rejected',submissionUnknown:mode==='unknown',providerTaskId:null,canResume:false});expect(w.visualTasks[0].error).toBeTruthy();
 const retry=await f.request('retryWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:job.id});expect(retry.status).toBe(409);
 if(mode==='unknown')expect((await f.request('requestWorkspaceImageCandidates',{...args,prompt:'不同描述也不可重复提交'})).status).toBe(409);
 expect((await readFile(submissions,'utf8')).trim().split('\n')).toHaveLength(1);
 const retryInput={...args,expectedRevision:w.revision,...(mode==='unknown'?{retryOfTaskId:job.taskId}:{})};
 if(mode==='unknown'){
  const draft=await f.rawRequest('prepareWorkspaceCall',{workspaceId:w.id,expectedRevision:w.revision,callCommand:'requestWorkspaceImageCandidates',callData:{episodeId:f.episode,...retryInput}});
  expect(draft.status,JSON.stringify(draft.body)).toBe(200);
  expect(draft.body.summary.retryOfTaskId).toBe(job.taskId);
  expect((await f.read()).visualTasks).toHaveLength(1);
  expect((await readFile(submissions,'utf8')).trim().split('\n')).toHaveLength(1);
 }
 {
  await writeFile(f.responseMode,'success');
  const fresh=await f.request('requestWorkspaceImageCandidates',retryInput);
  expect(fresh.status,JSON.stringify(fresh.body)).toBe(200);
  const next=fresh.body.visualTasks[0];
  expect(next.taskId).not.toBe(job.taskId);
  await f.execute(next.taskId);
  const updated=await f.read();
  expect(updated.visualTasks[0]).toMatchObject({taskId:next.taskId,status:'completed'});
  if(mode==='unknown'){
   expect(updated.visualTasks.find((task:{taskId:string})=>task.taskId===job.taskId)).toMatchObject({submissionUnknown:true,requestState:'submitting',retryTaskId:next.taskId});
   expect((await f.request('requestWorkspaceImageCandidates',{...retryInput,expectedRevision:updated.revision})).status).toBe(409);
   const firstFrame=updated.visualCandidates.find((candidate:{taskId:string})=>candidate.taskId===next.taskId);
   expect(firstFrame).toBeDefined();
   const videoInput={workspaceId:updated.id,expectedRevision:updated.revision,targetItemId:args.targetItemId,firstFrameMaterialRevisionId:firstFrame.materialRevisionId,prompt:'使用重试生成的首帧',durationSeconds:4,reservationCents:90};
   const video=await f.chosenRequest('requestWorkspaceVisualCandidate',videoInput);
   expect(video.status,JSON.stringify(video.body)).toBe(200);
   const videoTask=video.body.visualTasks.find((task:{kind:string})=>task.kind==='video');
   const duplicate=await f.chosenRequest('requestWorkspaceVisualCandidate',{...videoInput,expectedRevision:video.body.revision,prompt:'第二次视频提交'});
   expect(duplicate.status).toBe(409);
   await f.execute(videoTask.taskId);
   const finished=await f.read();
   expect(finished.visualTasks.find((task:{taskId:string})=>task.taskId===videoTask.taskId)).toMatchObject({status:'completed'});
   expect(finished.visualTasks.find((task:{taskId:string})=>task.taskId===job.taskId)).toMatchObject({submissionUnknown:true,requestState:'submitting',retryTaskId:next.taskId});
   expect((await readFile(f.videoSubmissions,'utf8')).trim().split('\n')).toHaveLength(1);
  }
  expect((await readFile(submissions,'utf8')).trim().split('\n')).toHaveLength(2);
 }
 expect((await f.c.query('SELECT attempt FROM public.tasks WHERE id=$1',[job.taskId])).rows[0].attempt).toBe(1);await evidence('image-'+mode,{taskId:job.taskId,state:w.visualTasks[0],supplierPosts:1,attemptCount:1,retryStatus:retry.status});
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('HTTP video polling resumes the same frozen task and original remote ID, never a second POST',async()=>{
 const {narrationFixture}=await import('./workspaceNarration.fixture'),{workspaceTestMedia}=await import('./workspaceTestMedia.fixture');const f=await narrationFixture(undefined,undefined,true);try{
 await f.authorize();let w=f.made;const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'resume.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});
 const mode=join(f.root,'poll-mode'),module=join(f.root,'controlled-video.mjs'),queries=join(f.root,'poll-queries.jsonl');await writeFile(mode,'fail');await writeFile(module,(await readFile(module,'utf8')).replace("if(host==='ark.cn-beijing.volces.com')return",`if(host==='ark.cn-beijing.volces.com'){appendFileSync(${JSON.stringify(queries)},String(input)+'\\n');if(readFileSync(${JSON.stringify(mode)},'utf8')==='fail')throw Error('Controlled poll interruption');}if(host==='ark.cn-beijing.volces.com')return`));
 expect(await readFile(module,'utf8')).toContain("throw Error('Controlled poll interruption')");
 const queued=await f.chosenRequest('requestWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,firstFrameMaterialRevisionId:image.body.id,prompt:'原冻结动作',durationSeconds:4,reservationCents:90});expect(queued.status,JSON.stringify(queued.body)).toBe(200);w=queued.body;const job=w.visualTasks[0];await f.execute(job.taskId,false);await f.restart();await f.restartWorker();w=await f.read();
 expect(w.visualTasks[0]).toMatchObject({taskId:job.taskId,status:'failed',providerTaskId:'controlled-t05-video',submissionOutcome:'received',submissionUnknown:false,canResume:true});expect(w.visualTasks[0].error).toBeTruthy();
 const resumed=await f.request('retryWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:job.id});expect(resumed.status).toBe(200);expect(resumed.body.visualTasks[0].taskId).toBe(job.taskId);await writeFile(mode,'success');await f.execute(job.taskId);w=await f.read();expect(w.visualTasks[0]).toMatchObject({status:'completed',videoPhase:'saving'});
 expect((await readFile(f.videoSubmissions,'utf8')).trim().split('\n')).toHaveLength(1);const urls=(await readFile(queries,'utf8')).trim().split('\n');expect(urls.length).toBeGreaterThanOrEqual(2);expect(urls.every(url=>url.endsWith('/controlled-t05-video'))).toBe(true);
 const state=(await f.c.query('SELECT attempt,input_snapshot FROM public.tasks WHERE id=$1',[job.taskId])).rows[0];expect(state.attempt).toBe(2);expect(state.input_snapshot.capability).toBe('shot_video_generation');expect(state.input_snapshot.media.video.prompt).toContain('原冻结动作');await evidence('video-resume',{taskId:job.taskId,providerTaskId:'controlled-t05-video',supplierPosts:1,attemptCount:2,pollQueries:urls,completedState:w.visualTasks[0]});
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('Owner HTTP reconciles a held publication after lost COMMIT without a new attempt or supplier POST',async()=>{
 const {f,ref,submissions}=await workspaceImageGenerationFixture();const worker=f.workerPool();try{
 const {nativeWorkerPort}=await import('./workerDatabase'),{runCodexWorker}=await import('../worker/codexRunner'),{executeNativeMedia}=await import('./mediaWorker'),{prepareNativeAttemptOutput}=await import('./nativeAttemptOutput'),{resolveEpisodeStorageLocation}=await import('./episodeStorageLocation'),{episodeFileIO}=await import('./episodeFiles'),{csrfFor}=await import('./sessions'),{verifyArtifactIndex}=await import('../worker/mediaLibrary');
 let w=await f.read();const queued=await f.request('requestWorkspaceImageCandidates',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection:{capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='openai_images'")).rows[0].id},prompt:'核对发布',settings:{size:'1152x2048',quality:'high',count:1},referenceMaterialRevisionIds:[ref.body.id],reservationCents:100});expect(queued.status,JSON.stringify(queued.body)).toBe(200);w=queued.body;const job=w.visualTasks[0];
 const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:job.taskId,p_worker_capacity:1}) as any[])[0],location=await resolveEpisodeStorageLocation(worker,f.root,task.episode_id),fence={p_task_id:task.task_id,p_attempt:task.attempt,p_lease_token:task.lease_token};let outputs:Awaited<ReturnType<typeof prepareNativeAttemptOutput>>|undefined;
 let faultTriggered=false;const faultPool={async connect(){const client=await worker.connect(),query=client.query.bind(client);client.query=(async(sql:string,args?:unknown[])=>{if(sql==='COMMIT'){faultTriggered=true;await query('ROLLBACK');throw Error('Controlled COMMIT reply lost');}return query(sql,args);}) as typeof client.query;return client;}};
 const execution=runCodexWorker({actualCostCents:1,claimNextTask:async()=>({taskId:task.task_id,taskType:task.task_type,attempt:task.attempt,budgetLimitCents:task.budget_limit_cents,maxAttempts:task.max_attempts,provider:task.provider,model:task.model,promptVersion:task.prompt_version,episodeId:task.episode_id,accountId:task.account_id,blueprintVersionId:task.blueprint_version_id,title:task.title,allowedAssetRoot:location.assetRoot,inputSnapshot:task.input_snapshot}),verifyAssetRoot:async()=>{},verifyArtifacts:async(p,a)=>outputs?outputs.verify(a):verifyArtifactIndex({assetRoot:p.assets.allowedRoot,episodeId:p.episode.id,artifacts:a,storage:await episodeFileIO(worker,p.assets.allowedRoot,p.episode.id)}),execute:async p=>{outputs=await prepareNativeAttemptOutput(p,fence,[],await episodeFileIO(worker,location.assetRoot,p.episode.id,true));return executeNativeMedia(worker,{mode:'controlled',modulePath:join(f.root,'controlled-video.mjs')},outputs.taskPackage,fence);},reportResult:async(_id,_attempt,result)=>{if(result.status==='completed')await outputs!.publish(faultPool,result);else await nativeWorkerPort(worker).rpc('report_worker_result',{...fence,p_result:result});}});let thrown:unknown;try{const result=await execution;throw Error(JSON.stringify({result,task:(await f.c.query('SELECT last_result FROM public.tasks WHERE id=$1',[job.taskId])).rows[0]}));}catch(error){thrown=error;}expect(thrown).toBeTruthy();expect(faultTriggered).toBe(true);
 w=await f.read();expect(w.visualTasks[0]).toMatchObject({taskId:job.taskId,status:'running',publicationAttempt:0,canResume:false});
 const reconcile=async(data:Record<string,unknown>={},token=f.token)=>{const r=await fetch(f.origin+'/api/local/native-output/reconcile',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+token,'X-CSRF-Token':csrfFor(token)},body:JSON.stringify({episodeId:f.episode,taskId:job.taskId,attempt:0,...data})});return{status:r.status,body:await r.json()};};
 expect((await reconcile({},f.otherToken)).status).toBe(404);expect((await reconcile({attempt:1})).status).toBe(409);expect((await reconcile({leaseToken:fence.p_lease_token})).status).toBe(400);
 const {rename}=await import('node:fs/promises'),receiptPath=join(outputs!.taskPackage.assets.allowedRoot,'publication-receipt-private.json'),bytes=await readFile(receiptPath);await rename(receiptPath,receiptPath+'.held');expect((await reconcile()).status).toBe(409);await rename(receiptPath+'.held',receiptPath);await writeFile(receiptPath,Buffer.from('tampered'));expect((await reconcile()).status).toBe(409);await writeFile(receiptPath,bytes);
 const otherClient=await f.pool.connect();try{await otherClient.query('BEGIN');await otherClient.query("SELECT set_config('loop.owner_id',$1,true)",[f.other]);expect((await otherClient.query('SELECT * FROM local_identity.workspace_publication_holds($1)',[f.episode])).rows).toEqual([]);await otherClient.query('ROLLBACK');}finally{otherClient.release();}
 expect((await reconcile()).body).toEqual({status:'completed',registered:true});expect((await reconcile()).body).toEqual({status:'completed',registered:false});w=await f.read();expect(w.visualTasks[0]).toMatchObject({status:'completed',publicationAttempt:null});expect(w.visualCandidates).toHaveLength(1);expect((await readFile(submissions,'utf8')).trim().split('\n')).toHaveLength(1);expect((await f.c.query('SELECT attempt FROM public.tasks WHERE id=$1',[job.taskId])).rows[0].attempt).toBe(1);await evidence('publication-reconciliation',{taskId:job.taskId,heldAttempt:0,attemptCount:1,supplierPosts:1,missingProofStatus:409,tamperedProofStatus:409,foreignOwnerStatus:404,wrongAttemptStatus:409,extraLeaseStatus:400,repeatedReconciliationRegistered:false,completedState:w.visualTasks[0]});
 }finally{await worker.end();await f.close();}
},120000);

it.skipIf(!enabled)('HTTP speech preserves unknown original submission evidence even after current input is changed',async()=>{
 const {narrationFixture}=await import('./workspaceNarration.fixture');const f=await narrationFixture();try{
 await f.authorize();let w=f.made;const base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
 expect((await f.request('saveWorkspaceNarration',{...base,mode:'tts',...f.narrationSettings,text:'原未知口播'})).status).toBe(200);expect((await f.request('confirmWorkspaceNarration',base)).status).toBe(200);const queued=await f.request('generateWorkspaceNarration',{...base,reservationCents:100});expect(queued.status,JSON.stringify(queued.body)).toBe(200);const taskId=queued.body.narration[0].taskId;await writeFile(f.responseMode,'unknown');await f.execute(taskId,false);await f.restart();await f.restartWorker();w=await f.read();
 expect(w.narration[0].generationTask).toMatchObject({taskId,status:'blocked',submissionOutcome:'started',submissionUnknown:true,publicationAttempt:null});expect(w.narration[0].generationTask.error).toBeTruthy();
 expect((await f.request('saveWorkspaceNarration',{...base,mode:'tts',...f.narrationSettings,text:'修改当前输入仍需核对原任务'})).status).toBe(200);w=await f.read();expect(w.narration[0].generationTask.taskId).toBe(taskId);expect(w.narration[0].generationTask.submissionUnknown).toBe(true);await f.request('confirmWorkspaceNarration',base);expect((await f.request('generateWorkspaceNarration',{...base,retry:true,reservationCents:100})).status).toBe(409);expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);await evidence('speech-unknown',{taskId,supplierPosts:1,inputChanged:true,state:w.narration[0].generationTask,retryStatus:409});
 }finally{await f.close();}
},120000);
