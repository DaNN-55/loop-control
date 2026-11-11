// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {join} from 'node:path';
import {narrationFixture,adoptInitialNarration} from './workspaceNarration.fixture';
import {readLocalCatalog,parseCatalogQuery} from './catalog';
import {randomUUID} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {ownerTransaction} from './ownerTransaction';
import {readWorkspaceProject,persistWorkspaceRevision} from './productionWorkspaceCommands';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';

it.skipIf(!enabled)('48/6/7/21/23: disabling unknown speech removes current blockers but retains reconciliation and prevents resend',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();let w=f.made;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;};
  const clipId=w.clips[0].id;
  await send('saveWorkspaceNarration',{clipId,mode:'tts',...f.narrationSettings,text:'修改正文不能绕过原未知请求。'});
  await send('confirmWorkspaceNarration',{clipId});await send('generateWorkspaceNarration',{clipId,reservationCents:100});
  const taskId=w.narration[0].taskId;
  await writeFile(f.responseMode,'unknown');await f.execute(taskId);w=await f.read();
  const catalog=()=>readLocalCatalog(f.pool,f.owner,parseCatalogQuery(new URLSearchParams({view:'operations',q:f.episode})));
  expect((await catalog()).operationRows[0]).toMatchObject({actionStatus:'blocked',blockerCount:1});
  await send('setWorkspaceNarrationEnabled',{clipId,enabled:false});
  expect(w.narration[0]).toMatchObject({enabled:false,generationTask:{submissionUnknown:true}});
  expect((await catalog()).operationRows[0]).toMatchObject({actionStatus:'running',blockerCount:0,backgroundTaskCount:1});
  expect((await catalog()).blocked.total).toBe(0);
  await f.restart();w=await f.read();expect(w.narration[0].enabled).toBe(false);
  expect((await catalog()).operationRows[0].blockerCount).toBe(0);
  await send('saveWorkspaceNarration',{clipId,mode:'tts',...f.narrationSettings,text:'核对已停用请求。'});
  expect(w.narration[0].enabled).toBe(true);
  expect((await catalog()).operationRows[0].actionStatus).toBe('blocked');
  expect((await f.request('generateWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId,reservationCents:100,retry:true})).status).toBe(409);
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
  await send('saveWorkspaceNarration',{clipId,mode:'none',text:'核对已停用请求。'});
  expect(w.narration[0]).toMatchObject({enabled:false,mode:'none'});
  expect((await catalog()).operationRows[0].blockerCount).toBe(0);
 }finally{await f.close();}
},180000);

it.skipIf(!enabled)('48/21/26/37: unused missing voice and its long tail cannot block real native export, while re-enabled media must validate',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();let w=f.made;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;};
  const clipId=w.clips[0].id;
  await send('saveWorkspaceNarration',{clipId,mode:'tts',...f.narrationSettings,text:'保留声音记录但本次不使用。'});
  await send('confirmWorkspaceNarration',{clipId});await send('generateWorkspaceNarration',{clipId,reservationCents:100});
  await f.execute(w.narration[0].taskId);w=await f.read();w=await adoptInitialNarration(f,w);
  const path=w.narration[0].relativePath,retained=w.narration[0].audioTrackId;
  await ownerTransaction(f.pool,f.owner,false,async c=>{
   const row=(await c.query('SELECT * FROM local_identity.production_workspaces WHERE id=$1 FOR UPDATE',[w.id])).rows[0];
   const project=await readWorkspaceProject(c,f.assetRoot,row);
   project.timelines[0].items.find(i=>i.id===w.narration[0].itemId)!.durationInFrames=600;
   await persistWorkspaceRevision(c,f.assetRoot,row,project,row.bindings,'Controlled long retained voice',{nativeEdit:true});
  });w=await f.read();
  await send('setWorkspaceNarrationEnabled',{clipId,enabled:false});
  await unlink(join(f.assetRoot,path));w=await f.fillVisuals(w);
  for(const clip of w.clips)await send('setWorkspaceCaptionsEnabled',{clipId:clip.id,enabled:false});
  await send('exportWorkspace');
  expect(w.exports[0].status,JSON.stringify(w.exports[0].checks)).toBe('ready');
  expect(w.narration[0]).toMatchObject({enabled:false,retainedAudioTrackId:retained});
  await send('setWorkspaceNarrationEnabled',{clipId,enabled:true});
  await send('exportWorkspace');
  expect(w.exports[0].status).toBe('failed');
  expect(w.exports[0].checks.find((c:any)=>c.name==='used_content').passed).toBe(false);
 }finally{await f.close();}
},180000);

