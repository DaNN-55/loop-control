// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {workspaceAudioFixture} from './workspaceAudio.fixture';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {ownerTransaction} from './ownerTransaction';
import {narrationFixture} from './workspaceNarration.fixture';
import {readFile} from 'node:fs/promises';

const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';

it.skipIf(!enabled)('48/6/28/46 independent: disabling stops only unsent queued attempts, preserves running and unknown evidence, and re-enabling does not submit',async()=>{
 const f=await workspaceAudioFixture();
 try{
  await f.authorize();let w=f.made;
  const send=async(command:string,data:Record<string,unknown>={})=>{
   const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});
   expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;
  };
  const selection={capability:'music_sound',provider:'freesound',adapter:'freesound_preview',connectionVersionId:(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='freesound_preview'")).rows[0].id};
  const tasks:string[]=[];
  for(const description of ['queued','running','unknown','held publication']){
   await send('prepareWorkspaceAudio',{kind:'bgm',description,query:'quiet piano',durationSeconds:2,selection});
   tasks.push(w.audio.preparations[0].taskId);
  }
  const [queued,running,unknown,held]=tasks;
  await f.c.query("UPDATE public.tasks SET available_at=now()+interval '1 hour' WHERE id=$1",[queued]);
  const worker=f.workerPool();
  try{expect((await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:running,p_worker_capacity:1}) as any[])[0].task_id).toBe(running);}finally{await worker.end();}
  const unknownResult={preflight:{checks:[{check:'provider_result_unknown',status:'blocked',reason:'Controlled retained unknown evidence.'}]}};
  await f.c.query('UPDATE public.tasks SET last_result=$2 WHERE id=$1',[unknown,unknownResult]);
  await f.c.query('INSERT INTO local_identity.native_output_publications(task_id,attempt,lease_token) VALUES($1,0,$2)',[held,randomUUID()]);
  const before=(await f.c.query('SELECT id,input_snapshot,last_result FROM public.tasks WHERE id=ANY($1::uuid[])',[tasks])).rows;
  const count=async()=>Number((await f.c.query('SELECT count(*) n FROM public.tasks WHERE episode_id=$1',[f.episode])).rows[0].n);
  const originalCount=await count();
  await send('setWorkspaceAudioEnabled',{kind:'bgm',enabled:false});
  const after=(await f.c.query('SELECT id,status,invalidated_at,input_snapshot,last_result FROM public.tasks WHERE id=ANY($1::uuid[])',[tasks])).rows;
  expect(after.find(t=>t.id===queued)).toMatchObject({status:'superseded',invalidated_at:expect.any(Date)});
  expect(after.find(t=>t.id===running)).toMatchObject({status:'running',invalidated_at:null});
  expect(after.find(t=>t.id===unknown)).toMatchObject({status:'ready',invalidated_at:null,last_result:unknownResult});
  expect(after.find(t=>t.id===held)).toMatchObject({status:'ready',invalidated_at:null});
  for(const t of after){expect(t.input_snapshot).toEqual(before.find(b=>b.id===t.id).input_snapshot);expect(t.last_result).toEqual(before.find(b=>b.id===t.id).last_result);}
  expect(await count()).toBe(originalCount);
  await f.restart();w=await f.read();
  await send('setWorkspaceAudioEnabled',{kind:'bgm',enabled:true});
  expect(await count()).toBe(originalCount);
  await send('prepareWorkspaceAudio',{kind:'bgm',description:'new explicit intent',query:'quiet piano',durationSeconds:2,selection});
  expect(await count()).toBe(originalCount+1);
  expect(w.audio.preparations[0].taskId).not.toBe(queued);
  expect(w.audio.preparations[0].status).toBe('ready');
 }finally{await f.close();}
},180000);

