// @vitest-environment node
import {expect,it} from 'vitest';
import {writeFile} from 'node:fs/promises';
import type {Pool} from 'pg';
import {storyE2eFixture} from './storyE2e.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {markProviderDispatching,prepareProviderDispatch,recoverProviderPreparation} from './providerDispatch';

const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1'&&!!process.env.LOOP_TEST_CONTEXT_MODULE;
const migrations=['db/current/228-storyboard-batch-video.sql','db/current/229-storyboard-batch-queued-reservations.sql'];

async function batchSpeech(f:Awaited<ReturnType<typeof storyE2eFixture>>,shotId:string){
 const {id}=await f.read(),shotIds=[shotId];
 const common={selection:f.selections.speech,voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1};
 const review=await f.ok(f.send('prepareStoryboardBatch',{kind:'speech',shotIds,common}));
 const receipt=await f.ok(f.post('episode-commands','confirmStoryboardBatch',{episodeId:f.episode,workspaceId:id,confirmationId:review.confirmationId,shotIds}));
 return receipt.items[0].taskId as string;
}

it.skipIf(!enabled)('permits recycling after cancelling a queued reservation and still holds an unknown dispatch',async()=>{
 const f=await storyE2eFixture({scriptOnly:true,migrations});
 try{
  const [first,second]=(await f.read()).clips;
  const preview=()=>f.ok(f.post('recycle-bin','previewBatchRecycle',{episodeIds:[f.episode]}));
  const stopped=await batchSpeech(f,first.shotId);
  expect((await preview()).items).toMatchObject([{status:'failed'}]);
  await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:first.id,enabled:false,voiceMode:'none'}));
  expect((await preview()).items).toMatchObject([{status:'ready'}]);
  const oldCost=(await f.c.query('SELECT request_state FROM public.paid_generation_reservations WHERE task_id=$1',[stopped])).rows[0];
  expect(oldCost?.request_state).toBe('queued');

  const unknown=await batchSpeech(f,second.shotId);
  await writeFile(f.mode,'unknown');
  expect((await f.execute(unknown)).status).toBe('blocked');
  await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:second.id,enabled:false,voiceMode:'none'}));
  expect((await preview()).items).toMatchObject([{status:'failed'}]);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('allows one transient local preparation recovery for a queued batch and forbids it after dispatch starts',async()=>{
 const f=await storyE2eFixture({scriptOnly:true,migrations});
 try{
  const [clip]=(await f.read()).clips,taskId=await batchSpeech(f,clip.shotId);
  const worker=f.workerPool();
  const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:taskId,p_worker_capacity:1}) as Array<{attempt:number;lease_token:string}>)[0];
  const fence={p_task_id:taskId,p_attempt:task.attempt,p_lease_token:task.lease_token};
  const transient=()=>Object.assign(Error('controlled transient serialization'),{code:'40001'});
  let attempts=0;
  const preparation={query:async(sql:string,args:unknown[])=>{
   if(sql.includes('prepare_provider_dispatch')&&++attempts===1)throw transient();
   return worker.query(sql,args);
  }} as Pool;
  expect(await prepareProviderDispatch(preparation,fence,'speech')).toBe('confirmed');
  expect(attempts).toBe(2);
  await markProviderDispatching(worker,fence);
  await expect(recoverProviderPreparation(worker,fence,'speech',async()=>{throw transient();})).rejects.toMatchObject({name:'ProviderRequestNotSentError'});
 }finally{await f.close();}
},120000);