it.skipIf(!enabled)('48/7/8/20/28/29: replacing or deleting a visual target and unused sound failures leave only background reminders',async()=>{
 const f=await productionWorkspaceFixture();try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const visualTask=randomUUID(),soundTask=randomUUID(),clip=w.clips[0];
  for(const [id,type] of [[visualTask,'generate_b_roll'],[soundTask,'generate_soundtrack']])await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,last_result) VALUES($1,$2,$3,'failed','{}',$4)",[id,f.episode,type,{blockers:[{code:'CONTROLLED_FAILURE',detail:'Controlled failure.'}]}]);
  await f.c.query("INSERT INTO local_identity.workspace_visual_candidates(workspace_id,episode_id,clip_id,shot_id,target_item_id,input_fingerprint,target_snapshot,request_snapshot,task_id) VALUES($1,$2,$3,$4,$5,'controlled','{}',$7,$6)",[w.id,f.episode,clip.id,clip.shotId,clip.itemId,visualTask,{kind:'video'}]);
  await f.c.query("INSERT INTO local_identity.workspace_audio_preparations(workspace_id,episode_id,kind,description,anchor,duration_seconds,task_id,input_fingerprint) VALUES($1,$2,'bgm','Controlled unused music','absolute',2,$3,'controlled')",[w.id,f.episode,soundTask]);
  const catalog=()=>readLocalCatalog(f.pool,f.owner,parseCatalogQuery(new URLSearchParams({view:'operations',q:f.episode})));
  expect((await catalog()).operationRows[0]).toMatchObject({blockerCount:1,backgroundTaskCount:1});
  let r=await f.request('matchWorkspaceMaterial',{workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id,materialRevisionId:f.material});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;
  expect((await catalog()).operationRows[0]).toMatchObject({blockerCount:0,backgroundTaskCount:2});
  r=await f.request('setWorkspaceAudioEnabled',{workspaceId:w.id,expectedRevision:w.revision,kind:'bgm',enabled:false});expect(r.status).toBe(200);w=r.body;
  expect((await catalog()).operationRows[0].blockerCount).toBe(0);
  w=await f.fillVisuals(w);
  r=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'remove',shotId:clip.shotId}});expect(r.status,JSON.stringify(r.body)).toBe(200);
  expect((await catalog()).operationRows[0]).toMatchObject({blockerCount:0,backgroundTaskCount:2});
  expect((await f.c.query('SELECT status FROM public.tasks WHERE id=ANY($1::uuid[])',[[visualTask,soundTask]])).rows.map(t=>t.status)).toEqual(['failed','failed']);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('48/6/21/26: an already sent speech request may finish after disabling but never restores or adopts its content',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();let w=f.made;const clipId=w.clips[0].id;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;};
  await send('saveWorkspaceNarration',{clipId,mode:'tts',...f.narrationSettings,text:'这次请求已发送，结果只作为候选保留。'});await send('confirmWorkspaceNarration',{clipId});await send('generateWorkspaceNarration',{clipId,reservationCents:100});
  const taskId=w.narration[0].taskId,modulePath=join(f.root,'controlled-narration.mjs');
  await writeFile(modulePath,(await readFile(modulePath,'utf8')).replace('setTimeout(resolve,400)','setTimeout(resolve,4000)'));await writeFile(f.responseMode,'delay');
  const execution=f.execute(taskId);
  let sent=false;for(let attempt=0;attempt<100&&!sent;attempt++){sent=await readFile(f.submissions,'utf8').then(value=>value.trim().length>0,()=>false);if(!sent)await delay(20);}
  expect(sent).toBe(true);await send('setWorkspaceNarrationEnabled',{clipId,enabled:false});
  expect((await execution).status).toBe('completed');w=await f.read();
  await send('refreshWorkspaceNarration');expect(w.narration[0]).toMatchObject({enabled:false,adoptedAudioTrackId:null});
  expect(w.candidates.some((candidate:any)=>candidate.taskId===taskId&&candidate.status==='available')).toBe(true);
  const native=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(native.timelines.flatMap((t:any)=>t.items).some((item:any)=>item.id===w.narration[0].itemId)).toBe(false);
  await send('setWorkspaceNarrationEnabled',{clipId,enabled:true});await send('refreshWorkspaceNarration');
  expect(w.narration[0]).toMatchObject({enabled:true,adoptedAudioTrackId:null});
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
 }finally{await f.close();}
},120000);
