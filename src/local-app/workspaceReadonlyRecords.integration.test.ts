// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceImageGenerationFixture} from './workspaceImageGeneration.fixture';
import {editStudioDocument} from './studioDocument.fixture';
import {narrationFixture} from './workspaceNarration.fixture';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
async function saveAndReopenNative(f:any,w:any,candidate:any){
 w=await f.fillVisuals(w);
 const send=async(name:string,data:Record<string,unknown>={})=>{const response=await f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(response.status,JSON.stringify(response.body)).toBe(200);return response.body;};
 let opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;
 await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{const item=doc.timelines.flatMap(t=>t.items).find(i=>i.id===candidate.targetItemId)!;item.transform={...(item.transform??{}),scale:0.3333333333333333};});
 w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256})).productionWorkspace;await send('closeWorkspaceStudio');
 opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;const reopened=await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>doc);expect(reopened.timelines.flatMap(t=>t.items).find(i=>i.id===candidate.targetItemId)?.transform?.scale).toBe(0.3333333333333333);
 w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256})).productionWorkspace;await send('closeWorkspaceStudio');
 return w;
}
it.skipIf(!enabled)('Owner reads retain frozen image request facts and exact adopted native bytes after restart',async()=>{
 const {f,ref,submissions}=await workspaceImageGenerationFixture();try{
 let w=await f.read();const targetItemId=w.clips[0].itemId,selection={capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='openai_images'")).rows[0].id};
 const queued=await f.request('requestWorkspaceImageCandidates',{workspaceId:w.id,expectedRevision:w.revision,targetItemId,selection,prompt:'原图片制作请求',settings:{size:'1152x2048',quality:'high',count:1},referenceMaterialRevisionIds:[ref.body.id],reservationCents:100});expect(queued.status,JSON.stringify(queued.body)).toBe(200);w=queued.body;const task=w.visualTasks[0];
 expect(task.generation).toMatchObject({prompt:'原图片制作请求',selection,imageSettings:{quality:'high',count:1},referenceMaterialRevisionIds:[ref.body.id]});expect(task.generation.actualPrompt).toContain('原图片制作请求');
 await f.execute(task.taskId);w=await f.read();const candidate=w.visualCandidates[0];expect(candidate.generation.actualPrompt).toContain('原图片制作请求');
 const plan=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'keep-target'});expect(plan.status,JSON.stringify(plan.body)).toBe(200);const adopted=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:plan.body.adoptionId});expect(adopted.status).toBe(200);w=await saveAndReopenNative(f,adopted.body,candidate);
 const bytes=await readFile(join(f.assetRoot,w.project.relativePath),'utf8');await f.restart();await f.restartWorker();const before=await f.read(),after=await f.read();expect(after.revision).toBe(before.revision);expect(after.visualCandidates).toEqual(before.visualCandidates);expect(await readFile(join(f.assetRoot,after.project.relativePath),'utf8')).toBe(bytes);expect(after.visualCandidates[0]).toMatchObject({status:'adopted',sha256:candidate.sha256,generation:{prompt:'原图片制作请求',selection}});expect((await readFile(submissions,'utf8')).trim().split('\n')).toHaveLength(1);
 if(process.env.LOOP_STORY_EVIDENCE)await writeFile(join(process.env.LOOP_STORY_EVIDENCE,'readonly-image.json'),JSON.stringify({task,record:after.visualCandidates[0],project:after.project,revision:after.revision,unchangedBytes:true,nativeSavedAndReopened:true,supplierPosts:1},null,2));
 }finally{await f.close();}
},120000);
it.skipIf(!enabled)('Owner reads retain the video first frame, frozen prompt and actual adopted source without changing native values',async()=>{
 const f=await narrationFixture(undefined,undefined,true);try{
 await f.authorize();let w=f.made;const {workspaceTestMedia}=await import('./workspaceTestMedia.fixture');const ref=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'原首帧.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(ref.status).toBe(200);
 const queued=await f.chosenRequest('requestWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,firstFrameMaterialRevisionId:ref.body.id,prompt:'原视频制作动作',firstFrameFit:'cover',durationSeconds:4,reservationCents:100});expect(queued.status,JSON.stringify(queued.body)).toBe(200);w=queued.body;const task=w.visualTasks[0];expect(task.generation).toMatchObject({prompt:'原视频制作动作',firstFrameMaterialRevisionId:ref.body.id,firstFrameFit:'cover',durationSeconds:4});await f.execute(task.taskId);w=await f.read();const candidate=w.visualCandidates[0];
 const prepared=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'keep-target'});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);const adopted=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:prepared.body.adoptionId});expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);w=await saveAndReopenNative(f,adopted.body,candidate);
 const bytes=await readFile(join(f.assetRoot,w.project.relativePath),'utf8');await f.restart();const before=await f.read(),after=await f.read();expect(after.revision).toBe(before.revision);expect(await readFile(join(f.assetRoot,after.project.relativePath),'utf8')).toBe(bytes);expect(after.visualCandidates[0]).toMatchObject({status:'adopted',generation:{prompt:'原视频制作动作',firstFrameMaterialRevisionId:ref.body.id,firstFrameFit:'cover'}});expect(after.visualCandidates[0].generation.actualPrompt).toContain('原视频制作动作');expect((await readFile(f.videoSubmissions,'utf8')).trim().split('\n')).toHaveLength(1);
 if(process.env.LOOP_STORY_EVIDENCE)await writeFile(join(process.env.LOOP_STORY_EVIDENCE,'readonly-video.json'),JSON.stringify({task,record:after.visualCandidates[0],project:after.project,revision:after.revision,unchangedBytes:true,nativeSavedAndReopened:true,supplierPosts:1},null,2));
 }finally{await f.close();}
},120000);
