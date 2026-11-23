// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {csrfFor} from './sessions';
import {storyE2eFixture} from './storyE2e.fixture';
import {storyBrowser} from './storyBrowser.fixture';

const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1'&&!!process.env.LOOP_TEST_CONTEXT_MODULE&&!!process.env.LOOP_STORY_EVIDENCE;
const migrations=['db/current/228-storyboard-batch-video.sql'];
type Fixture=Awaited<ReturnType<typeof storyE2eFixture>>;
type Browser=Awaited<ReturnType<typeof storyBrowser>>;
const speechCommon=(f:Fixture)=>({selection:f.selections.speech,voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1});
const submit=(f:Fixture,confirmationId:string,shotIds:string[])=>f.ok(f.post('episode-commands','confirmStoryboardBatch',{episodeId:f.episode,workspaceId:f.workspace.id,confirmationId,shotIds}));
const tab=(browser:Browser,name:string)=>browser.cli('find','role','tab','click','--name',name,'--exact');
const dialogText=(browser:Browser)=>browser.evaluate("document.querySelector('[role=dialog]')?.innerText");
async function paidTasks(f:Fixture){
 return (await f.c.query(`SELECT t.id,t.budget_limit_cents,r.reserved_cents
  FROM public.tasks t LEFT JOIN public.paid_generation_reservations r ON r.task_id=t.id
  WHERE t.episode_id=$1 AND t.budget_limit_cents>0 ORDER BY t.id`,[f.episode])).rows;
}
async function recover(f:Fixture,taskId:string,attempt:number,token=f.token){
 const response=await fetch(f.origin+'/api/local/native-output/reconcile',{method:'POST',
  headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+token,'X-CSRF-Token':csrfFor(token)},
  body:JSON.stringify({episodeId:f.episode,taskId,attempt})});
 return {status:response.status,body:await response.json()};
}
async function holdPublication(f:Fixture,taskId:string){
 const fault=join(f.root,'publication-commit-loss.mjs');
 await writeFile(fault,`import {createRequire} from 'node:module';
 const {Client}=createRequire(process.cwd()+'/package.json')('pg'), query=Client.prototype.query;
 let lost=false;
 Client.prototype.query=function(sql,...args){
  if(typeof sql==='string'&&sql.includes('begin_native_output_publication'))this.publishing=true;
  if(sql==='COMMIT'&&this.publishing&&!lost){
   lost=true;
   return query.call(this,'ROLLBACK').then(()=>{throw Error('Controlled publication COMMIT reply lost');});
  }
  return query.call(this,sql,...args);
 };`);
 try{
  await f.execute(taskId,{processOptions:{environment:{...process.env,NODE_OPTIONS:'--import '+pathToFileURL(fault).href}}});
 }catch(cause){
  expect(cause).toMatchObject({name:'NativePublicationUnknownError'});
  return;
 }
 const {rows}=await f.c.query('SELECT last_result FROM public.tasks WHERE id=$1',[taskId]);
 expect.fail('Worker did not hold publication: '+JSON.stringify(rows[0]?.last_result));
}


it.skipIf(!enabled)('a reopened shot can check the same missing speech receipt without making a new request',async()=>{
 const f=await storyE2eFixture({migrations});
 let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  const workspace=await f.read(),shot=workspace.clips[0],shotIds=[shot.shotId];
  const common=speechCommon(f);
  await f.ok(f.send('saveWorkspaceNarrationDefaults',common));
  const prepare=()=>f.ok(f.send('prepareStoryboardBatch',{kind:'speech',shotIds,common,regenerateShotIds:shotIds}));
  const review=await prepare();
  const submitted=await submit(f,review.confirmationId,shotIds);
  const {taskId,reservationCents}=submitted.items[0];
  await writeFile(f.mode,'unknown');await f.execute(taskId);
  const originalPaidTasks=await paidTasks(f);
  expect(originalPaidTasks).toEqual([{id:taskId,budget_limit_cents:reservationCents,reserved_cents:reservationCents}]);
  await f.restart();
  browser=await storyBrowser(f,'storyboard-batch-original-speech');
  await browser.cli('open',browser.url+'&step=preparation');
  await browser.wait("!!document.querySelector('#preparation-tab-voice')");
  await browser.cli('find','role','tab','click','--name','字幕与口播','--exact');
  const details=async()=>{await browser!.click('查看口播任务详情');await browser!.wait("!!document.querySelector('[role=dialog]')");};
  await details();
  for(let n=0;n<2;n++){
   await browser.click('刷新核对结果');
   await browser.cli('wait','--text','原任务的结果仍未知。');
  }
  expect(await dialogText(browser)).toContain(taskId);
  await browser.click('关闭口播任务详情');
  await browser.click('重新生成');
  await browser.cli('wait','--text','供应商可能对两次请求分别计费。');
  expect(await paidTasks(f)).toEqual(originalPaidTasks);
  await browser.cli('press','Escape');
  expect((await prepare()).items[0]).toMatchObject({state:'skipped',reason:'口播回执未知，请先在右侧核对原任务'});
  await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:shot.id,enabled:false,voiceMode:'none'}));
  await browser.cli('reload');
  await browser.wait("!!document.querySelector('#preparation-tab-voice')");
  await browser.cli('find','role','tab','click','--name','字幕与口播','--exact');
  await details();
  expect(await browser.evaluate("document.querySelector('[role=dialog]').innerText")).toContain(taskId);
  expect(await paidTasks(f)).toEqual(originalPaidTasks);
  expect((await f.read()).narration![0].generationTask).toMatchObject({taskId,reservationCents,submissionUnknown:true});
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
  await browser.capture('still-unknown');
 }catch(error){await browser?.capture('failed');throw error;}
 finally{await browser?.close();await f.close();}
},120000);

