// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {editStudioDocument} from './studioDocument.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
import {workspaceContentSha256} from './productionWorkspaceCommands';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('delivery keeps distinct adopted narration identities when shots share one uploaded file',async()=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){}}}),worker=f.workerPool();
 try{
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2)');
  const prepared=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});
  expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);let w=prepared.body;
  const send=async(command:string,data:Record<string,unknown>={})=>{
   const response=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});
   expect(response.status,`${command}: ${JSON.stringify(response.body)}`).toBe(200);
   if(response.body.id===w.id)w=response.body;
   return response.body;
  };
  const upload=async(kind:'image'|'audio',name:string,path:string)=>{
   const response=await f.request('importMaterial',{sourceKind:'file',sourcePath:name,materialType:kind,materialPurpose:kind==='image'?'visual_reference':'general_reference',mimeType:kind==='image'?'image/png':'audio/mpeg',isMainScript:false,contentBase64:(await readFile(path)).toString('base64')});
   expect(response.status,JSON.stringify(response.body)).toBe(200);return response.body;
  };
  const image=await upload('image','shared.png',workspaceTestMedia('still-striped.png'));
  const audio=await upload('audio','shared.mp3',workspaceTestMedia('controlled-narration-tone.mp3'));
  const texts=['第一镜明确采用的正文。','第二镜明确采用的正文。'],expected:Array<{shotId:string;audioTrackId:string;adoptedText:string}>=[];
  for(const [index,clip]of [...w.clips].entries()){
   await send('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image.id,usage:'still',durationSeconds:2.4,fit:'contain',focusX:0,focusY:0});
   await send('saveWorkspaceNarration',{clipId:clip.id,mode:'manual',text:texts[index],materialRevisionId:audio.id});
   await send('confirmWorkspaceNarration',{clipId:clip.id});
   const candidate=w.candidates.find((candidate:any)=>candidate.id===w.narration.find((voice:any)=>voice.clipId===clip.id).audioTrackId);
   const adoption=await send('prepareWorkspaceCandidate',{candidateId:candidate.id,durationPolicy:'keep-target'});
   await send('adoptWorkspaceCandidate',{candidateId:candidate.id,adoptionId:adoption.adoptionId});
   expected.push({shotId:clip.shotId,audioTrackId:candidate.id,adoptedText:texts[index]});
   await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(texts[index],'independent',false)});
  }
  expect(expected).toHaveLength(2);expect(expected[0].audioTrackId).not.toBe(expected[1].audioTrackId);
  const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;
  await editStudioDocument(opened.studioUrl,w.project.projectId,document=>{document.timelines[0].items.find((item:any)=>item.id===w.clips[0].itemId).transform.x=8;});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256})).productionWorkspace;
  await send('closeWorkspaceStudio');await f.restart();
  const reopened=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});
  expect(reopened.status).toBe(200);w=(await reopened.json()).workspace;
  for(const record of expected)expect(w.usedNarration.find((used:any)=>used.shotId===record.shotId)).toMatchObject({audioTrackId:record.audioTrackId,text:record.adoptedText});
  await send('exportWorkspace');const output=w.exports[0];expect(output.status,JSON.stringify(output)).toBe('ready');
  await send('confirmWorkspaceExport',{exportId:output.id,expectedExportSha256:output.artifact.sha256,expectedContentSha256:w.contentSha256});
  await send('prepareWorkspaceDelivery',{exportId:output.id,expectedExportSha256:output.artifact.sha256,expectedContentSha256:w.contentSha256,title:'共用文件的逐镜音轨身份',description:'',tags:[],coverBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});
  const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:w.deliveries[0].taskId,p_worker_capacity:2})as any[])[0];
  const result=await runWorkspaceDeliveryProcess(f,task);expect(result.status,JSON.stringify(result)).toBe('completed');
  const metadata=result.artifacts.find((artifact:any)=>artifact.artifactType==='metadata');
  const download=await fetch(`${f.origin}/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(metadata.relativePath)}&sha256=${metadata.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});
  expect(download.status).toBe(200);const delivered=await download.json();
  for(const record of expected)expect(delivered.narration.find((item:any)=>item.shotId===record.shotId)).toMatchObject({...record,sourceText:record.adoptedText,textSource:'owner_adoption'});
  const document=JSON.parse(await readFile(join(f.assetRoot,output.project.relativePath),'utf8'));
  for(const record of expected)expect(document.timelines.flatMap((timeline:any)=>timeline.items).find((item:any)=>item.id===`workspace-narration-shot-${record.shotId}`).sourceAssetId).toBe('audio-track-'+record.audioTrackId);
  if(process.env.LOOP_STORY_EVIDENCE){
   const evidence=join(process.env.LOOP_STORY_EVIDENCE,'delivery-identity');await mkdir(evidence,{recursive:true});
   await writeFile(join(evidence,'metadata.json'),JSON.stringify(delivered,null,2));await writeFile(join(evidence,'confirmed-project.json'),JSON.stringify(document,null,2));await writeFile(join(evidence,'expected-sources.json'),JSON.stringify(expected,null,2));
   await copyFile(join(f.assetRoot,output.artifact.relativePath),join(evidence,'confirmed-video.mp4'));
  }
 }finally{await worker.end();await f.close();}
},180000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner workspace reads accept a unique legacy narration path and reject ambiguous or mismatched sources',async()=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){}}});
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const send=async(command:string,data:Record<string,unknown>)=>{
   const response=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});
   expect(response.status,`${command}: ${JSON.stringify(response.body)}`).toBe(200);if(response.body.id===w.id)w=response.body;return response.body;
  };
  const uploaded=await f.request('importMaterial',{sourceKind:'file',sourcePath:'legacy-shared.mp3',materialType:'audio',materialPurpose:'general_reference',mimeType:'audio/mpeg',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('controlled-narration-tone.mp3'))).toString('base64')});expect(uploaded.status).toBe(200);
  const read=()=>fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});
  // Construct old persisted documents at the fixture boundary; all behavior is observed through Owner HTTP.
  const historicalDocument=async(edit:(document:any)=>void)=>{
   const document=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));edit(document);
   const bytes=Buffer.from(JSON.stringify(document,null,2)+'\n'),sha=createHash('sha256').update(bytes).digest('hex'),path=dirname(w.project.relativePath)+'/'+sha+'.json';
   await writeFile(join(f.assetRoot,path),bytes);
   await f.c.query('UPDATE local_identity.production_workspaces SET project_path=$2,project_sha256=$3,project_size=$4,content_sha256=$5 WHERE id=$1',[w.id,path,sha,bytes.length,workspaceContentSha256(document)]);
   const response=await read();if(response.status===200)w=(await response.clone().json()).workspace;return response;
  };
  let firstId='';
  for(const [index,clip]of [...w.clips].entries()){
   await send('saveWorkspaceNarration',{clipId:clip.id,mode:'manual',text:index===0?'第一条原稿。':'第二条原稿。',materialRevisionId:uploaded.body.id});await send('confirmWorkspaceNarration',{clipId:clip.id});
   const id=w.narration.find((voice:any)=>voice.clipId===clip.id).audioTrackId,adoption=await send('prepareWorkspaceCandidate',{candidateId:id,durationPolicy:'keep-target'});await send('adoptWorkspaceCandidate',{candidateId:id,adoptionId:adoption.adoptionId});
   if(index===0){
    firstId=id;
    const legacy=await historicalDocument(document=>{delete document.timelines.flatMap((timeline:any)=>timeline.items).find((item:any)=>item.id===`workspace-narration-shot-${clip.shotId}`).sourceAssetId;});
    expect(legacy.status,await legacy.clone().text()).toBe(200);
    expect((await legacy.json()).workspace.usedNarration[0]).toMatchObject({audioTrackId:firstId,text:'第一条原稿。'});
    const malformed=await historicalDocument(document=>{document.timelines.flatMap((timeline:any)=>timeline.items).find((item:any)=>item.id===`workspace-narration-shot-${clip.shotId}`).sourceAssetId='audio-track-audio-track-1';});
    expect(malformed.status).toBe(409);expect((await malformed.json()).error).toContain('身份无效');
    expect((await historicalDocument(document=>{document.timelines.flatMap((timeline:any)=>timeline.items).find((item:any)=>item.id===`workspace-narration-shot-${clip.shotId}`).sourceAssetId='audio-track-'+firstId;})).status).toBe(200);
   }
  }
  const firstItem=(document:any)=>document.timelines.flatMap((timeline:any)=>timeline.items).find((item:any)=>item.id===`workspace-narration-shot-${w.clips[0].shotId}`);
  const ambiguous=await historicalDocument(document=>{delete firstItem(document).sourceAssetId;});expect(ambiguous.status).toBe(409);expect((await ambiguous.json()).error).toContain('多条音轨');
  // The failed read does not replace the authoritative fixture document or accept an arbitrary track.
  expect((await historicalDocument(document=>{firstItem(document).sourceAssetId='audio-track-'+firstId;})).status).toBe(200);
  const mismatch=await historicalDocument(document=>{firstItem(document).sourceContentHash='0'.repeat(64);});expect(mismatch.status).toBe(409);expect((await mismatch.json()).error).toContain('指纹');
  const missing=await historicalDocument(document=>{firstItem(document).sourceAssetId='audio-track-'+randomUUID();});expect(missing.status).toBe(409);expect((await missing.json()).error).toContain('不一致');
 }finally{await f.close();}
},90000);
