// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {narrationFixture} from './workspaceNarration.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {inspectMp4Artifact} from '../worker/mediaTools';

const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
const configurations=[{provider:'bailian',model:'wan2.6-i2v-flash'},{provider:'volcengine',model:'doubao-seedance-2-0-260128'},{provider:'minimax',model:'MiniMax-H3'},{provider:'kling',model:'kling-v3'}] as const;
type Configuration=typeof configurations[number];
async function videoFixture(configuration:Configuration){
 const f=await narrationFixture(undefined,undefined,configuration);
 try{
  await f.authorize();
  const events=join(f.root,'video-contract-events.jsonl'),mode=join(f.root,'video-contract-mode'),module=join(f.root,'controlled-video.mjs');
  await writeFile(mode,'download-failure');
  // The external Provider seam returns real versioned media; Owner/Worker/SQL are unchanged.
  await writeFile(module,`import{readFileSync,appendFileSync}from'node:fs';
export async function createNarrationPorts(){return{mode:'controlled',store:{mode:'keychain',get:async()=> 'synthetic-video-contract'},fetcher:async(input,init={})=>{
 const url=new URL(input),kind=init.method==='POST'?'POST':url.pathname.endsWith('/durable-video-task')?'poll':'download';
 appendFileSync(${JSON.stringify(events)},JSON.stringify({kind,url:url.href})+'\\n');
 if(kind==='POST')return Response.json({id:'durable-video-task',task_id:'durable-video-task',code:0,data:{task_id:'durable-video-task'},output:{task_id:'durable-video-task'}});
 if(kind==='poll'){
  if(url.hostname==='dashscope.aliyuncs.com')return Response.json({output:{task_status:'SUCCEEDED',video_url:'https://dashscope-a717.oss-accelerate.aliyuncs.com/contract.mp4'}});
  if(url.hostname==='ark.cn-beijing.volces.com')return Response.json({status:'succeeded',content:{video_url:'https://result.volccdn.com/contract.mp4'}});
  if(url.hostname==='api.minimax.io')return Response.json({task:{status:'succeeded',content:{url:'https://cdn.hailuoai.com/contract.mp4'}}});
  return Response.json({code:0,data:{task_status:'succeed',task_result:{videos:[{url:'https://cdn.klingai.com/contract.mp4'}]}}});
 }
 if(readFileSync(${JSON.stringify(mode)},'utf8')==='download-failure')throw Error('Controlled result download disconnected');
 return new Response(readFileSync(${JSON.stringify(workspaceTestMedia('landscape-red-blue.mp4'))}),{headers:{'content-type':'video/mp4'}});
}};}`);
  const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'contract-frame.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(image.status).toBe(200);
  const w=f.made,args={workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,firstFrameMaterialRevisionId:image.body.id,prompt:'只恢复原视频任务',durationSeconds:4,reservationCents:90};
  const queued=await f.chosenRequest('requestWorkspaceVisualCandidate',args);expect(queued.status,JSON.stringify(queued.body)).toBe(200);
  return{...f,args,job:queued.body.visualTasks[0],mode,events:async()=>(await readFile(events,'utf8')).trim().split('\n').map(line=>JSON.parse(line) as {kind:string;url:string})};
 }catch(error){await f.close();throw error;}
}

