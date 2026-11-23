// @vitest-environment node
import {expect,it} from 'vitest';
import {storyE2eFixture} from './storyE2e.fixture';
import {writeFile} from 'node:fs/promises';
import {storyBrowser} from './storyBrowser.fixture';

const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1'&&!!process.env.LOOP_TEST_CONTEXT_MODULE&&!!process.env.LOOP_STORY_EVIDENCE;

it.skipIf(!enabled)('reviews and queues a batch of images, then adopts a generated candidate for one shot',async()=>{
 const f=await storyE2eFixture({migrations:['db/current/230-storyboard-batch-images.sql']});
 let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  const workspace=await f.read(),[first,second]=workspace.clips;
  browser=await storyBrowser(f,'storyboard-batch-image');
  await browser.cli('open',browser.url+'&step=preparation');
  await browser.evaluate("document.documentElement.dataset.interface='impeccable'");
  await browser.click('批量操作');
  const checkboxCenters=()=>browser!.evaluate(`Array.from(document.querySelectorAll('.workspace-shot-selection-cell input')).map(input=>{
   const box=input.getBoundingClientRect(),cell=input.closest('th,td').getBoundingClientRect();
   return Math.max(Math.abs(box.left+box.width/2-cell.left-cell.width/2),Math.abs(box.top+box.height/2-cell.top-cell.height/2));
  })`);
  for(const [width,height] of [[1404,946],[390,844]]){
   await browser.cli('set','viewport',String(width),String(height));
   const offsets=await checkboxCenters();
   expect(offsets).toHaveLength(3);
   for(const offset of offsets)expect(offset).toBeLessThan(1);
  }
  await browser.cli('set','viewport','1404','946');
  const selectAll=()=>browser!.cli('find','role','checkbox','click','--name','全选镜头','--exact');
  await selectAll();
  await browser.cli('wait','--text','已选择 2 个镜头');
  await selectAll();
  await browser.cli('wait','--text','已选择 0 个镜头');
  await browser.cli('find','role','checkbox','click','--name','勾选镜头 01','--exact');
  expect(await browser.evaluate("document.querySelector('.workspace-shot-selection-cell input').indeterminate")).toBe(true);
  await selectAll();

  const draft='纸条草稿：暖黄色伞柄，深蓝色站台。';
  const saved={preparationRevisionId:workspace.preparationRevisionId,imagePrompt:draft,references:[f.materials.first.id],settings:{quality:'low'},defaultOverrides:{version:1,fields:['settings.quality']}};
  await browser.evaluate(`sessionStorage.setItem(${JSON.stringify('loop-visual-draft:'+workspace.id+':'+second.itemId)},${JSON.stringify(JSON.stringify(saved))})`);
  await browser.click('共用设置');
  await browser.click('本次图片连接与模型');
  await browser.cli('find','text',f.selections.image.model,'click','--exact');
  await browser.capture('settings');
  await browser.click('批量生成图片');
  await browser.cli('wait','--text','核对批量图片');
  const review=await browser.evaluate("document.querySelector('dialog[open]').innerText");
  for(const detail of ['费用预留','来自已确认分镜','来自草稿','站台黄伞.png',draft])expect(review).toContain(detail);
  expect((await f.read()).visualTasks??[]).toHaveLength(0);
  await browser.dropNextResponse('confirmStoryboardBatch');
  await browser.click('确认并提交');
  await expect.poll(async()=>(await f.read()).visualTasks?.length).toBe(2);
  const tasks=(await f.read()).visualTasks!;
  const firstTask=tasks.find(task=>task.shotId===first.shotId)!,secondTask=tasks.find(task=>task.shotId===second.shotId)!;
  const reservations=(await f.c.query('SELECT request_state,reserved_cents FROM public.paid_generation_reservations WHERE task_id=ANY($1::uuid[])',[tasks.map(task=>task.taskId)])).rows;
  expect(reservations).toHaveLength(2);
  for(const reservation of reservations)expect(reservation).toMatchObject({request_state:'queued',reserved_cents:expect.any(Number)});
  expect((await f.execute(firstTask.taskId)).status).toBe('completed');
  expect((await f.execute(secondTask.taskId)).status).toBe('completed');
  expect((await f.read()).visualCandidates?.filter(candidate=>candidate.status==='available')).toHaveLength(2);
  expect((await f.read()).clips[0].source).toBeFalsy();

  await browser.cli('reload');
  await browser.wait("!!document.querySelector('#preparation-tab-visual')");
  await browser.cli('find','role','tab','click','--name','画面','--exact');
  await browser.click('预览图片候选 01');
  await browser.click('作为镜头画面');
  await expect.poll(async()=>(await f.read()).visualCandidates?.find(candidate=>candidate.taskId===firstTask.taskId)?.status).toBe('adopted');
  expect((await f.read()).visualCandidates?.find(candidate=>candidate.taskId===secondTask.taskId)?.status).toBe('available');
 }catch(error){await browser?.capture('failed');throw error;}
 finally{await browser?.close();await f.close();}
},180000);

it.skipIf(!enabled)('rechecks an image approval and retries a definite failure once',async()=>{
 const f=await storyE2eFixture({migrations:['db/current/230-storyboard-batch-images.sql']});
 try{
  const workspace=await f.read(),clip=workspace.clips[0],shotIds=[clip.shotId];
  const prepare=(retryFailures?:{shotId:string;taskId:string}[])=>f.ok(f.send('prepareStoryboardBatch',{kind:'image',shotIds,retryFailures,common:{selection:f.selections.image}}));
  const confirm=(confirmationId:string)=>f.ok(f.post('episode-commands','confirmStoryboardBatch',{episodeId:f.episode,workspaceId:workspace.id,confirmationId,shotIds}));
  const original=await prepare();
  await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:clip.id,enabled:true,voiceMode:'tts'}));
  const current=await confirm(original.confirmationId);
  expect(current).toMatchObject({status:'review',changed:true});
  expect((await f.read()).visualTasks??[]).toHaveLength(0);

  const submitted=await confirm(current.confirmationId);
  expect(await confirm(current.confirmationId)).toEqual(submitted);
  await writeFile(f.mode,'reject');
  expect((await f.execute(submitted.items[0].taskId)).status).toBe('failed');
  const retry=await prepare([{shotId:clip.shotId,taskId:submitted.items[0].taskId}]);
  expect(retry.items[0].state).toBe('ready');
  const retried=await confirm(retry.confirmationId);
  expect(await confirm(retry.confirmationId)).toEqual(retried);
  await writeFile(f.mode,'unknown');
  await f.execute(retried.items[0].taskId);
  expect((await prepare([{shotId:clip.shotId,taskId:retried.items[0].taskId}])).items[0]).toMatchObject({state:'skipped',reason:expect.stringContaining('核对')});
 }finally{await f.close();}
},120000);
