// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner prepares manual episode music, adopts actual audio and persists native independent mix',async()=>{
 const f=await productionWorkspaceFixture({migrations:['db/local/088-workspace-audio.sql'],runtime:{wake(){}}});try{
 let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
 const send=(name:string,data={})=>f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...data});
 const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'music.mp3',contentBase64:(await readFile('/private/tmp/loop-152-orchestration/media/controlled-bgm-110hz.mp3')).toString('base64'),materialType:'audio',mimeType:'audio/mpeg',isMainScript:false,materialPurpose:'background_music'});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
 const prepared=await send('prepareWorkspaceAudio',{kind:'bgm',materialRevisionId:imported.body.id,description:'人工整期配乐',durationSeconds:4,anchor:'absolute',offsetSeconds:0});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);w=prepared.body;expect(w.audio.preparations[0].taskId).toBeNull();
 const adopted=await send('adoptWorkspaceAudio',{preparationId:w.audio.preparations[0].id});expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);w=adopted.body;expect(w.audio.mix.sounds).toHaveLength(1);expect(w.audio.mix.sounds[0]).toMatchObject({kind:'bgm',durationSeconds:4,gainDb:-12});
 const mixed=await send('mixWorkspaceAudio',{edit:{kind:'sound',workspaceId:w.id,itemId:w.audio.mix.sounds[0].itemId,gainDb:-18,duckDepthDb:14}});expect(mixed.status,JSON.stringify(mixed.body)).toBe(200);w=mixed.body;
 expect(w.audio.mix.sounds[0]).toMatchObject({gainDb:-18,duckDepthDb:14});
 const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(project.timelines[0].items.filter((i:any)=>i.kind==='audio')).toHaveLength(1);expect(project.timelines[0].tracks['workspace-bgm']).toMatchObject({role:'follower',audioRouting:{duckDepthDb:14}});
 expect((await f.c.query("SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1 AND task_type='generate_soundtrack'",[f.episode])).rows[0].n).toBe(0);
 expect((await send('prepareWorkspaceAudio',{kind:'bgm',query:'ambient',description:'整期',durationSeconds:4})).status).toBe(409);
 expect((await f.request('mixWorkspaceAudio',{workspaceId:w.id,expectedRevision:w.revision,edit:{}},{csrf:false})).status).toBe(403);
 await f.restart();const read=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect((await read.json()).workspace.audio.mix.sounds[0].gainDb).toBe(-18);
 }finally{await f.close();}
},120000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Freesound preparation traverses actual Worker lease and result, records attribution, retries failed work and restores after restart',async()=>{
 const {workspaceAudioFixture}=await import('./workspaceAudio.fixture');const f=await workspaceAudioFixture();try{
 let w=f.made;const send=(name:string,data={})=>f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...data});
 expect((await send('prepareWorkspaceAudio',{kind:'bgm',query:'ambient',description:'整期配乐',durationSeconds:4})).status).toBe(409);await f.authorize();
 const queued=await send('prepareWorkspaceAudio',{kind:'bgm',query:'ambient',description:'整期配乐',durationSeconds:4});expect(queued.status,JSON.stringify(queued.body)).toBe(200);w=queued.body;let prep=w.audio.preparations[0];expect(prep.status).toBe('ready');
 await import('node:fs/promises').then(fs=>fs.writeFile(f.audioResponseMode,'reject'));expect((await f.executeAudio(prep.taskId)).status).toBe('blocked');
 await f.restart();await import('node:fs/promises').then(fs=>fs.writeFile(f.audioResponseMode,'success'));const retry=await send('prepareWorkspaceAudio',{preparationId:prep.id,retry:true,kind:'bgm'});expect(retry.status,JSON.stringify(retry.body)).toBe(200);w=retry.body;expect(w.audio.preparations[0].taskId).not.toBe(prep.taskId);prep=w.audio.preparations[0];
 expect((await f.executeAudio(prep.taskId)).status).toBe('completed');const refresh=await send('refreshWorkspaceAudio');expect(refresh.status).toBe(200);w=refresh.body;expect(w.audio.preparations[0].source).toMatchObject({provider:'freesound',sourceId:'1',creator:'fixture',license:'https://creativecommons.org/publicdomain/zero/1.0/'});
 const adopted=await send('adoptWorkspaceAudio',{preparationId:prep.id});expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);w=adopted.body;expect(w.audio.mix.sounds[0].kind).toBe('bgm');await f.restart();expect((await f.read()).audio.preparations[0].adoptedItemId).toBe('workspace-bgm');
 }finally{await f.close();}
},180000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('source mode uses real native source extraction task without fabricating a legacy video-ready draft',async()=>{
 const {workspaceAudioFixture}=await import('./workspaceAudio.fixture');const f=await workspaceAudioFixture();try{
 let w=f.made;const send=(name:string,data={})=>f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...data});
 const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'source.mp4',contentBase64:(await readFile('/private/tmp/loop-152-orchestration/media/landscape-red-blue.mp4')).toString('base64'),materialType:'video',mimeType:'video/mp4',isMainScript:false,materialPurpose:'a_roll'});expect(imported.status).toBe(200);
 const matched=await send('matchWorkspaceMaterial',{clipId:w.clips[0].id,materialRevisionId:imported.body.id});expect(matched.status).toBe(200);w=matched.body;
 const prepared=await send('prepareWorkspaceAudio',{kind:'source',shotId:w.clips[0].shotId,sourceItemId:w.clips[0].itemId});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);w=prepared.body;const prep=w.audio.preparations[0];expect((await f.executeAudio(prep.taskId)).status).toBe('completed');
 const adopted=await send('adoptWorkspaceAudio',{preparationId:prep.id});expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);w=adopted.body;expect(w.audio.mix.voices[0].mode).toBe('source');
 const draft=(await f.c.query('SELECT video_status,current_audio_track_id FROM public.shot_preparation_drafts WHERE episode_id=$1 AND shot_id=$2',[f.episode,w.clips[0].shotId])).rows[0];expect(draft.video_status).not.toBe('ready');expect(draft.current_audio_track_id).toBeTruthy();
 const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),voice=project.timelines[0].items.find((i:any)=>i.id===`workspace-source-shot-${w.clips[0].shotId}`);expect(voice.sourceAssetId).toBe('audio-track-'+draft.current_audio_track_id);expect(project.timelines[0].items.find((i:any)=>i.id===w.clips[0].itemId).volume).toBe(0);
 }finally{await f.close();}
},180000);
