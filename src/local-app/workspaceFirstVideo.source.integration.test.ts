// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {editStudioDocument} from './studioDocument.fixture';
import {workspaceAudioFixture} from './workspaceAudio.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('first video freezes the actual source main voice without requiring an unused TTS draft',async()=>{
 const f=await workspaceAudioFixture({videoConfiguration:true});
 try{
  let w=f.made;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.chosenRequest(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r;};
  const video=await f.request('importMaterial',{sourceKind:'file',sourcePath:'source.mp4',contentBase64:(await readFile(f.media.video)).toString('base64'),materialType:'video',mimeType:'video/mp4',isMainScript:false,materialPurpose:'a_roll'});expect(video.status).toBe(200);
  const first=w.clips[0];for(const clip of [...w.clips])await send('matchWorkspaceMaterial',{clipId:clip.id,materialRevisionId:video.body.id});
  await send('prepareWorkspaceAudio',{kind:'source',shotId:first.shotId,sourceItemId:first.itemId});const prep=w.audio.preparations[0];expect((await f.executeAudio(prep.taskId)).status).toBe('completed');await send('adoptWorkspaceAudio',{preparationId:prep.id});
  // The real native save boundary may retain an extracted voice while replacing its picture with a fresh placeholder.
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
  const clipId=randomUUID();await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{const item=doc.timelines[0].items.find((i:any)=>i.id===first.itemId);item.id=`shot-${first.shotId}-${clipId}`;item.kind='text';item.props={text:'新画面占位',fontSize:56};item.loopControlShot={...item.loopControlShot,clipId};delete item.loopControlShot.provenance;
  for(const key of ['src','sourceAssetId','sourceRevision','sourceContentHash','sourceFilename','srcInFrame'])delete item[key];
  });const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;await send('closeWorkspaceStudio');
  const target=w.clips.find((c:any)=>c.id===clipId);expect(target.source).toBeNull();expect(w.audio.mix.voices.find((v:any)=>v.shotId===first.shotId).mode).toBe('source');
  await send('saveWorkspaceNarration',{clipId,mode:'tts',text:'这份尚未生成的口播草稿不能替代实际原声。'});expect(w.narration.find((n:any)=>n.shotId===first.shotId).audioTrackId).toBeNull();
  await f.authorize();
  const picture=await f.request('importMaterial',{sourceKind:'file',sourcePath:'first.png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),materialType:'image',mimeType:'image/png',isMainScript:false,materialPurpose:'visual_reference'});expect(picture.status).toBe(200);
  const before=w.nativeEditRevision;await send('generateWorkspaceImage',{clipId,materialRevisionId:picture.body.id,prompt:'自然平稳推进',durationSeconds:11,reservationCents:90});
  const image=w.clips.find((c:any)=>c.id===clipId).image;expect(image.durationSeconds).toBe(2);expect(image.providerDurationSeconds).toBe(4);expect(w.nativeEditRevision).toBe(before);
  const task=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[image.taskId])).rows[0];expect(task.input_snapshot.workspace_visual).toMatchObject({windowDurationSeconds:2,mode:'source'});
  const request=(await f.c.query('SELECT narration_target FROM local_identity.workspace_image_requests WHERE task_id=$1',[image.taskId])).rows[0];expect(request.narration_target).toBeNull();
  const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(project.timelines.flatMap((t:any)=>t.items).find((i:any)=>i.id===`workspace-source-shot-${first.shotId}`).sourceAssetId).toBe('audio-track-'+w.audio.preparations.find((p:any)=>p.id===prep.id).audioTrackId);
 }finally{await f.close();}
},180000);
