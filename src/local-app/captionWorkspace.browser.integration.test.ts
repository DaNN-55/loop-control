// @vitest-environment node
import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {storyE2eFixture,storyLines} from './storyE2e.fixture';
import {storyBrowser} from './storyBrowser.fixture';
import {nativeWorkerPort} from './workerDatabase';

const enabled=process.env.LOOP_STORY_E2E==='1';
const exec=promisify(execFile);
it.skipIf(!enabled)('caption preparation browser: selected-shot alignment, adoption, clean Studio and saved reopen',async()=>{
 const f=await storyE2eFixture();let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  await f.fill();const clip=f.workspace.clips[0];
  // The stock 2.5-second MP3 intentionally covers only part of a 3-second shot.
  // Use a full-window local fixture so the genuine alignment readiness gate passes.
  await exec('ffmpeg',['-nostdin','-y','-v','error','-f','lavfi','-i','sine=frequency=660:sample_rate=48000','-t','3','-c:a','libmp3lame',f.files.voice]);
  // The existing controlled speech provider returns the fixture's local MP3.
  // No external provider or WhisperX model is contacted by this acceptance.
  await f.ok(f.request('saveTtsSettings',{languageCode:'zh-CN',voice:'zh_female_vv_uranus_bigtts',speakingRate:1}));
  await f.ok(f.send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',selection:f.selections.speech,text:storyLines[0],voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1}));
  await f.ok(f.send('confirmWorkspaceNarration',{clipId:clip.id}));
  await f.ok(f.send('generateWorkspaceNarration',{clipId:clip.id,reservationCents:20}));
  const speech=await f.execute(f.workspace.narration![0].taskId!);expect(speech.status,JSON.stringify(speech)).toBe('completed');
  await f.ok(f.send('refreshWorkspaceNarration'));
  const candidate=f.workspace.candidates![0],prepared=await f.ok(f.send('prepareWorkspaceCandidate',{candidateId:candidate.id,durationPolicy:'use-candidate'}));
  await f.ok(f.send('adoptWorkspaceCandidate',{candidateId:candidate.id,adoptionId:prepared.adoptionId}));await f.read();
  expect(f.workspace.captions!.find(c=>c.shotId===clip.shotId)?.audioTrackId).toBeTruthy();

  browser=await storyBrowser(f,'caption-workspace');
  await browser.cli('set','viewport','1280','900');
  await browser.cli('open',browser.url+'&step=preparation');
  await browser.wait("!!document.querySelector('#preparation-tab-voice')");
  await browser.cli('find','role','tab','click','--name','字幕与口播','--exact');
  await browser.cli('find','role','tab','click','--name','字幕','--exact');
  await browser.cli('wait','--text','自动校准字幕时间');
  expect(await browser.evaluate("!document.querySelector('.embedded-studio')&&!document.querySelector('[aria-label=字幕片段]')")).toBe(true);
  const captionText=f.workspace.captions!.find(c=>c.shotId===clip.shotId)!.contract.text;
  await browser.fill('字幕内容','尚未保存的字幕草稿');
  expect(await browser.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='声学对齐').disabled")).toBe(true);
  await browser.fill('字幕内容',captionText);
  await browser.capture('preparation-desktop');
  await browser.cli('set','viewport','390','844');await browser.capture('preparation-narrow');
  expect(await browser.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1")).toBe(true);
  await browser.cli('set','viewport','1280','900');

  await browser.click('声学对齐');
  await expect.poll(async()=>{await f.read();return f.workspace.captions!.find(c=>c.shotId===clip.shotId)?.timing;},{timeout:20000}).toBe('waiting');
  const queued=f.workspace.captions!.find(c=>c.shotId===clip.shotId)!;
  expect(queued.taskId).toBeTruthy();
  expect(browser.traffic.filter(t=>t.command==='requestWorkspaceCaptionAlignment'&&t.status===200)).toHaveLength(1);

  // Real queue claim, artifact and Worker receipt; only the model result is a
  // deterministic external-aligner seam, as in workspaceCaptions integration.
  const port=nativeWorkerPort(f.workerPool());
  const claim=(await port.rpc('claim_next_worker_task',{p_task_id:queued.taskId!,p_worker_capacity:1}) as any[])[0];
  expect(claim?.task_id).toBe(queued.taskId);
  const frozen=claim.input_snapshot.acoustic_alignment;
  const result={version:'acoustic-alignment/v1',status:'completed',method:'local_whisperx',granularity:'phrase',inputVersion:frozen.input_version,audioSha256:frozen.audio_sha256,textFingerprint:frozen.text_fingerprint,provider:'whisperx',model:claim.model,connectionVersionId:null,wordCount:1,cues:[{id:'caption-browser-aligned',text:frozen.confirmed_text,startMs:120,endMs:1000,confidence:.99}],reviewIssues:[],attempts:[],detail:'Controlled external-aligner timestamp for real browser bridge acceptance.',generatedAt:new Date().toISOString()};
  const bytes=Buffer.from(JSON.stringify(result)),relative=claim.input_snapshot.output.relative_path;
  await mkdir(dirname(join(f.assetRoot,relative)),{recursive:true});await writeFile(join(f.assetRoot,relative),bytes);
  await port.rpc('report_worker_result',{p_task_id:claim.task_id,p_attempt:claim.attempt,p_lease_token:claim.lease_token,p_result:{version:'worker-result/v1',taskId:claim.task_id,status:'completed',acousticAlignment:result,artifacts:[{artifactType:'acoustic_alignment_evidence',relativePath:relative,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length}],validation:{passed:true,checks:[{name:'controlled_alignment',passed:true,detail:'Fixed external aligner fixture'}]},actualCostCents:0,blockers:[],retry:{shouldRetry:false,reason:'completed'},nextStep:'Owner checks timing'}});
  await browser.cli('wait','--text','对齐完成，待采用');
  await browser.click('采用对齐');
  await expect.poll(()=>browser!.traffic.filter(t=>t.command==='applyWorkspaceCaptionAlignment'&&t.status===200).length,{timeout:20000}).toBe(1);
  await expect.poll(async()=>{await f.read();return f.workspace.captions!.find(c=>c.shotId===clip.shotId)?.contract.cues[0]?.startMs;},{timeout:20000}).toBe(120);
  expect(f.workspace.captions!.find(c=>c.shotId===clip.shotId)?.timing).toBe('current');
  await browser.capture('alignment-adopted');
  const firstContract=structuredClone(f.workspace.captions!.find(c=>c.shotId===clip.shotId)!.contract);
  await browser.click('选择镜头 02');
  expect(await browser.evaluate("Array.from(document.querySelectorAll('textarea[aria-label=字幕内容]')).find(e=>e.getBoundingClientRect().height>0).value")).toBe(storyLines[1]);
  expect(await browser.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='声学对齐').disabled")).toBe(true);
  await browser.click('选择镜头 01');
  await f.read();expect(f.workspace.captions!.find(c=>c.shotId===clip.shotId)!.contract).toEqual(firstContract);
  await browser.click('进入剪辑工作台');await browser.click('定位镜头 '+clip.shotId);
  expect(await browser.evaluate("document.querySelector('.embedded-studio-caption-panel')===null&&!Array.from(document.querySelectorAll('.embedded-studio header button')).some(b=>b.textContent==='自动校准字幕时间')")).toBe(true);
  await f.read();const openedProject=f.workspace.project.sha256;
  const conflicting=await f.send('applyWorkspaceCaptionAlignment',{clipId:clip.id,taskId:queued.taskId,expectedInputFingerprint:f.workspace.captions!.find(c=>c.shotId===clip.shotId)!.inputFingerprint});
  expect(conflicting.status).toBe(409);expect(conflicting.body.error).toContain('请先保存并返回');
  await f.read();expect(f.workspace.project.sha256).toBe(openedProject);

  // Direct frame-descendant refs avoid the CLI's CSS/frame context mismatch.
  // Restrict every match to the iframe subtree so host and SDK names cannot collide.
  const nativeRef=async(role:string,name:string)=>{
   const lines=(await browser!.snapshot()).split('\n');
   const start=lines.findIndex(line=>line.includes('- Iframe '+JSON.stringify('OpenChatCut 剪辑工程')+' '));
   if(start<0)throw Error('Native Studio iframe absent');
   const indent=lines[start].search(/\S/),descendants:string[]=[];
   for(const line of lines.slice(start+1)){if(line.trim()&&line.search(/\S/)<=indent)break;descendants.push(line);}
   const line=descendants.find(line=>line.includes('- '+role+' '+JSON.stringify(name)+' '));
   const ref=line?.match(/ref=(e\d+)/)?.[1];if(!ref)throw Error('Native caption '+role+' absent: '+name);
   return '@'+ref;
  };
  const native=async(work:()=>Promise<void>)=>work();
  const nativeButton=async(name:string)=>{await browser!.cli('focus',await nativeRef('button',name));await browser!.cli('press','Enter');};
  await native(async()=>{await nativeButton('字幕');});
  expect((await browser.snapshot()).includes('- button "自动校准字幕时间" ')).toBe(false);
  await browser.capture('clean-studio');
  const revised='雨停了，她把伞轻轻留在长椅上。';
  await native(async()=>{
   await browser!.cli('fill',await nativeRef('textbox','字幕文字'),revised);
   await browser!.cli('fill',await nativeRef('spinbutton','开始秒数'),'0.2');
   await browser!.cli('fill',await nativeRef('spinbutton','结束秒数'),'1.2');
   await nativeButton('保存');
  });
  await browser.click('保存并返回分镜台');await browser.wait("!document.querySelector('.embedded-studio')");await f.read();
  const saved=f.workspace.captions!.find(c=>c.shotId===clip.shotId)!;
  expect(saved.contract).toMatchObject({text:revised,cues:[{text:revised,startMs:200,endMs:1200}]});
  expect(saved.timing).toBe('current');
  expect(browser.traffic.filter(t=>t.command==='saveWorkspaceStudio'&&t.status===200).length).toBeGreaterThanOrEqual(1);
  const document=JSON.parse(await readFile(join(f.assetRoot,f.workspace.project.relativePath),'utf8'));
  expect(JSON.stringify(document)).toContain(revised);
  await browser.click('进入剪辑工作台');await browser.click('定位镜头 '+clip.shotId);
  await native(async()=>{await nativeButton('字幕');expect((await browser!.cli('get','value',await nativeRef('textbox','字幕文字'))).value).toBe(revised);});
  await browser.capture('saved-reopened');
  await browser.click('保存并返回分镜台');await browser.wait("!document.querySelector('.embedded-studio')");
  await writeFile(join(process.env.LOOP_STORY_EVIDENCE!,'caption-workspace-result.json'),JSON.stringify({alignmentModelExecuted:false,alignerSeam:'controlled',speechProvider:'controlled-local-mp3',caption:saved,workspaceId:f.workspace.id,projectSha256:f.workspace.project.sha256},null,2));
 }catch(error){await browser?.cli('frame','main').catch(()=>{});await browser?.capture('failed');throw error;}
 finally{await browser?.close();await f.close();}
},240000);