it.skipIf(!enabled)('recovers the original batch speech publication and auditions and adopts that candidate',async()=>{
 const f=await storyE2eFixture({migrations});
 let browser:Browser|undefined;
 try{
  const shot=(await f.read()).clips[0],shotIds=[shot.shotId];
  await f.ok(f.send('setWorkspaceCaptionsEnabled',{clipId:shot.id,enabled:false}));
  const review=await f.ok(f.send('prepareStoryboardBatch',{kind:'speech',shotIds,common:speechCommon(f)}));
  const {taskId,reservationCents}=(await submit(f,review.confirmationId,shotIds)).items[0];
  await holdPublication(f,taskId);
  expect((await f.read()).narration![0].generationTask).toMatchObject({taskId,reservationCents,publicationAttempt:0});
  const originalPaidTasks=await paidTasks(f);
  expect(originalPaidTasks).toEqual([{id:taskId,budget_limit_cents:reservationCents,reserved_cents:reservationCents}]);
  const posts=await readFile(f.submissions,'utf8');
  expect(posts.trim().split('\n')).toHaveLength(1);
  expect((await recover(f,taskId,0,f.otherToken)).status).toBe(404);
  await f.restart();
  browser=await storyBrowser(f,'storyboard-batch-held-speech');
  await browser.cli('open',browser.url+'&step=preparation');
  await browser.wait("!!document.querySelector('#preparation-tab-voice')");
  await tab(browser,'字幕与口播');
  await browser.click('查看口播任务详情');
  expect(await dialogText(browser)).toContain(taskId);
  expect(await dialogText(browser)).toContain('尝试 0');
  await browser.click('核对并恢复产物');
  await browser.cli('wait','--text','口播候选');
  expect(await recover(f,taskId,0)).toEqual({status:200,body:{status:'completed',registered:false}});
  expect(await paidTasks(f)).toEqual(originalPaidTasks);
  expect(await readFile(f.submissions,'utf8')).toBe(posts);
  const candidates=(await f.read()).candidates!.filter(candidate=>candidate.taskId===taskId);
  expect(candidates).toMatchObject([{taskId,shotId:shot.shotId,status:'available'}]);
  await browser.click('试听 '+candidates[0].text);
  await browser.wait("Array.from(document.querySelectorAll('.workspace-speech-results audio')).some(audio=>audio.currentTime>0.05)");
  await browser.click('采用');
  await browser.click('确认采用');
  await expect.poll(async()=>(await f.read()).usedNarration?.[0]?.taskId).toBe(taskId);
  await browser.capture('adopted');
 }catch(error){await browser?.capture('failed');throw error;}
 finally{await browser?.close();await f.close();}
},150000);

