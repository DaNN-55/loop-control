import {inspectMediaRoot} from './mediaRootSettings';
import {ownerTransaction} from './ownerTransaction';
// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {reviewRenderFromSnapshot} from '../worker/history/reviewRenderV1';
import {buildOpenChatCutProject} from '../worker/openchatcutProject';
import {legacyHtmlFixture} from './legacyHtmlWorkspace.fixture';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {editStudioDocument} from './studioDocument.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {storyBrowser} from './storyBrowser.fixture';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function recordedWorkbench(layout:'legacy'|'registered'='legacy',mode:'none'|'source'|'tts'='none',shotCount=1,patterned=false,localAudio=false,storage:Pick<NonNullable<Parameters<typeof productionWorkspaceFixture>[0]>,'databaseName'|'testRootParent'>={}){
 const f=await productionWorkspaceFixture({...storage,runtime:{wake(){},...(localAudio?{mediaReady:async()=>{}}:{})},...(layout==='registered'?{episodeRelativePath:()=> '原工作版本 [D]_%/素材'}:{})});
 try{
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2) ON CONFLICT(singleton) DO NOTHING');
  if(patterned){
   const path=join(f.root,'patterned.mp4');execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=360x640:rate=30:duration=2','-c:v','libx264','-pix_fmt','yuv420p',path]);const bytes=await readFile(path);await writeFile(join(f.assetRoot,f.videoPath),bytes);f.files[0].sha256=hash(bytes);f.files[0].fileSize=bytes.length;
   await f.c.query('UPDATE public.production_material_revisions SET sha256=$2,file_size=$3 WHERE id=$1',[f.material,hash(bytes),bytes.length]);await f.c.query('UPDATE public.artifacts SET sha256=$3,file_size=$4 WHERE episode_id=$1 AND relative_path=$2',[f.episode,f.videoPath,hash(bytes),bytes.length]);
  }
  if(mode==='source'){
   const path=join(f.root,'recorded-source.mp4');execFileSync('ffmpeg',['-nostdin','-v','error','-i',join(f.assetRoot,f.videoPath),'-i',join(f.assetRoot,f.episodeRelativePath,'voice.mp3'),'-c:v','copy','-c:a','aac','-shortest',path]);
   const bytes=await readFile(path);await writeFile(join(f.assetRoot,f.videoPath),bytes);f.files[0].sha256=hash(bytes);f.files[0].fileSize=bytes.length;
   await f.c.query('UPDATE public.production_material_revisions SET sha256=$2,file_size=$3 WHERE id=$1',[f.material,hash(bytes),bytes.length]);await f.c.query('UPDATE public.artifacts SET sha256=$3,file_size=$4 WHERE episode_id=$1 AND relative_path=$2',[f.episode,f.videoPath,hash(bytes),bytes.length]);
  }
  const board=JSON.parse((await readFile(join(f.assetRoot,f.boardPath))).toString());board.shots=board.shots.slice(0,shotCount);
  const bytes=Buffer.from(JSON.stringify(board));await writeFile(join(f.assetRoot,f.boardPath),bytes);
  await f.c.query('UPDATE public.artifacts SET sha256=$2,file_size=$3 WHERE id=(SELECT artifact_id FROM public.review_packages WHERE id=$1)',[f.board,hash(bytes),bytes.length]);
  await f.c.query('UPDATE public.review_packages SET context_snapshot=$2 WHERE id=$1',[f.board,{worker_result:{storyboard:board}}]);
  await f.c.query("INSERT INTO public.approvals(episode_id,stage,decision,reason,actor_id,review_package_id) VALUES($1,'storyboard_approved','approved','Recorded workbench evidence',$2,$3)",[f.episode,f.owner,f.board]);
  await f.c.query("UPDATE public.shot_preparation_drafts SET audio_mode='none',subtitle_text='原字幕草稿',subtitles_enabled=false,selected_material_revision_id=$3,clip_start_seconds=0,clip_end_seconds=2,clip_segments='[{\"start_seconds\":0,\"end_seconds\":2}]',video_status='ready',video_duration_seconds=2,current_video_task_id=$4,current_video_artifact_id=(SELECT id FROM public.artifacts WHERE episode_id=$1 AND relative_path=$5 LIMIT 1) WHERE episode_id=$1 AND review_package_id=$2",[f.episode,f.board,f.material,f.task,f.videoPath]);
  let voice:{taskId:string;trackId:string}|null=null;
  if(mode!=='none'){
   const track=randomUUID(),task=randomUUID(),artifact=randomUUID(),draft=(await f.c.query("SELECT id FROM public.shot_preparation_drafts WHERE episode_id=$1 AND shot_id='shot-1'",[f.episode])).rows[0].id;
   await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,$3,'completed',$4)",[task,f.episode,mode==='source'?'extract_embedded_audio':'generate_narration',{shot_preparation:{draft_id:draft},media:{narration:{text:'原口播确认正文'}}}]);
   await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,$4,$5,$6,$7)",[artifact,f.episode,task,mode==='source'?'source_audio':'narration_audio',f.episodeRelativePath+'/voice.mp3',f.files[1].sha256,f.files[1].fileSize]);
   await f.c.query("INSERT INTO public.audio_tracks(id,episode_id,source_task_id,source_artifact_id,source_review_package_id,track_kind,cue_id,relative_path,sha256,file_size,duration_seconds) VALUES($1,$2,$3,$4,$5,$6,'shot-1',$7,$8,$9,2)",[track,f.episode,task,artifact,f.board,mode==='source'?'source':'narration',f.episodeRelativePath+'/voice.mp3',f.files[1].sha256,f.files[1].fileSize]);
   await f.c.query("UPDATE public.shot_preparation_drafts SET audio_mode=$3,current_audio_track_id=$2,tts_text=CASE WHEN $3='tts' THEN '原口播确认正文' ELSE NULL END,tts_voice=CASE WHEN $3='tts' THEN 'recorded-voice' ELSE NULL END,tts_speaking_rate=CASE WHEN $3='tts' THEN 1 ELSE NULL END WHERE id=$1",[draft,track,mode]);
   voice={taskId:task,trackId:track};
  }
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='confirmed',confirmed_at=now(),confirmed_by=$3,current_preview_task_id=$4,current_preview_input_fingerprint=preparation_input_fingerprint WHERE episode_id=$1 AND review_package_id=$2",[f.episode,f.board,f.owner,f.task]);
  // The original task carries the exact recorded confirmation; no SDK/HTML project exists.
  const d=(await f.c.query("SELECT * FROM public.shot_preparation_drafts WHERE episode_id=$1 AND review_package_id=$2 AND shot_id='shot-1'",[f.episode,f.board])).rows[0];
  const snapshot=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[f.task])).rows[0].input_snapshot;
  snapshot.input_artifacts=f.files;snapshot.review_render.storyboard=board;snapshot.review_render.confirmed_shots=[{shot_id:d.shot_id,confirmation_status:'confirmed',input_fingerprint:d.preparation_input_fingerprint,source_material_revision_id:f.material,clip_segments:d.clip_segments,composition:d.composition,preparation_contract:d.preparation_contract,audio_mode:mode,audio_track_id:mode==='tts'?voice!.trackId:null,subtitle_text:d.subtitle_text,subtitles_enabled:false}];
  snapshot.review_render.members=[{member_key:'shot:'+d.shot_id,member_kind:'shot_media',source_material_revision_id:f.material,relative_path:f.videoPath,sha256:f.files[0].sha256,start_seconds:0,duration_seconds:2,clip_segments:d.clip_segments,composition:d.composition,preparation_contract:d.preparation_contract,input_fingerprint:d.preparation_input_fingerprint,audio_mode:mode,subtitle_text:d.subtitle_text,subtitles_enabled:false}];
  if(mode==='tts')snapshot.review_render.members.push({member_key:'narration:shot-1',member_kind:'narration',task_id:voice!.taskId,audio_track_id:voice!.trackId,audio_mode:'tts',relative_path:f.episodeRelativePath+'/voice.mp3',sha256:f.files[1].sha256,start_seconds:0,duration_seconds:2});
  await f.c.query('UPDATE public.tasks SET input_snapshot=$2 WHERE id=$1',[f.task,snapshot]);
  await f.c.query('DELETE FROM local_identity.input_episodes WHERE episode_id=$1',[f.episode]);
  const get=async(token=f.token)=>{const r=await fetch(`${f.origin}/api/local/episodes/${f.episode}/legacy-workbench`,{headers:{Cookie:'loop_owner_session='+token}});return{status:r.status,body:await r.json()};};
  return{...f,get,draft:d};
 }catch(e){await f.close();throw e;}
}
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('imports an unfinished original-voice selection as current unconfirmed input with its exact track and window, preserving the original through restart',async()=>{
 const f=await recordedWorkbench('legacy','source');try{
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending',script_narration_gain_db=-9 WHERE id=$1",[f.draft.id]);
  const original=(await f.c.query('SELECT * FROM public.shot_preparation_drafts WHERE id=$1',[f.draft.id])).rows[0],source=await f.get();
  const r=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(r.status,JSON.stringify(r.body)).toBe(200);const w=r.body;
  expect(w.clips[0].voiceInput).toMatchObject({version:'workspace-voice-input/v1',mode:'source',visual:{materialRevisionId:f.material,sha256:f.files[0].sha256},audioTrack:{id:original.current_audio_track_id,sha256:f.files[1].sha256},visualDraft:{segments:[{startSeconds:0,endSeconds:2}]}});
  expect(w.clips[0].renderPreferences.voiceGainDb).toBe(-9);expect(w.audio.mix.voices[0].mode).toBe('none');expect(w.narration[0].confirmed).toBe(false);expect(w.audio.preparations).toHaveLength(0);
  await f.restart();const read=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(read.status).toBe(200);expect((await read.json()).workspace.clips[0].voiceInput).toEqual(w.clips[0].voiceInput);
  expect((await f.c.query('SELECT * FROM public.shot_preparation_drafts WHERE id=$1',[f.draft.id])).rows[0]).toEqual(original);
 }finally{await f.close();}
},120000);
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['original','track-owner','artifact-owner','task-owner','file-sha','artifact-reference','current-record'] as const)('projects a recorded original-voice preparation only with its exact original source Owner, preserving current editing and archived evidence (%s)',async(kind)=>{
 const f=await recordedWorkbench('legacy','source');try{
  const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=runtimeContext();expect(context.dailyRuntime).toBe(false);expect(context.isolatedFixtureContainer===true||context.isolatedFixtureNative===true&&!!context.nativeConnection).toBe(true);
  const {projectHistory}=await import(join(process.cwd(),'scripts/runtime/project-history.mjs'));
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending' WHERE id=$1",[f.draft.id]);
  const original=(await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE id=$1',[f.draft.id])).rows[0].value,source=await f.get();
  let result=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(result.status,JSON.stringify(result.body)).toBe(200);let w=result.body;
  const candidate=w.visualCandidates[0],decision=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'keep-target'});expect(decision.status,JSON.stringify(decision.body)).toBe(200);
  result=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:decision.body.adoptionId});expect(result.status,JSON.stringify(result.body)).toBe(200);w=result.body;
  const input=w.clips[0].voiceInput;result=await f.request('adoptWorkspaceRecordedVoice',{workspaceId:w.id,expectedRevision:w.revision,shotId:'shot-1',audioTrackId:input.audioTrack.id,expectedSha256:input.audioTrack.sha256});expect(result.status,JSON.stringify(result.body)).toBe(200);w=result.body;
  const preparation=(await f.c.query('SELECT to_jsonb(p) value FROM local_identity.workspace_audio_preparations p WHERE workspace_id=$1',[w.id])).rows[0].value;
  expect(preparation.request_snapshot).toMatchObject({version:'registered-audio-input/v1',audioTrackId:original.current_audio_track_id,purpose:'recorded-primary-voice/v1'});
  const parents:Array<{table:string;id:string;payload:Record<string,unknown>}>=[];
  for(const [table,id]of [['public.audio_tracks',preparation.request_snapshot.audioTrackId],['public.artifacts',preparation.request_snapshot.sourceArtifactId],['public.tasks',preparation.request_snapshot.sourceTaskId]]){
   const payload=(await f.c.query(`SELECT to_jsonb(t) value FROM ${table} t WHERE id=$1`,[id])).rows[0].value;parents.push({table,id,payload});
   const foreign=(kind==='track-owner'||kind==='current-record')&&table==='public.audio_tracks'||kind==='artifact-owner'&&table==='public.artifacts'||kind==='task-owner'&&table==='public.tasks';
   await f.c.query('INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload) VALUES($1,$2,$3,$4,$5)',[table,{id},hash(Buffer.from(JSON.stringify(payload))),foreign?f.other:f.owner,payload]);
  }
  if(kind==='file-sha')preparation.request_snapshot.sha256='0'.repeat(64);
  if(kind==='artifact-reference')preparation.request_snapshot.sourceArtifactId=randomUUID();
  await f.c.query('INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload) VALUES($1,$2,$3,$4,$5)',['local_identity.workspace_audio_preparations',{id:preparation.id},hash(Buffer.from(JSON.stringify(preparation))),f.owner,preparation]);
  const archive=async()=>(await f.c.query('SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY table_name,row_key::text)::text) value FROM local_identity.history_versions h')).rows[0].value,before=await archive(),project=await readFile(join(f.assetRoot,w.project.relativePath));
  if(kind!=='current-record')await f.c.query('DELETE FROM local_identity.workspace_audio_preparations WHERE id=$1',[preparation.id]);
  const projectHistoryOnce=()=>projectHistory({sql:(sql:string)=>context.sql(sql,f.database)});projectHistoryOnce();
  const restored=(await f.c.query('SELECT to_jsonb(p) value FROM local_identity.workspace_audio_preparations p WHERE id=$1',[preparation.id])).rows.map(r=>r.value);
  const preserved=kind==='original'||kind==='current-record';expect(restored,kind).toEqual(preserved?[preparation]:[]);
  const status=(await f.c.query("SELECT status FROM local_identity.history_projection_results WHERE table_name='local_identity.workspace_audio_preparations' AND row_key=$1",[{id:preparation.id}])).rows[0].status;
  expect(status).toBe(kind==='original'?'inserted':kind==='current-record'?'current-preserved':['file-sha','artifact-reference'].includes(kind)?'history-only:registered-audio-source':'history-only:source-owner');
  const response=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const current=(await response.json()).workspace;expect(current.project.sha256).toBe(w.project.sha256);expect(current.audio.mix).toEqual(w.audio.mix);
  if(preserved)expect(current.audio.preparations.find((p:any)=>p.id===preparation.id)).toMatchObject({status:'ready',audioTrackId:original.current_audio_track_id,sha256:input.audioTrack.sha256});
  else expect(current.audio.preparations.find((p:any)=>p.id===preparation.id)).toBeUndefined();
  expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(project);expect((await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE id=$1',[f.draft.id])).rows[0].value).toEqual(original);
  for(const parent of parents)expect((await f.c.query(`SELECT to_jsonb(t) value FROM ${parent.table} t WHERE id=$1`,[parent.id])).rows[0].value).toEqual(parent.payload);
  projectHistoryOnce();expect(await archive()).toBe(before);expect((await f.c.query('SELECT to_jsonb(p) value FROM local_identity.workspace_audio_preparations p WHERE id=$1',[preparation.id])).rows.map(r=>r.value)).toEqual(restored);
 }finally{await f.close();}
},120000);
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['pending-source','confirmed-source','mixed-source','html-source','json-source'] as const)('restores an explicitly adopted source workbench into a new database and file root, retaining original evidence and current voice edits with the old root offline (%s)',async(kind)=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{randomBytes}=await import('node:crypto'),{nativeStorageContext}=await import('./nativeStorage.fixture'),{restoreCreatedEpisode}=await import('./episodeCreationRestore.fixture'),{csrfFor}=await import('./sessions');
 const storage=await mkdtemp('/private/tmp/loop-d-source-restore-');await mkdir(join(storage,'state'));const source='loop_t24_restore_'+randomBytes(6).toString('hex'),target='loop_t24_restore_'+randomBytes(6).toString('hex'),{runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!),context=nativeStorageContext(runtimeContext(),storage,source,target);
 const f=await recordedWorkbench('legacy','source',kind==='mixed-source'?2:1,false,false,{databaseName:source,testRootParent:join(storage,'state')});try{
  if(kind==='pending-source')await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending' WHERE id=$1",[f.draft.id]);if(kind==='mixed-source')await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending' WHERE episode_id=$1 AND shot_id='shot-2'",[f.episode]);const original=await f.get();
  let sourceArtifact:{id:string;filename:string;bytes:Buffer}|null=null;
  if(kind==='html-source'||kind==='json-source'){const snapshot=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[f.task])).rows[0].input_snapshot,render=reviewRenderFromSnapshot(snapshot)!,originalProject=kind==='json-source'?buildOpenChatCutProject(render,'retained-'+f.episode):null;if(originalProject){Object.assign(originalProject.timelines[0].items.find(i=>i.kind==='video')!.transform as object,{x:7});Object.assign(originalProject.timelines[0].items.find(i=>i.id==='main-source-shot-1')!,{volume:10**(-11/20),startFrame:2,durationInFrames:48,srcInFrame:3});}const bytes=Buffer.from(kind==='html-source'?legacyHtmlFixture(render).html:JSON.stringify(originalProject)),filename='original-source.'+(kind==='html-source'?'html':'json'),path=f.episodeRelativePath+'/'+filename,id=randomUUID();await writeFile(join(f.assetRoot,path),bytes);await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'review_render_project',$4,$5,$6)",[id,f.episode,f.task,path,hash(bytes),bytes.length]);sourceArtifact={id,filename,bytes};}
  const imported=await f.request(kind==='pending-source'||kind==='mixed-source'?'importLegacyDraftInputs':'adoptLegacyWorkspace',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,...(sourceArtifact?{artifactId:sourceArtifact.id,expectedSourceSha256:hash(sourceArtifact.bytes)}:{workbenchSha256:original.body.sha256})});expect(imported.status,JSON.stringify(imported.body)).toBe(200);let w=imported.body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.productionWorkspace)w=r.body.productionWorkspace;else if(r.body.id===w.id)w=r.body;return r.body;};
  for(const candidate of w.visualCandidates.filter((c:any)=>c.status==='available')){const prepared=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target'});await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:prepared.adoptionId});}const voiceInput=w.clips[0].voiceInput;if(voiceInput)await send('adoptWorkspaceRecordedVoice',{shotId:'shot-1',audioTrackId:voiceInput.audioTrack.id,expectedSha256:voiceInput.audioTrack.sha256});expect(w.audio.mix.voices.find((v:any)=>v.shotId==='shot-1')).toMatchObject({mode:'source'});if(kind==='json-source')expect(w.audio.mix.voices[0]).toMatchObject({gainDb:-11,coverage:'partial'});const sourceAssetId=w.audio.mix.voices.find((v:any)=>v.shotId==='shot-1').sourceAssetId;
  for(const clip of w.clips)await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract('原字幕草稿','independent',false)});
  const opened=await send('openWorkspaceStudio');await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{const voice=doc.timelines[0].items.find((i:any)=>i.id==='workspace-source-shot-shot-1');voice.volume=10**(-13/20);voice.startFrame=2;voice.durationInFrames=48;voice.srcInFrame=3;});await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256});await send('closeWorkspaceStudio');
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  const post=async(command:string,data:Record<string,unknown>={})=>{const r=await fetch(f.origin+'/api/local/account-commands',{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:f.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data:{accountId:account,...data}})});const body=await r.json();expect(r.status,command+JSON.stringify(body)).toBe(200);return body;};
  const plan=await post('planLegacyStorageAdoption');expect(plan.conflicts).toEqual([]);await post('executeAssetDirectoryMigration',{migrationId:plan.id});
  const current=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(current.status).toBe(200);w=(await current.json()).workspace;
  const snapshots=new Map<string,string>();for(const table of ['public.shot_preparation_drafts','public.audio_tracks','public.tasks','public.artifacts','local_identity.workspace_audio_preparations'])snapshots.set(table,context.sql(`SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM ${table} t WHERE episode_id='${f.episode}'`,source));
  const evidence=join(process.env.LOOP_STORY_EVIDENCE!,'source-workbench-restore');await mkdir(evidence,{recursive:true});
  await restoreCreatedEpisode({f,context,storage,source,target,episode:f.episode,accountId:account,prefix:plan.episodes[0].targetPrefix,w,evidence,volumeMount:'/',phase:kind,expectedTransformX:kind==='json-source'?7:0,verifyRestored:async({workspace,project,query,root,sourceOffline}:any)=>{
   expect(sourceOffline).toBe(true);expect(workspace.clips[0].voiceInput).toEqual(voiceInput);expect(workspace.audio.mix.voices[0]).toMatchObject({mode:'source',gainDb:-13,sourceAssetId,coverage:'partial'});if(voiceInput)expect(workspace.audio.preparations.find((p:any)=>p.source?.provider==='registered')).toMatchObject({audioTrackId:voiceInput.audioTrack.id,sha256:voiceInput.audioTrack.sha256,status:'ready'});else expect(workspace.audio.preparations.filter((p:any)=>p.source?.provider==='registered')).toHaveLength(0);
   expect(project.timelines[0].items.find((i:any)=>i.id==='workspace-source-shot-shot-1')).toMatchObject({volume:10**(-13/20),startFrame:2,durationInFrames:48,srcInFrame:3});if(sourceArtifact)expect(await readFile(join(root,plan.episodes[0].targetPrefix,sourceArtifact.filename))).toEqual(sourceArtifact.bytes);for(const[table,before]of snapshots)expect(query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM ${table} t WHERE episode_id='${f.episode}'`),table).toBe(before);
  }});
 }finally{await f.close();await rm(storage,{recursive:true,force:true});}
},300000);
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['fingerprint','missing-contract'] as const)('rejects legacy preview JSON with %s evidence without changing the original file or creating a current workspace',async(fault)=>{
 const f=await recordedWorkbench('legacy','source');try{
  const snapshot=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[f.task])).rows[0].input_snapshot,project=buildOpenChatCutProject(reviewRenderFromSnapshot(snapshot)!,'original-'+f.episode);
  if(fault==='fingerprint')project.loopControl!.inputFingerprint='0'.repeat(64);else{delete snapshot.review_render.confirmed_shots;await f.c.query('UPDATE public.tasks SET input_snapshot=$2 WHERE id=$1',[f.task,snapshot]);}
  const bytes=Buffer.from(JSON.stringify(project)),path=f.episodeRelativePath+'/unverifiable-preview.json',id=randomUUID();await writeFile(join(f.assetRoot,path),bytes);await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'review_render_project',$4,$5,$6)",[id,f.episode,f.task,path,hash(bytes),bytes.length]);
  const before=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[f.episode])).rows,denied=await f.request('adoptLegacyWorkspace',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,artifactId:id,expectedSourceSha256:hash(bytes)});expect(denied.status,JSON.stringify(denied.body)).toBe(409);expect(await readFile(join(f.assetRoot,path))).toEqual(bytes);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_workspaces WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(0);expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[f.episode])).rows).toEqual(before);
 }finally{await f.close();}
},120000);
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('refuses authority fields inserted into current original-voice input through a real native save, keeping the current project and original draft',async()=>{
 const f=await recordedWorkbench('legacy','source');try{
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending' WHERE id=$1",[f.draft.id]);const original=(await f.c.query('SELECT * FROM public.shot_preparation_drafts WHERE id=$1',[f.draft.id])).rows[0],source=await f.get();
  const imported=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(imported.status).toBe(200);let w=imported.body;
  const candidate=w.visualCandidates[0],prepared=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'keep-target'});expect(prepared.status).toBe(200);const adopted=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:prepared.body.adoptionId});expect(adopted.status).toBe(200);w=adopted.body;
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status).toBe(200);w=opened.body.productionWorkspace;const before=await readFile(join(f.assetRoot,w.project.relativePath));
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{doc.timelines[0].items.find((i:any)=>i.id===w.clips[0].itemId).loopControlShot.voiceInput.execution={execution_path:'external',authorizationHash:'forged'};});
  const denied=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(denied.status,JSON.stringify(denied.body)).toBe(409);expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(before);expect((await f.c.query('SELECT * FROM public.shot_preparation_drafts WHERE id=$1',[f.draft.id])).rows[0]).toEqual(original);
 }finally{await f.close();}
},120000);
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('explicitly adopts the recorded original voice without extracting or generating, then preserves native mix edits and the original across replay and export',async()=>{
 const f=await recordedWorkbench('legacy','source');let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending',script_narration_gain_db=-9 WHERE id=$1",[f.draft.id]);
  const original=(await f.c.query('SELECT * FROM public.shot_preparation_drafts WHERE id=$1',[f.draft.id])).rows[0],source=await f.get();
  const imported=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(imported.status,JSON.stringify(imported.body)).toBe(200);let w=imported.body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const candidate=w.visualCandidates[0],choice=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target'});await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:choice.adoptionId});
  const tasks=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[f.episode])).rows;
  const input=w.clips[0].voiceInput;
  if(process.env.LOOP_STORY_E2E==='1'&&process.env.LOOP_STORY_EVIDENCE){
   browser=await storyBrowser(f,'recorded-source-voice','四步制作 T02 验收');await browser.cli('open',browser.url+'&step=preparation');await browser.wait("!!document.querySelector('#preparation-tab-voice')");await browser.cli('find','role','tab','click','--name','字幕与口播','--exact');
   await browser.cli('wait','--text','原登记原声 · 尚未设为主声');expect(browser.traffic.filter(t=>t.command==='adoptWorkspaceRecordedVoice')).toHaveLength(0);
   await browser.doubleClick('采用原登记原声');await browser.cli('wait','--text','原登记原声 · 当前已设为主声');expect(browser.traffic.filter(t=>t.command==='adoptWorkspaceRecordedVoice')).toHaveLength(1);
   await browser.evaluate("document.querySelector('.workspace-source-voice').scrollIntoView({block:'start'})");await browser.capture('desktop');await browser.cli('set','viewport','390','844');await browser.evaluate("document.querySelector('.workspace-source-voice').scrollIntoView({block:'start'})");expect(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth')).toBe(true);await browser.capture('narrow');
   await browser.close();browser=undefined;const response=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);w=(await response.json()).workspace;
  }else await send('adoptWorkspaceRecordedVoice',{shotId:'shot-1',audioTrackId:input.audioTrack.id,expectedSha256:input.audioTrack.sha256});
  expect(w.audio.mix.voices[0]).toMatchObject({mode:'source',gainDb:-9,sourceAssetId:'audio-track-'+original.current_audio_track_id});
  const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{const voice=doc.timelines[0].items.find((i:any)=>i.id==='workspace-source-shot-shot-1');voice.volume=10**(-14/20);voice.srcInFrame=2;voice.startFrame=3;voice.durationInFrames=48;});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256})).productionWorkspace;await send('closeWorkspaceStudio');
  const before=await readFile(join(f.assetRoot,w.project.relativePath)),sha=w.project.sha256;await send('adoptWorkspaceRecordedVoice',{shotId:'shot-1',audioTrackId:input.audioTrack.id,expectedSha256:input.audioTrack.sha256});expect(w.project.sha256).toBe(sha);expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(before);
  await send('setWorkspaceNarrationEnabled',{clipId:w.clips[0].id,enabled:false,voiceMode:'source'});expect(w.audio.mix.voices[0].mode).toBe('none');
  await send('adoptWorkspaceRecordedVoice',{shotId:'shot-1',audioTrackId:input.audioTrack.id,expectedSha256:input.audioTrack.sha256});expect(w.audio.mix.voices[0]).toMatchObject({mode:'source',gainDb:-14,coverage:'partial'});
  await f.restart();const read=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});w=(await read.json()).workspace;expect(w.audio.mix.voices[0]).toMatchObject({mode:'source',gainDb:-14,coverage:'partial'});
  await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');
  expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[f.episode])).rows).toEqual(tasks);expect((await f.c.query('SELECT * FROM public.shot_preparation_drafts WHERE id=$1',[f.draft.id])).rows[0]).toEqual(original);
 }finally{await browser?.close();await f.close();}
},180000);
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('replaces an explicitly selected current manual voice with the recorded source while retaining mix edits and dropping the prior candidate identity',async()=>{
 const f=await recordedWorkbench('legacy','source');try{
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending' WHERE id=$1",[f.draft.id]);const source=await f.get();const imported=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(imported.status).toBe(200);let w=imported.body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const v=w.visualCandidates[0],p=await send('prepareWorkspaceVisualCandidate',{candidateId:v.id,durationPolicy:'keep-target'});await send('adoptWorkspaceVisualCandidate',{candidateId:v.id,adoptionId:p.adoptionId});
  const manualPath=join(f.root,'different-manual.mp3');execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=220:sample_rate=48000','-t','2','-c:a','libmp3lame',manualPath]);
  const material=await f.request('importMaterial',{sourceKind:'file',sourcePath:'current-manual.mp3',materialType:'audio',materialPurpose:'general_reference',mimeType:'audio/mpeg',isMainScript:false,contentBase64:(await readFile(manualPath)).toString('base64')});expect(material.status).toBe(200);
  await send('saveWorkspaceNarration',{clipId:w.clips[0].id,mode:'manual',text:'当前人工选择',materialRevisionId:material.body.id});await send('confirmWorkspaceNarration',{clipId:w.clips[0].id});const voice=w.narration[0].audioTrackId,choice=await send('prepareWorkspaceCandidate',{candidateId:voice,durationPolicy:'keep-target'});await send('adoptWorkspaceCandidate',{candidateId:voice,adoptionId:choice.adoptionId});
  const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{const voice=doc.timelines[0].items.find((i:any)=>i.id==='workspace-narration-shot-shot-1');voice.volume=10**(-17/20);voice.startFrame=3;voice.durationInFrames=48;voice.srcInFrame=2;});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256})).productionWorkspace;await send('closeWorkspaceStudio');
  const manual=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')).timelines[0].items.find((i:any)=>i.id==='workspace-narration-shot-shot-1');expect(manual.loopControlCandidate).toBeTruthy();
  const input=w.clips[0].voiceInput;await send('adoptWorkspaceRecordedVoice',{shotId:'shot-1',audioTrackId:input.audioTrack.id,expectedSha256:input.audioTrack.sha256});
  const actual=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')).timelines[0].items.find((i:any)=>i.id==='workspace-source-shot-shot-1');expect(actual).toMatchObject({volume:10**(-17/20),startFrame:3,durationInFrames:48,srcInFrame:2,sourceAssetId:'audio-track-'+input.audioTrack.id,sourceContentHash:input.audioTrack.sha256});expect(actual.loopControlCandidate).toBeUndefined();expect(actual.sourceRevision).not.toBe(manual.sourceRevision);
 }finally{await f.close();}
},180000);
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['valid','missing-receipt','changed-receipt','invalid-source','changed-selected-receipt','re-established-receipt','asset-conflict'] as const)('replaces a recorded source file with an explicitly extracted current voice while retaining native timing, gain and routing (%s)',async(proof)=>{
 const f=await recordedWorkbench('legacy','source',1,false,true),worker=f.workerPool();let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;try{
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending' WHERE id=$1",[f.draft.id]);const original=(await f.c.query('SELECT * FROM public.shot_preparation_drafts WHERE id=$1',[f.draft.id])).rows[0],source=await f.get();
  const imported=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(imported.status).toBe(200);let w=imported.body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const candidate=w.visualCandidates[0],choice=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target'});await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:choice.adoptionId});const input=w.clips[0].voiceInput;await send('adoptWorkspaceRecordedVoice',{shotId:'shot-1',audioTrackId:input.audioTrack.id,expectedSha256:input.audioTrack.sha256});
  const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{const t=doc.timelines[0],voice=t.items.find((i:any)=>i.id==='workspace-source-shot-shot-1');voice.volume=10**(-15/20);voice.startFrame=6;voice.durationInFrames=48;voice.srcInFrame=4;t.tracks['recorded-route']={...t.tracks[voice.track],name:'人工主声',role:'anchor',audioRouting:{duckDepthDb:-7}};t.trackOrder.push('recorded-route');voice.track='recorded-route';if(proof==='asset-conflict')doc.assets.find((a:any)=>a.id===voice.sourceAssetId).src=t.items.find((i:any)=>i.id===w.clips[0].itemId).src;});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256})).productionWorkspace;await send('closeWorkspaceStudio');
  if(proof==='asset-conflict'){const before=await readFile(join(f.assetRoot,w.project.relativePath)),denied=await f.request('adoptWorkspaceRecordedVoice',{workspaceId:w.id,expectedRevision:w.revision,shotId:'shot-1',audioTrackId:input.audioTrack.id,expectedSha256:input.audioTrack.sha256});expect(denied.status).toBe(409);expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(before);return;}
  if(proof==='re-established-receipt'){await f.c.query("DELETE FROM local_identity.workspace_audio_preparations WHERE workspace_id=$1 AND request_snapshot->>'purpose'='recorded-primary-voice/v1'",[w.id]);const before=await readFile(join(f.assetRoot,w.project.relativePath));await send('adoptWorkspaceRecordedVoice',{shotId:'shot-1',audioTrackId:input.audioTrack.id,expectedSha256:input.audioTrack.sha256});expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(before);}
  const readCurrent=async()=>{const response=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);w=(await response.json()).workspace;};
  if(proof==='valid'&&process.env.LOOP_STORY_E2E==='1'&&process.env.LOOP_STORY_EVIDENCE){
   browser=await storyBrowser(f,'recorded-source-replacement','四步制作 T02 验收');await browser.cli('open',browser.url+'&step=preparation');await browser.wait("!!document.querySelector('#preparation-tab-voice')");await browser.cli('find','role','tab','click','--name','字幕与口播','--exact');await browser.doubleClick('准备当前原片原声');await expect.poll(()=>browser!.traffic.filter(t=>t.command==='prepareWorkspaceAudio'&&t.status===200).length).toBe(1);await readCurrent();
  }else await send('prepareWorkspaceAudio',{kind:'source',shotId:'shot-1',sourceItemId:w.clips[0].itemId});
  const prep=w.audio.preparations[0],task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:prep.taskId,p_worker_capacity:2})as any[])[0];expect(task.task_id).toBe(prep.taskId);const done=await runWorkspaceDeliveryProcess(f,task,{media:{mode:'local'},mountPath:(await inspectMediaRoot(f.root)).mountPath});expect(done.status,JSON.stringify({done,task:(await f.c.query('SELECT input_snapshot,last_result FROM public.tasks WHERE id=$1',[prep.taskId])).rows[0]})).toBe('completed');
  await readCurrent();const completed=w.audio.preparations.find((p:any)=>p.id===prep.id);expect(completed.generationTask.invalidated,JSON.stringify({completed,clips:w.clips,task:(await f.c.query('SELECT invalidated_at,invalidated_reason,input_snapshot FROM public.tasks WHERE id=$1',[prep.taskId])).rows[0],items:JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')).timelines[0].items})).toBe(false);
  if(proof!=='valid'&&proof!=='re-established-receipt'){
   // Native provenance hints still exist: incomplete or invalid registered proof
   // must not make those editable hints authoritative.
   if(proof==='missing-receipt')await f.c.query("DELETE FROM local_identity.workspace_audio_preparations WHERE workspace_id=$1 AND request_snapshot->>'purpose'='recorded-primary-voice/v1'",[w.id]);
   if(proof==='changed-receipt')await f.c.query("UPDATE local_identity.workspace_audio_preparations SET request_snapshot=jsonb_set(request_snapshot,'{sha256}',to_jsonb(repeat('0',64))) WHERE workspace_id=$1 AND request_snapshot->>'purpose'='recorded-primary-voice/v1'",[w.id]);
   if(proof==='changed-selected-receipt')await f.c.query("UPDATE local_identity.workspace_audio_preparations SET request_snapshot=jsonb_set(request_snapshot,'{fileSize}','0'::jsonb) WHERE workspace_id=$1 AND request_snapshot->>'purpose'='recorded-primary-voice/v1'",[w.id]);
   if(proof==='invalid-source')await f.c.query("UPDATE public.tasks SET invalidated_at=clock_timestamp(),invalidated_reason='Original source invalidated after adoption' WHERE id=(SELECT source_task_id FROM public.audio_tracks WHERE id=$1)",[input.audioTrack.id]);
   const before=await readFile(join(f.assetRoot,w.project.relativePath)),denied=await f.request('adoptWorkspaceAudio',{workspaceId:w.id,expectedRevision:w.revision,preparationId:proof==='changed-selected-receipt'?w.audio.preparations.find((p:any)=>p.source?.provider==='registered').id:prep.id});expect(denied.status,JSON.stringify(denied.body)).toBe(409);expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(before);
  }else{
   if(browser){await browser.click('采用原片原声 '+prep.description);await expect.poll(()=>browser!.traffic.filter(t=>t.command==='adoptWorkspaceAudio'&&t.status===200).length).toBe(1);await readCurrent();await browser.evaluate("document.querySelector('.workspace-source-voice').scrollIntoView({block:'start'})");await browser.capture('desktop');await browser.cli('set','viewport','390','844');await browser.evaluate("document.querySelector('.workspace-source-voice').scrollIntoView({block:'start'})");expect(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth')).toBe(true);await browser.capture('narrow');}
   else await send('adoptWorkspaceAudio',{preparationId:prep.id});
   const actual=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')).timelines[0],voice=actual.items.find((i:any)=>i.id==='workspace-source-shot-shot-1');expect(voice).toMatchObject({volume:10**(-15/20),startFrame:6,durationInFrames:48,srcInFrame:4,track:'recorded-route'});expect(actual.tracks['recorded-route'].audioRouting).toEqual({duckDepthDb:-7});
  }
  expect((await f.c.query('SELECT * FROM public.shot_preparation_drafts WHERE id=$1',[f.draft.id])).rows[0]).toEqual(original);
 }catch(error){await browser?.capture('failed');throw error;}
 finally{await browser?.close();await worker.end();await f.close();}
},180000);
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['foreign-owner','sha','track','source-task','file-sha','missing-file','range','unadopted'] as const)('rejects %s recorded original voice without changing current editing, source records or requests',async(fault)=>{
 const f=await recordedWorkbench('legacy','source');const path=join(f.assetRoot,f.episodeRelativePath,'voice.mp3'),bytes=await readFile(path);let missing=false;
 try{
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending' WHERE id=$1",[f.draft.id]);const source=await f.get();
  const imported=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(imported.status).toBe(200);let w=imported.body;
  if(fault!=='unadopted'){
   const candidate=w.visualCandidates[0],p=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'keep-target'});expect(p.status).toBe(200);
   const adopted=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:p.body.adoptionId});expect(adopted.status).toBe(200);w=adopted.body;
  }
  if(fault==='range'){const changed=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'range',itemId:w.clips[0].itemId,edge:'in',deltaFrames:1}});expect(changed.status,JSON.stringify(changed.body)).toBe(200);w=changed.body;}
  if(fault==='source-task')await f.c.query("UPDATE public.tasks SET invalidated_at=clock_timestamp(),invalidated_reason='Original source invalidated for acceptance' WHERE id=(SELECT source_task_id FROM public.audio_tracks WHERE id=$1)",[f.draft.current_audio_track_id]);
  if(fault==='file-sha'){const altered=Buffer.from(bytes);altered[altered.length-1]^=1;await writeFile(path,altered);}
  if(fault==='missing-file'){const {rename}=await import('node:fs/promises');await rename(path,path+'.offline');missing=true;}
  const before=await readFile(join(f.assetRoot,w.project.relativePath)),drafts=(await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE episode_id=$1 ORDER BY id',[f.episode])).rows,tasks=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[f.episode])).rows;
  const r=await f.request('adoptWorkspaceRecordedVoice',{workspaceId:w.id,expectedRevision:w.revision,shotId:'shot-1',audioTrackId:fault==='track'?randomUUID():f.draft.current_audio_track_id,expectedSha256:fault==='sha'?'0'.repeat(64):f.files[1].sha256},fault==='foreign-owner'?{token:f.otherToken}:{});expect(r.status,JSON.stringify(r.body)).toBe(fault==='foreign-owner'?404:409);
  expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(before);expect((await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE episode_id=$1 ORDER BY id',[f.episode])).rows).toEqual(drafts);expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[f.episode])).rows).toEqual(tasks);
 }finally{if(missing){const {rename}=await import('node:fs/promises');await rename(path+'.offline',path);}await writeFile(path,bytes);await f.close();}
},120000);
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['confirmed','pending','mixed'] as const)('offers the recorded %s workbench as an explicit source without preparing or changing original confirmation',async(mode)=>{
 const f=await recordedWorkbench('legacy','none',mode==='mixed'?2:1);
 try{
  if(mode!=='confirmed')await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending' WHERE episode_id=$1 AND ($2='pending' OR shot_id='shot-2')",[f.episode,mode]);
  const before=(await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE episode_id=$1 ORDER BY id',[f.episode])).rows,source=await f.get();expect(source.status).toBe(200);
  const response=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({workspace:null,sourceOptions:{version:'workspace-source-options/v1',scriptRevisionId:f.script,options:[{source:{kind:'shot-workbench',reviewPackageId:f.board,workbenchSha256:source.body.sha256,mode:mode==='confirmed'?'confirmed':'inputs'}}]}});
  expect((await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE episode_id=$1 ORDER BY id',[f.episode])).rows).toEqual(before);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_workspaces WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(0);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_STORY_E2E!=='1'||!process.env.LOOP_TEST_CONTEXT_MODULE||!process.env.LOOP_STORY_EVIDENCE)('browser: displays and explicitly adopts an imported source interval, preserving the original draft and exact native frames',async()=>{
 const f=await recordedWorkbench('legacy','none',1,true);let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending',clip_segments=$2 WHERE id=$1",[f.draft.id,JSON.stringify([{start_seconds:1,end_seconds:2}])]);
  const before=(await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE id=$1',[f.draft.id])).rows[0].value;
  browser=await storyBrowser(f,'imported-range','四步制作 T02 验收');await browser.cli('open',browser.url+'&step=preparation');await browser.wait("!!document.querySelector('select[name=workspaceSource]')");
  await browser.cli('select','select[name=workspaceSource]','shot-workbench');
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_workspaces WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(0);await browser.capture('before-source-import');await browser.click('接入当前制作');
  await browser.wait("!!document.querySelector('[aria-label=素材镜头列表]')");const imported=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(imported.status).toBe(200);let w=(await imported.json()).workspace;
  expect(w.visualCandidates[0].initialRange).toEqual({version:'workspace-source-range/v1',sourceInSeconds:1,sourceOutSeconds:2});const original=await readFile(join(f.assetRoot,f.videoPath));
  await browser.wait("Array.from(document.querySelectorAll('[role=tab]')).some(e=>e.textContent==='视频')");
  await browser.cli('find','role','tab','click','--name','视频','--exact');await browser.click('预览视频候选 01');await browser.cli('hover','[aria-label="视频候选预览播放器"]');await browser.click('裁剪与时长');
  expect(await browser.evaluate("[document.querySelector('[aria-label=\"视频使用起点（秒）\"]').value,document.querySelector('[aria-label=\"视频使用终点（秒）\"]').value]")).toEqual(['1','2']);await browser.capture('initial');await browser.click('完成');
  await browser.wait("document.querySelector('video[aria-label=\"视频候选预览\"]')?.readyState>=2");expect(await browser.evaluate("document.querySelector('video[aria-label=\"视频候选预览\"]').currentTime")).toBeCloseTo(1,2);
  await browser.cli('hover','[aria-label="视频候选预览播放器"]');await browser.click('裁剪与时长');await browser.fill('视频使用起点（秒）','0');await browser.fill('视频使用终点（秒）','1.5');await browser.click('完成');
  await browser.click('采用视频到当前镜头');await browser.cli('wait','--text','确认采用');expect(browser.traffic.filter(t=>t.command==='adoptWorkspaceVisualCandidate')).toHaveLength(0);await browser.click('确认采用');
  await browser.wait("document.querySelector('button[aria-label=\"撤回视频采用\"]')!==null");const read=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});w=(await read.json()).workspace;
  await browser.wait("document.querySelector('[aria-label=\"片段进度\"]')?.max==='1'");
  const p=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(p.timelines[0].items.find((v:any)=>v.id===w.clips[0].itemId)).toMatchObject({srcInFrame:0,durationInFrames:30});
  await browser.cli('reload');await browser.cli('wait','--text','四步制作 T02 验收');await browser.capture('adopted');expect(browser.traffic.filter(t=>t.command==='adoptWorkspaceVisualCandidate')).toHaveLength(1);expect(browser.traffic.some(t=>['requestWorkspaceVisualCandidate','requestWorkspaceImageCandidates','generateWorkspaceNarration','confirmWorkspaceCall'].includes(t.command))).toBe(false);
  await browser.wait("document.querySelector('video[aria-label=\"视频候选预览\"]')?.readyState>=2");expect(await browser.evaluate("({start:document.querySelector('video[aria-label=\"视频候选预览\"]').currentTime,end:document.querySelector('[aria-label=\"片段进度\"]').max})")).toEqual({start:0,end:'1'});
  await browser.cli('set','viewport','390','844');await browser.cli('scrollintoview','[aria-label="视频候选预览播放器"]');expect(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth')).toBe(true);await browser.capture('narrow');
  expect((await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE id=$1',[f.draft.id])).rows[0].value).toEqual(before);expect(await readFile(join(f.assetRoot,f.videoPath))).toEqual(original);
 }catch(error){await browser?.capture('failed');throw error;}
 finally{await browser?.close();await f.close();}
},180000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['legacy','registered'] as const)('continues recorded manual bindings without a native or HTML project and preserves the old work while current editing and export work (%s)',async(layout)=>{
 const f=await recordedWorkbench(layout);
 try{
  const facts=async()=>(await f.c.query("SELECT jsonb_build_object('tasks',(SELECT jsonb_agg(t ORDER BY id) FROM public.tasks t WHERE episode_id=$1),'drafts',(SELECT jsonb_agg(d ORDER BY id) FROM public.shot_preparation_drafts d WHERE episode_id=$1),'approvals',(SELECT jsonb_agg(a ORDER BY id) FROM public.approvals a WHERE episode_id=$1),'reviews',(SELECT jsonb_agg(p ORDER BY id) FROM public.review_packages p WHERE episode_id=$1)) value",[f.episode])).rows[0].value;
  const before=await facts(),original=await readFile(join(f.assetRoot,f.videoPath));
  const read=await f.get();expect(read.status,JSON.stringify(read.body)).toBe(200);expect(read.body).toMatchObject({version:'legacy-shot-workbench/v1',sourceVerification:'not_checked',shots:[{shotId:'shot-1',confirmationStatus:'confirmed'}]});
  expect((await f.get(f.otherToken)).status).toBe(404);expect(await facts()).toEqual(before);
  const r=await f.request('adoptLegacyWorkspace',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:read.body.sha256});expect(r.status,JSON.stringify(r.body)).toBe(200);let w=r.body;
  expect(w.readiness).toMatchObject({placeholders:[],missingSources:[]});expect(w.clips[0].source.materialRevisionId).toBe(f.material);expect(w.history[0].reason).toBe('从原镜头工作版本继续编辑');
  const recovery=JSON.parse((await readFile(join(f.assetRoot,w.recovery.relativePath))).toString());expect(recovery.source.version).toBe('legacy-shot-workbench/v1');expect(recovery.source.sha256).toBe(read.body.sha256);expect(recovery.source.record.drafts[0].id).toBe(f.draft.id);
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  await send('saveWorkspaceCaptions',{clipId:w.clips[0].id,captionContract:defaultShotCaptionContract('原字幕草稿','independent',false)});
  let opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{doc.timelines[0].name='原绑定接入后编辑';});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256})).productionWorkspace;await send('closeWorkspaceStudio');await f.restart();opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{expect(doc.timelines[0].name).toBe('原绑定接入后编辑');});await send('closeWorkspaceStudio');await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');
  expect(await facts()).toEqual(before);expect(await readFile(join(f.assetRoot,f.videoPath))).toEqual(original);
  const output=w.exports[0];await send('confirmWorkspaceExport',{exportId:output.id,expectedExportSha256:output.artifact.sha256,expectedContentSha256:w.contentSha256});
  await send('prepareWorkspaceDelivery',{exportId:output.id,expectedExportSha256:output.artifact.sha256,expectedContentSha256:w.contentSha256,title:'原绑定继续制作',description:'仅本地历史来源',tags:[],coverBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});
  const worker=f.workerPool(),task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:w.deliveries[0].taskId,p_worker_capacity:2}))[0] as any;
  expect(task.task_id).toBe(w.deliveries[0].taskId);const delivery=await runWorkspaceDeliveryProcess(f,task);expect(delivery.status,JSON.stringify(delivery)).toBe('completed');
  for(const artifact of delivery.artifacts){const r=await fetch(`${f.origin}/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(artifact.relativePath)}&sha256=${artifact.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);expect(hash(Buffer.from(await r.arrayBuffer()))).toBe(artifact.sha256);}
  expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=$1',[f.task])).rows[0].value).toEqual(before.tasks[0]);
  expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(before.tasks.length+1);
  const final=await facts();expect({...final,tasks:final.tasks.filter((t:{id:string})=>t.id!==task.task_id)}).toEqual(before);

 }finally{await f.close();}
},180000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('refuses an invalidated original preview without reviving or rewriting its manual bindings',async()=>{
 const f=await recordedWorkbench();
 try{
  await f.c.query("UPDATE public.tasks SET invalidated_at=now(),invalidated_reason='Recorded invalidated preview' WHERE id=$1",[f.task]);
  const read=await f.get();expect(read.status).toBe(200);
  const before=(await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE episode_id=$1',[f.episode])).rows;
  const response=await f.request('adoptLegacyWorkspace',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:read.body.sha256});expect(response.status,JSON.stringify(response.body)).toBe(409);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_workspaces WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE episode_id=$1',[f.episode])).rows).toEqual(before);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['unknown','changed-confirmation','unconfirmed','file-sha'] as const)('refuses %s workbench evidence before creating current registration',async(kind)=>{
 const f=await recordedWorkbench();
 try{
  if(kind==='unknown')await f.c.query("UPDATE public.tasks SET status='blocked',last_result=$2 WHERE id=$1",[f.task,{blockers:[{code:'provider_outcome_unknown'}],retry:{shouldRetry:false}}]);
  if(kind==='changed-confirmation')await f.c.query("UPDATE public.tasks SET input_snapshot=jsonb_set(input_snapshot,'{review_render,confirmed_shots,0,input_fingerprint}',to_jsonb(repeat('e',32))) WHERE id=$1",[f.task]);
  if(kind==='unconfirmed')await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending' WHERE id=$1",[f.draft.id]);
  if(kind==='file-sha'){const original=await readFile(join(f.assetRoot,f.videoPath)),bad=Buffer.from(original);bad[bad.length-1]^=1;await writeFile(join(f.assetRoot,f.videoPath),bad);}
  const read=await f.get();expect(read.status).toBe(200);expect(read.body.sourceVerification).toBe('not_checked');
  const before=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[f.episode])).rows;
  const response=await f.request('adoptLegacyWorkspace',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:read.body.sha256});expect(response.status,JSON.stringify(response.body)).toBe(409);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_workspaces WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.input_episodes WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(0);
  expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[f.episode])).rows).toEqual(before);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('requires the exact source, replays only its receipt and preserves a different unknown request and existing current edit',async()=>{
 const f=await recordedWorkbench();
 try{
  const old=randomUUID();await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,last_result) VALUES($1,$2,'generate_narration','blocked',$3,$4)",[old,f.episode,{original:'frozen unknown input'},{blockers:[{code:'provider_outcome_unknown'}]}]);
  const before=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[f.episode])).rows;
  const read=await f.get(),data={episodeId:f.episode,expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:read.body.sha256};
  expect((await f.request('adoptLegacyWorkspace',{...data,workbenchSha256:'f'.repeat(64)})).status).toBe(409);
  expect((await f.request('adoptLegacyWorkspace',{...data,artifactId:randomUUID()})).status).toBe(400);
  expect((await f.request('adoptLegacyWorkspace',data,{token:f.otherToken})).status).toBe(404);
  const {csrfFor}=await import('./sessions'),key=randomUUID();
  const post=async()=>{const r=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'adoptLegacyWorkspace',idempotencyKey:key,data})});return{status:r.status,body:await r.json()};};
  const adopted=await post();expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);expect((await post()).body).toEqual(adopted.body);
  const bytes=await readFile(join(f.assetRoot,adopted.body.project.relativePath));expect((await f.request('adoptLegacyWorkspace',data)).status).toBe(409);expect(await readFile(join(f.assetRoot,adopted.body.project.relativePath))).toEqual(bytes);
  expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE episode_id=$1 ORDER BY id',[f.episode])).rows).toEqual(before);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('preserves a saved native document when its SQL registration is missing instead of replacing it with old bindings',async()=>{
 const f=await recordedWorkbench();
 try{
  const read=await f.get(),projectId=`loop-control-${f.episode}`,work=join(f.assetRoot,f.episodeRelativePath,'openchatcut-work/current');await mkdir(join(work,'runtime'),{recursive:true});
  const project={version:3,loopControl:{version:'four-step-workspace/v1',inputFingerprint:'original-edit'},assets:[],mediaFolders:[],activeTimelineId:projectId,timelines:[{id:projectId,name:'原编辑不可替换',fps:30,width:1080,height:1920,fit:'contain',items:[],tracks:{},trackOrder:[],transitions:[],selectedId:null}]};
  const store=Buffer.from(JSON.stringify({version:1,entries:{projects:[{id:projectId,name:'原剪辑'}],[`project:${projectId}`]:project}})),metadata=Buffer.from(JSON.stringify({projectId,reverseSources:{},inputFingerprint:'original-edit'}));
  await writeFile(join(work,'runtime/project-store-v1.json'),store,{flag:'wx'});await writeFile(join(work,'workspace.json'),metadata,{flag:'wx'});
  const r=await f.request('adoptLegacyWorkspace',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:read.body.sha256});expect(r.status,JSON.stringify(r.body)).toBe(409);
  expect(await readFile(join(work,'runtime/project-store-v1.json'))).toEqual(store);expect(await readFile(join(work,'workspace.json'))).toEqual(metadata);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_workspaces WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(0);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.input_episodes WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(0);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('uses the original HTML project instead of rebuilding its already edited content from older bindings',async()=>{
 const f=await recordedWorkbench();
 try{
  const snapshot=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[f.task])).rows[0].input_snapshot,render=reviewRenderFromSnapshot(snapshot)!;
  const html=Buffer.from(legacyHtmlFixture(render).html),path=f.episodeRelativePath+'/original-edit.html';await writeFile(join(f.assetRoot,path),html);
  await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'review_render_project',$4,$5,$6)",[randomUUID(),f.episode,f.task,path,hash(html),html.length]);
  const read=await f.get(),r=await f.request('adoptLegacyWorkspace',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:read.body.sha256});expect(r.status,JSON.stringify(r.body)).toBe(409);
  expect(await readFile(join(f.assetRoot,path))).toEqual(html);expect((await f.c.query('SELECT count(*)::int n FROM local_identity.production_workspaces WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(0);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('continues the old source-audio protocol whose preview correctly has a null narration track identity',async()=>{
 const f=await recordedWorkbench('legacy','source');
 try{
  const read=await f.get(),r=await f.request('adoptLegacyWorkspace',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:read.body.sha256});expect(r.status,JSON.stringify(r.body)).toBe(200);let w=r.body;
  expect(w.audio.mix.voices.find((v:any)=>v.shotId==='shot-1').mode).toBe('source');expect(w.readiness.missingSources).toEqual([]);
  const caption=await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,captionContract:defaultShotCaptionContract('原字幕草稿','independent',false)});expect(caption.status).toBe(200);w=caption.body;
  const output=await f.request('exportWorkspace',{workspaceId:w.id,expectedRevision:w.revision});expect(output.status).toBe(200);expect(output.body.exports[0].status,JSON.stringify(output.body.exports[0])).toBe('ready');
  const recovery=JSON.parse((await readFile(join(f.assetRoot,w.recovery.relativePath))).toString());expect(recovery.source.record.drafts[0].current_audio_track_id).toBe(f.draft.current_audio_track_id);
 }finally{await f.close();}
},120000);

