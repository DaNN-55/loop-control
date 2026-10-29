// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner edits only the chosen native caption lane and persists manual timing without shot approval',async()=>{
 const f=await productionWorkspaceFixture({migrations:['db/local/089-workspace-captions.sql']});try{
  const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(made.status,JSON.stringify(made.body)).toBe(200);let w=made.body;
  const contract=defaultShotCaptionContract('第一句字幕正文','independent');contract.cues=[{id:'one',text:contract.text,startMs:0,endMs:900}];contract.spatial.maxCharactersPerLine=4;
  const save=()=>f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,captionContract:contract});
  const first=await save();expect(first.status,JSON.stringify(first.body)).toBe(200);w=first.body;expect(w.captions[0].timing).toBe('current');
  const one=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),lane=one.timelines[0].tracks['workspace-captions'].captions.sourceEntries[0];expect(lane.words[0].text).toBe('第一句字\n幕正文');
  const second=await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[1].id,captionContract:{...contract,text:'第二镜字幕',cues:[{id:'two',text:'第二镜字幕',startMs:100,endMs:900}]}});expect(second.status,JSON.stringify(second.body)).toBe(200);w=second.body;
  contract.spatial.anchor='top-left';const changed=await save();expect(changed.status,JSON.stringify(changed.body)).toBe(200);w=changed.body;
  const two=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(two.timelines[0].tracks['workspace-captions'].captions.sourceEntries.find((e:{id:string})=>e.id.includes(w.clips[1].itemId))).toEqual(JSON.parse(await readFile(join(f.assetRoot,second.body.project.relativePath),'utf8')).timelines[0].tracks['workspace-captions'].captions.sourceEntries.find((e:{id:string})=>e.id.includes(w.clips[1].itemId)));
  await f.restart();const read=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});const resumed=(await read.json()).workspace;expect(resumed.captions[0].contract.spatial.anchor).toBe('top-left');expect(resumed.captions[1].contract.cues[0].startMs).toBe(100);
  await f.c.query("UPDATE public.shot_preparation_drafts SET audio_mode='tts',tts_text=$3,tts_voice='fixture',tts_speaking_rate=1 WHERE episode_id=$1 AND shot_id=$2",[f.episode,w.clips[0].shotId,contract.text]);
  const follow=await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,captionContract:{...contract,contentMode:'follow_tts'}});expect(follow.status,JSON.stringify(follow.body)).toBe(200);w=follow.body;
  await f.c.query('UPDATE public.shot_preparation_drafts SET tts_text=$3 WHERE episode_id=$1 AND shot_id=$2',[f.episode,w.clips[0].shotId,'另一版口播']);
  const stale=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}}),changedInput=(await stale.json()).workspace;expect(changedInput.captions[0].timing).toBe('stale');expect(changedInput.captions[1].timing).toBe('current');
  const off=await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,captionContract:{...contract,enabled:false}});expect(off.status,JSON.stringify(off.body)).toBe(200);w=off.body;expect(w.captions[0].contract.enabled).toBe(false);expect(w.captions[1].contract.enabled).toBe(true);
  expect((await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision})).status).toBe(200);
 }finally{await f.close();}
},180_000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('current native caption evidence follows the real alignment queue and rejects a late Worker result after a text edit',async()=>{
 const {randomUUID,createHash}=await import('node:crypto'),{writeFile,mkdir}=await import('node:fs/promises'),{dirname}=await import('node:path'),{nativeWorkerPort}=await import('./workerDatabase');
 const f=await productionWorkspaceFixture({migrations:['db/local/089-workspace-captions.sql'],runtime:{postReady:async()=>{},wake(){}}}),worker=f.workerPool();
 try{
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,1) ON CONFLICT(singleton) DO NOTHING');await f.c.query('UPDATE local_identity.input_episodes SET enabled=true WHERE episode_id=$1',[f.episode]);
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const contract=defaultShotCaptionContract('对齐正文','independent');contract.cues=[{id:'manual',text:contract.text,startMs:0,endMs:900}];
  w=(await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,captionContract:contract})).body;
  const audio=randomUUID(),artifact=randomUUID(),voice=f.files[1];
  await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'audio',$4,$5,$6)",[artifact,f.episode,f.task,voice.relativePath,voice.sha256,voice.fileSize]);
  await f.c.query("INSERT INTO public.audio_tracks(id,episode_id,source_task_id,source_artifact_id,track_kind,cue_id,relative_path,sha256,file_size,duration_seconds) VALUES($1,$2,$3,$4,'narration',$5,$6,$7,$8,2)",[audio,f.episode,f.task,artifact,w.clips[0].shotId,voice.relativePath,voice.sha256,voice.fileSize]);
  await f.c.query("UPDATE public.shot_preparation_drafts SET audio_mode='source',current_audio_track_id=$2,audio_status='ready' WHERE episode_id=$1",[f.episode,audio]);
  const request=await f.request('requestWorkspaceCaptionAlignment',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,localOnly:true});expect(request.status,JSON.stringify(request.body)).toBe(200);w=request.body.workspace;
  expect(w.captions[0].timing).toBe('waiting');
  const task=request.body.task,port=nativeWorkerPort(worker),claim=(await port.rpc('claim_next_worker_task',{p_task_id:task.id,p_worker_capacity:1}))[0] as Record<string,any>;expect(claim?.task_id).toBe(task.id);
  async function complete(claim:Record<string,any>){const frozen=claim.input_snapshot.acoustic_alignment,result={version:'acoustic-alignment/v1',status:'completed',method:'local_whisperx',granularity:'phrase',inputVersion:frozen.input_version,audioSha256:frozen.audio_sha256,textFingerprint:frozen.text_fingerprint,provider:'whisperx',model:claim.model,connectionVersionId:null,wordCount:1,cues:[{id:'aligned',text:frozen.confirmed_text,startMs:120,endMs:980}],reviewIssues:[],attempts:[],detail:'Controlled timestamp response at the external aligner seam.',generatedAt:new Date().toISOString()},bytes=Buffer.from(JSON.stringify(result)),path=claim.input_snapshot.output.relative_path;await mkdir(dirname(join(f.assetRoot,path)),{recursive:true});await writeFile(join(f.assetRoot,path),bytes);await port.rpc('report_worker_result',{p_task_id:claim.task_id,p_attempt:claim.attempt,p_lease_token:claim.lease_token,p_result:{version:'worker-result/v1',taskId:claim.task_id,status:'completed',acousticAlignment:result,artifacts:[{artifactType:'acoustic_alignment_evidence',relativePath:path,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length}],validation:{passed:true,checks:[{name:'controlled_alignment',passed:true,detail:'Fixed external aligner fixture'}]},actualCostCents:0,blockers:[],retry:{shouldRetry:false,reason:'completed'},nextStep:'Owner checks timing'}});}
  await complete(claim);
  const applied=await f.request('applyWorkspaceCaptionAlignment',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,taskId:task.id,expectedInputFingerprint:w.captions[0].inputFingerprint});expect(applied.status,JSON.stringify(applied.body)).toBe(200);w=applied.body;expect(w.captions[0].contract.cues[0].startMs).toBe(120);
  const confirm=await f.request('confirmWorkspaceCaptionText',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,expectedInputFingerprint:w.captions[0].inputFingerprint});expect(confirm.status,JSON.stringify(confirm.body)).toBe(200);w=confirm.body;expect(w.captions[0].textConfirmed).toBe(true);
  const queued=await f.request('requestWorkspaceCaptionAlignment',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,localOnly:true});expect(queued.status).toBe(200);w=queued.body.workspace;const oldInput=w.captions[0].inputFingerprint,late=(await port.rpc('claim_next_worker_task',{p_task_id:queued.body.task.id,p_worker_capacity:1}))[0] as Record<string,any>;
  const edited={...contract,text:'修改后的正文',cues:[]};const changed=await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,captionContract:edited});expect(changed.status,JSON.stringify(changed.body)).toBe(200);w=changed.body;expect(w.captions[0].textConfirmed).toBe(false);
  await complete(late);
  const ignored=await f.request('applyWorkspaceCaptionAlignment',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,taskId:late.task_id,expectedInputFingerprint:oldInput});expect(ignored.status,JSON.stringify(ignored.body)).toBe(409);
  const read=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}}),actual=(await read.json()).workspace;expect(actual.captions[0].contract.text).toBe('修改后的正文');expect(actual.captions[0].timing).toBe('missing');expect(actual.captions[0].textConfirmed).toBe(false);
 }finally{await worker.end();await f.close();}
},180_000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('real landscape and portrait Remotion frames contain caption pixels inside the chosen safe area',async()=>{
 const {writeFile,mkdir}=await import('node:fs/promises'),{applyWorkspaceCaptionEdit}=await import('../workspaceCaptions'),{shotCaptionSafeAreaInsets}=await import('../shotCaptions');
 const f=await productionWorkspaceFixture({migrations:['db/local/089-workspace-captions.sql']});
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const contract=defaultShotCaptionContract('一二三四五六七八九十','independent');contract.spatial.maxCharactersPerLine=3;contract.spatial.maxLines=2;contract.cues=[{id:'visible',text:contract.text,startMs:0,endMs:1000}];
  w=(await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,captionContract:contract})).body;
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);expect(opened.body.productionWorkspace.captions[0].contract.spatial.maxCharactersPerLine).toBe(3);
  const native=JSON.parse(await readFile(join(f.assetRoot,opened.body.productionWorkspace.project.relativePath),'utf8'));
  const {spawnSync}=await import('node:child_process');
  const pixels=(bytes:Buffer)=>{const result=spawnSync('ffmpeg',['-v','error','-i','pipe:0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{input:bytes,maxBuffer:8*1024*1024});if(result.status!==0)throw Error(String(result.stderr));return result.stdout;};
  const output=join(process.cwd(),'docs/verification/issue-159-workspace-captions');await mkdir(output,{recursive:true});const results=[];
  for(const aspect of ['9:16','16:9'] as const){
   const project=structuredClone(native),timeline=project.timelines[0];timeline.width=aspect==='9:16'?360:640;timeline.height=aspect==='9:16'?640:360;
   contract.spatial.aspectRatio=aspect;contract.spatial.insets=shotCaptionSafeAreaInsets({...contract.spatial,safeArea:'title-safe'});
   const visible=applyWorkspaceCaptionEdit(project,w.clips[0].itemId,contract),off=structuredClone(visible);Object.values(off.timelines[0].tracks).find(t=>t.kind==='caption')!.captions!.sourceEntries[0].visible=false;
   async function render(doc:typeof visible){const response=await fetch(new URL('/render-still',opened.body.studioUrl),{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(opened.body.studioUrl).origin,'Sec-Fetch-Site':'same-origin'},body:JSON.stringify({project:doc,state:doc.timelines[0],timelineId:doc.activeTimelineId,frames:[15],grid:false})});expect(response.status,await response.clone().text()).toBe(200);const value=await response.json();return Buffer.from(value.frames[0].base64,'base64');}
   const frame=await render(visible),baseline=await render(off),name=aspect==='9:16'?'portrait':'landscape';await writeFile(join(output,`${name}-caption.jpg`),frame);
   const dimensions=JSON.parse(spawnSync('ffprobe',['-v','error','-show_entries','stream=width,height','-of','json','pipe:0'],{input:frame}).stdout.toString()).streams[0];const a={data:pixels(frame),info:dimensions},b={data:pixels(baseline)};let minX=a.info.width,minY=a.info.height,maxX=-1,maxY=-1,count=0;
   for(let y=0;y<a.info.height;y++)for(let x=0;x<a.info.width;x++){const n=(y*a.info.width+x)*3;if(Math.max(...[0,1,2].map(i=>Math.abs(a.data[n+i]-b.data[n+i])))>50){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);count++;}}
   expect(count).toBeGreaterThan(50);const inset=contract.spatial.insets;expect(minX).toBeGreaterThanOrEqual(Math.floor(inset.left*a.info.width)-2);expect(maxX).toBeLessThanOrEqual(Math.ceil((1-inset.right)*a.info.width)+2);expect(minY).toBeGreaterThanOrEqual(Math.floor(inset.top*a.info.height)-2);expect(maxY).toBeLessThanOrEqual(Math.ceil((1-inset.bottom)*a.info.height)+2);results.push({aspect,width:a.info.width,height:a.info.height,changedPixels:count,bounds:{minX,minY,maxX,maxY},insets:inset});
  }
  await writeFile(join(output,'render-pixels.json'),JSON.stringify(results,null,2)+'\n');
 }finally{await f.close();}
},240_000);
