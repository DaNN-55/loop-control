// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {storyE2eFixture} from './storyE2e.fixture';
import {storyBrowser} from './storyBrowser.fixture';
import type {StoryboardBatchKind} from '../storyboardBatch';

const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1'&&!!process.env.LOOP_TEST_CONTEXT_MODULE&&!!process.env.LOOP_STORY_EVIDENCE;

it.skipIf(!enabled).each<StoryboardBatchKind>(['speech','video'])('%s keeps mixed progress across poll, reopen, candidate use and selected failure retry',async kind=>{
 const f=await storyE2eFixture({migrations:['db/current/228-storyboard-batch-video.sql']});
 let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  const [first,second]=(await f.read()).clips;
  const speech=kind==='speech',media=speech?'口播':'视频';
  const voice={selection:f.selections.speech,voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1};
  if(speech)await f.ok(f.send('saveWorkspaceNarrationDefaults',voice));
  for(const clip of [first,second]){
   await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:clip.id,enabled:speech,voiceMode:speech?'tts':'none'}));
   await f.ok(f.send('setWorkspaceCaptionsEnabled',{clipId:clip.id,enabled:false}));
  }
  const workspace=await f.read(),shotIds=[first.shotId,second.shotId];
  const initial=await f.ok(f.send('prepareStoryboardBatch',{kind,shotIds,common:speech?voice:{selection:f.selections.video,durationSeconds:4}}));
  const receipt=await f.ok(f.post('episode-commands','confirmStoryboardBatch',{episodeId:f.episode,workspaceId:workspace.id,confirmationId:initial.confirmationId,shotIds}));
  const [good,failed]=receipt.items;
  browser=await storyBrowser(f,'storyboard-batch-retry-'+kind);
  await browser.cli('set','viewport','1440','900');
  const open=()=>browser!.cli('open',browser!.url+'&step=preparation');
  const status=(shot:number,label:string)=>'镜头 0'+shot+media+'：'+label;
  const hasStatus=(shot:number,label:string)=>browser!.wait(`!!document.querySelector('button[aria-label="${status(shot,label)}"]')`);
  await open();
  await hasStatus(2,'待执行');
  expect((await f.execute(good.taskId,{afterClaim:async()=>{await hasStatus(1,'生成中');}})).status).toBe('completed');
  await hasStatus(1,'待采用');
  await writeFile(f.mode,'reject');
  expect((await f.execute(failed.taskId)).status).toBe('failed');
  await hasStatus(2,'失败');
  await browser.cli('reload');
  await hasStatus(1,'待采用');
  await hasStatus(2,'失败');
  await browser.cli('open',browser.url.split('/__story')[0]+'/__story');
  await open();
  await hasStatus(2,'失败');
  const row=()=>browser!.evaluate('document.querySelector(\'tr[aria-label="镜头 02"]\').innerText');
  const mixed=await f.read();
  const reason=speech?mixed.narration?.find(n=>n.shotId===second.shotId)?.generationTask?.error:mixed.visualTasks?.find(t=>t.taskId===failed.taskId)?.error;
  expect(reason).toMatch(/拒绝|400/);
  expect(await row()).toContain(reason!);
  await browser.capture('mixed');
  await browser.click(status(1,'待采用'));
  if(speech)await browser.cli('wait','--text','口播候选');
  else await browser.click('预览视频候选 01');
  await browser.click(speech?'采用':'应用镜头');
  await browser.click('确认采用');
  await expect.poll(async()=>{const w=await f.read();return speech?w.usedNarration?.some(c=>c.taskId===good.taskId):w.visualCandidates?.some(c=>c.taskId===good.taskId&&c.status==='adopted');}).toBe(true);
  await browser.click('重试失败'+media);
  const eligibility=await browser.evaluate(`Array.from(document.querySelectorAll('.workspace-shot-table input[type=checkbox]')).map(input=>input.disabled)`);
  expect(eligibility).toEqual([true,false]);
  await browser.cli('find','role','checkbox','check','--name','勾选镜头 02','--exact');
  await browser.click('核对重试');
  await browser.cli('wait','--text','核对失败'+media+'重试');
  const review=String(await browser.evaluate("document.querySelector('dialog[open]').innerText"));
  expect(review).toContain('镜头 02');
  expect(review).not.toContain('镜头 01');
  expect(review).toContain('费用预留 ¥'+(failed.reservationCents/100).toFixed(2));
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(2);
  await browser.capture('review');
  await browser.click('确认并提交');
  await browser.cli('wait','--text','已提交 1 个镜头');
  await hasStatus(2,'待执行');
  const retriedWorkspace=await f.read();
  const retried=speech?retriedWorkspace.narration?.find(n=>n.shotId===second.shotId)?.generationTask:retriedWorkspace.visualTasks?.find(t=>t.shotId===second.shotId&&t.status==='ready');
  expect(retried).toMatchObject({reservationCents:failed.reservationCents,status:'ready'});
  expect(retried?.taskId).not.toBe(failed.taskId);
  await writeFile(f.mode,'unknown');
  await f.execute(retried!.taskId);
  await hasStatus(2,'回执未知');
  expect(await browser.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='重试失败${media}')?.disabled??true`)).toBe(true);
  await browser.capture('unknown');
 }catch(error){await browser?.capture('failed');throw error;}
 finally{await browser?.close();await f.close();}
},180000);
