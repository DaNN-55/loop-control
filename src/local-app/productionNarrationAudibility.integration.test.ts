// @vitest-environment node
import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {editStudioDocument} from './studioDocument.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1'||!process.env.LOOP_TEST_CONTEXT_MODULE).each(['plain','automated-silence','automated-gain','hidden','edited-transcript'] as const)('delivery narration text agrees with actual native %s audio',async(kind)=>{
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:productionScriptTemplate.replace('镜头时长（秒）：5','镜头时长（秒）：2.4')}),worker=f.workerPool();
 try{
  expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.productionWorkspace)w=r.body.productionWorkspace;else if(r.body.id===w.id)w=r.body;return r.body;};
  const upload=async(type:string,name:string,mime:string)=>{const r=await f.send('importMaterial',{sourceKind:'file',sourcePath:name,materialType:type,materialPurpose:'general_reference',mimeType:mime,isMainScript:false,contentBase64:(await readFile(workspaceTestMedia(name))).toString('base64')});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body.id;};
  const image=await upload('image','still-striped.png','image/png'),audio=await upload('audio','controlled-narration-tone.mp3','audio/mpeg'),clip=w.clips[0];
  await send('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image,usage:'still',durationSeconds:2.4,fit:'contain',focusX:0,focusY:0});await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  await send('saveWorkspaceNarration',{clipId:clip.id,mode:'manual',text:'这份人工录音是明确采用的来源。',materialRevisionId:audio});
  const track=w.narration[0].audioTrackId,prepared=await send('prepareWorkspaceCandidate',{candidateId:track,durationPolicy:'keep-target'});await send('adoptWorkspaceCandidate',{candidateId:track,adoptionId:prepared.adoptionId});
  const opened=await send('openWorkspaceStudio');await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{
   const root=doc.timelines[0],voice=root.items.find((i:any)=>i.id==='workspace-narration-shot-'+clip.shotId);expect(voice).toBeTruthy();
   if(kind==='hidden')root.tracks[voice.track].hidden=true;
   if(kind==='automated-silence'||kind==='automated-gain')voice.keyframes={volume:[{frame:0,value:kind==='automated-silence'?0:.5},{frame:Number(voice.durationInFrames)-1,value:kind==='automated-silence'?0:.5}]};
   if(kind==='edited-transcript'){voice.transcript=[{text:'原来前半句',start:0,end:1200},{text:'保留后半句',start:1200,end:2400}];voice.deletedWordIdx=[0];}
  });await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});await send('closeWorkspaceStudio');await send('exportWorkspace');
  const exported=w.exports[0];expect(exported.status,JSON.stringify(exported)).toBe('ready');await send('confirmWorkspaceExport',{exportId:exported.id,expectedExportSha256:exported.artifact.sha256,expectedContentSha256:w.contentSha256});
  await send('prepareWorkspaceDelivery',{exportId:exported.id,expectedExportSha256:exported.artifact.sha256,expectedContentSha256:w.contentSha256,title:'嵌套声音对账',description:'',tags:[],coverBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});
  const claimed=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:w.deliveries[0].taskId,p_worker_capacity:2}) as any[])[0],result=await runWorkspaceDeliveryProcess(f,claimed,{mountPath:f.mountPath});expect(result.status,JSON.stringify(result)).toBe('completed');
  const metadata=result.artifacts.find((a:any)=>a.artifactType==='metadata'),response=await fetch(`${f.origin}/_local-artifact?episode=${f.newEpisode}&path=${encodeURIComponent(metadata.relativePath)}&sha256=${metadata.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const bytes=Buffer.from(await response.arrayBuffer());expect(createHash('sha256').update(bytes).digest('hex')).toBe(metadata.sha256);const record=JSON.parse(bytes.toString()).narration[0];
  const output=w.exports.find((x:any)=>x.id===exported.id),file=join(process.env.LOOP_STORY_EVIDENCE!,'voice-'+kind+'.mp4');await writeFile(file,await readFile(join(f.assetRoot,output.artifact.relativePath)));
  const streams=execFileSync('ffprobe',['-v','error','-select_streams','a','-show_entries','stream=index','-of','csv=p=0',file],{encoding:'utf8'}).trim();
  const pcm=streams?execFileSync('ffmpeg',['-nostdin','-v','error','-i',file,'-map','0:a:0','-ac','1','-ar','48000','-f','f32le','pipe:1'],{maxBuffer:4*1024*1024}):Buffer.alloc(0);let squares=0;for(let i=0;i<pcm.length;i+=4){const n=pcm.readFloatLE(i);expect(Number.isFinite(n)).toBe(true);squares+=n*n;}const rms=pcm.length?Math.sqrt(squares/(pcm.length/4)):0;
  await writeFile(join(process.env.LOOP_STORY_EVIDENCE!,'voice-'+kind+'.json'),JSON.stringify({rms,metadata:record},null,2));
  expect(record.audioTrackId).toBe(track);expect(record.sourceText).toBe('这份人工录音是明确采用的来源。');expect(record.windows).toHaveLength(1);
  if(kind==='automated-silence'||kind==='hidden'){expect(rms).toBeLessThan(.000001);expect(record.windows[0].audible).toBe(false);}else expect(rms).toBeGreaterThan(.00001);
  if(kind==='plain'){expect(record.adoptedText).toBe(record.sourceText);expect(record.textCoverage).toBe('complete_source');}else{expect(record.adoptedText).toBeNull();expect(record.textCoverage).toBe('partial_or_retimed_unverified');}
 }finally{await worker.end();await f.close();}
},120000);