it.skipIf(!enabled)('48/20/46 independent: deleting a visual target stops its unsent queued task and retains its immutable request',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  w=await f.fillVisuals(w);const clip=w.clips[0],taskId=randomUUID(),snapshot={test:'controlled unsent visual'};
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_b_roll','ready',$3)",[taskId,f.episode,snapshot]);
  await f.c.query("INSERT INTO local_identity.workspace_visual_candidates(workspace_id,episode_id,clip_id,shot_id,target_item_id,input_fingerprint,target_snapshot,request_snapshot,task_id) VALUES($1,$2,$3,$4,$5,'controlled','{}',$7,$6)",[w.id,f.episode,clip.id,clip.shotId,clip.itemId,taskId,{kind:'video'}]);
  const removed=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'remove',shotId:clip.shotId}});
  expect(removed.status,JSON.stringify(removed.body)).toBe(200);
  const task=(await f.c.query('SELECT status,invalidated_at,input_snapshot FROM public.tasks WHERE id=$1',[taskId])).rows[0];
  expect(task).toMatchObject({status:'superseded',invalidated_at:expect.any(Date),input_snapshot:snapshot});
  expect(removed.body.visualTasks.find((t:any)=>t.taskId===taskId)).toMatchObject({invalidated:true,canResume:false,retryAllowed:false});
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('48/21/24/46 independent: reopening stopped speech submits nothing and a new confirmed same-input request gets a fresh task',async()=>{
 const f=await narrationFixture();
 try{
  await f.authorize();let w=f.made;
  const send=async(command:string,data:Record<string,unknown>={})=>{
   const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});
   expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;
  };
  const clipId=w.clips[0].id;
  await send('saveWorkspaceNarration',{clipId,mode:'tts',...f.narrationSettings,text:'同一正文重新明确请求。'});
  await send('confirmWorkspaceNarration',{clipId});await send('generateWorkspaceNarration',{clipId,reservationCents:100});
  const first=w.narration[0].taskId,hash=w.narration[0].inputFingerprint;
  await f.c.query("UPDATE public.tasks SET available_at=now()+interval '1 hour' WHERE id=$1",[first]);
  await send('setWorkspaceNarrationEnabled',{clipId,enabled:false});
  expect((await f.c.query('SELECT status,invalidated_at FROM public.tasks WHERE id=$1',[first])).rows[0]).toMatchObject({status:'superseded',invalidated_at:expect.any(Date)});
  const count=async()=>Number((await f.c.query("SELECT count(*) n FROM public.tasks WHERE episode_id=$1 AND task_type='generate_narration'",[f.episode])).rows[0].n);
  const before=await count();
  await f.restart();w=await f.read();await send('setWorkspaceNarrationEnabled',{clipId,enabled:true});
  expect(await count()).toBe(before);expect(w.narration[0].inputFingerprint).toBe(hash);
  await send('generateWorkspaceNarration',{clipId,reservationCents:100});
  expect(w.narration[0].taskId).not.toBe(first);expect(w.narration[0].inputFingerprint).toBe(hash);expect(await count()).toBe(before+1);
  expect((await f.c.query('SELECT status FROM public.tasks WHERE id=$1',[w.narration[0].taskId])).rows[0].status).toBe('ready');
  expect((await readFile(f.submissions,'utf8').catch(()=>'')).trim()).toBe('');
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('48/2/42/46 independent: queue stopping rejects foreign Owners, illegal scopes, current-shot removal and read-only workspaces',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});
  expect(made.status,JSON.stringify(made.body)).toBe(200);const w=made.body;
  const stop=(owner:string,kind:string|null,shot:string|null=null)=>ownerTransaction(f.pool,owner,false,c=>c.query('SELECT local_identity.stop_workspace_queued_tasks($1,$2,$3)',[w.id,kind,shot]));
  await expect(stop(f.other,'bgm')).rejects.toMatchObject({code:'42501'});
  await expect(stop(f.owner,'everything')).rejects.toMatchObject({code:'22023'});
  await expect(stop(f.owner,null)).rejects.toMatchObject({code:'22023'});
  await expect(stop(f.owner,'bgm',w.clips[0].shotId)).rejects.toMatchObject({code:'22023'});
  await expect(stop(f.owner,'shot',w.clips[0].shotId)).rejects.toMatchObject({code:'22023'});
  expect((await stop(f.owner,'bgm')).rows[0].stop_workspace_queued_tasks).toBe(0);
  await f.c.query('UPDATE public.episodes SET archived_at=now() WHERE id=$1',[f.episode]);
  await expect(stop(f.owner,'bgm')).rejects.toMatchObject({code:expect.stringMatching(/^(42501|22023|55000)$/)});
  await f.c.query("UPDATE public.episodes SET archived_at=NULL,stage='production_completed' WHERE id=$1",[f.episode]);
  await expect(stop(f.owner,'bgm')).rejects.toMatchObject({code:expect.stringMatching(/^(42501|22023|55000)$/)});
  await f.c.query("UPDATE public.episodes SET stage='storyboard_approved' WHERE id=$1",[f.episode]);
  await f.c.query('UPDATE local_identity.production_workspaces SET script_revision_id=$2 WHERE id=$1',[w.id,f.material]);
  await expect(stop(f.owner,'bgm')).rejects.toMatchObject({code:'55000'});
  await f.c.query('UPDATE local_identity.production_workspaces SET script_revision_id=$2 WHERE id=$1',[w.id,f.script]);
  await f.c.query("UPDATE public.review_packages SET invalidated_at=now(),invalidated_reason='Controlled stale review basis' WHERE id=$1",[f.board]);
  await expect(stop(f.owner,'bgm')).rejects.toMatchObject({code:'55000'});
  await expect(ownerTransaction(f.pool,f.owner,false,c=>c.query("UPDATE public.tasks SET status='ready' WHERE false"))).rejects.toMatchObject({code:'42501'});
 }finally{await f.close();}
},120000);
