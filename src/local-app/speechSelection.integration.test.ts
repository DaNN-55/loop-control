// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {narrationFixture} from './workspaceNarration.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('speech requests freeze connection and voice while defaults change, and completed audio waits for explicit native adoption',async()=>{
 const f=await narrationFixture();try{
 await f.authorize();
 const a=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='volcengine_tts'")).rows[0].id;
 const b=randomUUID(),connection=randomUUID(),secret=randomUUID();
 await f.c.query('BEGIN');
 await f.c.query("INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,'volcengine_tts','volcengine_tts','Speech B',$2,$3,'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse')",[connection,f.owner,b]);
 await f.c.query("INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES($1,$2,1,'volcengine_tts','volcengine_tts','https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse',$3)",[b,connection,secret]);
 await f.c.query("INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES($1,$2,$3,'keychain')",[b,f.owner,secret]);
 await f.c.query('INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified) VALUES($1,$2,true)',[b,f.owner]);
 await f.c.query("INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome) VALUES($1,$2,'live','verified')",[b,f.owner]);
 // No blueprint speech switch or executor remains authoritative.
 await f.c.query("UPDATE public.account_blueprint_versions SET policy=policy-'narration' WHERE id=(SELECT blueprint_version_id FROM public.episodes WHERE id=$1)",[f.episode]);
 await f.c.query('COMMIT');
 let w=await f.read();const original=w.project.sha256,clip=w.clips[0];
 const selection=(id:string)=>({capability:'speech',provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0',connectionVersionId:id});
 const base=()=>({workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id});
 const save=async(id:string,voice:string)=>{const r=await f.request('saveWorkspaceNarration',{...base(),mode:'tts',text:'完整口播不能截断。',selection:selection(id),voice,speakingRate:1,languageCode:'zh-CN'});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;const c=await f.request('confirmWorkspaceNarration',base());expect(c.status,JSON.stringify(c.body)).toBe(200);w=c.body;};
 await save(a,'zh_female_vv_uranus_bigtts');
 let r=await f.request('generateWorkspaceNarration',{...base(),reservationCents:10});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;const taskA=w.narration[0].taskId;
 await save(b,'zh_male_m191_uranus_bigtts');
 r=await f.request('saveWorkspaceNarrationDefaults',{workspaceId:w.id,expectedRevision:w.revision,selection:selection(b),voice:'zh_male_m191_uranus_bigtts',speakingRate:1,languageCode:'zh-CN'});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;
 expect((await f.request('generateWorkspaceNarration',{...base(),reservationCents:10})).status).toBe(409);
 await f.c.query('BEGIN');const rotated=randomUUID();await f.c.query('INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) SELECT $2,connection_id,2,provider,adapter,endpoint,vault_secret_id FROM public.external_connection_versions WHERE id=$1',[a,rotated]);await f.c.query('UPDATE public.external_connections SET current_version_id=$2 WHERE current_version_id=$1',[a,rotated]);await f.c.query('COMMIT');
 await f.restart();await f.restartWorker();expect(await f.execute(taskA)).toEqual({status:'completed',taskId:taskA});w=await f.read();
 expect(w.project.sha256).toBe(original);expect(w.candidates).toHaveLength(1);expect(w.candidates[0].status).toBe('available');
 r=await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision});expect(r.status).toBe(200);w=r.body;expect(w.project.sha256).toBe(original);
 r=await f.request('generateWorkspaceNarration',{...base(),reservationCents:10});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;const taskB=w.narration[0].taskId;expect(taskB).not.toBe(taskA);
 await f.execute(taskB);w=await f.read();expect(w.candidates).toHaveLength(2);expect(w.candidates.every((c:any)=>c.status==='available')).toBe(true);
 const calls=(await readFile(f.submissions,'utf8')).trim().split('\n').map(s=>JSON.parse(s));expect(calls.map(c=>c.resourceId)).toEqual(['seed-tts-2.0','seed-tts-2.0']);expect(calls[1].credentialRef).toBe(secret);expect(calls.map(c=>c.body.req_params.speaker)).toEqual(['zh_female_vv_uranus_bigtts','zh_male_m191_uranus_bigtts']);
 const old=w.candidates.find((c:any)=>c.taskId===taskA);const prepared=await f.request('prepareWorkspaceCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:old.id,durationPolicy:'use-candidate'});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
 r=await f.request('adoptWorkspaceCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:old.id,adoptionId:prepared.body.adoptionId});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;
 const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));const voice=project.timelines[0].items.find((i:any)=>i.sourceAssetId==='audio-track-'+old.id);expect(voice.durationInFrames).toBe(72);expect(w.usedNarration[0]).toMatchObject({taskId:taskA,text:'完整口播不能截断。',fullSourceUsed:true});expect(w.narration[0].selection.connectionVersionId).toBe(b);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('fresh formal speech adoption drives actual video duration and invalidates subtitle evidence when a longer voice is adopted',async()=>{
 const {formalWorkflowFixture}=await import('./formalWorkflow.fixture'),{workspaceTestMedia}=await import('./workspaceTestMedia.fixture'),{productionScriptTemplate}=await import('../reviews/productionScript'),{defaultShotCaptionContract}=await import('../shotCaptions'),{editStudioDocument}=await import('./studioDocument.fixture');
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
 const f=await formalWorkflowFixture({controlled:true,scriptText:productionScriptTemplate.replace('镜头类型：b_roll','镜头类型：a_roll')});try{
 expect((await f.send('start')).status).toBe(200);let r=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(r.status,JSON.stringify(r.body)).toBe(200);let w=r.body;const clip=w.clips[0];
 const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
 await send('authorizeWorkspacePreparation',{enabled:true});
 const a=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='volcengine_tts'")).rows[0].id,selection={capability:'speech',provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0',connectionVersionId:a};
 const speech=async(text:string)=>{await send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',selection,text,voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1});await send('confirmWorkspaceNarration',{clipId:clip.id});await send('generateWorkspaceNarration',{clipId:clip.id,reservationCents:50});const task=w.narration[0].taskId;await f.controlled!.execute(task);w=(await (await fetch(f.origin+`/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}})).json()).workspace;return w.candidates.find((c:any)=>c.taskId===task);};
 const first=await speech('真实完整口播窗口。');const original=w.project.sha256;await send('refreshWorkspaceNarration');expect(w.project.sha256).toBe(original);const firstPrep=await send('prepareWorkspaceCandidate',{candidateId:first.id,durationPolicy:'use-candidate'});await send('adoptWorkspaceCandidate',{candidateId:first.id,adoptionId:firstPrep.adoptionId});
 const contract=defaultShotCaptionContract(first.text,'follow_tts');contract.cues=[{id:'full',text:first.text,startMs:0,endMs:2000}];await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:contract});await send('confirmWorkspaceCaptionText',{clipId:clip.id,expectedInputFingerprint:w.captions[0].inputFingerprint});expect(w.captions[0]).toMatchObject({timing:'current',textConfirmed:true});const captionFingerprint=w.captions[0].inputFingerprint;
 const image=await f.send('importMaterial',{sourceKind:'file',sourcePath:'first.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(image.status).toBe(200);
 const videoVersion=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='seedance_video'")).rows[0].id;
 await send('generateWorkspaceImage',{selection:{capability:'video',provider:'volcengine',adapter:'seedance_video',model:'doubao-seedance-2-0-260128',connectionVersionId:videoVersion},clipId:clip.id,materialRevisionId:image.body.id,prompt:'保持自然运动。',durationSeconds:4,reservationCents:90});expect(w.clips[0].image.durationSeconds).toBe(2.4);expect(w.clips[0].image.providerDurationSeconds).toBe(4);const video=w.clips[0].image.taskId;await f.controlled!.execute(video);await send('fillWorkspaceImageResult',{taskId:video});
 // A real saved native edit survives the later speech candidate.
 const projectBefore=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));
 // Supply all remaining placeholder visuals through existing material adoption.
 for(const c of w.clips.filter((c:any)=>!c.source)){await send('registerWorkspaceVisualCandidate',{targetItemId:c.itemId,materialRevisionId:image.body.id,usage:'still',durationSeconds:4});const candidate=w.visualCandidates.find((v:any)=>v.targetItemId===c.itemId);const p=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target',motionPolicy:'preserve-target'});await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:p.adoptionId});}
 const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{doc.timelines[0].items.find((i:any)=>i.id===clip.itemId)!.transform.x=17;});const saved=await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256});w=saved.productionWorkspace;await send('closeWorkspaceStudio');
 await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','sine=frequency=660:sample_rate=48000','-t','5.2','-c:a','libmp3lame',f.controlled!.controlledVoicePath]);
 const second=await speech(first.text+'新版。');expect(second.durationSeconds).toBe(5.2);const short=await f.send('prepareWorkspaceCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:second.id,durationPolicy:'keep-target'});expect(short.status).toBe(409);expect(short.body.error).toContain('不会截断');
 const prepared=await send('prepareWorkspaceCandidate',{candidateId:second.id,durationPolicy:'use-candidate'});await send('adoptWorkspaceCandidate',{candidateId:second.id,adoptionId:prepared.adoptionId});expect(w.captions[0].inputFingerprint).not.toBe(captionFingerprint);expect(w.captions[0]).toMatchObject({timing:'stale',textConfirmed:false});expect(w.narration[0].windowWarning).toContain('拆镜');
 const after=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),visual=after.timelines[0].items.find((i:any)=>i.id===clip.itemId),voice=after.timelines[0].items.find((i:any)=>i.id===second.targetItemId);expect(visual.transform.x).toBe(17);expect(visual.durationInFrames).toBe(projectBefore.timelines[0].items.find((i:any)=>i.id===clip.itemId).durationInFrames);expect(voice.durationInFrames).toBe(156);expect(w.usedNarration[0].fullSourceUsed).toBe(true);
 await f.restart();const resumed=(await (await fetch(f.origin+`/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}})).json()).workspace;expect(resumed.usedNarration[0]).toMatchObject({taskId:second.taskId,fullSourceUsed:true});expect(resumed.captions[0].timing).toBe('stale');
 }finally{await f.close();}
},180000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('speech validates actual choices, ownership and budget, and an unknown paid request cannot be sent again after restart',async()=>{
 const {writeFile}=await import('node:fs/promises');const f=await narrationFixture();try{
 let w=await f.read();const a=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='volcengine_tts'")).rows[0].id;
 const selection={capability:'speech',provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0',connectionVersionId:a},args={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,mode:'tts',text:'未知结果不能重复收费。',selection,voice:'zh_female_vv_uranus_bigtts',speakingRate:1,languageCode:'zh-CN'};
 for(const change of [{selection:{...selection,model:'seed-tts-1.0'}},{voice:'old_voice_mars_bigtts'},{languageCode:'xx-XX'},{voice:'zh_male_m191_uranus_bigtts',languageCode:'en-US'},{speakingRate:2.1},{selection:{...selection,extra:true}}])expect((await f.request('saveWorkspaceNarration',{...args,...change})).status).toBe(400);
 expect((await f.request('saveWorkspaceNarration',args,{token:f.otherToken})).status).toBe(404);expect((await f.request('saveWorkspaceNarration',args,{csrf:false})).status).toBe(403);
 await f.c.query('UPDATE local_identity.connection_qualifications SET qualified=false WHERE version_id=$1',[a]);expect((await f.request('saveWorkspaceNarration',args)).status).toBe(409);
 // An unused speech connection cannot prevent an explicit no-voice choice.
 expect((await f.request('saveWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[1].id,mode:'none',text:'无需语音服务。'})).status).toBe(200);
 await f.c.query('UPDATE local_identity.connection_qualifications SET qualified=true WHERE version_id=$1',[a]);let r=await f.request('saveWorkspaceNarration',args);expect(r.status).toBe(200);w=r.body;
 r=await f.request('confirmWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id});expect(r.status).toBe(200);w=r.body;
 const generate=()=>f.request('generateWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,reservationCents:50,retry:true});expect((await generate()).status).toBe(409);await f.authorize();
 r=await generate();expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;const task=w.narration[0].taskId;await writeFile(f.responseMode,'unknown');await f.execute(task,false);await f.restart();await f.restartWorker();
 r=await generate();expect(r.status,JSON.stringify(r.body)).toBe(409);expect(r.body.error).toContain('未知');expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);expect((await f.c.query('SELECT reserved_cents,request_state FROM public.paid_generation_reservations WHERE task_id=$1',[task])).rows).toEqual([{reserved_cents:50,request_state:'submitting'}]);
 }finally{await f.close();}
},120000);
