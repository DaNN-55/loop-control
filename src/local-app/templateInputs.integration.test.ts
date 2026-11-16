// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
const script='# 当前模板预填\n## 制作设置\n- 模板版本：3\n- 旁白音色：zh_female_vv_uranus_bigtts\n- 旁白语言：zh-CN\n- 旁白语速：0.9\n- 背景音乐素材：背景\n- 封面素材：产品\n- 视频费用预留（分/镜头）：250\n## 正文\n### 段落 01\n- 口播：第一镜\n- 画面来源：图片\n- 画面提示：静态产品构图\n- 视频提示词：独立运镜\n- 素材名称：产品\n- 音效素材：轻响\n- 旁白语速：1.1\n- 音效起点（秒）：0\n- 音效时长（秒）：0.4\n- 镜头时长（秒）：2\n';
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('resolves frozen current-template prefills through real HTTP and scoped material revisions without adopting anything',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:script});
 try{
  const upload=async(name:string,type:string,purpose:string)=>{const r=await f.send('importMaterial',{sourceKind:'file',sourcePath:name,materialType:type,materialPurpose:purpose,mimeType:type==='image'?'image/png':'audio/mpeg',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia(type==='image'?'still-striped.png':'controlled-narration-tone.mp3'))).toString('base64')});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body;};
  const image=await upload('产品.png','image','visual_reference'),music=await upload('背景.mp3','audio','background_music'),sound=await upload('轻响.mp3','audio','sound_effect');
  expect((await f.send('start')).status).toBe(200);let r=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(r.status,JSON.stringify(r.body)).toBe(200);let w=r.body;
  expect(w.templateInputs).toMatchObject({narration:{speakingRate:.9,languageCode:'zh-CN'},bgm:{status:'bound',material:{id:music.id,sha256:music.sha256}},cover:{status:'bound',material:{id:image.id}}});
  expect(w.templateInputs.shots[0]).toMatchObject({imagePrompt:'静态产品构图',videoPrompt:'独立运镜',narration:{speakingRate:1.1},visual:{material:{id:image.id}},sfx:{material:{id:sound.id}},videoReservationCents:250});
  expect(w.coverInputs).toContainEqual(expect.objectContaining({source:expect.objectContaining({kind:'material',id:image.id,sha256:image.sha256})}));
  expect(w.clips[0].source).toBeNull();expect(w.audio.preparations).toHaveLength(0);
  const sha=w.project.sha256;r=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(r.body.project.sha256).toBe(sha);
  const prepared=await f.send('prepareWorkspaceAudio',{workspaceId:w.id,expectedRevision:w.revision,kind:'sfx',shotId:w.clips[0].shotId,description:'明确选择模板音效',materialRevisionId:sound.id});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);w=prepared.body;expect(w.audio.preparations[0]).toMatchObject({offsetSeconds:0,durationSeconds:.4,source:{materialRevisionId:sound.id}});
  const rejected=await f.send('reconfirmScript',{expectedScriptRevisionId:f.main,text:'# 历史输入\n## 制作设置\n- 模板版本：2\n## 正文\n### 段落 01\n- 口播：旧内容\n- 首帧素材：无\n- 视频生成提示词：旧提示',reason:'验证旧版写入退役'});expect(rejected.status).toBe(400);expect(rejected.body.error).toMatch(/版本 3/);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('accepts the frozen template cover through the actual delivery command and rejects a changed fingerprint',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:script});
 try{
  const bytes=await readFile(workspaceTestMedia('still-striped.png')),image=await f.send('importMaterial',{sourceKind:'file',sourcePath:'产品.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:bytes.toString('base64')});expect(image.status).toBe(200);
  expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(name:string,data:Record<string,unknown>={})=>{const r=await f.send(name,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,name+JSON.stringify(r.body)).toBe(200);w=r.body;};
  await send('matchWorkspaceImage',{clipId:w.clips[0].id,materialRevisionId:image.body.id,usage:'still',durationSeconds:2,fit:'contain',focusX:0,focusY:0});
  await send('saveWorkspaceCaptions',{clipId:w.clips[0].id,captionContract:{...w.captions[0].contract,enabled:false,contentMode:'independent'}});
  await send('exportWorkspace');expect(w.exports[0].status).toBe('ready');
  const exported=w.exports[0];await send('confirmWorkspaceExport',{exportId:exported.id,expectedExportSha256:exported.artifact.sha256,expectedContentSha256:w.contentSha256});
  const data={exportId:exported.id,expectedExportSha256:exported.artifact.sha256,expectedContentSha256:w.contentSha256,title:'模板封面验收',description:'',tags:[],coverSource:w.coverInputs[0].source};
  const changed=await f.send('prepareWorkspaceDelivery',{workspaceId:w.id,expectedRevision:w.revision,...data,coverSource:{...data.coverSource,sha256:'0'.repeat(64)}});expect(changed.status).toBe(409);
  await send('prepareWorkspaceDelivery',data);expect(w.deliveries).toHaveLength(1);
  const snapshot=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[w.deliveries[0].taskId])).rows[0].input_snapshot;
  expect(snapshot.input_artifacts.find((a:{artifactType:string})=>a.artifactType==='cover').sha256).toBe(image.body.sha256);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('prefills video reservation independently of the estimate and freezes the Owner final amount',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,controlled:true,scriptText:script.replace('250','1').replace('镜头时长（秒）：2','镜头时长（秒）：4')});
 try{
  const image=await f.send('importMaterial',{sourceKind:'file',sourcePath:'产品.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(image.status).toBe(200);
  expect((await f.send('start')).status).toBe(200);let result=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(result.status,JSON.stringify(result.body)).toBe(200);let w=result.body;
  result=await f.send('matchWorkspaceImage',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,materialRevisionId:image.body.id,usage:'still',durationSeconds:4,fit:'contain',focusX:0,focusY:0});expect(result.status,JSON.stringify(result.body)).toBe(200);w=result.body;
  const callData={episodeId:f.newEpisode,workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection:f.controlled!.videoSelection,firstFrameMaterialRevisionId:image.body.id,prompt:'人工确认后的独立视频提示',durationSeconds:4};
  const proposed=await f.send('prepareWorkspaceCall',{workspaceId:w.id,expectedRevision:w.revision,callCommand:'requestWorkspaceVisualCandidate',callData});expect(proposed.status,JSON.stringify(proposed.body)).toBe(200);
  expect(proposed.body.summary).toMatchObject({kind:'视频生成',reservationCents:1,reservationPrefilled:true});
  const amount=Math.max(321,proposed.body.summary.estimate.minimumCents),confirmed=await f.send('confirmWorkspaceCall',{workspaceId:w.id,expectedRevision:w.revision,confirmationId:proposed.body.confirmationId,reservationCents:amount});expect(confirmed.status,JSON.stringify(confirmed.body)).toBe(200);
  const saved=(await f.c.query('SELECT payload,summary FROM local_identity.workspace_call_confirmations WHERE id=$1',[proposed.body.confirmationId])).rows[0];expect(saved.payload.reservationCents).toBe(amount);expect(saved.summary.reservationCents).toBe(amount);expect(saved.payload.prompt).toBe(callData.prompt);
  const queued=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE episode_id=$1 AND task_type=\'generate_shot_video\'',[f.newEpisode])).rows;expect(queued).toHaveLength(1);expect(JSON.stringify(queued[0].input_snapshot)).toContain(callData.prompt);
  expect(await readFile(f.controlled!.videoSubmissions,'utf8').catch(()=> '')).toBe('');
 }finally{await f.close();}
},90000);