async function recordedMusicWorkbench(shotCount=1){
 const f=await recordedWorkbench('legacy','none',shotCount);
 try{
  const cue='bgm-recorded',selection=randomUUID(),board=JSON.parse((await readFile(join(f.assetRoot,f.boardPath))).toString());board.audioCues=[{id:cue,kind:'bgm',description:'原配乐',startSeconds:0,durationSeconds:2}];
  const boardBytes=Buffer.from(JSON.stringify(board));await writeFile(join(f.assetRoot,f.boardPath),boardBytes);await f.c.query('UPDATE public.artifacts SET sha256=$2,file_size=$3 WHERE id=(SELECT artifact_id FROM public.review_packages WHERE id=$1)',[f.board,hash(boardBytes),boardBytes.length]);await f.c.query('UPDATE public.review_packages SET context_snapshot=$2 WHERE id=$1',[f.board,{worker_result:{storyboard:board}}]);
  const createTrack=async(label:string,frequency:number)=>{
   const path=f.episodeRelativePath+`/music-${label}.mp3`;execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',`sine=frequency=${frequency}:sample_rate=48000`,'-t','2','-c:a','libmp3lame',join(f.assetRoot,path)]);const bytes=await readFile(join(f.assetRoot,path)),task=randomUUID(),artifact=randomUUID(),track=randomUUID();
   await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_soundtrack','completed',$3)",[task,f.episode,{originalResult:label}]);await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'soundtrack_audio',$4,$5,$6)",[artifact,f.episode,task,path,hash(bytes),bytes.length]);
   await f.c.query("INSERT INTO public.audio_tracks(id,episode_id,source_task_id,source_artifact_id,source_review_package_id,track_kind,cue_id,relative_path,sha256,file_size,duration_seconds,created_at) VALUES($1,$2,$3,$4,$5,'bgm',$6,$7,$8,$9,2,clock_timestamp()+CASE WHEN $10 THEN interval '-1 hour' ELSE interval '0' END)",[track,f.episode,task,artifact,f.board,cue,path,hash(bytes),bytes.length,label==='A']);return{track,task,path,sha:hash(bytes),size:bytes.length};
  };
  const a=await createTrack('A',220);
  await f.c.query("INSERT INTO public.storyboard_audio_selections(id,episode_id,review_package_id,target_kind,target_id,audio_kind,cue_id,created_by) VALUES($1,$2::uuid,$3,'episode',$2::uuid::text,'bgm',$4,$5)",[selection,f.episode,f.board,cue,f.owner]);
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='confirmed',confirmed_at=now(),confirmed_by=$2,current_preview_task_id=$3,current_preview_input_fingerprint=preparation_input_fingerprint WHERE id=$1",[f.draft.id,f.owner,f.task]);
  const draft=(await f.c.query('SELECT * FROM public.shot_preparation_drafts WHERE id=$1',[f.draft.id])).rows[0],snapshot=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[f.task])).rows[0].input_snapshot;
  snapshot.review_render.storyboard=board;Object.assign(snapshot.review_render.confirmed_shots[0],{input_fingerprint:draft.preparation_input_fingerprint,preparation_contract:draft.preparation_contract});Object.assign(snapshot.review_render.members[0],{input_fingerprint:draft.preparation_input_fingerprint,preparation_contract:draft.preparation_contract});snapshot.review_render.members.push({member_key:`bgm:${f.episode}`,member_kind:'soundtrack',audio_kind:'bgm',task_id:a.task,audio_track_id:a.track,relative_path:a.path,sha256:a.sha,start_seconds:0,duration_seconds:2});snapshot.input_artifacts.push({relativePath:a.path,sha256:a.sha,fileSize:a.size});
  await f.c.query('UPDATE public.tasks SET input_snapshot=$2 WHERE id=$1',[f.task,snapshot]);const b=await createTrack('B',880);
  return{f,a,b};
 }catch(error){await f.close();throw error;}
}

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('keeps the original frozen music A when a later unconfirmed result B exists for the same cue',async()=>{
 const {f,a,b}=await recordedMusicWorkbench();
 try{
  const read=await f.get();expect(read.status).toBe(200);expect(read.body.shots[0].confirmationStatus).toBe('confirmed');
  const r=await f.request('adoptLegacyWorkspace',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:read.body.sha256});expect(r.status,JSON.stringify(r.body)).toBe(200);
  const response=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace/project?sha=${r.body.project.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const project=(await response.json()).project,paths=project.timelines[0].items.filter((i:any)=>i.kind==='audio').map((i:any)=>i.src);expect(paths).toContain(a.path);expect(paths).not.toContain(b.path);
  const recovered=JSON.parse((await readFile(join(f.assetRoot,r.body.recovery.relativePath))).toString());expect(recovered.source.record.tracks.map((t:any)=>t.id)).toEqual(expect.arrayContaining([a.track,b.track]));expect(await readFile(join(f.assetRoot,b.path))).toBeTruthy();
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('preserves the exact confirmed narration track and refuses its invalidated source task',async()=>{
 const f=await recordedWorkbench('legacy','tts');
 try{
  const track=f.draft.current_audio_track_id,sourceTask=(await f.c.query('SELECT source_task_id FROM public.audio_tracks WHERE id=$1',[track])).rows[0].source_task_id;
  const read=await f.get(),before=(await f.c.query('SELECT to_jsonb(a) value FROM public.audio_tracks a WHERE id=$1',[track])).rows[0].value;
  await f.c.query("UPDATE public.tasks SET invalidated_at=now(),invalidated_reason='Original voice withdrawn' WHERE id=$1",[sourceTask]);
  const changed=await f.get();expect(changed.body.sha256).not.toBe(read.body.sha256);
  const bad=await f.request('adoptLegacyWorkspace',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:changed.body.sha256});expect(bad.status,JSON.stringify(bad.body)).toBe(409);expect(bad.body.error).toContain('原音轨');
  await f.c.query('UPDATE public.tasks SET invalidated_at=NULL,invalidated_reason=NULL WHERE id=$1',[sourceTask]);
  const restored=await f.get(),r=await f.request('adoptLegacyWorkspace',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:restored.body.sha256});expect(r.status,JSON.stringify(r.body)).toBe(200);expect(r.body.narration[0].adoptedAudioTrackId).toBe(track);
  expect((await f.c.query('SELECT to_jsonb(a) value FROM public.audio_tracks a WHERE id=$1',[track])).rows[0].value).toEqual(before);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('imports pending selections as current inputs and candidates without borrowing old confirmation, then continues through explicit adoption and native export',async()=>{
 const f=await recordedWorkbench('legacy','tts');
 try{
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending' WHERE id=$1",[f.draft.id]);
  const facts=async()=>(await f.c.query("SELECT jsonb_build_object('drafts',(SELECT jsonb_agg(d ORDER BY id) FROM public.shot_preparation_drafts d WHERE episode_id=$1),'tasks',(SELECT jsonb_agg(t ORDER BY id) FROM public.tasks t WHERE episode_id=$1),'tracks',(SELECT jsonb_agg(a ORDER BY id) FROM public.audio_tracks a WHERE episode_id=$1),'approvals',(SELECT jsonb_agg(a ORDER BY id) FROM public.approvals a WHERE episode_id=$1)) value",[f.episode])).rows[0].value,before=await facts(),source=await f.get();
  const r=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(r.status,JSON.stringify(r.body)).toBe(200);let w=r.body;
  expect(w.legacyInputs).toMatchObject({version:'legacy-draft-inputs/v1',sourceSha256:source.body.sha256,shots:[{shotId:'shot-1',confirmationStatus:'pending',audioMode:'tts'}]});
  expect(w.readiness.placeholders).toHaveLength(1);expect(w.narration[0]).toMatchObject({mode:'manual',text:'原口播确认正文',confirmed:false,adoptedAudioTrackId:null,audioTrackId:f.draft.current_audio_track_id});expect(w.usedNarration).toHaveLength(0);expect(await facts()).toEqual(before);const events=async()=>(await f.c.query('SELECT event_type,payload FROM local_identity.production_metric_events WHERE episode_id=$1 ORDER BY id',[f.episode])).rows;expect((await events()).filter((e:any)=>['candidate_adopted','sound_used','provider_request_dispatch'].includes(e.event_type))).toHaveLength(0);
  const candidate=w.visualCandidates.find((c:any)=>c.materialRevisionId===f.material);expect(candidate).toMatchObject({status:'available',taskId:null});
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const prepared=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target',sourceInSeconds:0,sourceOutSeconds:2});await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:prepared.adoptionId});await send('confirmWorkspaceNarration',{clipId:w.clips[0].id});
  const voice=await send('prepareWorkspaceCandidate',{candidateId:f.draft.current_audio_track_id,durationPolicy:'keep-target'});await send('adoptWorkspaceCandidate',{candidateId:f.draft.current_audio_track_id,adoptionId:voice.adoptionId});
  const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{expect(doc.timelines[0].items.some((i:any)=>i.sourceAssetId===`audio-track-${f.draft.current_audio_track_id}`)).toBe(true);});await send('closeWorkspaceStudio');await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');
  expect(await facts()).toEqual(before);const collected=await events();expect(collected.filter((e:any)=>e.event_type==='candidate_adopted')).toHaveLength(2);expect(collected.filter((e:any)=>e.event_type==='sound_used')).toHaveLength(1);expect(collected.filter((e:any)=>e.event_type==='provider_request_dispatch')).toHaveLength(0);await f.restart();await f.get();expect(await events()).toEqual(collected);
 }finally{await f.close();}
},180000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each([false,true])('keeps the confirmed shot and exact original voice while importing the unfinished shot without confirmation, then edits and exports the whole order (pending first: %s)',async(pendingFirst)=>{
 const f=await recordedWorkbench('legacy','tts',2);
 try{
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending',subtitle_text='第二镜未确认字幕' WHERE episode_id=$1 AND shot_id='shot-2'",[f.episode]);
  if(pendingFirst){const board=JSON.parse((await readFile(join(f.assetRoot,f.boardPath))).toString());board.shots.reverse();const bytes=Buffer.from(JSON.stringify(board));await writeFile(join(f.assetRoot,f.boardPath),bytes);await f.c.query('UPDATE public.artifacts SET sha256=$2,file_size=$3 WHERE id=(SELECT artifact_id FROM public.review_packages WHERE id=$1)',[f.board,hash(bytes),bytes.length]);await f.c.query('UPDATE public.review_packages SET context_snapshot=$2 WHERE id=$1',[f.board,{worker_result:{storyboard:board}}]);await f.c.query("UPDATE public.tasks SET input_snapshot=jsonb_set(input_snapshot,'{review_render,storyboard}',$2) WHERE id=$1",[f.task,board]);}
  await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));

  const facts=async()=>(await f.c.query("SELECT jsonb_build_object('drafts',(SELECT jsonb_agg(d ORDER BY id) FROM public.shot_preparation_drafts d WHERE episode_id=$1),'tasks',(SELECT jsonb_agg(t ORDER BY id) FROM public.tasks t WHERE episode_id=$1),'tracks',(SELECT jsonb_agg(a ORDER BY id) FROM public.audio_tracks a WHERE episode_id=$1),'approvals',(SELECT jsonb_agg(a ORDER BY id) FROM public.approvals a WHERE episode_id=$1)) value",[f.episode])).rows[0].value,before=await facts(),source=await f.get();
  const r=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(r.status,JSON.stringify(r.body)).toBe(200);let w=r.body;
  const first=w.clips.find((c:any)=>c.shotId==='shot-1'),second=w.clips.find((c:any)=>c.shotId==='shot-2');expect(first.source.materialRevisionId).toBe(f.material);expect(second.source).toBeNull();expect(w.readiness.placeholders).toEqual([second.itemId]);expect(w.usedNarration).toMatchObject([{shotId:'shot-1',audioTrackId:f.draft.current_audio_track_id,text:'原口播确认正文'}]);expect(w.legacyInputs.shots.map((s:any)=>s.confirmationStatus)).toEqual(['confirmed','pending']);expect(await facts()).toEqual(before);const observed=async()=>(await f.c.query('SELECT event_type FROM local_identity.production_metric_events WHERE episode_id=$1 ORDER BY id',[f.episode])).rows;expect((await observed()).filter((e:any)=>['candidate_adopted','sound_used','provider_request_dispatch'].includes(e.event_type))).toHaveLength(0);
  const candidate=w.visualCandidates.find((c:any)=>c.shotId==='shot-2'&&c.materialRevisionId===f.material);expect(candidate).toMatchObject({status:'available',taskId:null});
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const prepared=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target',sourceInSeconds:0,sourceOutSeconds:2});await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:prepared.adoptionId});await send('saveWorkspaceCaptions',{clipId:second.id,captionContract:defaultShotCaptionContract('第二镜未确认字幕','independent',false)});
  const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{const voice=doc.timelines[0].items.find((i:any)=>i.sourceAssetId===`audio-track-${f.draft.current_audio_track_id}`);expect(voice).toBeTruthy();expect(voice!.startFrame).toBe(pendingFirst?60:0);doc.timelines[0].name='混合原作品继续编辑';});w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256})).productionWorkspace;await send('closeWorkspaceStudio');await f.restart();const reloaded=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(reloaded.status).toBe(200);w=(await reloaded.json()).workspace;await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');expect(await facts()).toEqual(before);expect((await observed()).filter((e:any)=>e.event_type==='candidate_adopted')).toHaveLength(1);expect((await observed()).filter((e:any)=>e.event_type==='sound_used')).toHaveLength(0);
 }finally{await f.close();}
},180000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('keeps unknown old voice unresolved while local candidates remain usable and current external proposals are blocked',async()=>{
 const f=await recordedWorkbench('legacy','tts');
 try{
  const original=(await f.c.query('SELECT source_task_id FROM public.audio_tracks WHERE id=$1',[f.draft.current_audio_track_id])).rows[0].source_task_id;
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending' WHERE id=$1",[f.draft.id]);
  await f.c.query("UPDATE public.tasks SET status='blocked',last_result=$2 WHERE id=$1",[original,{blockers:[{code:'provider_outcome_unknown'}],retry:{shouldRetry:false}}]);
  const source=await f.get(),r=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(r.status,JSON.stringify(r.body)).toBe(200);let w=r.body;
  expect(w.narration[0].mode).toBe('none');expect(w.legacyInputs.issues).toContainEqual({shotId:'shot-1',kind:'voice_source_unavailable'});
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const visual=w.visualCandidates.find((c:any)=>c.materialRevisionId===f.material),ready=await send('prepareWorkspaceVisualCandidate',{candidateId:visual.id,durationPolicy:'keep-target',sourceInSeconds:0,sourceOutSeconds:2});await send('adoptWorkspaceVisualCandidate',{candidateId:visual.id,adoptionId:ready.adoptionId});
  const payload={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,reservationCents:100},before=(await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=$1',[original])).rows[0].value;
  const blocked=await f.request('generateWorkspaceNarration',payload);expect(blocked.status,JSON.stringify(blocked.body)).toBe(409);expect(blocked.body.error).toContain('原外部请求仍在执行或结果未知');
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.workspace_call_confirmations WHERE workspace_id=$1',[w.id])).rows[0].n).toBe(0);expect((await f.c.query('SELECT to_jsonb(t) value FROM public.tasks t WHERE id=$1',[original])).rows[0].value).toEqual(before);
  await f.c.query("UPDATE public.tasks SET last_result=$2 WHERE id=$1",[original,{blockers:[{code:'confirmed_not_sent'}]}]);const resolved=await f.request('generateWorkspaceNarration',payload);expect(resolved.status,JSON.stringify(resolved.body)).toBe(409);expect(resolved.body.error).toContain('请先保存并确认当前口播');
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('imports every original registered music result as an unadopted local preparation and adopts only the explicitly selected result',async()=>{
 const {f,a,b}=await recordedMusicWorkbench();
 try{
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending' WHERE id=$1",[f.draft.id]);await ownerTransaction(f.pool,f.owner,false,c=>c.query('SELECT local_identity.set_production_metrics_enabled(true)'));
  const source=await f.get(),facts=async()=>(await f.c.query("SELECT jsonb_build_object('tasks',(SELECT jsonb_agg(t ORDER BY id) FROM public.tasks t WHERE episode_id=$1),'tracks',(SELECT jsonb_agg(a ORDER BY id) FROM public.audio_tracks a WHERE episode_id=$1),'materials',(SELECT jsonb_agg(m ORDER BY id) FROM public.production_material_revisions m WHERE episode_id=$1)) value",[f.episode])).rows[0].value,before=await facts();
  const r=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(r.status,JSON.stringify(r.body)).toBe(200);let w=r.body;
  expect(w.audio.mix.sounds).toHaveLength(0);expect(w.audio.preparations.map((p:any)=>p.audioTrackId).sort()).toEqual([a.track,b.track].sort());for(const p of w.audio.preparations)expect(p).toMatchObject({status:'ready',taskId:null,adoptedItemId:null});expect(await facts()).toEqual(before);
  const prep=w.audio.preparations.find((p:any)=>p.audioTrackId===b.track),adopt=await f.request('adoptWorkspaceAudio',{workspaceId:w.id,expectedRevision:w.revision,preparationId:prep.id});expect(adopt.status,JSON.stringify(adopt.body)).toBe(200);w=adopt.body;expect(w.audio.mix.sounds).toHaveLength(1);
  const response=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace/project?sha=${w.project.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);expect((await response.json()).project.timelines[0].items.some((i:any)=>i.src===b.path&&i.kind==='audio')).toBe(true);expect(await readFile(join(f.assetRoot,a.path))).toBeTruthy();expect(await facts()).toEqual(before);
  const events=(await f.c.query("SELECT payload FROM local_identity.production_metric_events WHERE episode_id=$1 AND event_type='sound_used'",[f.episode])).rows;expect(events).toHaveLength(1);expect(events[0].payload).toMatchObject({role:'bgm',source_kind:'audio_track',source_id:b.track});
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['invalidated-confirmation','stale-source','foreign-owner','existing-workspace'] as const)('refuses %s mixed imports without changing original work or replacing current editing',async(kind)=>{
 const f=await recordedWorkbench('legacy','tts',2);
 try{
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending' WHERE episode_id=$1 AND shot_id='shot-2'",[f.episode]);let source=await f.get();
  if(kind==='invalidated-confirmation'){await f.c.query("UPDATE public.tasks SET invalidated_at=now(),invalidated_reason='Original preview withdrawn' WHERE id=$1",[f.task]);source=await f.get();}
  if(kind==='stale-source')await f.c.query("UPDATE public.shot_preparation_drafts SET subtitle_text='Changed pending input' WHERE episode_id=$1 AND shot_id='shot-2'",[f.episode]);
  if(kind==='existing-workspace')expect((await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).status).toBe(200);
  const facts=async()=>(await f.c.query("SELECT jsonb_build_object('drafts',(SELECT jsonb_agg(d ORDER BY id) FROM public.shot_preparation_drafts d WHERE episode_id=$1),'tasks',(SELECT jsonb_agg(t ORDER BY id) FROM public.tasks t WHERE episode_id=$1),'current',(SELECT jsonb_agg(w ORDER BY id) FROM local_identity.production_workspaces w WHERE episode_id=$1)) value",[f.episode])).rows[0].value,before=await facts();
  const r=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256},kind==='foreign-owner'?{token:f.otherToken}:{});expect(r.status,JSON.stringify(r.body)).toBe(kind==='foreign-owner'?404:409);expect(await facts()).toEqual(before);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('preserves the frozen music source interval when an unfinished shot precedes the confirmed shot, keeping the later result unadopted',async()=>{
 const {f,a,b}=await recordedMusicWorkbench(2);
 try{
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending' WHERE episode_id=$1 AND shot_id='shot-2'",[f.episode]);
  const board=JSON.parse((await readFile(join(f.assetRoot,f.boardPath))).toString());board.shots.reverse();const bytes=Buffer.from(JSON.stringify(board));await writeFile(join(f.assetRoot,f.boardPath),bytes);await f.c.query('UPDATE public.artifacts SET sha256=$2,file_size=$3 WHERE id=(SELECT artifact_id FROM public.review_packages WHERE id=$1)',[f.board,hash(bytes),bytes.length]);await f.c.query('UPDATE public.review_packages SET context_snapshot=$2 WHERE id=$1',[f.board,{worker_result:{storyboard:board}}]);await f.c.query("UPDATE public.tasks SET input_snapshot=jsonb_set(input_snapshot,'{review_render,storyboard}',$2) WHERE id=$1",[f.task,board]);
  const source=await f.get(),r=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(r.status,JSON.stringify(r.body)).toBe(200);const w=r.body;
  const response=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace/project?sha=${w.project.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const project=(await response.json()).project,sounds=project.timelines[0].items.filter((i:any)=>i.kind==='audio');expect(sounds).toHaveLength(1);expect(sounds[0]).toMatchObject({src:a.path,srcInFrame:0,startFrame:60,durationInFrames:60});expect(sounds.some((i:any)=>i.src===b.path)).toBe(false);expect(w.audio.preparations.map((p:any)=>p.audioTrackId)).toEqual(expect.arrayContaining([a.track,b.track]));expect(w.readiness.placeholders).toHaveLength(1);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('moves a frozen shot effect with its confirmed shot after an unfinished gap without silently losing its original use',async()=>{
 const {f,a}=await recordedMusicWorkbench(2);
 try{
  const board=JSON.parse((await readFile(join(f.assetRoot,f.boardPath))).toString());board.shots.reverse();board.audioCues[0].kind='sfx';const bytes=Buffer.from(JSON.stringify(board));await writeFile(join(f.assetRoot,f.boardPath),bytes);await f.c.query('UPDATE public.artifacts SET sha256=$2,file_size=$3 WHERE id=(SELECT artifact_id FROM public.review_packages WHERE id=$1)',[f.board,hash(bytes),bytes.length]);await f.c.query('UPDATE public.review_packages SET context_snapshot=$2 WHERE id=$1',[f.board,{worker_result:{storyboard:board}}]);
  await f.c.query("UPDATE public.audio_tracks SET track_kind='sfx' WHERE id=$1",[a.track]);await f.c.query("UPDATE public.storyboard_audio_selections SET audio_kind='sfx',target_kind=$2,target_id=$3,cue_id=cue_id WHERE episode_id=$1",[f.episode,'shot','shot-1']);
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending' WHERE episode_id=$1 AND shot_id='shot-2'",[f.episode]);await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='confirmed',confirmed_at=now(),confirmed_by=$2,current_preview_task_id=$3,current_preview_input_fingerprint=preparation_input_fingerprint WHERE id=$1",[f.draft.id,f.owner,f.task]);
  const draft=(await f.c.query('SELECT * FROM public.shot_preparation_drafts WHERE id=$1',[f.draft.id])).rows[0],snapshot=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[f.task])).rows[0].input_snapshot;snapshot.review_render.storyboard=board;Object.assign(snapshot.review_render.confirmed_shots[0],{input_fingerprint:draft.preparation_input_fingerprint,preparation_contract:draft.preparation_contract});Object.assign(snapshot.review_render.members[0],{input_fingerprint:draft.preparation_input_fingerprint,preparation_contract:draft.preparation_contract});const member=snapshot.review_render.members.find((m:any)=>m.member_kind==='soundtrack');Object.assign(member,{member_key:'sfx:shot-1',audio_kind:'sfx',start_seconds:0,duration_seconds:2});await f.c.query('UPDATE public.tasks SET input_snapshot=$2 WHERE id=$1',[f.task,snapshot]);
  const source=await f.get();expect(source.body.shots.find((s:any)=>s.shotId==='shot-1').confirmationStatus).toBe('confirmed');const r=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(r.status,JSON.stringify(r.body)).toBe(200);const w=r.body;
  const response=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace/project?sha=${w.project.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const sounds=(await response.json()).project.timelines[0].items.filter((i:any)=>i.kind==='audio');expect(sounds).toHaveLength(1);expect(sounds[0]).toMatchObject({src:a.path,startFrame:60,durationInFrames:60,loopControlAudio:{kind:'sfx',shotId:'shot-1',anchor:'shot'}});
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('keeps a confirmed shot usable when the unfinished shot source is offline, preserving its original selection as an issue',async()=>{
 const f=await recordedWorkbench('legacy','tts',2);
 try{
  const material=randomUUID(),path=f.episodeRelativePath+'/offline-pending.mp4';await f.c.query("INSERT INTO public.production_material_revisions(id,episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,is_main_script,created_by,material_purpose) SELECT $1,episode_id,3,material_type,source_kind,$2,$2,mime_type,sha256,file_size,false,created_by,material_purpose FROM public.production_material_revisions WHERE id=$3",[material,path,f.material]);
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending',selected_material_revision_id=$2 WHERE episode_id=$1 AND shot_id='shot-2'",[f.episode,material]);
  const source=await f.get(),r=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(r.status,JSON.stringify(r.body)).toBe(200);const w=r.body;
  expect(w.usedNarration[0]).toMatchObject({shotId:'shot-1',audioTrackId:f.draft.current_audio_track_id});expect(w.clips.find((c:any)=>c.shotId==='shot-1').source.materialRevisionId).toBe(f.material);expect(w.readiness.placeholders).toHaveLength(1);expect(w.legacyInputs.issues).toContainEqual({shotId:'shot-2',kind:'visual_source_unavailable'});expect(w.legacyInputs.shots.find((d:any)=>d.shotId==='shot-2').materialRevisionId).toBe(material);expect(w.visualCandidates.some((c:any)=>c.materialRevisionId===material)).toBe(false);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('carries original unfinished mix settings into current inputs while adoption remains explicit',async()=>{
 const f=await recordedWorkbench('legacy','tts');
 try{
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending',script_narration_gain_db=-7,script_bgm_gain_db=-25,bgm_ducking_level='strong',transition_mode='fade' WHERE id=$1",[f.draft.id]);
  const music=randomUUID(),task=randomUUID(),artifact=randomUUID(),path=f.episodeRelativePath+'/voice.mp3';await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_soundtrack','completed','{}')",[task,f.episode]);await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'soundtrack_audio',$4,$5,$6)",[artifact,f.episode,task,path,f.files[1].sha256,f.files[1].fileSize]);await f.c.query("INSERT INTO public.audio_tracks(id,episode_id,source_task_id,source_artifact_id,source_review_package_id,track_kind,cue_id,relative_path,sha256,file_size,duration_seconds) VALUES($1,$2,$3,$4,$5,'bgm','manual-original-music',$6,$7,$8,2)",[music,f.episode,task,artifact,f.board,path,f.files[1].sha256,f.files[1].fileSize]);
  const before=(await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE id=$1',[f.draft.id])).rows[0].value,source=await f.get(),r=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(r.status,JSON.stringify(r.body)).toBe(200);let w=r.body;expect(w.usedNarration).toHaveLength(0);expect(w.audio.mix.sounds).toHaveLength(0);
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const picture=w.visualCandidates[0],visual=await send('prepareWorkspaceVisualCandidate',{candidateId:picture.id,durationPolicy:'keep-target',sourceInSeconds:0,sourceOutSeconds:2});await send('adoptWorkspaceVisualCandidate',{candidateId:picture.id,adoptionId:visual.adoptionId});await send('confirmWorkspaceNarration',{clipId:w.clips[0].id});const voice=await send('prepareWorkspaceCandidate',{candidateId:f.draft.current_audio_track_id,durationPolicy:'keep-target'});await send('adoptWorkspaceCandidate',{candidateId:f.draft.current_audio_track_id,adoptionId:voice.adoptionId});await send('prepareWorkspaceAudio',{kind:'bgm',audioTrackId:music,description:'明确选择的原音乐',durationSeconds:2});await send('adoptWorkspaceAudio',{preparationId:w.audio.preparations.find((p:any)=>p.kind==='bgm').id});
  expect(w.audio.mix.voices[0].gainDb).toBe(-7);expect(w.audio.mix.sounds[0]).toMatchObject({gainDb:-25,duckDepthDb:14});const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{expect(doc.timelines[0].items.find((i:any)=>i.id===w.clips[0].itemId)).toMatchObject({fadeInFrames:11,fadeOutFrames:11});});await send('closeWorkspaceStudio');await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');expect((await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE id=$1',[f.draft.id])).rows[0].value).toEqual(before);
 }finally{await f.close();}
},180000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('pending two-slot composition remains an explicit current source choice with exact slot windows',async()=>{
 const f=await recordedWorkbench('legacy','none',1,true);
 try{
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending',clip_segments=$2,composition=$3 WHERE id=$1",[f.draft.id,JSON.stringify([{start_seconds:0,end_seconds:1},{start_seconds:1,end_seconds:2}]),{version:'shot-composition/v1',layout:'2up-horizontal',slots:[{id:'left',clipSegmentIndex:0,fit:'contain',focalPoint:{x:.2,y:.3}},{id:'right',clipSegmentIndex:1,fit:'cover',focalPoint:{x:.8,y:.7}}]}]);
  const before=(await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE id=$1',[f.draft.id])).rows[0].value,original=await readFile(join(f.assetRoot,f.videoPath));
  const source=await f.get();expect(source.status).toBe(200);const imported=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  let w=imported.body;expect(w.clips).toHaveLength(2);expect(w.visualCandidates).toHaveLength(2);expect(w.visualCandidates.map((v:any)=>v.durationImpact.deltaSeconds)).toEqual([0,0]);expect(w.usedNarration).toHaveLength(0);expect(w.audio.mix.sounds).toHaveLength(0);let project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(project.timelines[0].items.filter((i:any)=>i.kind==='video'||i.kind==='image')).toHaveLength(0);
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  for(const [index,clip]of [...w.clips].entries()){
   const candidate=w.visualCandidates.find((v:any)=>v.targetItemId===clip.itemId),prepared=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target'});
   if(index===1)expect(prepared.edit.source.sourceInSeconds).toBe(1);
   await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:prepared.adoptionId});
  }
  project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));const items=w.clips.map((c:any)=>project.timelines[0].items.find((v:any)=>v.id===c.itemId));
  expect(items[0]).toMatchObject({startFrame:0,durationInFrames:30,srcInFrame:0,transform:{scale:.5,x:-25,y:0}});expect(items[1]).toMatchObject({startFrame:0,durationInFrames:30,srcInFrame:30,transform:{scale:1,x:10,y:0,crop:{left:.4,right:.1}}});expect(w.readiness.placeholders).toEqual([]);
  const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{expect(doc.timelines[0].items.find((v:any)=>v.id===w.clips[1].itemId)).toMatchObject({srcInFrame:30,durationInFrames:30});doc.timelines[0].items.find((v:any)=>v.id===w.clips[1].itemId).transform.x=17;});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256})).productionWorkspace;await send('closeWorkspaceStudio');await f.restart();const response=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);w=(await response.json()).workspace;project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(project.timelines[0].items.find((v:any)=>v.id===w.clips[1].itemId)).toMatchObject({srcInFrame:30,transform:{x:17}});await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');
  if(process.env.LOOP_STORY_EVIDENCE){const dir=join(process.env.LOOP_STORY_EVIDENCE,'pending-two-slot');await mkdir(dir,{recursive:true});await writeFile(join(dir,'output.mp4'),await readFile(join(f.assetRoot,w.exports[0].artifact.relativePath)));await writeFile(join(dir,'project.json'),await readFile(join(f.assetRoot,w.exports[0].project.relativePath)));const frame=w.exports[0].checks.find((c:any)=>c.name==='representative_frame').artifact;await writeFile(join(dir,'frame.jpg'),await readFile(join(f.assetRoot,frame.relativePath)));}
  expect((await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE id=$1',[f.draft.id])).rows[0].value).toEqual(before);expect(await readFile(join(f.assetRoot,f.videoPath))).toEqual(original);expect((await f.c.query('SELECT count(*)::int n FROM public.paid_generation_reservations r JOIN public.tasks t ON t.id=r.task_id WHERE t.episode_id=$1',[f.episode])).rows[0].n).toBe(0);
 }finally{await f.close();}
},180000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each([
 {name:'sequential',segments:[{start_seconds:.5,end_seconds:1.5},{start_seconds:0,end_seconds:.5}],composition:{version:'shot-composition/v1',layout:'full',slots:[{id:'full',clipSegmentIndex:0,fit:'cover',focalPoint:{x:.5,y:.5}}]},expected:[{startFrame:0,durationInFrames:30,srcInFrame:15},{startFrame:30,durationInFrames:15,srcInFrame:30}]},
 {name:'pip',segments:[{start_seconds:1,end_seconds:2},{start_seconds:0,end_seconds:.5}],composition:{version:'shot-composition/v1',layout:'pip',slots:[{id:'main',clipSegmentIndex:1,fit:'cover',focalPoint:{x:.5,y:.5}},{id:'inset',clipSegmentIndex:0,fit:'contain',focalPoint:{x:.3,y:.7}}]},expected:[{startFrame:0,durationInFrames:15,srcInFrame:0},{startFrame:0,durationInFrames:15,srcInFrame:30}]},
 {name:'grid',segments:[{start_seconds:0,end_seconds:.5},{start_seconds:.5,end_seconds:1},{start_seconds:1,end_seconds:1.5},{start_seconds:1.5,end_seconds:2}],composition:{version:'shot-composition/v1',layout:'grid-4',slots:[{id:'top-left',clipSegmentIndex:3,fit:'cover',focalPoint:{x:.5,y:.5}},{id:'top-right',clipSegmentIndex:2,fit:'cover',focalPoint:{x:.5,y:.5}},{id:'bottom-left',clipSegmentIndex:1,fit:'contain',focalPoint:{x:.5,y:.5}},{id:'bottom-right',clipSegmentIndex:0,fit:'contain',focalPoint:{x:.5,y:.5}}]},expected:[{startFrame:0,durationInFrames:15,srcInFrame:45},{startFrame:0,durationInFrames:15,srcInFrame:30},{startFrame:0,durationInFrames:15,srcInFrame:15},{startFrame:0,durationInFrames:15,srcInFrame:0}]},
])('continues pending $name ranges with explicit adoption and preserves Owner overrides',async({name,segments,composition,expected})=>{
 const f=await recordedWorkbench();
 try{
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending',clip_segments=$2,composition=$3 WHERE id=$1",[f.draft.id,JSON.stringify(segments),composition]);
  const before=(await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE id=$1',[f.draft.id])).rows[0].value,source=await f.get(),imported=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(imported.status,JSON.stringify(imported.body)).toBe(200);let w=imported.body;expect(w.clips).toHaveLength(expected.length);expect(w.visualCandidates).toHaveLength(expected.length);
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  if(name==='sequential')await send('editWorkspaceStructure',{operation:{kind:'appearance',itemId:w.clips[0].itemId,focusX:7}});
  for(const [index,clip]of [...w.clips].entries()){
   const candidate=w.visualCandidates.find((v:any)=>v.targetItemId===clip.itemId);let prepared=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target'});
   if(name==='sequential'&&index===1){expect(prepared.edit.source.sourceInSeconds).toBe(0);prepared=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target',sourceInSeconds:1,sourceOutSeconds:1.5});}
   await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:prepared.adoptionId});
  }
  const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));for(const [index,clip]of w.clips.entries())expect(project.timelines[0].items.find((v:any)=>v.id===clip.itemId)).toMatchObject(expected[index]);if(name==='sequential')expect(project.timelines[0].items.find((v:any)=>v.id===w.clips[0].itemId).transform.x).toBe(7);
  await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');expect((await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE id=$1',[f.draft.id])).rows[0].value).toEqual(before);
 }finally{await f.close();}
},180000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('keeps a confirmed original shot intact while importing and adopting an unfinished parallel composition',async()=>{
 const f=await recordedWorkbench('legacy','none',2);
 try{
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending',clip_segments=$3,composition=$4 WHERE episode_id=$1 AND shot_id=$2",[f.episode,'shot-2',JSON.stringify([{start_seconds:0,end_seconds:1},{start_seconds:1,end_seconds:2}]),{version:'shot-composition/v1',layout:'2up-vertical',slots:[{id:'top',clipSegmentIndex:0,fit:'cover',focalPoint:{x:.5,y:.5}},{id:'bottom',clipSegmentIndex:1,fit:'cover',focalPoint:{x:.5,y:.5}}]}]);
  const before=(await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE episode_id=$1 ORDER BY shot_id',[f.episode])).rows,source=await f.get(),imported=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(imported.status,JSON.stringify(imported.body)).toBe(200);let w=imported.body;expect(w.clips).toHaveLength(3);expect(w.visualCandidates).toHaveLength(2);let project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));const confirmed=w.clips.find((c:any)=>c.shotId==='shot-1'),original=project.timelines[0].items.find((i:any)=>i.id===confirmed.itemId);expect(original).toMatchObject({kind:'video',startFrame:0,durationInFrames:60,srcInFrame:0});
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  for(const clip of w.clips.filter((c:any)=>c.shotId==='shot-2')){const candidate=w.visualCandidates.find((v:any)=>v.targetItemId===clip.itemId),prepared=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target'});await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:prepared.adoptionId});}
  project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(project.timelines[0].items.find((i:any)=>i.id===confirmed.itemId)).toEqual(original);for(const clip of w.clips.filter((c:any)=>c.shotId==='shot-2'))expect(project.timelines[0].items.find((i:any)=>i.id===clip.itemId)).toMatchObject({startFrame:60,durationInFrames:30});await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');expect((await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE episode_id=$1 ORDER BY shot_id',[f.episode])).rows).toEqual(before);
 }finally{await f.close();}
},180000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('keeps an unavailable pending range as evidence and rejects malformed public range overrides without changing the project',async()=>{
 const f=await recordedWorkbench();
 try{
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending',clip_segments=$2,composition=$3 WHERE id=$1",[f.draft.id,JSON.stringify([{start_seconds:0,end_seconds:1},{start_seconds:1,end_seconds:3}]),{version:'shot-composition/v1',layout:'2up-horizontal',slots:[{id:'left',clipSegmentIndex:0,fit:'cover',focalPoint:{x:.5,y:.5}},{id:'right',clipSegmentIndex:1,fit:'cover',focalPoint:{x:.5,y:.5}}]}]);
  const original=(await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE id=$1',[f.draft.id])).rows[0].value,source=await f.get(),imported=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(imported.status,JSON.stringify(imported.body)).toBe(200);const w=imported.body;expect(w.clips).toHaveLength(2);expect(w.visualCandidates).toHaveLength(1);expect(w.legacyInputs.issues).toContainEqual({shotId:'shot-1',kind:'visual_range_unavailable'});expect(w.legacyInputs.shots[0].ranges[1]).toEqual({startSeconds:1,endSeconds:3});
  const base={workspaceId:w.id,expectedRevision:w.revision},candidate=w.visualCandidates[0],before=await readFile(join(f.assetRoot,w.project.relativePath));
  const hidden=await f.request('registerWorkspaceVisualCandidate',{...base,targetItemId:w.clips[0].itemId,materialRevisionId:f.material,usage:'video',initialRange:{version:'workspace-source-range/v1',sourceInSeconds:0,sourceOutSeconds:1}});expect(hidden.status).toBe(400);
  for(const field of ['sourceInSeconds','sourceOutSeconds']){const rejected=await f.request('prepareWorkspaceVisualCandidate',{...base,candidateId:candidate.id,durationPolicy:'keep-target',[field]:null});expect(rejected.status,JSON.stringify(rejected.body)).toBe(400);}
  const outsideFrame=await f.request('prepareWorkspaceVisualCandidate',{...base,candidateId:candidate.id,durationPolicy:'use-candidate',acceptTimelineImpact:true,sourceInSeconds:1.999,sourceOutSeconds:2});expect(outsideFrame.status,JSON.stringify(outsideFrame.body)).toBe(409);
  expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(before);expect((await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE id=$1',[f.draft.id])).rows[0].value).toEqual(original);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('retains the existing SQL rejection of unsupported original compositions without changing the draft',async()=>{
 const f=await recordedWorkbench();
 try{
  const before=(await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE id=$1',[f.draft.id])).rows[0].value;
  await expect(f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending',composition=jsonb_set(composition,'{version}','\"shot-composition/v99\"') WHERE id=$1",[f.draft.id])).rejects.toMatchObject({code:'23514',constraint:'shot_preparation_drafts_composition_check'});
  expect((await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE id=$1',[f.draft.id])).rows[0].value).toEqual(before);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each([.05,121])('imports an original image window of %s seconds by its actual frames while enforcing current public registration bounds',async(seconds)=>{
 const f=await recordedWorkbench();
 try{
  const material=await f.request('importMaterial',{sourceKind:'file',sourcePath:'original-still.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(material.status,JSON.stringify(material.body)).toBe(200);
  await f.c.query("UPDATE public.shot_preparation_drafts SET confirmation_status='pending',selected_material_revision_id=$2,clip_segments=$3 WHERE id=$1",[f.draft.id,material.body.id,JSON.stringify([{start_seconds:0,end_seconds:seconds}])]);
  const before=(await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE id=$1',[f.draft.id])).rows[0].value,source=await f.get(),imported=await f.request('importLegacyDraftInputs',{expectedScriptRevisionId:f.script,reviewPackageId:f.board,workbenchSha256:source.body.sha256});expect(imported.status,JSON.stringify(imported.body)).toBe(200);let w=imported.body;const frames=seconds===.05?2:3630,candidate=w.visualCandidates[0];expect(w.visualCandidates).toHaveLength(1);expect(candidate.durationSeconds).toBe(frames/30);expect(candidate.initialRange).toBeUndefined();expect(w.readiness.placeholders).toHaveLength(1);
  const base={workspaceId:w.id,expectedRevision:w.revision},publicRejected=await f.request('registerWorkspaceVisualCandidate',{...base,targetItemId:w.clips[0].itemId,materialRevisionId:material.body.id,usage:'still',durationSeconds:seconds===.05?frames/30:3601});expect(publicRejected.status,JSON.stringify(publicRejected.body)).toBe(400);
  if(seconds===121){const publicAccepted=await f.request('registerWorkspaceVisualCandidate',{...base,targetItemId:w.clips[0].itemId,materialRevisionId:material.body.id,usage:'still',durationSeconds:121});expect(publicAccepted.status,JSON.stringify(publicAccepted.body)).toBe(200);w=publicAccepted.body;}
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const prepared=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target'});await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:prepared.adoptionId});const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(project.timelines[0].items.find((i:any)=>i.id===w.clips[0].itemId)).toMatchObject({kind:'image',startFrame:0,durationInFrames:frames,srcInFrame:0});
  if(seconds===.05){await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');expect(w.exports[0].checks.find((c:any)=>c.name==='technical').videoFrames).toBe(2);if(process.env.LOOP_STORY_EVIDENCE){const dir=join(process.env.LOOP_STORY_EVIDENCE,'pending-short-image');await mkdir(dir,{recursive:true});await writeFile(join(dir,'output.mp4'),await readFile(join(f.assetRoot,w.exports[0].artifact.relativePath)));await writeFile(join(dir,'project.json'),await readFile(join(f.assetRoot,w.exports[0].project.relativePath)));const frame=w.exports[0].checks.find((c:any)=>c.name==='representative_frame').artifact;await writeFile(join(dir,'frame.jpg'),await readFile(join(f.assetRoot,frame.relativePath)));}}
  expect((await f.c.query('SELECT to_jsonb(d) value FROM public.shot_preparation_drafts d WHERE id=$1',[f.draft.id])).rows[0].value).toEqual(before);
 }finally{await f.close();}
},180000);
