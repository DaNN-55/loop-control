import {adoptInitialNarration} from './workspaceNarration.fixture';
// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each([false,true])('fresh authored first video uses current preparation without a legacy approval (actual voice=%s)',async withVoice=>{
 const script=productionScriptTemplate.replace('镜头类型：b_roll','镜头类型：a_roll');
 const f=await formalWorkflowFixture({controlled:true,scriptText:script});
 try{
  expect((await f.send('start')).status).toBe(200);
  let r=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(r.status,JSON.stringify(r.body)).toBe(200);let w=r.body;
  await f.send('setWanBudget',{trialCents:300,totalCents:10000,full:false});const send=async(command:string,data:Record<string,unknown>={})=>{const response=await f.chosenSend(command,{workspaceId:w.id,expectedRevision:w.revision,...data});if(response.status===200&&response.body.id===w.id)w=response.body;return response;};
  const uploaded=await f.send('importMaterial',{sourceKind:'file',sourcePath:'first.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(uploaded.status).toBe(200);
  expect((await f.send('setWanBudget',{trialCents:300,totalCents:1000,full:false})).status).toBe(200);
  const payload={clipId:w.clips[0].id,materialRevisionId:uploaded.body.id,prompt:'清晨山脊，缓慢推进。',durationSeconds:4,reservationCents:90};
  r=await send('generateWorkspaceImage',payload);expect(r.status,JSON.stringify(r.body)).toBe(409);expect(r.body.error).toContain('授权');
  expect((await send('authorizeWorkspacePreparation',{enabled:true})).status).toBe(200);
  if(withVoice){
   expect((await f.send('saveTtsSettings',{languageCode:'zh-CN',voice:'zh_female_vv_uranus_bigtts',speakingRate:1})).status).toBe(200);
   expect((await send('saveWorkspaceNarration',{clipId:w.clips[0].id,mode:'tts',text:'真实主声窗口由本次口播结果确定。'})).status).toBe(200);
   expect((await send('confirmWorkspaceNarration',{clipId:w.clips[0].id})).status).toBe(200);
   expect((await send('generateWorkspaceNarration',{clipId:w.clips[0].id})).status).toBe(200);
   expect((await f.controlled!.execute(w.narration[0].taskId))?.status).toBe('completed');
   expect((await send('refreshWorkspaceNarration')).status).toBe(200);w=await adoptInitialNarration({request:(command,data)=>f.send(command,data)},w);
  }
  r=await send('generateWorkspaceImage',payload);expect(r.status,JSON.stringify(r.body)).toBe(200);
  expect(w.clips[0].image.providerDurationSeconds).toBe(4);if(withVoice)expect(w.clips[0].image.durationSeconds).toBeCloseTo(2.4);
  const taskId=w.clips[0].image.taskId;
  expect((await f.c.query('SELECT stage FROM public.episodes WHERE id=$1',[f.newEpisode])).rows[0].stage).toBe('script_approved');
  expect((await f.c.query('SELECT count(*)::int n FROM public.approvals WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
  const task=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[taskId])).rows[0];expect(task.input_snapshot.workspace_visual).toBeTruthy();if(withVoice)expect(task.input_snapshot.workspace_visual.windowDurationSeconds).toBeCloseTo(2.4);
  expect((await f.controlled!.execute(taskId))?.status).toBe('completed');
  r=await send('fillWorkspaceImageResult',{taskId});expect(r.status,JSON.stringify(r.body)).toBe(200);expect(w.clips[0].source.kind).toBe('video');
  const after=w.project.sha256;
  r=await send('fillWorkspaceImageResult',{taskId});expect(r.status).toBe(409);expect(w.project.sha256).toBe(after);
  expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1 AND provider=$2',[f.newEpisode,'volcengine'])).rows[0].n).toBe(1);
 }finally{await f.close();}
},180000);


it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('replanning discards current voice adoption without discarding historical decisions, then adopts the first new voice',async()=>{
 const script=productionScriptTemplate.replace('镜头类型：b_roll','镜头类型：a_roll');
 const f=await formalWorkflowFixture({controlled:true,scriptText:script});
 try{
  expect((await f.send('start')).status).toBe(200);
  let r=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(r.status,JSON.stringify(r.body)).toBe(200);let w=r.body;
  await f.send('setWanBudget',{trialCents:300,totalCents:10000,full:false});const send=async(command:string,data:Record<string,unknown>={})=>{const response=await f.chosenSend(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(response.status,JSON.stringify(response.body)).toBe(200);if(response.body.id===w.id)w=response.body;return response;};
  await f.send('saveTtsSettings',{languageCode:'zh-CN',voice:'zh_female_vv_uranus_bigtts',speakingRate:1});
  const generate=async(text:string)=>{await send('authorizeWorkspacePreparation',{enabled:true});await send('saveWorkspaceNarration',{clipId:w.clips[0].id,mode:'tts',text});await send('confirmWorkspaceNarration',{clipId:w.clips[0].id});await send('generateWorkspaceNarration',{clipId:w.clips[0].id});expect((await f.controlled!.execute(w.narration[0].taskId))?.status).toBe('completed');};
  await generate('重规划前的完整口播。');await send('refreshWorkspaceNarration');w=await adoptInitialNarration({request:(command,data)=>f.send(command,data)},w);
  const oldTrack=w.narration[0].audioTrackId;expect(w.narration[0].adoptedAudioTrackId).toBe(oldTrack);
  r=await f.send('reconfirmScript',{expectedScriptRevisionId:f.main,text:script.replace('填写本段完整口播。','重新规划后的主脚本完整口播。'),reason:'验收重新规划'});expect(r.status,JSON.stringify(r.body)).toBe(200);const revised=r.body.id;
  expect((await f.send('start')).status).toBe(200);
  await send('replanWorkspace',{expectedScriptRevisionId:revised,reason:'以新脚本重建初稿'});
  expect(w.narration[0].adoptedAudioTrackId).toBeNull();
  expect((await f.c.query("SELECT count(*)::int n FROM local_identity.workspace_candidate_decisions WHERE workspace_id=$1 AND candidate_id=$2 AND decision='adopted'",[w.id,oldTrack])).rows[0].n).toBe(1);
  await generate('重新规划后的完整新口播。');await send('refreshWorkspaceNarration');w=await adoptInitialNarration({request:(command,data)=>f.send(command,data)},w);
  const current=w.narration[0];expect(current.audioTrackId).not.toBe(oldTrack);expect(current.adoptedAudioTrackId).toBe(current.audioTrackId);
  expect(w.candidates.find((c:any)=>c.id===oldTrack)?.status).not.toBe('adopted');expect(w.candidates.find((c:any)=>c.id===current.audioTrackId)?.status).toBe('adopted');
  const project=JSON.parse(await readFile(f.assetRoot+'/'+w.project.relativePath,'utf8'));expect(project.timelines.flatMap((t:any)=>t.items).find((i:any)=>i.id===current.itemId)?.sourceAssetId).toBe('audio-track-'+current.audioTrackId);
 }finally{await f.close();}
},180000);
