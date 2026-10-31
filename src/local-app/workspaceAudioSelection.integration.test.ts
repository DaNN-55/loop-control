// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceAudioFixture} from './workspaceAudio.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('independent audio searches freeze connection and query across blueprint changes, retries, audition and explicit native adoption',async()=>{
 const f=await workspaceAudioFixture();try{
 await f.authorize();let w=f.made;
 const send=async(name:string,data={})=>{const r=await f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;return w;};
 const a=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='freesound_preview'")).rows[0].id;
 const b=randomUUID(),connection=randomUUID(),secret=randomUUID();await f.c.query('BEGIN');
 await f.c.query("INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,'freesound','freesound_preview','Audio B',$2,$3,'https://freesound.org/apiv2')",[connection,f.owner,b]);
 await f.c.query("INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES($1,$2,1,'freesound','freesound_preview','https://freesound.org/apiv2',$3)",[b,connection,secret]);
 await f.c.query("INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES($1,$2,$3,'keychain')",[b,f.owner,secret]);
 await f.c.query('INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified) VALUES($1,$2,true)',[b,f.owner]);
 await f.c.query("INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome) VALUES($1,$2,'live','verified')",[b,f.owner]);await f.c.query('COMMIT');
 // No soundtrack tool remains on this production order. Only the request selects it.
 const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
 await f.c.query('BEGIN');await f.c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);await f.c.query('SET SESSION AUTHORIZATION loop_app');await f.c.query('SELECT public.update_current_blueprint($1,$2)',[account,{asset_root:f.assetRoot,positioning:'保留自然音色'}]);await f.c.query('SET SESSION AUTHORIZATION DEFAULT');await f.c.query('UPDATE public.episodes SET blueprint_version_id=(SELECT current_blueprint_version_id FROM public.accounts WHERE id=$2) WHERE id=$1',[f.episode,account]);await f.c.query('COMMIT');
 const selection=(id:string)=>({capability:'music_sound',provider:'freesound',adapter:'freesound_preview',connectionVersionId:id});
 const args={kind:'sfx',description:'门铃',query:'door bell',durationSeconds:.4,anchor:'shot',shotId:w.clips[0].shotId,offsetSeconds:.2};
 const originalSha=w.project.sha256;
 await send('prepareWorkspaceAudio',{...args,selection:selection(a)});const prepA=w.audio.preparations[0];
 await send('prepareWorkspaceAudio',{...args,description:'风声',query:'soft wind',selection:selection(b)});const prepB=w.audio.preparations[0];
 const originalA=(await f.c.query("SELECT input_snapshot-'runtime_constraints' input_snapshot FROM public.tasks WHERE id=$1",[prepA.taskId])).rows[0].input_snapshot;
 await f.c.query('BEGIN');const rotated=randomUUID();await f.c.query("INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) SELECT $2,connection_id,2,provider,adapter,endpoint,vault_secret_id FROM public.external_connection_versions WHERE id=$1",[a,rotated]);await f.c.query('UPDATE public.external_connections SET current_version_id=$2 WHERE current_version_id=$1',[a,rotated]);await f.c.query('COMMIT');
 await writeFile(f.audioResponseMode,'reject');await f.executeAudio(prepA.taskId,false);
 await writeFile(f.audioResponseMode,'success');await f.executeAudio(prepB.taskId);
 await f.restart();await send('prepareWorkspaceAudio',{kind:'sfx',preparationId:prepA.id,retry:true});const retried=w.audio.preparations.find((p:any)=>p.id===prepA.id);await f.executeAudio(retried.taskId);
 w=await f.read();expect(w.project.sha256).toBe(originalSha);expect(w.audio.preparations).toHaveLength(2);expect(w.audio.preparations.every((p:any)=>p.status==='completed'&&!p.adoptedItemId)).toBe(true);
 const frozen=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=ANY($1::uuid[]) ORDER BY created_at',[[prepA.taskId,prepB.taskId,retried.taskId]])).rows.map(r=>r.input_snapshot);
 expect(frozen.map(r=>r.credential_ref)).toEqual([a,b,a]);expect(frozen.map(r=>r.media.soundtrack.query)).toEqual(['door bell','soft wind','door bell']);expect((await f.c.query("SELECT input_snapshot-'runtime_constraints' input_snapshot FROM public.tasks WHERE id=$1",[prepA.taskId])).rows[0].input_snapshot).toEqual(originalA);expect(frozen[2].production_selection).toEqual(frozen[0].production_selection);expect(frozen[0].workspace_target.projectSha256).toBe(originalSha);
 const calls=(await readFile(f.audioSubmissions,'utf8')).trim().split('\n').map(s=>new URL(s)).filter(u=>u.hostname==='freesound.org');const secretA=(await f.c.query('SELECT secret_ref FROM local_identity.connection_bindings WHERE version_id=$1',[a])).rows[0].secret_ref;expect(calls.map(u=>u.searchParams.get('token'))).toEqual(['synthetic-t06-'+secretA,'synthetic-t06-'+secret,'synthetic-t06-'+secretA]);
 for(const p of w.audio.preparations){const response=await fetch(f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(p.relativePath)}&sha256=${p.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(100);}
 await send('adoptWorkspaceAudio',{preparationId:prepA.id});await send('adoptWorkspaceAudio',{preparationId:prepB.id});expect(w.audio.mix.sounds).toHaveLength(2);
 const first=w.audio.mix.sounds.find((s:any)=>s.itemId===`workspace-sfx-${prepA.id}`);await send('mixWorkspaceAudio',{edit:{kind:'sound',workspaceId:w.id,itemId:first.itemId,gainDb:-19,duckDepthDb:3}});
 await f.restart();w=await f.read();expect(w.audio.mix.sounds.find((s:any)=>s.itemId===first.itemId)).toMatchObject({gainDb:-19,startSeconds:.2,durationSeconds:.4});
 // Fill all actual visual sources, then save/reopen the real native workspace.
 w=await f.fillVisuals(w);const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
 const {editStudioDocument}=await import('./studioDocument.fixture');await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{const effect=doc.timelines[0].items.find((i:any)=>i.id===first.itemId);effect.startFrame=12;effect.volume=10**(-17/20);});
 const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;await send('closeWorkspaceStudio');
 const reopened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(reopened.status,JSON.stringify(reopened.body)).toBe(200);w=reopened.body.productionWorkspace;await send('closeWorkspaceStudio');expect(w.audio.mix.sounds.find((s:any)=>s.itemId===first.itemId)).toMatchObject({gainDb:-17,startSeconds:.4});
 const doc=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(doc.timelines[0].items.filter((i:any)=>String(i.id).startsWith('workspace-sfx-'))).toHaveLength(2);
 }finally{await f.close();}
},180000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('invalid audio selections do not enqueue and unavailable search never blocks uploaded music or original audio',async()=>{
 const f=await workspaceAudioFixture();try{
 await f.authorize();let w=f.made;const a=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='freesound_preview'")).rows[0].id;
 const selection={capability:'music_sound',provider:'freesound',adapter:'freesound_preview',connectionVersionId:a},args={workspaceId:w.id,expectedRevision:w.revision,kind:'sfx',description:'检索音效',query:'bell',durationSeconds:.4,selection};
 for(const change of [{selection:{...selection,model:'freesound-preview-v1'}},{selection:{...selection,capability:'image'}},{selection:{...selection,endpoint:'https://elsewhere.invalid'}},{query:'中文'}])expect((await f.request('prepareWorkspaceAudio',{...args,...change})).status).toBe(400);
 expect((await f.request('prepareWorkspaceAudio',args,{token:f.otherToken})).status).toBe(404);expect((await f.request('prepareWorkspaceAudio',args,{csrf:false})).status).toBe(403);
 expect((await f.request('prepareWorkspaceAudio',{...args,selection:{...selection,connectionVersionId:randomUUID()}})).status).toBe(409);
 expect((await f.read()).audio.preparations).toHaveLength(0);
 const queued=await f.request('prepareWorkspaceAudio',args);expect(queued.status).toBe(200);w=queued.body;const p=w.audio.preparations[0];await writeFile(f.audioResponseMode,'empty');expect((await f.executeAudio(p.taskId,false)).status).toBe('failed');w=await f.read();expect(w.audio.preparations[0].error).toContain('未找到');
 await f.c.query('UPDATE local_identity.connection_qualifications SET qualified=false WHERE version_id=$1',[a]);
 const send=async(name:string,data={})=>{const r=await f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;};
 const uploaded=await f.request('importMaterial',{sourceKind:'file',sourcePath:'own-music.mp3',contentBase64:(await readFile(f.media.bgm)).toString('base64'),materialType:'audio',mimeType:'audio/mpeg',isMainScript:false,materialPurpose:'background_music'});expect(uploaded.status).toBe(200);
 await send('prepareWorkspaceAudio',{kind:'bgm',materialRevisionId:uploaded.body.id,description:'上传配乐',durationSeconds:4});await send('adoptWorkspaceAudio',{preparationId:w.audio.preparations[0].id});expect(w.audio.mix.sounds[0].kind).toBe('bgm');
 const video=await f.request('importMaterial',{sourceKind:'file',sourcePath:'source.mp4',contentBase64:(await readFile(f.media.video)).toString('base64'),materialType:'video',mimeType:'video/mp4',isMainScript:false,materialPurpose:'a_roll'});expect(video.status).toBe(200);await send('matchWorkspaceMaterial',{clipId:w.clips[0].id,materialRevisionId:video.body.id});
 await send('prepareWorkspaceAudio',{kind:'source',sourceItemId:w.clips[0].itemId});const source=w.audio.preparations[0];await f.executeAudio(source.taskId);await send('adoptWorkspaceAudio',{preparationId:source.id});expect(w.audio.mix.voices[0].mode).toBe('source');
 expect((await f.c.query('SELECT count(*)::int n FROM public.paid_generation_reservations r JOIN public.tasks t ON t.id=r.task_id WHERE t.episode_id=$1',[f.episode])).rows[0].n).toBe(0);
 }finally{await f.close();}
},180000);
