// @vitest-environment node
import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {defaultShotCaptionContract} from '../shotCaptions';
import {applyWorkspaceCaptionEdit} from '../workspaceCaptions';
import {editStudioDocument} from './studioDocument.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('registers exact native-applied alignment after a real SDK save, but rejects later manual timing',async()=>{
 const f=await productionWorkspaceFixture({runtime:{postReady:async()=>{},wake(){}}}),worker=f.workerPool();
 try{
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,1) ON CONFLICT(singleton) DO NOTHING');
  await f.c.query('UPDATE local_identity.input_episodes SET enabled=true WHERE episode_id=$1',[f.episode]);
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);
  const send=(name:string,data:Record<string,unknown>={})=>f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...data});
  const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'voice.mp3',materialType:'audio',materialPurpose:'general_reference',mimeType:'audio/mpeg',isMainScript:false,contentBase64:(await readFile(join(f.assetRoot,f.files[1].relativePath))).toString('base64')});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  for(const [name,data]of [['saveWorkspaceNarration',{mode:'manual',text:'对齐正文',materialRevisionId:imported.body.id}],['confirmWorkspaceNarration',{}]] as const){const r=await send(name,{clipId:w.clips[0].id,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;}
  const plan=await send('prepareWorkspaceCandidate',{candidateId:w.narration[0].audioTrackId,durationPolicy:'keep-target'});expect(plan.status,JSON.stringify(plan.body)).toBe(200);
  const adopted=await send('adoptWorkspaceCandidate',{candidateId:w.narration[0].audioTrackId,adoptionId:plan.body.adoptionId});expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);w=adopted.body;
  const contract={...defaultShotCaptionContract('对齐正文','independent'),cues:[{id:'seed',text:'对齐正文',startMs:0,endMs:900}]};
  const changed=await send('saveWorkspaceCaptions',{clipId:w.clips[0].id,captionContract:contract});expect(changed.status).toBe(200);w=changed.body;
  const requested=await send('requestWorkspaceCaptionAlignment',{clipId:w.clips[0].id,localOnly:true});expect(requested.status,JSON.stringify(requested.body)).toBe(200);w=requested.body.workspace;
  const port=nativeWorkerPort(worker),claim=(await port.rpc('claim_next_worker_task',{p_task_id:requested.body.task.id,p_worker_capacity:1})as any[])[0];expect(claim?.task_id).toBe(requested.body.task.id);
  const frozen=claim.input_snapshot.acoustic_alignment,result={version:'acoustic-alignment/v1',status:'completed',method:'local_whisperx',granularity:'phrase',inputVersion:frozen.input_version,audioSha256:frozen.audio_sha256,textFingerprint:frozen.text_fingerprint,provider:'whisperx',model:claim.model,connectionVersionId:null,wordCount:1,cues:[{id:'aligned',text:'对齐正文',startMs:120,endMs:980,confidence:.99}],reviewIssues:[],attempts:[],detail:'controlled external aligner seam',generatedAt:new Date().toISOString()},bytes=Buffer.from(JSON.stringify(result)),path=claim.input_snapshot.output.relative_path;
  await mkdir(dirname(join(f.assetRoot,path)),{recursive:true});await writeFile(join(f.assetRoot,path),bytes);
  await port.rpc('report_worker_result',{p_task_id:claim.task_id,p_attempt:claim.attempt,p_lease_token:claim.lease_token,p_result:{version:'worker-result/v1',taskId:claim.task_id,status:'completed',acousticAlignment:result,artifacts:[{artifactType:'acoustic_alignment_evidence',relativePath:path,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length}],validation:{passed:true,checks:[{name:'alignment',passed:true,detail:'controlled external timestamp'}]},actualCostCents:0,blockers:[],retry:{shouldRetry:false,reason:'completed'},nextStep:'检查'}});
  const opened=await send('openWorkspaceStudio');expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;let file=opened.body.workspace;
  const fields={clipId:w.clips[0].id,taskId:claim.task_id,automatic:true,expectedInputFingerprint:w.captions[0].inputFingerprint};
  const prepared=await send('prepareWorkspaceCaptionAlignment',fields);expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  async function nativeSave(caption:any){
   await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>applyWorkspaceCaptionEdit(doc,w.clips[0].itemId,caption,{timingOnly:true}));
   const saved=await send('saveWorkspaceStudio',{workspaceRelativePath:file.relativePath,projectId:file.projectId,expectedWorkspaceSha256:file.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;file=saved.body;
  }
  await nativeSave(prepared.body.captionContract);expect(w.captions[0].alignmentMethod).toBe('manual');
  const registered=await send('applyWorkspaceCaptionAlignment',{...fields,nativeApplied:true});expect(registered.status,JSON.stringify(registered.body)).toBe(200);w=registered.body;
  expect(w.captions[0].alignmentMethod).toBe('alignment');expect(w.captions[0].timing).toBe('current');
  const manual={...w.captions[0].contract,cues:w.captions[0].contract.cues.map((cue:any)=>({...cue,startMs:250}))};await nativeSave(manual);
  const late=await send('applyWorkspaceCaptionAlignment',{...fields,nativeApplied:true});expect(late.status).toBe(409);
  const current=(await(await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}})).json()).workspace;expect(current.captions[0].contract.cues[0].startMs).toBe(250);
 }finally{await worker.end();await f.close();}
},180000);
