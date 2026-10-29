// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {narrationFixture} from './workspaceNarration.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('completed local speech versions stay immutable and rejecting a candidate preserves the native project',async()=>{
 const f=await narrationFixture();try{
 await f.authorize();let w=f.made;const clip=w.clips[0];
 const base=()=>({workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id});
 await f.request('saveWorkspaceNarration',{...base(),mode:'tts',text:'第一版采用正文。'});await f.request('confirmWorkspaceNarration',base());let q=await f.request('generateWorkspaceNarration',base());await f.execute(q.body.narration[0].taskId);w=(await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision})).body;
 await f.request('saveWorkspaceNarration',{...base(),mode:'tts',text:'剪辑内修改的一句话。'});await f.request('confirmWorkspaceNarration',base());q=await f.request('generateWorkspaceNarration',base());await f.execute(q.body.narration[0].taskId);w=await f.read();
 expect(w.candidates).toHaveLength(2);const candidate=w.candidates.find((v:any)=>v.taskId===q.body.narration[0].taskId);expect(candidate).toMatchObject({text:'剪辑内修改的一句话。',mainScriptText:clip.text,durationSeconds:2.4,status:'available'});expect(candidate.inputFingerprint).toHaveLength(64);
 const before=w.project.sha256,rejected=await f.request('rejectWorkspaceCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id});expect(rejected.status,JSON.stringify(rejected.body)).toBe(200);expect(rejected.body.project.sha256).toBe(before);expect(rejected.body.candidates.find((v:any)=>v.id===candidate.id).status).toBe('rejected');
 await f.restartWorker();const recovered=await f.read();expect(recovered.candidates.find((v:any)=>v.id===candidate.id).status).toBe('rejected');expect(JSON.parse(await readFile(join(f.assetRoot,recovered.project.relativePath),'utf8')).timelines[0].items.find((v:any)=>v.id===candidate.targetItemId).src).not.toBe(candidate.relativePath);
 }finally{await f.close();}
},120000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('explicit candidate duration changes only the stable main voice and stale attempts preserve the saved edit',async()=>{
 const f=await narrationFixture();try{
 await f.authorize();let w=f.made;const clip=w.clips[0];const base=()=>({workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id});
 await f.request('saveWorkspaceNarration',{...base(),mode:'tts',text:'原始完整口播。'});await f.request('confirmWorkspaceNarration',base());let q=await f.request('generateWorkspaceNarration',base());await f.execute(q.body.narration[0].taskId);w=(await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision})).body;
 const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
 const storePath=join(f.assetRoot,`episodes/${f.episode}/openchatcut-work/current/runtime/project-store-v1.json`);const {writeFile}=await import('node:fs/promises'),store=JSON.parse(await readFile(storePath,'utf8'));const timeline=store.entries[`project:${w.project.projectId}`].timelines[0],voice=timeline.items.find((i:any)=>i.id===w.narration[0].itemId);voice.volume=.37;voice.fadeInFrames=4;timeline.items.find((i:any)=>i.id===clip.itemId).transform.x=17;timeline.transitions=[{id:'manual-cut',fromItemId:clip.itemId,toItemId:w.clips[1].itemId,durationInFrames:0}];await writeFile(storePath,JSON.stringify(store));
 const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});
 const before=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));const {promisify}=await import('node:util'),{execFile}=await import('node:child_process');await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','sine=frequency=660:sample_rate=48000','-t','1.4','-c:a','libmp3lame',join(f.assetRoot,`episodes/${f.episode}/voice.mp3`)]);
 await f.request('saveWorkspaceNarration',{...base(),mode:'tts',text:'简短新口播。'});await f.request('confirmWorkspaceNarration',base());q=await f.request('generateWorkspaceNarration',base());await f.execute(q.body.narration[0].taskId);w=await f.read();const candidate=w.candidates.find((v:any)=>v.taskId===q.body.narration[0].taskId);
 expect((await f.request('prepareWorkspaceCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'keep-target'})).status).toBe(409);
 const prepared=await f.request('prepareWorkspaceCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'use-candidate'});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);const adopted=await f.request('adoptWorkspaceCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:prepared.body.adoptionId});expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);w=adopted.body;
 const after=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),newVoice=after.timelines[0].items.find((v:any)=>v.id===candidate.targetItemId);expect(newVoice).toMatchObject({volume:.37,fadeInFrames:4,durationInFrames:42,src:candidate.relativePath});
 expect(after.timelines[0].items.filter((v:any)=>v.id!==candidate.targetItemId)).toEqual(before.timelines[0].items.filter((v:any)=>v.id!==candidate.targetItemId));expect(after.timelines[0].transitions).toEqual(before.timelines[0].transitions);expect(after.timelines[0].tracks).toEqual(before.timelines[0].tracks);
 const stale=await f.request('adoptWorkspaceCandidate',{workspaceId:w.id,expectedRevision:w.revision-1,candidateId:candidate.id,adoptionId:prepared.body.adoptionId});expect(stale.status).toBe(409);await f.restartWorker();expect((await f.read()).candidates.find((v:any)=>v.id===candidate.id).status).toBe('adopted');
 }finally{await f.close();}
},120000);
