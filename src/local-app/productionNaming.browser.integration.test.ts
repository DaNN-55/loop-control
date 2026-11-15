// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {editStudioDocument} from './studioDocument.fixture';
import {storyBrowser} from './storyBrowser.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';

it.skipIf(process.env.LOOP_STORY_E2E!=='1'||!process.env.LOOP_TEST_CONTEXT_MODULE)('keeps readable native names, manual renames and adopted wording through real wide/narrow draft editing and reload',async()=>{
 const f=await formalWorkflowFixture({freshAccount:true,controlled:true,scriptText:productionScriptTemplate.replace('镜头时长（秒）：5','镜头时长（秒）：2')});let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.productionWorkspace)w=r.body.productionWorkspace;else if(r.body.id===w.id)w=r.body;return r.body;};
  const upload=async(type:string,file:string,mime:string)=>{const r=await f.send('importMaterial',{sourceKind:'file',sourcePath:file,materialType:type,materialPurpose:'general_reference',mimeType:mime,isMainScript:false,contentBase64:(await readFile(workspaceTestMedia(file))).toString('base64')});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body.id;};
  const image=await upload('image','still-striped.png','image/png'),audio=await upload('audio','controlled-narration-tone.mp3','audio/mpeg'),clip=w.clips[0];
  await send('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image,usage:'still',durationSeconds:2,fit:'contain',focusX:0,focusY:0});
  const adoptedText='成片采用的是山脚这一段原口播。';await send('saveWorkspaceNarration',{clipId:clip.id,mode:'manual',text:adoptedText,materialRevisionId:audio});
  const track=w.narration[0].audioTrackId,proposal=await send('prepareWorkspaceCandidate',{candidateId:track,durationPolicy:'use-candidate'});await send('adoptWorkspaceCandidate',{candidateId:track,adoptionId:proposal.adoptionId});
  const nodeId='workspace-narration-shot-'+clip.shotId,assetId='audio-track-'+track,first=await readFile(join(f.assetRoot,w.project.relativePath)),project=JSON.parse(first.toString());
  expect(project.assets.find((a:any)=>a.id===assetId).name).toBe('镜头 01 口播');expect(project.timelines[0].items.find((i:any)=>i.id===nodeId).name).toBe('镜头 01 口播');
  const oldPath=w.project.relativePath,opened=await send('openWorkspaceStudio');await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{doc.timelines[0].items.find((i:any)=>i.id===nodeId).name='人工命名 · 山脚旁白';doc.assets.find((a:any)=>a.id===assetId).name='人工录音 · 第一版';});
  await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});await send('closeWorkspaceStudio');
  await send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',...f.controlled!.narrationSettings,text:'这是尚未采用的新口播草稿。'});await send('confirmWorkspaceNarration',{clipId:clip.id});await send('generateWorkspaceNarration',{clipId:clip.id,reservationCents:100});
  const requested=w.narration[0].taskId;expect((await f.controlled!.execute(requested))?.status).toBe('completed');await send('refreshWorkspaceNarration');const candidate=w.candidates.find((c:any)=>c.taskId===requested);expect(candidate.status).toBe('available');await send('rejectWorkspaceCandidate',{candidateId:candidate.id});
  expect(w.usedNarration.find((n:any)=>n.shotId===clip.shotId)).toMatchObject({audioTrackId:track,text:adoptedText});
  const current=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(current.timelines[0].items.find((i:any)=>i.id===nodeId)).toMatchObject({name:'人工命名 · 山脚旁白',sourceAssetId:assetId});expect(current.assets.find((a:any)=>a.id===assetId).name).toBe('人工录音 · 第一版');expect(await readFile(join(f.assetRoot,oldPath))).toEqual(first);
  const taskCount=Number((await f.c.query('SELECT count(*) n FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows[0].n),sha=w.project.sha256;
  browser=await storyBrowser({...f,episode:f.newEpisode},'f1-names','正式新单');await browser.cli('open',browser.url+'&step=preparation&tab=voice');await browser.wait("!!document.querySelector('label[for]')&&Array.from(document.querySelectorAll('label')).some(l=>l.textContent==='口播草稿')");
  const field="Array.from(document.querySelectorAll('label')).find(l=>l.textContent==='口播草稿')?.control";
  await browser.wait(field+"?.value==='这是尚未采用的新口播草稿。'");await browser.cli('set','viewport','1365','900');
  await browser.cli('find','text','成片采用的口播','click','--exact');expect(String(await browser.evaluate('document.body.innerText'))).toContain(adoptedText);await browser.capture('wide');
  await browser.fill('口播草稿','浏览器内尚未提交的另一份草稿。');await browser.cli('set','viewport','390','844');await browser.capture('narrow');
  expect(await browser.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')).toBe(true);
  await browser.cli('reload');await browser.wait(field+"?.value==='浏览器内尚未提交的另一份草稿。'");await browser.cli('find','text','成片采用的口播','click','--exact');await browser.capture('reloaded');
  const text=String(await browser.evaluate('document.body.innerText'));expect(text).toContain('草稿未采用，成片仍使用已采用口播。');expect(text).toContain(adoptedText);expect(text).not.toContain('workspace-narration-shot-');
  expect(Number((await f.c.query('SELECT count(*) n FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows[0].n)).toBe(taskCount);expect((await f.c.query('SELECT project_sha256 FROM local_identity.production_workspaces WHERE id=$1',[w.id])).rows[0].project_sha256).toBe(sha);
  await writeFile(join(process.env.LOOP_STORY_EVIDENCE!,'f1-current-project.json'),JSON.stringify(current,null,2));
 }finally{await browser?.close();await f.close();}
},180000);
