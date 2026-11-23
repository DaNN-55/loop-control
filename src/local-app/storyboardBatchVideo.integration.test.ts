// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {storyE2eFixture} from './storyE2e.fixture';

const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1'&&!!process.env.LOOP_TEST_CONTEXT_MODULE;

it.skipIf(!enabled)('waits for an adopted main voice, then reserves and submits the video at its model duration',async()=>{
 const f=await storyE2eFixture({migrations:['db/current/228-storyboard-batch-video.sql']});
 try{
  const w=await f.read(),[first,second]=w.clips;
  await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:first.id,enabled:true,voiceMode:'tts'}));
  await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:second.id,enabled:false,voiceMode:'source'}));
  const shotIds=[first.shotId,second.shotId],common={selection:f.selections.video,durationSeconds:5};
  const reviewVideo=()=>f.ok(f.send('prepareStoryboardBatch',{kind:'video',shotIds,common}));
  const confirm=(review:{confirmationId:string},ids:string[])=>f.ok(f.post('episode-commands','confirmStoryboardBatch',{episodeId:f.episode,workspaceId:w.id,confirmationId:review.confirmationId,shotIds:ids}));
  const before=await reviewVideo();
  expect(before.items).toMatchObject([
   {shotId:first.shotId,state:'skipped',reason:'先采用口播'},
   {shotId:second.shotId,state:'ready',targetSeconds:5,providerSeconds:5},
  ]);
  const speech=await f.ok(f.send('prepareStoryboardBatch',{kind:'speech',shotIds:[first.shotId],common:{selection:f.selections.speech,voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1}}));
  const spoken=await confirm(speech,[first.shotId]);
  expect((await f.execute(spoken.items[0].taskId)).status).toBe('completed');
  const pending=await f.read();
  expect((await reviewVideo()).items[0]).toMatchObject({state:'skipped',reason:'先采用口播'});
  const speechCandidate=pending.candidates!.find(candidate=>candidate.taskId===spoken.items[0].taskId)!;
  const adoption=await f.ok(f.send('prepareWorkspaceCandidate',{candidateId:speechCandidate.id,durationPolicy:'use-candidate'}));
  await f.ok(f.send('adoptWorkspaceCandidate',{candidateId:speechCandidate.id,adoptionId:adoption.adoptionId}));

  const review=await reviewVideo();
  expect(review.items[0]).toMatchObject({shotId:first.shotId,state:'ready',targetSeconds:2.5,providerSeconds:4,summary:{model:f.selections.video.model,connection:'雨伞故事受控video · v1',inputs:['站台黄伞.png']}});
  const [receipt,repeated]=await Promise.all([confirm(review,[first.shotId]),confirm(review,[first.shotId])]);
  expect(receipt).toEqual(repeated);
  const {taskId,reservationCents}=receipt.items[0];
  expect(reservationCents).toBeGreaterThan(0);
  expect((await f.read()).visualTasks).toMatchObject([{taskId,reservationCents,status:'ready',shotId:first.shotId}]);
  expect((await f.execute(taskId)).status).toBe('completed');
  const completed=await f.read();
  const video=completed.visualCandidates!.find(candidate=>candidate.taskId===taskId)!;
  expect(video).toMatchObject({status:'available',durationSeconds:4,shotId:first.shotId});
  expect(completed.clips[0].source).toBeFalsy();
  const {body}=JSON.parse((await readFile(f.submissions,'utf8')).trim().split('\n').at(-1)!);
  expect(body.duration).toBe(4);
  expect(JSON.stringify(body)).toContain('雨后站台长椅旁一把黄色雨伞');
  expect((await reviewVideo()).items[0]).toMatchObject({state:'regenerate',reason:'已有未采用视频候选'});
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('rechecks all picked video inputs atomically and honors individual video draft settings',async()=>{
 const f=await storyE2eFixture({migrations:['db/current/228-storyboard-batch-video.sql']});
 try{
  const [first,second]=(await f.read()).clips;
  const inserted=await f.ok(f.send('editWorkspaceStructure',{operation:{kind:'insert',afterShotId:second.shotId,text:'这个镜头暂缺画面。'}}));
  const third=inserted.clips[2];
  for(const clip of [first,second,third])await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:clip.id,enabled:false,voiceMode:'none'}));
  const w=await f.read(),shotIds=[first.shotId,second.shotId,third.shotId],picked=shotIds.slice(0,2);
  const prompt='使用 @图片1 的风格，镜头缓慢移动。';
  const drafts=[
   {shotId:second.shotId,targetItemId:second.itemId,preparationRevisionId:w.preparationRevisionId,inputs:{
    prompt,durationSeconds:6,firstFrameMaterialRevisionId:f.materials.second.id,promptReferences:[{token:'@图片1',materialRevisionId:f.materials.second.id}],
   }},
   {shotId:third.shotId,targetItemId:third.itemId,preparationRevisionId:w.preparationRevisionId,inputs:{prompt:'没有设置首帧。'}},
  ];
  const prepare=(durationSeconds:number)=>f.ok(f.send('prepareStoryboardBatch',{kind:'video',shotIds,common:{selection:f.selections.video,durationSeconds},drafts}));
  const confirm=(confirmationId:string)=>f.ok(f.post('episode-commands','confirmStoryboardBatch',{episodeId:f.episode,workspaceId:w.id,confirmationId,shotIds:picked}));
  const unsupported=await prepare(3);
  expect(unsupported.items).toMatchObject([
   {state:'skipped',reason:expect.stringContaining('4～15 秒')},
   {state:'ready',source:'draft',providerSeconds:6,text:expect.stringContaining('使用 首帧图像 的风格')},
   {state:'skipped',reason:'缺少首帧图片'},
  ]);
  const reviewed=await prepare(5);
  expect(reviewed.items.slice(0,2)).toMatchObject([
   {state:'ready',source:'confirmed',providerSeconds:5,summary:{inputs:['站台黄伞.png']}},
   {state:'ready',source:'draft',providerSeconds:6,summary:{inputs:['伞柄纸条.png']}},
  ]);
  const alternative=await f.importFile(f.files.candidate,'image','visual_reference');
  const registered=await f.ok(f.send('registerWorkspaceVisualCandidate',{targetItemId:first.itemId,materialRevisionId:alternative.id,usage:'still',durationSeconds:3}));
  const image=registered.visualCandidates.find((candidate:{materialRevisionId:string})=>candidate.materialRevisionId===alternative.id);
  await f.ok(f.send('retainWorkspaceImageCandidate',{candidateId:image.id}));
  const changed=await confirm(reviewed.confirmationId);
  expect(changed).toMatchObject({status:'review',kind:'video',changed:true,items:[
   {state:'ready',change:'视觉输入已变化',summary:{inputs:['候选黄伞.png']}},
   {state:'ready',providerSeconds:6},
   {state:'skipped',reason:'缺少首帧图片'},
  ]});
  expect((await f.read()).visualTasks).toHaveLength(0);
  expect(await confirm(reviewed.confirmationId)).toEqual(changed);
  const receipt=await confirm(changed.confirmationId);
  expect(receipt.items).toHaveLength(2);
  expect((await f.read()).visualTasks).toEqual(expect.arrayContaining(receipt.items.map((item:{taskId:string;shotId:string;reservationCents:number})=>expect.objectContaining({...item,status:'ready'}))));
  expect((await prepare(5)).items.slice(0,2)).toMatchObject([
   {state:'skipped',reason:'已有视频任务进行中'},
   {state:'skipped',reason:'已有视频任务进行中'},
  ]);
  await writeFile(f.mode,'unknown');
  await f.execute(receipt.items[0].taskId);
  expect((await prepare(5)).items.slice(0,2)).toMatchObject([
   {state:'skipped',reason:'视频回执未知，请先在右侧核对原任务'},
   {state:'skipped',reason:'已有视频任务进行中'},
  ]);
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
 }finally{await f.close();}
},120000);
