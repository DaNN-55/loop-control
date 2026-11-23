// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import type {ClaimedTaskRow} from '../orchestration/workerDispatch';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
import {storyE2eFixture} from './storyE2e.fixture';
import {nativeWorkerPort} from './workerDatabase';

const enabled=!!process.env.LOOP_TEST_CONTEXT_MODULE;
const migrations=[
 'db/current/228-storyboard-batch-video.sql','db/current/229-storyboard-batch-queued-reservations.sql',
 'db/current/230-storyboard-batch-images.sql','db/current/231-storyboard-batch-image-dispatch-target.sql',
 'db/current/232-worker-generation-scheduling.sql',
];
type Fixture=Awaited<ReturnType<typeof storyE2eFixture>>;

async function enableRoutes(f:Fixture){
 await f.c.query(`INSERT INTO public.worker_generation_routes(provider,adapter,kind,capacity) VALUES
  ('volcengine','seedance_video','video',2),('kling','kling_video','video',2),
  ('bailian','wan_video','video',2),('minimax','minimax_video','video',2),
  ('openai','openai_images','image',2),('volcengine_tts','volcengine_tts','speech',2)`);
}
const providers={
 seedance:{provider:'volcengine',adapter:'seedance_video',model:'doubao-seedance-2-0-260128',endpoint:'https://ark.cn-beijing.volces.com/api/v3'},
 kling:{provider:'kling',adapter:'kling_video',model:'kling-v3',endpoint:'https://api-singapore.klingai.com'},
 wan:{provider:'bailian',adapter:'wan_video',model:'wan2.6-i2v-flash',endpoint:'https://dashscope.aliyuncs.com'},
 minimax:{provider:'minimax',adapter:'minimax_video',model:'MiniMax-H3-Lite',endpoint:'https://api.minimax.io'},
};
async function addControlledVideo(f:Fixture,name:keyof typeof providers){
 const {provider,adapter,model,endpoint}=providers[name];
 const connection=randomUUID(),version=randomUUID(),secret=randomUUID();
 await f.c.query('BEGIN');
 try{
  await f.c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);
  await f.c.query('INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,$2,$3,$4,$5,$6,$7)',[connection,provider,adapter,name+' scheduler fixture',f.owner,version,endpoint]);
  await f.c.query('INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES($1,$2,1,$3,$4,$5,$6)',[version,connection,provider,adapter,endpoint,secret]);
  await f.c.query("INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES($1,$2,$3,'keychain')",[version,f.owner,secret]);
  await f.c.query('INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified) VALUES($1,$2,true)',[version,f.owner]);
  await f.c.query("INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome) VALUES($1,$2,'live','verified')",[version,f.owner]);
  await f.c.query('COMMIT');
 }catch(error){await f.c.query('ROLLBACK');throw error;}
 return {capability:'video',provider,adapter,model,connectionVersionId:version};
}

async function submit(f:Fixture,kind:string,shotIds:string[],common:Record<string,unknown>,drafts:unknown[]=[]):Promise<string[]>{
 const w=await f.read();
 const review=await f.ok(f.send('prepareStoryboardBatch',{kind,shotIds,common,drafts}));
 expect(review.items.map((i:{state:string;reason?:string})=>[i.state,i.reason])).toEqual(shotIds.map(()=>['ready',undefined]));
 const receipt=await f.ok(f.post('episode-commands','confirmStoryboardBatch',{episodeId:f.episode,workspaceId:w.id,confirmationId:review.confirmationId,shotIds}));
 expect(receipt.status).toBe('submitted');
 return receipt.items.map((i:{taskId:string})=>i.taskId);
}
const speech=(f:Fixture)=>({selection:f.selections.speech,voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1});
const claim=(worker:ReturnType<Fixture['workerPool']>)=>nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:null,p_worker_capacity:4}) as Promise<ClaimedTaskRow[]>;

