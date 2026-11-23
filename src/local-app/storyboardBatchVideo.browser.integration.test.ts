// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {storyE2eFixture} from './storyE2e.fixture';
import {storyBrowser} from './storyBrowser.fixture';

const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1'&&!!process.env.LOOP_TEST_CONTEXT_MODULE&&!!process.env.LOOP_STORY_EVIDENCE;

it.skipIf(!enabled)('adopts a voice, reviews a video draft, adopts the generated candidate, and opens native editing',async()=>{
 const f=await storyE2eFixture({migrations:['db/current/228-storyboard-batch-video.sql']});
 let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  const [first,second]=(await f.read()).clips;
  await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:first.id,enabled:true,voiceMode:'tts'}));
  await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:second.id,enabled:false,voiceMode:'none'}));
  await f.ok(f.send('setWorkspaceCaptionsEnabled',{clipId:first.id,enabled:false}));
  await f.ok(f.send('saveWorkspaceNarrationDefaults',{selection:f.selections.speech,voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1}));
  browser=await storyBrowser(f,'storyboard-batch-video');
  await browser.cli('open',browser.url+'&step=preparation');
  const tab=async(name:string)=>browser!.cli('find','role','tab','click','--name',name,'--exact');
  const check=async(name:string)=>browser!.cli('find','role','checkbox','check','--name',name,'--exact');
  const reviewText=()=>browser!.evaluate("document.querySelector('dialog[open]').innerText");
  await browser.click('批量操作');
  await check('勾选镜头 01');
  await browser.click('批量生成视频');
  await browser.cli('wait','--text','先采用口播');
  await browser.cli('press','Escape');
  await browser.click('批量生成口播');
  await browser.click('确认并提交');
  await browser.cli('wait','--text','已提交 1 个镜头');
  const voiceTask=(await f.read()).narration!.find(n=>n.shotId===first.shotId)!.generationTask!;
  expect((await f.execute(voiceTask.taskId)).status).toBe('completed');
  await browser.cli('reload');
  await browser.wait("!!document.querySelector('#preparation-tab-voice')");
  await tab('字幕与口播');
  await browser.cli('wait','--text','口播候选');
  await browser.click('采用');
  await browser.click('确认采用');
  await expect.poll(async()=>(await f.read()).usedNarration?.[0]?.taskId).toBe(voiceTask.taskId);

  await tab('画面');
  await tab('视频');
  await browser.wait("!!document.querySelector('textarea[aria-label=画面动作]')");
  const draft='浏览器草稿里的黄色雨伞和蓝色站台。';
  await browser.fill('画面动作',draft);
  await browser.click('批量操作');
  await check('勾选镜头 01');
  await browser.cli('find','text','本次共用视频设置','click','--exact');
  await browser.click('本次视频连接与模型');
  await browser.cli('find','text',f.selections.video.model,'click','--exact');
  await browser.click('批量生成视频');
  await browser.cli('wait','--text','核对批量视频');
  for(const visible of [draft,'来自草稿','站台黄伞.png','雨伞故事受控video','镜头 2.5 秒','服务请求 4 秒','费用预留'])expect(await reviewText()).toContain(visible);
  await browser.cli('press','Escape');
  await browser.wait("!document.querySelector('dialog[open]')");
  expect(await browser.evaluate("document.querySelector('textarea[aria-label=画面动作]').value")).toBe(draft);
  expect((await f.read()).visualTasks).toHaveLength(0);
  await browser.click('批量生成视频');
  await browser.click('确认并提交');
  await browser.cli('wait','--text','已提交 1 个镜头');
  const task=(await f.read()).visualTasks![0];
  expect((await f.execute(task.taskId)).status).toBe('completed');
  const before=await f.read();
  expect(before.visualCandidates![0]).toMatchObject({status:'available',taskId:task.taskId});
  expect(before.clips[0].source).toBeFalsy();
  expect(before.readiness.placeholders).toContain(first.itemId);
  await browser.cli('reload');
  await browser.wait("!!document.querySelector('#preparation-tab-visual')");
  await tab('画面');
  await tab('视频');
  await browser.click('预览视频候选 01');
  await browser.wait("Array.from(document.querySelectorAll('video')).some(video=>video.readyState>=2)");
  expect(await browser.evaluate("!!document.querySelector('[aria-label=\"镜头 01准备情况：可剪辑\"]')")).toBe(false);
  await browser.click('应用镜头');
  await browser.click('确认采用');
  await expect.poll(async()=>(await f.read()).visualCandidates?.[0].status).toBe('adopted');
  const adopted=await f.read();
  const project=JSON.parse(await readFile(join(f.assetRoot,adopted.project.relativePath),'utf8'));
  expect(project.timelines[0].items.find((item:{id:string})=>item.id===first.itemId)).toMatchObject({kind:'video',src:adopted.visualCandidates![0].relativePath});
  await browser.wait("!!document.querySelector('[aria-label=\"镜头 01准备情况：可剪辑\"]')");
  expect(adopted.readiness.placeholders).not.toContain(first.itemId);
  await browser.click('进入剪辑工作台');
  await browser.wait("document.querySelector('.embedded-studio iframe')?.getAttribute('aria-busy')==='false'");
  await browser.capture('native-editing');
 }catch(error){await browser?.capture('failed');throw error;}
 finally{await browser?.close();await f.close();}
},180000);
