// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {confirmedTtsRender} from '../worker/openchatcutProject.fixture';
import {legacyHtmlFixture} from './legacyHtmlWorkspace.fixture';
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
it.skipIf(process.env.LOOP_LEGACY_EDIT_ACCEPTANCE!=='1').each(['legacy','registered'] as const)('adopts frozen HTML over real HTTP/PG/SDK, permits per-shot replacement, saves and reopens without touching original records (%s)',async layout=>{
 const f=await productionWorkspaceFixture({episodeRelativePath:layout==='registered'?()=> 'HTML恢复 [T09]_%/本单':undefined,migrations:['db/local/120-native-workspace-storage-locations.sql']});
 try{
  const render=confirmedTtsRender(),audio=randomUUID(),artifact=randomUUID(),path=`${f.episodeRelativePath}/original.html`;
  render.preRenderReviewPackageId=f.board;render.members[0].relativePath=f.videoPath;render.members[1].relativePath=`${f.episodeRelativePath}/voice.mp3`;render.members[0].sha256=f.files[0].sha256;render.members[1].sha256=f.files[1].sha256;render.members[1].audioTrackId=audio;render.confirmedShots[0].audioTrackId=audio;
  const fixture=legacyHtmlFixture(render,true),bytes=Buffer.from(fixture.html);await writeFile(join(f.assetRoot,path),bytes);
  await f.c.query('UPDATE public.tasks SET input_snapshot=$2 WHERE id=$1',[f.task,{...fixture.snapshot,input_artifacts:f.files}]);
  await f.c.query('UPDATE public.review_packages SET context_snapshot=$2 WHERE id=$1',[f.board,{worker_result:{storyboard:render.storyboard}}]);
  await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'review_render_project',$4,$5,$6)",[artifact,f.episode,f.task,path,hash(bytes),bytes.length]);
  const voiceArtifact=randomUUID();await f.c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'audio',$4,$5,$6)",[voiceArtifact,f.episode,f.task,render.members[1].relativePath,f.files[1].sha256,f.files[1].fileSize]);
  await f.c.query("INSERT INTO public.audio_tracks(id,episode_id,source_task_id,source_artifact_id,track_kind,cue_id,relative_path,sha256,file_size,duration_seconds) VALUES($1,$2,$3,$4,'narration','shot-1',$5,$6,$7,2)",[audio,f.episode,f.task,voiceArtifact,render.members[1].relativePath,f.files[1].sha256,f.files[1].fileSize]);
  await f.c.query('DELETE FROM local_identity.input_episodes WHERE episode_id=$1',[f.episode]);
  const fingerprint=async()=>(await f.c.query("SELECT jsonb_build_object('episode',(SELECT to_jsonb(e) FROM public.episodes e WHERE id=$1),'tasks',(SELECT jsonb_agg(t ORDER BY id) FROM public.tasks t WHERE episode_id=$1),'reviews',(SELECT jsonb_agg(r ORDER BY id) FROM public.review_packages r WHERE episode_id=$1),'materials',(SELECT jsonb_agg(m ORDER BY id) FROM public.production_material_revisions m WHERE episode_id=$1)) value",[f.episode])).rows[0].value,before=await fingerprint();
  const data={artifactId:artifact,expectedSourceSha256:hash(bytes),expectedScriptRevisionId:f.script,reviewPackageId:f.board};
  expect((await f.request('adoptLegacyWorkspace',data,{token:f.otherToken})).status).toBe(404);expect((await f.request('adoptLegacyWorkspace',{...data,expectedSourceSha256:'0'.repeat(64)})).status).toBe(409);
  const adopted=await f.request('adoptLegacyWorkspace',data);expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);let w=adopted.body;expect(w.recovery.relativePath.startsWith(f.episodeRelativePath+'/production-workspace/recoveries/')).toBe(true);
  expect(w.clips).toHaveLength(2);expect(w.readiness.placeholders).toEqual([]);expect(w.readiness.missingSources).toEqual([]);expect(w.preparation.authorized).toBe(false);expect(w.captions).toHaveLength(1);expect(w.captions[0].textConfirmed).toBe(false);expect(w.narration[0].mode).toBe('manual');expect(w.narration[0].adoptedAudioTrackId).toBe(audio);expect(w.captions[0].contract.cues[0].endMs).toBe(2000);
  const project=async(sha:string)=>{const r=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace/project?sha=${sha}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);return(await r.json()).project;};
  const original=await project(w.project.sha256);expect(original.timelines[0].items.filter((i:any)=>i.kind==='video')).toHaveLength(2);expect(original.timelines[0].items.find((i:any)=>i.kind==='audio').sourceAssetId).toBe(`audio-track-${audio}`);
  const target=w.clips[0];
  const registered=await f.request('registerWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:target.itemId,materialRevisionId:f.material,usage:'video',durationSeconds:2});expect(registered.status,JSON.stringify(registered.body)).toBe(200);w=registered.body;
  const candidate=w.visualCandidates[0],prepared=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'keep-target'});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  const replaced=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:prepared.body.adoptionId});expect(replaced.status,JSON.stringify(replaced.body)).toBe(200);w=replaced.body;
  const after=await project(w.project.sha256);const untouched=after.timelines[0].items.find((i:any)=>i.kind==='video'&&i.id!==target.itemId),previous=original.timelines[0].items.find((i:any)=>i.kind==='video'&&i.id!==target.itemId);expect(untouched.loopControlShot.provenance).toMatchObject({sha256:f.files[0].sha256,materialRevisionId:f.material});delete untouched.loopControlShot.provenance;expect(untouched).toEqual(previous);expect(after.timelines[0].items.find((i:any)=>i.kind==='audio')).toEqual(original.timelines[0].items.find((i:any)=>i.kind==='audio'));
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
  const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:opened.body.workspace.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;
  await f.restart();expect((await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision})).status).toBe(200);
  expect(await readFile(join(f.assetRoot,path))).toEqual(bytes);expect(await fingerprint()).toEqual(before);expect((await f.request('adoptLegacyWorkspace',data)).status).toBe(409);
  const flags=(await f.c.query('SELECT * FROM local_identity.input_episodes WHERE episode_id=$1',[f.episode])).rows[0];for(const key of ['enabled','storyboard_enabled','media_enabled','narration_enabled','studio_enabled'])expect(flags[key]).toBe(false);
 }finally{await f.close();}
},180000);