it.skipIf(!enabled).each([['seedance','seedance'],['seedance','kling'],['wan','minimax']] as const)('claims %s + %s video and uses both image slots in the real database scheduler',async (left,right)=>{
 const f=await storyE2eFixture({migrations});
 try{
  await f.c.query('UPDATE public.worker_scheduler_settings SET capacity=4');
  const [first,second]=(await f.read()).clips;
  for(const clip of [first,second])await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:clip.id,enabled:false,voiceMode:'none'}));
  const initial=left==='seedance'?f.selections.video:await addControlledVideo(f,left);
  const other=left===right?initial:await addControlledVideo(f,right);
  const firstVideo=await submit(f,'video',[first.shotId],{selection:initial,durationSeconds:5});
  const secondVideo=await submit(f,'video',[second.shotId],{selection:other,durationSeconds:5});
  const images=await submit(f,'image',[first.shotId,second.shotId],{selection:f.selections.image});
  const worker=f.workerPool();
  const baseline=(await Promise.all(Array.from({length:4},()=>claim(worker)))).flat();
  expect(baseline.map(t=>t.task_id)).toHaveLength(left===right?2:3);
  expect(baseline.filter(t=>t.provider==='openai')).toHaveLength(1);
  await enableRoutes(f);
  const extra=(await Promise.all(Array.from({length:4},()=>claim(worker)))).flat();
  const all=baseline.concat(extra);
  expect(all.map(t=>t.task_id).sort()).toEqual([...firstVideo,...secondVideo,...images].sort());
  expect((await claim(worker))).toEqual([]);
  const active=(await f.c.query("SELECT provider,count(*)::integer count FROM public.tasks WHERE status='running' GROUP BY provider ORDER BY provider")).rows;
  const counts:Record<string,number>={openai:2};
  for(const name of [left,right])counts[providers[name].provider]=(counts[providers[name].provider]??0)+1;
  expect(Object.fromEntries(active.map(r=>[r.provider,r.count]))).toEqual(counts);
 }finally{await f.close();}
},90000);

it.skipIf(!enabled)('serves a later voice on the next free slot while an older image waits',async()=>{
 const f=await storyE2eFixture({migrations});
 try{
  await f.c.query('UPDATE public.worker_scheduler_settings SET capacity=1');
  await enableRoutes(f);
  const [first,second]=(await f.read()).clips;
  for(const clip of [first,second])await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:clip.id,enabled:true,voiceMode:'tts'}));
  const images=await submit(f,'image',[first.shotId,second.shotId],{selection:f.selections.image});
  const worker=f.workerPool();
  const [running]=await claim(worker);
  expect(images).toContain(running.task_id);
  const [voice]=await submit(f,'speech',[first.shotId],speech(f));
  expect(await claim(worker)).toEqual([]);
  expect((await f.c.query("SELECT status FROM public.tasks WHERE id=$1",[running.task_id])).rows[0].status).toBe('running');
  const result=await runWorkspaceDeliveryProcess(f,running,{mountPath:f.volume.mountPath,media:{mode:'controlled',modulePath:join(f.root,'story-provider.mjs')}});
  expect(result.status).toBe('completed');
  expect((await claim(worker))[0].task_id).toBe(voice);
  expect((await f.c.query("SELECT status FROM public.tasks WHERE id=$1",[images.find(id=>id!==running.task_id)])).rows[0].status).toBe('ready');
 }finally{await f.close();}
},90000);


it.skipIf(!enabled).each(['provider','quota'] as const)('shares a %s limit between two separately verified connection versions',async scope=>{
 const f=await storyE2eFixture({migrations});
 try{
  await f.c.query('UPDATE public.worker_scheduler_settings SET capacity=4');
  await enableRoutes(f);
  if(scope==='provider'){
   await f.c.query("INSERT INTO public.worker_resource_ceilings(resource_key,capacity) VALUES('provider:volcengine',1)");
  }else{
   await f.c.query("INSERT INTO public.worker_resource_ceilings(resource_key,capacity) VALUES('quota:fixture-video',1)");
   await f.c.query("UPDATE public.worker_generation_routes SET quota_key='quota:fixture-video' WHERE provider IN ('volcengine','kling')");
  }
  const [first,second]=(await f.read()).clips;
  for(const clip of [first,second])await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:clip.id,enabled:false,voiceMode:'none'}));
  const other=await addControlledVideo(f,scope==='provider'?'seedance':'kling');
  expect(other.connectionVersionId).not.toBe(f.selections.video.connectionVersionId);
  const [one]=await submit(f,'video',[first.shotId],{selection:f.selections.video,durationSeconds:5});
  const [two]=await submit(f,'video',[second.shotId],{selection:other,durationSeconds:5});
  const worker=f.workerPool(),claimed=(await Promise.all([claim(worker),claim(worker)])).flat();
  expect(claimed).toHaveLength(1);
  const remaining=claimed[0].task_id===one?two:one;
  expect((await f.c.query('SELECT status FROM public.tasks WHERE id=$1',[remaining])).rows[0].status).toBe('ready');
  expect(await claim(worker)).toEqual([]);
 }finally{await f.close();}
},90000);
