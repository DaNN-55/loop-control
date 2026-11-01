// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,realpath,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {narrationFixture} from './workspaceNarration.fixture';
import {csrfFor} from './sessions';
import {nativeWorkerPort} from './workerDatabase';
import {prepareNativeAttemptOutput} from './nativeAttemptOutput';
import {episodeFileIO} from './episodeFiles';
import {runCodexWorker,type ClaimedWorkerTask} from '../worker/codexRunner';
import {executeNativeNarration} from './narrationWorker';
import {verifyArtifactIndex} from '../worker/mediaLibrary';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
it.skipIf(!enabled)('real queue claims and one unknown controlled Provider submission remain blockers without rewriting the task or fee',async()=>{
 const f=await narrationFixture(undefined,undefined,false,false,['db/local/120-native-workspace-storage-locations.sql','db/local/125-global-media-root-plans.sql']),worker=f.workerPool(),target=await realpath(await mkdtemp('/private/tmp/loop-root-blockers-'));
 try{
  await f.authorize();let w=await f.read();
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  await send('saveWorkspaceNarration',{mode:'tts',...f.narrationSettings,text:'全局根盘点不更改未知收费请求。'});await send('confirmWorkspaceNarration');await send('generateWorkspaceNarration',{reservationCents:100});const taskId=w.narration[0].taskId;
  const planned=async(reason:string)=>{const task=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=$1',[taskId])).rows,fee=(await f.c.query('SELECT to_jsonb(r) value FROM public.paid_generation_reservations r WHERE task_id=$1',[taskId])).rows;
   const response=await fetch(f.origin+'/api/local/media-root',{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:f.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'planMigration',path:target,idempotencyKey:randomUUID()})}),plan=await response.json();expect(response.status,JSON.stringify(plan)).toBe(200);expect(plan.manifest.blockers.map((r:{reason:string})=>r.reason).join()).toContain(reason);expect(plan.manifest.canExecute).toBe(false);expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=$1',[taskId])).rows).toEqual(task);expect((await f.c.query('SELECT to_jsonb(r) value FROM public.paid_generation_reservations r WHERE task_id=$1',[taskId])).rows).toEqual(fee);return plan;
  };
  await planned('待执行或运行');const port=nativeWorkerPort(worker),task=(await port.rpc('claim_next_worker_task',{p_task_id:taskId,p_worker_capacity:1}) as any[])[0];expect(task.task_id).toBe(taskId);await planned('待执行或运行');
  await writeFile(f.responseMode,'unknown');const fence={p_task_id:taskId,p_attempt:task.attempt,p_lease_token:task.lease_token};let outputs:Awaited<ReturnType<typeof prepareNativeAttemptOutput>>|undefined;
  const result=await runCodexWorker({actualCostCents:1,claimNextTask:async()=>({taskId:task.task_id,taskType:task.task_type,attempt:task.attempt,budgetLimitCents:task.budget_limit_cents,maxAttempts:task.max_attempts,provider:task.provider,model:task.model,promptVersion:task.prompt_version,episodeId:task.episode_id,accountId:task.account_id,blueprintVersionId:task.blueprint_version_id,title:task.title,allowedAssetRoot:task.allowed_asset_root,inputSnapshot:task.input_snapshot} as ClaimedWorkerTask),verifyAssetRoot:async()=>{},verifyArtifacts:async(p,a)=>outputs?outputs.verify(a):verifyArtifactIndex({assetRoot:p.assets.allowedRoot,episodeId:p.episode.id,episodeRelativePath:p.assets.episodeRelativePath,artifacts:a}),execute:async p=>{outputs=await prepareNativeAttemptOutput(p,fence,[],await episodeFileIO(worker,f.assetRoot,f.episode,true));return executeNativeNarration(worker,{mode:'controlled',modulePath:join(f.root,'controlled-narration.mjs')},outputs.taskPackage,fence);},reportResult:async(_id,_attempt,value)=>{await port.rpc('report_worker_result',{...fence,p_result:value});}});expect(result?.status).toBe('blocked');
  const submissions=await readFile(f.submissions,'utf8');expect(submissions.trim().split('\n')).toHaveLength(1);await f.restart();await planned('供应商');expect(await readFile(f.submissions,'utf8')).toBe(submissions);
 }finally{await worker.end();await f.close();await rm(target,{recursive:true});}
},120000);