it.skipIf(!enabled)('queries only the original saved provider ID, recovers the original video output, and leaves a missing ID unknown',async()=>{
 const f=await storyE2eFixture({migrations});
 let browser:Browser|undefined;
 try{
  const [first,second]=(await f.read()).clips,shotIds=[first.shotId,second.shotId];
  for(const shot of [first,second])await f.ok(f.send('setWorkspaceNarrationEnabled',{clipId:shot.id,enabled:false,voiceMode:'none'}));
  const prepare=()=>f.ok(f.send('prepareStoryboardBatch',{kind:'video',shotIds,common:{selection:f.selections.video,durationSeconds:4}}));
  const review=await prepare(),{items:[saved,missing]}=await submit(f,review.confirmationId,shotIds);
  await writeFile(f.mode,'poll-fail');await f.execute(saved.taskId);
  await writeFile(f.mode,'unknown');await f.execute(missing.taskId);
  const stopped=await f.read();
  expect(stopped.visualTasks).toEqual(expect.arrayContaining([
   expect.objectContaining({taskId:saved.taskId,providerTaskId:'story-umbrella-remote-task',canResume:true}),
   expect.objectContaining({taskId:missing.taskId,providerTaskId:null,submissionUnknown:true}),
  ]));
  const missingTask=stopped.visualTasks!.find(task=>task.taskId===missing.taskId)!;
  expect((await f.send('retryWorkspaceVisualCandidate',{candidateId:missingTask.id})).status).toBe(409);
  expect((await prepare()).items).toMatchObject(shotIds.map(shotId=>({shotId,state:'skipped',reason:'视频回执未知，请先在右侧核对原任务'})));
  const originalPaidTasks=await paidTasks(f);
  expect(originalPaidTasks).toEqual(expect.arrayContaining([saved,missing].map(item=>({id:item.taskId,budget_limit_cents:item.reservationCents,reserved_cents:item.reservationCents}))));
  expect(originalPaidTasks).toHaveLength(2);
  const posts=await readFile(f.submissions,'utf8');
  expect(posts.trim().split('\n')).toHaveLength(2);
  const originalPolls=(await readFile(f.videoPolls,'utf8')).trim().split('\n');
  expect(originalPolls.length).toBeGreaterThan(0);
  await f.restart();
  browser=await storyBrowser(f,'storyboard-batch-original-video');
  await browser.cli('open',browser.url+'&step=preparation');
  await browser.wait("!!document.querySelector('#preparation-tab-visual')");
  await tab(browser,'画面');
  await tab(browser,'视频');
  await browser.click('查看视频任务详情');
  expect(await dialogText(browser)).toContain(saved.taskId);
  expect(await dialogText(browser)).toContain('story-umbrella-remote-task');
  await browser.click('查询原视频任务');
  await expect.poll(async()=>(await f.read()).visualTasks!.find(task=>task.taskId===saved.taskId)?.status).toBe('ready');
  expect(await paidTasks(f)).toEqual(originalPaidTasks);
  expect(await readFile(f.submissions,'utf8')).toBe(posts);
  await writeFile(f.mode,'success');await holdPublication(f,saved.taskId);
  const held=(await f.read()).visualTasks!.find(task=>task.taskId===saved.taskId);
  expect(held).toMatchObject({taskId:saved.taskId,reservationCents:saved.reservationCents,publicationAttempt:1});
  await browser.cli('reload');
  await browser.wait("!!document.querySelector('#preparation-tab-visual')");
  await tab(browser,'画面');
  await tab(browser,'视频');
  await browser.click('查看视频任务详情');
  expect(await dialogText(browser)).toContain(saved.taskId);
  await browser.click('核对并恢复产物');
  await browser.wait("!document.querySelector('[role=dialog]')");
  expect(await recover(f,saved.taskId,1)).toEqual({status:200,body:{status:'completed',registered:false}});
  const recovered=(await f.read()).visualCandidates!.filter(candidate=>candidate.taskId===saved.taskId);
  expect(recovered).toMatchObject([{taskId:saved.taskId,shotId:first.shotId,status:'available'}]);
  await browser.click('预览视频候选 01');
  await browser.wait("Array.from(document.querySelectorAll('video')).some(video=>video.readyState>=2)");
  await browser.click('应用镜头');
  await browser.click('确认采用');
  await expect.poll(async()=>(await f.read()).visualCandidates!.find(candidate=>candidate.taskId===saved.taskId)?.status).toBe('adopted');
  await browser.click('选择镜头 02');
  await tab(browser,'视频');
  await browser.click('查看视频任务详情');
  for(let n=0;n<2;n++){
   await browser.click('刷新核对结果');
   await browser.cli('wait','--text','原任务的结果仍未知。');
  }
  expect(await dialogText(browser)).toContain(missing.taskId);
  expect(await dialogText(browser)).not.toContain('查询原视频任务');
  expect((await prepare()).items[1]).toMatchObject({state:'skipped',reason:'视频回执未知，请先在右侧核对原任务'});
  const final=await f.read();
  expect(final.visualTasks!.find(task=>task.taskId===missing.taskId)).toMatchObject({submissionUnknown:true,reservationCents:missing.reservationCents});
  expect(final.visualCandidates!.some(candidate=>candidate.taskId===missing.taskId)).toBe(false);
  expect(await paidTasks(f)).toEqual(originalPaidTasks);
  expect(await readFile(f.submissions,'utf8')).toBe(posts);
  const polls=(await readFile(f.videoPolls,'utf8')).trim().split('\n');
  expect(polls.length).toBeGreaterThan(originalPolls.length);
  for(const line of polls)expect(JSON.parse(line)).toMatchObject({method:'GET',url:expect.stringMatching(/\/story-umbrella-remote-task$/)});
  await browser.capture('missing');
 }catch(error){await browser?.capture('failed');throw error;}
 finally{await browser?.close();await f.close();}
},180000);
