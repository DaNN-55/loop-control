// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceAudioFixture} from './workspaceAudio.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('episode audio defaults survive reopening without changing shot overrides, frozen tasks, candidates or adopted tracks',async()=>{
 const f=await workspaceAudioFixture();try{
 await f.authorize();let w=await f.read();
 const send=async(name:string,data={})=>{const r=await f.chosenRequest(name,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;return w;};
 const musicVersion=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='freesound_preview'")).rows[0].id;
 const musicBId=randomUUID(),musicBConnection=randomUUID(),musicBSecret=randomUUID();
 await f.c.query('BEGIN');
 await f.c.query("INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,'freesound','freesound_preview','Default B',$2,$3,'https://freesound.org/apiv2')",[musicBConnection,f.owner,musicBId]);
 await f.c.query("INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES($1,$2,1,'freesound','freesound_preview','https://freesound.org/apiv2',$3)",[musicBId,musicBConnection,musicBSecret]);
 await f.c.query("INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES($1,$2,$3,'keychain')",[musicBId,f.owner,musicBSecret]);
 await f.c.query('INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified) VALUES($1,$2,true)',[musicBId,f.owner]);
 await f.c.query("INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome) VALUES($1,$2,'live','verified')",[musicBId,f.owner]);await f.c.query('COMMIT');
 const music={capability:'music_sound',provider:'freesound',adapter:'freesound_preview',connectionVersionId:musicVersion};
 const originalSha=w.project.sha256,originalNarration=structuredClone(w.narration);
 await send('saveWorkspaceAudioDefaults',{selection:music});
 expect(w.audio.defaults).toEqual({selection:music});expect(w.audio.preparations).toHaveLength(0);expect(w.narration).toEqual(originalNarration);expect(w.project.sha256).toBe(originalSha);
 await send('saveWorkspaceNarrationDefaults',f.narrationSettings);
 const clip=w.clips[0],override={...f.narrationSettings,speakingRate:1.25};
 await send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',text:'本镜保留独立声音设置',...override});await send('confirmWorkspaceNarration',{clipId:clip.id});await send('generateWorkspaceNarration',{clipId:clip.id});
 const task=w.narration.find((n:any)=>n.shotId===clip.shotId).taskId;
 await send('saveWorkspaceNarrationDefaults',{...f.narrationSettings,speakingRate:.85});
 await f.restart();w=await f.read();
 expect(w.audio.defaults).toEqual({selection:music});expect(w.narration[0].defaults.speakingRate).toBe(.85);
 expect(w.narration.find((n:any)=>n.shotId===clip.shotId)).toMatchObject({speakingRate:1.25,taskId:task,execution:{taskId:task,speakingRate:1.25,text:'本镜保留独立声音设置'}});
 await f.execute(task);w=await f.read();const candidate=w.candidates.find((c:any)=>c.taskId===task);expect(candidate.status).toBe('available');
 const frozenCandidate=structuredClone(candidate),readySha=w.project.sha256;
 await send('saveWorkspaceNarrationDefaults',{...f.narrationSettings,speakingRate:1.1});
 expect(w.candidates.find((c:any)=>c.taskId===task)).toEqual(frozenCandidate);expect(w.project.sha256).toBe(readySha);
 // A new default connection must not rewrite an already queued music request.
 const musicB={...music,connectionVersionId:musicBId};
 await send('prepareWorkspaceAudio',{kind:'bgm',description:'已冻结检索',query:'piano',durationSeconds:.4,selection:music});const musicPreparation=w.audio.preparations[0];
 await send('saveWorkspaceAudioDefaults',{selection:musicB});await f.restart();w=await f.read();expect(w.audio.defaults).toEqual({selection:musicB});expect(w.audio.preparations.find((p:any)=>p.id===musicPreparation.id)).toMatchObject({selection:music,query:'piano',taskId:musicPreparation.taskId});
 await f.executeAudio(musicPreparation.taskId);w=await f.read();expect(w.audio.preparations.find((p:any)=>p.id===musicPreparation.id)).toMatchObject({selection:music,status:'completed',adoptedItemId:null});
 // Adopt local music through real files, then prove changing defaults does not remix it.
 const uploaded=await f.request('importMaterial',{sourceKind:'file',sourcePath:'own-music.mp3',contentBase64:(await readFile(f.media.bgm)).toString('base64'),materialType:'audio',mimeType:'audio/mpeg',isMainScript:false,materialPurpose:'background_music'});expect(uploaded.status).toBe(200);
 await send('prepareWorkspaceAudio',{kind:'bgm',materialRevisionId:uploaded.body.id,description:'已采用配乐',durationSeconds:.4});await send('adoptWorkspaceAudio',{preparationId:w.audio.preparations[0].id});
 const used=structuredClone(w.audio.mix),usedSha=w.project.sha256;
 await send('saveWorkspaceAudioDefaults',{selection:music});await f.restart();w=await f.read();expect(w.audio.mix).toEqual(used);expect(w.project.sha256).toBe(usedSha);expect(w.candidates.find((c:any)=>c.taskId===task)).toEqual(frozenCandidate);
 const secondTab=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(secondTab.status).toBe(200);expect((await secondTab.json()).workspace.audio.defaults).toEqual({selection:music});
 const invalid=await f.request('saveWorkspaceAudioDefaults',{workspaceId:w.id,expectedRevision:w.revision,selection:{...music,model:'unexpected'}});expect(invalid.status).toBe(400);
 expect((await f.request('saveWorkspaceAudioDefaults',{workspaceId:w.id,expectedRevision:w.revision,selection:music},{token:f.otherToken})).status).toBe(404);
 expect((await f.request('saveWorkspaceAudioDefaults',{workspaceId:w.id,expectedRevision:w.revision,selection:music},{csrf:false})).status).toBe(403);
 await send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',text:'下一次生成的当前输入',...f.narrationSettings,speakingRate:1.4});expect(w.narration.find((n:any)=>n.shotId===clip.shotId)).toMatchObject({taskId:null,speakingRate:1.4,execution:{taskId:task,speakingRate:1.25,text:'本镜保留独立声音设置'}});
 const submissions=(await readFile(f.submissions,'utf8')).trim().split('\n').map(s=>JSON.parse(s));expect(submissions).toHaveLength(1);expect(submissions[0].body.req_params.speaker).toBe(override.voice);
 if(process.env.LOOP_SOUND_EVIDENCE)await writeFile(join(process.env.LOOP_SOUND_EVIDENCE,'audio-defaults.json'),JSON.stringify({workspace:w,taskId:task,musicDefaults:w.audio.defaults,narrationDefaults:w.narration[0].defaults,execution:w.narration[0].execution,usedMix:w.audio.mix,supplierPosts:submissions.length,audioPreparationTaskId:musicPreparation.taskId,projectSha:usedSha},null,2));
 }finally{await f.close();}
},180000);
