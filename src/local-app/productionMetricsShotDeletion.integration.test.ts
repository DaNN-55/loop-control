// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {narrationFixture,adoptInitialNarration} from './workspaceNarration.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {ownerTransaction} from './ownerTransaction';
import {readProductionMetricsV2} from './productionMetricsCollected';
import {csrfFor} from './sessions';
import {editStudioDocument} from './studioDocument.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';

const contextPath=process.env.LOOP_METRICS_TEST_CONTEXT;
async function adoptedVoiceFixture(){
 if(!contextPath||process.env.LOOP_TEST_CONTEXT_MODULE!==contextPath)throw Error('Explicit isolated metrics context required');
 const {runtimeContext}=await import(contextPath);const context=runtimeContext();
 if(context.dailyRuntime!==false||context.isolatedFixtureContainer!==true)throw Error('Daily environment prohibited');
 const f=await narrationFixture();
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  await f.authorize();let w=f.made;
  const send=async(command:string,data:Record<string,unknown>)=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;};
  const material=await f.request('importMaterial',{sourceKind:'file',sourcePath:'metrics-shot-delete.mp4',materialType:'video',materialPurpose:'a_roll',mimeType:'video/mp4',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('landscape-red-blue.mp4'))).toString('base64')});expect(material.status,JSON.stringify(material.body)).toBe(200);
  for(const clip of w.clips)await send('matchWorkspaceMaterial',{clipId:clip.id,materialRevisionId:material.body.id});
  const shotId=w.clips[0].shotId,clipId=w.clips[0].id;
  await send('saveWorkspaceNarration',{clipId,mode:'tts',...f.narrationSettings,text:'隔离样例：删除镜头后，口播撤回只记一次。'});
  await send('confirmWorkspaceNarration',{clipId});await send('generateWorkspaceNarration',{clipId,reservationCents:100});await f.execute(w.narration[0].taskId);
  await send('refreshWorkspaceNarration',{});w=await adoptInitialNarration(f,w);
  const voice=w.narration.find((n:any)=>n.shotId===shotId),candidate=w.candidates.find((c:any)=>c.id===voice.adoptedAudioTrackId);expect(candidate).toBeTruthy();
  const audioPath=join(f.assetRoot,candidate.relativePath),projectPath=join(f.assetRoot,w.project.relativePath),audio=await readFile(audioPath),project=await readFile(projectPath);
  const date=new Date(Date.now()+8*3600000).toISOString().slice(0,10),midnight=Date.parse(date+'T00:00:00+08:00');
  const metrics=async()=>(await readProductionMetricsV2(f.pool,f.owner,{from:new Date(midnight-86400000+8*3600000).toISOString().slice(0,10),toExclusive:new Date(midnight+86400000+8*3600000).toISOString().slice(0,10),includeTestEpisodes:true})).collected!.detail.candidates;
  expect(await metrics()).toMatchObject({adopted:1,withdrawn:0});
  const post=async(command:string,data:Record<string,unknown>,key=randomUUID())=>{const response=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,data:{episodeId:f.episode,...data},idempotencyKey:key})});return{status:response.status,body:await response.json()};};
  return{...f,w,shotId,voiceItemId:voice.itemId,audioPath,projectPath,audio,project,metrics,post};
 }catch(error){await f.close();throw error;}
}

it.skipIf(!contextPath)('storyboard shot removal records one narration withdrawal and retains audio and historical project across receipt replay and reopen',async()=>{
 const f=await adoptedVoiceFixture();
 try{
  const key=randomUUID(),input={workspaceId:f.w.id,expectedRevision:f.w.revision,operation:{kind:'remove',shotId:f.shotId}};
  const removed=await f.post('editWorkspaceStructure',input,key);expect(removed.status,JSON.stringify(removed.body)).toBe(200);expect(removed.body.clips).toHaveLength(1);expect(removed.body.clips.some((c:any)=>c.shotId===f.shotId)).toBe(false);
  expect(await f.metrics()).toMatchObject({adopted:1,withdrawn:1});
  expect((await f.post('editWorkspaceStructure',input,key)).status).toBe(200);expect(await f.metrics()).toMatchObject({adopted:1,withdrawn:1});
  const denied=await f.post('editWorkspaceStructure',{workspaceId:removed.body.id,expectedRevision:removed.body.revision,operation:{kind:'remove',shotId:removed.body.clips[0].shotId}});expect(denied.status).toBe(409);expect(await f.metrics()).toMatchObject({withdrawn:1});
  await f.restart();const reopened=await f.read();expect(reopened.clips).toHaveLength(1);expect(reopened.usedNarration.some((n:any)=>n.shotId===f.shotId)).toBe(false);expect(await f.metrics()).toMatchObject({adopted:1,withdrawn:1});
  expect(await readFile(f.audioPath)).toEqual(f.audio);expect(await readFile(f.projectPath)).toEqual(f.project);
 }finally{await f.close();}
},150000);

it.skipIf(!contextPath)('native editor shot deletion records one narration withdrawal across repeated save and reopen while keeping source history',async()=>{
 const f=await adoptedVoiceFixture();
 try{
  let w=f.w;
  for(const clip of w.clips){const saved=await f.post('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body;}
  const opened=await f.post('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
  const visualIds=new Set(w.clips.filter((c:any)=>c.shotId===f.shotId).map((c:any)=>c.itemId));
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{
   for(const timeline of doc.timelines){timeline.items=timeline.items.filter((item:any)=>!visualIds.has(item.id)&&item.id!==f.voiceItemId);timeline.selectedId=null;timeline.selectedIds=[];}
  });
  expect(await f.metrics()).toMatchObject({adopted:1,withdrawn:0}); // Native editing alone is not a committed workspace save.
  const key=randomUUID(),input={workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256};
  const saved=await f.post('saveWorkspaceStudio',input,key);expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;expect(w.clips).toHaveLength(1);expect(w.clips.some((c:any)=>c.shotId===f.shotId)).toBe(false);
  expect(await f.metrics()).toMatchObject({adopted:1,withdrawn:1});
  expect((await f.post('saveWorkspaceStudio',input,key)).status).toBe(200);expect(await f.metrics()).toMatchObject({withdrawn:1});
  const unchanged=await f.post('saveWorkspaceStudio',{...input,expectedRevision:w.revision,expectedWorkspaceSha256:w.project.sha256});expect(unchanged.status,JSON.stringify(unchanged.body)).toBe(200);w=unchanged.body.productionWorkspace;expect(await f.metrics()).toMatchObject({withdrawn:1});
  expect((await f.post('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision})).status).toBe(200);
  await f.restart();const reopened=await f.read();expect(reopened.clips).toHaveLength(1);expect(reopened.usedNarration.some((n:any)=>n.shotId===f.shotId)).toBe(false);expect(await f.metrics()).toMatchObject({adopted:1,withdrawn:1});
  expect(await readFile(f.audioPath)).toEqual(f.audio);expect(await readFile(f.projectPath)).toEqual(f.project);
 }finally{await f.close();}
},180000);
