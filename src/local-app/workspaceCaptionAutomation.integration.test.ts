// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {ownerTransaction} from './ownerTransaction';
import {updateWorkspaceProject} from './productionWorkspaceCommands';
import {nativeWorkerPort} from './workerDatabase';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('same-input automation preserves real manual caption evidence without creating alignment work',async()=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){}}});try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const contract={...defaultShotCaptionContract('人工字幕','independent'),cues:[{id:'one',text:'人工字幕',startMs:100,endMs:900}]};
  const manual=await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,captionContract:contract});expect(manual.status,JSON.stringify(manual.body)).toBe(200);w=manual.body;
  const current=w.captions[0];expect(current.alignmentMethod).toBe('manual');expect(current.timing).toBe('current');
  const queued=await f.request('requestWorkspaceCaptionAlignment',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,automatic:true,expectedInputFingerprint:current.inputFingerprint,localOnly:true});
  expect(queued.status,JSON.stringify(queued.body)).toBe(200);expect(queued.body.task).toBeUndefined();expect(queued.body.workspace.project.sha256).toBe(w.project.sha256);
  expect((await f.c.query("SELECT count(*) FROM public.tasks WHERE episode_id=$1 AND task_type='align_shot_captions'",[f.episode])).rows[0].count).toBe('0');
  const late=await f.request('applyWorkspaceCaptionAlignment',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,automatic:true,taskId:randomUUID(),expectedInputFingerprint:current.inputFingerprint});
  expect(late.status,JSON.stringify(late.body)).toBe(409);expect(late.body.error).toContain('字幕已由人工');
 }finally{await f.close();}
},180000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each([0,500])('aligns a complete short adopted voice at offset %i ms without requiring full-shot coverage',async offsetMs=>{
 const f=await productionWorkspaceFixture({runtime:{postReady:async()=>{},wake(){}}}),worker=f.workerPool();
 try{
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,1) ON CONFLICT(singleton) DO NOTHING');
  await f.c.query('UPDATE local_identity.input_episodes SET enabled=true WHERE episode_id=$1',[f.episode]);
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  async function changeNative(edit:(doc:any)=>void){
   const doc=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));edit(doc);
   w=await ownerTransaction(f.pool,f.owner,false,async c=>{const row=(await c.query('SELECT * FROM local_identity.production_workspaces WHERE id=$1',[w.id])).rows[0];return updateWorkspaceProject(c,f.assetRoot,row,doc,row.bindings,'测试原生音频窗口',{nativeEdit:true});});
  }
  // A 2-second file is used whole inside a longer native shot, just like imported speech.
  await changeNative(doc=>{const t=doc.timelines[0],visual=t.items.find((i:any)=>i.id===w.clips[0].itemId);visual.durationInFrames=5*t.fps;for(const i of t.items)if(i.kind==='audio')i.volume=0;for(const i of t.items)if(i.id===w.clips[1].itemId)i.startFrame=5*t.fps;});
  const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'short-voice.mp3',materialType:'audio',materialPurpose:'general_reference',mimeType:'audio/mpeg',isMainScript:false,contentBase64:(await readFile(join(f.assetRoot,f.files[1].relativePath))).toString('base64')});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  for(const [command,data] of [['saveWorkspaceNarration',{mode:'manual',text:'部分窗口字幕。',materialRevisionId:imported.body.id}],['confirmWorkspaceNarration',{}]] as const){const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;}
  expect(w.captions[0].audioTrackId).toBeNull();expect(w.captions[0].alignmentReady).toBe(false);
  const unadopted=await f.request('requestWorkspaceCaptionAlignment',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,automatic:true,expectedInputFingerprint:w.captions[0].inputFingerprint,localOnly:true});expect(unadopted.status).toBe(409);
  expect((await f.c.query("SELECT count(*) FROM public.tasks WHERE episode_id=$1 AND task_type='align_shot_captions'",[f.episode])).rows[0].count).toBe('0');
  const candidate=w.narration[0].audioTrackId,prepared=await f.request('prepareWorkspaceCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate,durationPolicy:'keep-target'});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  const adopted=await f.request('adoptWorkspaceCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate,adoptionId:prepared.body.adoptionId});expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);w=adopted.body;
  if(offsetMs)await changeNative(doc=>{const t=doc.timelines[0],voice=t.items.find((i:any)=>i.id===`workspace-narration-shot-${w.clips[0].shotId}`);voice.startFrame+=Math.round(offsetMs*t.fps/1000);});
  expect(w.audio.mix.voices[0].coverage).toBe('partial');expect(w.captions[0].alignmentReady).toBe(true);
  const text='部分窗口字幕。',edited=await f.request('saveWorkspaceNarrationCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,contentMode:'independent',text});expect(edited.status,JSON.stringify(edited.body)).toBe(200);w=edited.body;
  async function queue(){const r=await f.request('requestWorkspaceCaptionAlignment',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,automatic:true,expectedInputFingerprint:w.captions[0].inputFingerprint,localOnly:true});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body.workspace;return r.body.task;}
  async function complete(task:any,status='completed'){
   const claim=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:task.id,p_worker_capacity:1})as any[])[0];expect(claim?.task_id).toBe(task.id);const frozen=claim.input_snapshot.acoustic_alignment;
   const result={version:'acoustic-alignment/v1',status,method:'local_whisperx',granularity:'phrase',inputVersion:frozen.input_version,audioSha256:frozen.audio_sha256,textFingerprint:frozen.text_fingerprint,provider:'whisperx',model:claim.model,connectionVersionId:null,wordCount:1,cues:[{id:'aligned',text,startMs:100,endMs:900,confidence:status==='completed'?.99:.2}],reviewIssues:status==='completed'?[]:[{id:'low',kind:'low_confidence',text,cueIds:['aligned'],detail:'待检查'}],attempts:[],detail:'受控外部结果接口',generatedAt:new Date().toISOString()};
   const bytes=Buffer.from(JSON.stringify(result)),path=claim.input_snapshot.output.relative_path;await mkdir(dirname(join(f.assetRoot,path)),{recursive:true});await writeFile(join(f.assetRoot,path),bytes);
   await nativeWorkerPort(worker).rpc('report_worker_result',{p_task_id:claim.task_id,p_attempt:claim.attempt,p_lease_token:claim.lease_token,p_result:{version:'worker-result/v1',taskId:claim.task_id,status:'completed',acousticAlignment:result,artifacts:[{artifactType:'acoustic_alignment_evidence',relativePath:path,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length}],validation:{passed:true,checks:[{name:'test_alignment',passed:true,detail:'alignment protocol fixture'}]},actualCostCents:0,blockers:[],retry:{shouldRetry:false,reason:'completed'},nextStep:'核对'}});
   w=(await(await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}})).json()).workspace;
  }
  let task=await queue();
  if(offsetMs){await complete(task,'needs_review');expect(w.captions[0].suggestedCues[0]).toMatchObject({startMs:100+offsetMs,endMs:900+offsetMs});const retry=await f.request('requestWorkspaceCaptionAlignment',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,localOnly:true});expect(retry.status).toBe(200);w=retry.body.workspace;task=retry.body.task;}
  await complete(task);
  const applied=await f.request('applyWorkspaceCaptionAlignment',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,automatic:true,taskId:task.id,expectedInputFingerprint:w.captions[0].inputFingerprint});expect(applied.status,JSON.stringify(applied.body)).toBe(200);w=applied.body;
  expect(w.captions[0].contract.cues[0]).toMatchObject({startMs:100+offsetMs,endMs:900+offsetMs});expect(w.captions[0].timing).toBe('current');
  const manual={...w.captions[0].contract,cues:w.captions[0].contract.cues.map((cue:any)=>({...cue,startMs:cue.startMs+25}))};const saved=await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,captionContract:manual,expectedInputFingerprint:w.captions[0].inputFingerprint});expect(saved.status).toBe(200);w=saved.body;
  const late=await f.request('applyWorkspaceCaptionAlignment',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,automatic:true,taskId:task.id,expectedInputFingerprint:w.captions[0].inputFingerprint});expect(late.status).toBe(409);expect(late.body.error).toContain('字幕已由人工');
 }finally{await worker.end();await f.close();}
},180000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('small caption text corrections keep phrase windows valid and need no model retry',async()=>{
 const f=await productionWorkspaceFixture();try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const contract={...defaultShotCaptionContract('招才纳福。财源广进。','independent'),cues:[{id:'one',text:'招才纳福。',startMs:100,endMs:450},{id:'two',text:'财源广进。',startMs:500,endMs:900}]};
  const saved=await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,captionContract:contract});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body;
  const corrected=await f.request('saveWorkspaceNarrationCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,contentMode:'independent',text:'招财纳福。财源广进。'});
  expect(corrected.status,JSON.stringify(corrected.body)).toBe(200);w=corrected.body;
  expect(w.captions[0].contract.cues.map((c:any)=>[c.text,c.startMs,c.endMs])).toEqual([['招财纳福。',100,450],['财源广进。',500,900]]);
  expect(w.captions[0].timing).toBe('current');expect(w.captions[0].alignmentMethod).toBe('manual');
 }finally{await f.close();}
},180000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('manual timing saved from an old text/audio/window identity is rejected before changing the current project',async()=>{
 const f=await productionWorkspaceFixture();try{
  const w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const contract={...defaultShotCaptionContract('旧输入上的修改','independent'),cues:[{id:'one',text:'旧输入上的修改',startMs:0,endMs:900}]};
  const rejected=await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,captionContract:contract,expectedInputFingerprint:'0'.repeat(64)});
  expect(rejected.status,JSON.stringify(rejected.body)).toBe(409);expect(rejected.body.error).toContain('声音、正文或镜头已变化');
 }finally{await f.close();}
},180000);
