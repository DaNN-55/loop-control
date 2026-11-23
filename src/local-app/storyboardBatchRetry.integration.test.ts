// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {storyE2eFixture} from './storyE2e.fixture';
import type {StoryboardBatchKind} from '../storyboardBatch';

const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1'&&!!process.env.LOOP_TEST_CONTEXT_MODULE;

it.skipIf(!enabled).each<StoryboardBatchKind>(['speech','video'])('%s only accepts definite failures in a new batch retry confirmation',async kind=>{
 const f=await storyE2eFixture({migrations:['db/current/228-storyboard-batch-video.sql']});
 try{
  const clips=(await f.read()).clips,[first,second]=clips,shotIds=clips.map(clip=>clip.shotId);
  for(const clip of clips)await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:clip.id,enabled:kind==='speech',voiceMode:kind==='speech'?'tts':'none'}));
  const workspace=await f.read();
  const common=kind==='speech'?{selection:f.selections.speech,voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1}:{selection:f.selections.video,durationSeconds:4};
  const prepare=(extra:Record<string,unknown>={})=>f.ok(f.send('prepareStoryboardBatch',{kind,shotIds,common,...extra}));
  const confirm=(confirmationId:string,ids=shotIds)=>f.post('episode-commands','confirmStoryboardBatch',{episodeId:f.episode,workspaceId:workspace.id,confirmationId,shotIds:ids});
  const initial=await prepare();
  const receipt=await f.ok(confirm(initial.confirmationId));
  const [good,failed]=receipt.items;
  const failures=[{shotId:first.shotId,taskId:good.taskId},{shotId:second.shotId,taskId:failed.taskId}];
  expect((await prepare({retryFailures:failures})).items).toMatchObject([{state:'skipped'},{state:'skipped'}]);
  const generated=await f.execute(good.taskId);
  expect(generated.status,JSON.stringify((await f.read()).visualTasks?.find(t=>t.taskId===good.taskId))).toBe('completed');
  await writeFile(f.mode,'reject');
  expect((await f.execute(failed.taskId)).status).toBe('failed');

  const retry=await prepare({retryFailures:failures});
  expect(retry.items).toMatchObject([{state:'skipped'},{state:'ready',summary:{reservationCents:failed.reservationCents}}]);
  expect((await confirm(retry.confirmationId)).status).toBe(400);
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(2);
  const racing=await prepare({retryFailures:failures,common:undefined});
  expect(racing.items).toMatchObject([{state:'skipped'},{state:'ready'}]);
  const retried=await f.ok(confirm(retry.confirmationId,[second.shotId]));
  expect(retried.items).toMatchObject([{shotId:second.shotId,reservationCents:failed.reservationCents}]);
  expect(retried.items[0].taskId).not.toBe(failed.taskId);
  expect(await f.ok(confirm(retry.confirmationId,[second.shotId]))).toEqual(retried);
  expect(await f.ok(confirm(racing.confirmationId,[second.shotId]))).toMatchObject({
   status:'review',changed:true,retry:true,items:[{state:'skipped'},{state:'skipped',reason:expect.stringContaining('进行中')}],
  });

  await writeFile(f.mode,'unknown');
  await f.execute(retried.items[0].taskId);
  expect((await prepare({retryFailures:[failures[0],{shotId:second.shotId,taskId:retried.items[0].taskId}]})).items).toMatchObject([
   {state:'skipped'},{state:'skipped',reason:expect.stringContaining('回执未知')},
  ]);
  expect((await prepare({retryFailures:failures})).items).toMatchObject([{state:'skipped'},{state:'skipped'}]);
  const final=await f.read(),candidates=kind==='speech'?final.candidates:final.visualCandidates;
  expect(candidates).toContainEqual(expect.objectContaining({shotId:first.shotId,taskId:good.taskId,status:'available'}));
  const records=await f.c.query(`SELECT t.id,t.status,r.reserved_cents FROM public.tasks t
   JOIN public.paid_generation_reservations r ON r.task_id=t.id
   WHERE t.episode_id=$1 AND r.kind=$2`,[f.episode,kind==='speech'?'narration':'video']);
  expect(records.rows).toHaveLength(3);
  expect(records.rows).toEqual(expect.arrayContaining([good,failed,retried.items[0]].map(item=>expect.objectContaining({id:item.taskId,reserved_cents:item.reservationCents}))));
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(3);
 }finally{await f.close();}
},120000);
