// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {editStudioDocument} from './studioDocument.fixture';

async function registeredMusicFixture(){
 const f=await productionWorkspaceFixture({runtime:{wake(){}}});
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);
  const track=randomUUID(),task=randomUUID(),artifact=randomUUID(),path=f.episodeRelativePath+'/registered-music.mp3';
  execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=220:sample_rate=48000','-t','6','-c:a','libmp3lame',join(f.assetRoot,path)]);const bytes=await readFile(join(f.assetRoot,path)),sha=createHash('sha256').update(bytes).digest('hex');
  await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,provider,input_snapshot) VALUES($1,$2,'generate_soundtrack','completed','freesound',$3)",[task,f.episode,{original:'registered music output'}]);
  await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'soundtrack_audio',$4,$5,$6)",[artifact,f.episode,task,path,sha,bytes.length]);
  await f.c.query("INSERT INTO public.audio_tracks(id,episode_id,source_task_id,source_artifact_id,source_review_package_id,track_kind,cue_id,relative_path,sha256,file_size,duration_seconds) VALUES($1,$2,$3,$4,$5,'bgm','original-music',$6,$7,$8,6)",[track,f.episode,task,artifact,f.board,path,sha,bytes.length]);
  const facts=async()=>(await f.c.query("SELECT jsonb_build_object('tasks',(SELECT jsonb_agg(t ORDER BY id) FROM public.tasks t WHERE episode_id=$1),'tracks',(SELECT jsonb_agg(a ORDER BY id) FROM public.audio_tracks a WHERE episode_id=$1),'materials',(SELECT jsonb_agg(m ORDER BY id) FROM public.production_material_revisions m WHERE episode_id=$1)) value",[f.episode])).rows[0].value,before=await facts();
  return{...f,w,track,task,artifact,path,sha,facts,before};
 }catch(error){await f.close();throw error;}
}

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('prepares an exact existing music track locally without manufacturing a material, task or adoption, then edits and reopens the adopted sound',async()=>{
 const f=await registeredMusicFixture();let w=f.w;const{track,path,sha,facts,before}=f;
 try{
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const r=await f.rawRequest('prepareWorkspaceAudio',{workspaceId:w.id,expectedRevision:w.revision,kind:'bgm',audioTrackId:track,description:'原登记配乐',durationSeconds:4,anchor:'absolute',offsetSeconds:0});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;
  const prep=w.audio.preparations[0];expect(prep).toMatchObject({status:'ready',taskId:null,audioTrackId:track,relativePath:path,sha256:sha,adoptedItemId:null});expect(w.audio.mix.sounds).toHaveLength(0);expect(await facts()).toEqual(before);
  await send('adoptWorkspaceAudio',{preparationId:prep.id});expect(w.audio.mix.sounds).toHaveLength(1);
  for(const clip of w.clips)await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{expect(doc.timelines[0].items.some((i:any)=>i.kind==='audio'&&i.sourceAssetId===`audio-track-${track}`)).toBe(true);});await send('closeWorkspaceStudio');await f.restart();
  const response=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);expect((await response.json()).workspace.audio.preparations[0].audioTrackId).toBe(track);expect(await facts()).toEqual(before);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['invalidated','failed','artifact','sha'] as const)('revalidates %s source evidence after local preparation without adopting it or creating a request',async(kind)=>{
 const f=await registeredMusicFixture();
 try{
  const data={workspaceId:f.w.id,expectedRevision:f.w.revision,kind:'bgm',audioTrackId:f.track,description:'本地原轨',durationSeconds:4};
  const made=await f.rawRequest('prepareWorkspaceAudio',data);expect(made.status,JSON.stringify(made.body)).toBe(200);const p=made.body.audio.preparations[0];
  if(kind==='invalidated')await f.c.query("UPDATE public.tasks SET invalidated_at=now(),invalidated_reason='Original invalidated' WHERE id=$1",[f.task]);
  if(kind==='failed')await f.c.query("UPDATE public.tasks SET status='blocked',last_result=$2 WHERE id=$1",[f.task,{blockers:[{code:'provider_outcome_unknown'}]}]);
  if(kind==='artifact')await f.c.query("UPDATE public.artifacts SET sha256=repeat('e',64) WHERE id=$1",[f.artifact]);
  if(kind==='sha'){const bytes=await readFile(join(f.assetRoot,f.path)),bad=Buffer.from(bytes);bad[bad.length-1]^=1;await writeFile(join(f.assetRoot,f.path),bad);}
  const before=await f.facts(),r=await f.rawRequest('adoptWorkspaceAudio',{workspaceId:f.w.id,expectedRevision:f.w.revision,preparationId:p.id});expect(r.status,JSON.stringify(r.body)).toBe(409);expect(await f.facts()).toEqual(before);
  const read=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(read.status).toBe(200);expect((await read.json()).workspace.audio.mix.sounds).toHaveLength(0);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('rejects malformed local pointers, mixed inputs and foreign Owner while keeping the retry confirmation gate',async()=>{
 const f=await registeredMusicFixture();
 try{
  const data={workspaceId:f.w.id,expectedRevision:f.w.revision,kind:'bgm',audioTrackId:f.track,description:'本地原轨',durationSeconds:4};
  for(const audioTrackId of [null,'',0,{}]){const r=await f.rawRequest('prepareWorkspaceAudio',{...data,audioTrackId});expect(r.status,JSON.stringify(r.body)).toBe(400);}
  expect((await f.rawRequest('prepareWorkspaceAudio',{...data,materialRevisionId:f.material})).status).toBe(400);expect((await f.rawRequest('prepareWorkspaceAudio',{...data,kind:'source'})).status).toBe(400);expect((await f.rawRequest('prepareWorkspaceAudio',data,{token:f.otherToken})).status).toBe(404);
  const retry=await f.rawRequest('prepareWorkspaceAudio',{...data,preparationId:randomUUID(),retry:true});expect(retry.status).toBe(409);expect(retry.body.error).toContain('确认本次调用');
  expect((await f.rawRequest('prepareWorkspaceAudio',{...data,kind:'sfx'})).status).toBe(409);expect((await f.rawRequest('prepareWorkspaceAudio',{...data,durationSeconds:8})).status).toBe(409);expect(await f.facts()).toEqual(f.before);
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.workspace_audio_preparations WHERE workspace_id=$1',[f.w.id])).rows[0].n).toBe(0);
 }finally{await f.close();}
},90000);