it.skipIf(!enabled).each(configurations)('$provider resumes a failed real MP4 download after restart with one POST, reservation and registered candidate',async configuration=>{
 const f=await videoFixture(configuration);
 try{
  expect((await f.execute(f.job.taskId,false))?.status).toBe('failed');
  const before=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[f.job.taskId])).rows[0].input_snapshot;
  const reserved=(await f.c.query('SELECT reserved_cents,provider_task_id FROM public.paid_generation_reservations WHERE task_id=$1',[f.job.taskId])).rows[0];expect(reserved.provider_task_id).toBe('durable-video-task');
  await f.restart();await f.restartWorker();let w=await f.read();
  expect(w.visualTasks.find((t:any)=>t.taskId===f.job.taskId)).toMatchObject({status:'failed',providerTaskId:'durable-video-task',submissionOutcome:'received',canResume:true});expect(w.visualCandidates).toHaveLength(0);
  const resumed=await f.request('retryWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:f.job.id});expect(resumed.status).toBe(200);
  await writeFile(f.mode,'success');expect((await f.execute(f.job.taskId))?.status).toBe('completed');w=await f.read();
  expect(w.visualTasks.find((t:any)=>t.taskId===f.job.taskId)).toMatchObject({status:'completed',providerTaskId:'durable-video-task',videoPhase:'saving'});expect(w.visualCandidates).toHaveLength(1);
  const candidate=w.visualCandidates[0],path=join(f.assetRoot,candidate.relativePath),bytes=await readFile(path);expect(bytes).toEqual(await readFile(workspaceTestMedia('landscape-red-blue.mp4')));expect(createHash('sha256').update(bytes).digest('hex')).toBe(candidate.sha256);expect((await inspectMp4Artifact(path)).durationSeconds).toBeGreaterThanOrEqual(4);
  const reservations=await f.c.query('SELECT reserved_cents,provider_task_id FROM public.paid_generation_reservations WHERE task_id=$1',[f.job.taskId]);expect(reservations.rows).toEqual([reserved]);expect((await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[f.job.taskId])).rows[0].input_snapshot).toEqual(before);
  await f.restart();w=await f.read();expect(w.visualCandidates.map((c:any)=>c.id)).toEqual([candidate.id]);expect((await f.request('retryWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:f.job.id})).status).toBe(409);
  expect((await f.c.query("SELECT count(*)::int n FROM public.production_material_revisions WHERE episode_id=$1 AND material_type='video' AND source_kind='worker'",[f.episode])).rows[0].n).toBe(1);expect((await f.c.query('SELECT count(*)::int n FROM public.artifacts WHERE producer_task_id=$1',[f.job.taskId])).rows[0].n).toBe(1);
  const events=await f.events();expect(events.map(e=>e.kind)).toEqual(['POST','poll','download','poll','download']);expect(events.filter(e=>e.kind==='poll').every(e=>e.url.endsWith('/durable-video-task'))).toBe(true);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled).each([configurations[0],configurations[1]])('$provider stops after a real ID-registration permission failure and preserves unknown submission protection',async configuration=>{
 const f=await videoFixture(configuration);let revoked=false;
 try{
  await f.c.query('REVOKE EXECUTE ON FUNCTION local_identity.record_wan_submission(uuid,integer,uuid,text) FROM loop_worker');revoked=true;
  expect((await f.execute(f.job.taskId,false))?.status).toBe(configuration.provider==='bailian'?'failed':'blocked');
  await f.c.query('GRANT EXECUTE ON FUNCTION local_identity.record_wan_submission(uuid,integer,uuid,text) TO loop_worker');revoked=false;
  await f.restart();await f.restartWorker();const w=await f.read();
  expect(w.visualTasks.find((t:any)=>t.taskId===f.job.taskId)).toMatchObject({status:configuration.provider==='bailian'?'failed':'blocked',providerTaskId:null,submissionUnknown:true,submissionOutcome:'started',canResume:false});expect(w.visualCandidates).toHaveLength(0);
  expect((await f.request('retryWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:f.job.id})).status).toBe(409);expect((await f.chosenRequest('requestWorkspaceVisualCandidate',{...f.args,expectedRevision:w.revision,prompt:'修改描述也不重复生成'})).status).toBe(409);
  expect((await f.events()).map(e=>e.kind)).toEqual(['POST']);expect((await f.c.query('SELECT count(*)::int n FROM public.paid_generation_reservations WHERE task_id=$1',[f.job.taskId])).rows[0].n).toBe(1);
 }finally{if(revoked)await f.c.query('GRANT EXECUTE ON FUNCTION local_identity.record_wan_submission(uuid,integer,uuid,text) TO loop_worker');await f.close();}
},120000);
