// @vitest-environment node
import {expect,it} from 'vitest';
import {observeWorkspaceReadback} from './workspaceReadback.fixture';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {narrationFixture} from './workspaceNarration.fixture';
import {workspaceAudioFixture} from './workspaceAudio.fixture';
import {editStudioDocument} from './studioDocument.fixture';

const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';

it.skipIf(!enabled)('caption edits assemble one final response with current timing and survive an Owner restart',async()=>{
 const f=await productionWorkspaceFixture(),measure=observeWorkspaceReadback(f.pool);
 try{
  const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(made.status).toBe(200);let w=made.body;
  const contract=defaultShotCaptionContract('完整响应中的新字幕','independent');contract.cues=[{id:'manual',text:contract.text,startMs:100,endMs:900}];
  const saved=await measure(()=>f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,captionContract:contract}));
  expect(saved.result.status,JSON.stringify(saved.result.body)).toBe(200);w=saved.result.body;
  expect(w.captions[0].contract.text).toBe(contract.text);expect(w.captions[0].timing).toBe('current');
  await f.restart();const response=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);
  const resumed=(await response.json()).workspace;expect(resumed).toMatchObject({revision:w.revision,project:{sha256:w.project.sha256}});expect(resumed.captions[0]).toMatchObject({timing:'current',contract:{text:contract.text}});
  expect(saved.reads).toBe(1);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('pool registration, matching, Studio recovery and replanning assemble only the required final states',async()=>{
 const f=await productionWorkspaceFixture(),measure=observeWorkspaceReadback(f.pool);
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const pool=await measure(()=>f.request('prepareWorkspaceVisualPool',{workspaceId:w.id,expectedRevision:w.revision,materialRevisionId:f.material}));expect(pool.result.status).toBe(200);expect(pool.result.body.asset).toMatchObject({id:`material-${f.material}`,kind:'video',sourceContentHash:f.files[0].sha256});
  const read=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(read.status).toBe(200);w=(await read.json()).workspace;
  const document=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(document.assets.some((a:any)=>a.id===pool.result.body.asset.id)).toBe(true);
  const reads=[pool.reads];
  for(const clip of w.clips){const matched=await measure(()=>f.request('matchWorkspaceMaterial',{workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id,materialRevisionId:f.material}));expect(matched.result.status,JSON.stringify(matched.result.body)).toBe(200);w=matched.result.body;reads.push(matched.reads);}
  expect(w.readiness.placeholders).toEqual([]);
  const opened=await measure(()=>f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision}));expect(opened.result.status).toBe(200);w=opened.result.body.productionWorkspace;reads.push(opened.reads);
  await editStudioDocument(opened.result.body.studioUrl,w.project.projectId,doc=>{doc.timelines[0].items.find((i:any)=>i.id===w.clips[0].itemId).x=42;const lane=Object.values(doc.timelines[0].tracks).flatMap((t:any)=>t.captions?.sourceEntries??[])[0] as any;lane.words[0].text='恢复后的新字幕';lane.words[0].start=120;lane.words[0].end=700;});
  const closed=await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(closed.status).toBe(200);w=closed.body;await f.restart();
  const restored=await measure(()=>f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision}));expect(restored.result.status,JSON.stringify(restored.result.body)).toBe(200);expect(restored.result.body.recoveredNativeEdits).toBe(true);w=restored.result.body.productionWorkspace;reads.push(restored.reads);
  expect(w.captions[0]).toMatchObject({timing:'current',contract:{text:'恢复后的新字幕'}});expect(JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')).timelines[0].items.find((i:any)=>i.id===w.clips[0].itemId).x).toBe(42);
  const closedAgain=await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(closedAgain.status).toBe(200);w=closedAgain.body;const oldSha=w.project.sha256;
  const script=randomUUID(),board=randomUUID(),path=`episodes/${f.episode}/readback-script.md`,bytes=Buffer.from('明确重新规划的脚本。');await writeFile(join(f.assetRoot,path),bytes);
  await f.c.query("INSERT INTO public.production_material_revisions(id,episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,is_main_script,created_by,material_purpose) VALUES($1,$2,3,'script','paste',$3,$3,'text/markdown',$4,$5,true,$6,'main_script')",[script,f.episode,path,createHash('sha256').update(bytes).digest('hex'),bytes.length,f.owner]);
  await f.c.query('UPDATE public.episodes SET main_script_revision_id=$2 WHERE id=$1',[f.episode,script]);
  await f.c.query("UPDATE public.review_packages SET invalidated_at=now(),invalidated_reason='受控重规划' WHERE id=$1",[f.board]);
  await f.c.query('INSERT INTO public.review_packages(id,episode_id,stage,revision_number,artifact_id,task_id,context_snapshot) SELECT $1,episode_id,stage,2,artifact_id,task_id,context_snapshot FROM public.review_packages WHERE id=$2',[board,f.board]);
  await f.c.query("INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id) SELECT account_id,id,'main_script_reconfirmed',jsonb_build_object('material_id',$2::text,'reason','调整叙事顺序'),$3 FROM public.episodes WHERE id=$1",[f.episode,script,f.owner]);
  const replanned=await measure(()=>f.request('replanWorkspace',{workspaceId:w.id,expectedRevision:w.revision,reviewPackageId:board,expectedScriptRevisionId:script,reason:'调整叙事顺序'}));expect(replanned.result.status,JSON.stringify(replanned.result.body)).toBe(200);w=replanned.result.body;reads.push(replanned.reads);
  expect(w.scriptRevisionId).toBe(script);expect(w.history.some((h:any)=>h.sha256===oldSha)).toBe(true);expect(w.history.some((h:any)=>h.reason==='调整叙事顺序')).toBe(true);
  expect(reads).toEqual([0,1,1,2,2,1]);
 }finally{await f.close();}
},180000);

it.skipIf(!enabled)('uploaded music adoption, mixing and switches preserve the final preparation and gain with one readback each',async()=>{
 const f=await workspaceAudioFixture(),measure=observeWorkspaceReadback(f.pool);
 try{
  await f.authorize();let w=f.made;
  const uploaded=await f.request('importMaterial',{sourceKind:'file',sourcePath:'readback.mp3',contentBase64:(await readFile(f.media.bgm)).toString('base64'),materialType:'audio',mimeType:'audio/mpeg',isMainScript:false,materialPurpose:'background_music'});expect(uploaded.status).toBe(200);
  const base=()=>({workspaceId:w.id,expectedRevision:w.revision});
  const prepared=await f.request('prepareWorkspaceAudio',{...base(),kind:'bgm',materialRevisionId:uploaded.body.id,description:'读回回归配乐',durationSeconds:1});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);w=prepared.body;
  const preparationId=w.audio.preparations[0].id,adopted=await measure(()=>f.request('adoptWorkspaceAudio',{...base(),preparationId}));expect(adopted.result.status,JSON.stringify(adopted.result.body)).toBe(200);w=adopted.result.body;
  const itemId=w.audio.mix.sounds[0].itemId;expect(w.audio.preparations[0].adoptedItemId).toBe(itemId);expect(w.audio.mix.sounds[0].kind).toBe('bgm');
  const mixed=await measure(()=>f.request('mixWorkspaceAudio',{...base(),edit:{kind:'sound',workspaceId:w.id,itemId,gainDb:-18,duckDepthDb:3}}));expect(mixed.result.status).toBe(200);w=mixed.result.body;expect(w.audio.mix.sounds[0].gainDb).toBe(-18);
  const reads=[adopted.reads,mixed.reads];
  for(const enabled of [false,true]){const changed=await measure(()=>f.request('setWorkspaceAudioEnabled',{...base(),kind:'bgm',enabled}));expect(changed.result.status).toBe(200);w=changed.result.body;expect(w.audio.enabled.bgm).toBe(enabled);reads.push(changed.reads);}
  await f.restart();const response=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);w=(await response.json()).workspace;expect(w.audio.mix.sounds[0]).toMatchObject({itemId,gainDb:-18});expect(w.audio.preparations[0].adoptedItemId).toBe(itemId);
  expect(reads).toEqual([1,1,1,1]);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('narration adoption and switches return the final track and mode using one readback each',async()=>{
 const f=await narrationFixture(),measure=observeWorkspaceReadback(f.pool);
 try{
  await f.authorize();let w=f.made;const clip=w.clips[0],base=()=>({workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id});
  expect((await f.request('saveWorkspaceNarration',{...base(),mode:'tts',...f.narrationSettings,text:'只读回最终采用的口播。'})).status).toBe(200);expect((await f.request('confirmWorkspaceNarration',base())).status).toBe(200);
  const queued=await f.request('generateWorkspaceNarration',{...base(),reservationCents:100});expect(queued.status).toBe(200);expect((await f.execute(queued.body.narration[0].taskId))?.status).toBe('completed');w=await f.read();
  const voice=w.narration[0],adopted=await measure(()=>f.request('adoptWorkspaceNarration',{...base(),inputFingerprint:voice.inputFingerprint,audioTrackId:voice.audioTrackId}));expect(adopted.result.status,JSON.stringify(adopted.result.body)).toBe(200);w=adopted.result.body;
  expect(w.narration[0].adoptedAudioTrackId).toBe(voice.audioTrackId);expect(w.usedNarration[0]).toMatchObject({text:'只读回最终采用的口播。',provenance:'owner_adoption'});
  const reads=[adopted.reads];
  for(const enabled of [false,true]){const changed=await measure(()=>f.request('setWorkspaceNarrationEnabled',{...base(),enabled}));expect(changed.result.status).toBe(200);w=changed.result.body;expect(w.narration[0].enabled).toBe(enabled);expect(enabled?w.narration[0].adoptedAudioTrackId:w.narration[0].retainedAudioTrackId).toBe(voice.audioTrackId);reads.push(changed.reads);}
  const disabled=await measure(()=>f.request('saveWorkspaceNarration',{...base(),mode:'none',text:''}));expect(disabled.result.status,JSON.stringify(disabled.result.body)).toBe(200);w=disabled.result.body;expect(w.narration[0].mode).toBe('none');expect(w.audio.mix.voices.find((v:any)=>v.shotId===clip.shotId)?.mode).toBe('none');reads.push(disabled.reads);
  await f.restart();expect((await f.read()).narration[0].mode).toBe('none');expect(reads).toEqual([1,1,1,1]);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('visual adoption writes evidence before one final response and a final-read failure rolls back the whole adoption',async()=>{
 const f=await productionWorkspaceFixture(),measure=observeWorkspaceReadback(f.pool);let revoked=false;
 try{
  let w=await f.fillVisuals((await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body);
  const registered=await f.request('registerWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,materialRevisionId:f.material,usage:'video',durationSeconds:2});expect(registered.status).toBe(200);w=registered.body;
  const candidate=w.visualCandidates[0],args={workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id};
  const prepared=await f.request('prepareWorkspaceVisualCandidate',{...args,durationPolicy:'keep-target'});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  await f.c.query('REVOKE SELECT ON local_identity.production_workspace_versions FROM loop_app');revoked=true;
  const denied=await measure(()=>f.request('adoptWorkspaceVisualCandidate',{...args,adoptionId:prepared.body.adoptionId}));expect(denied.result.status).toBe(403);
  await f.c.query('GRANT SELECT ON local_identity.production_workspace_versions TO loop_app');revoked=false;
  const response=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const unchanged=(await response.json()).workspace;
  expect(unchanged.project.sha256).toBe(w.project.sha256);expect(unchanged.revision).toBe(w.revision);expect(unchanged.history).toEqual(w.history);expect(unchanged.visualCandidates[0].status).toBe('available');
  const adopted=await measure(()=>f.request('adoptWorkspaceVisualCandidate',{...args,adoptionId:prepared.body.adoptionId}));expect(adopted.result.status,JSON.stringify(adopted.result.body)).toBe(200);w=adopted.result.body;
  expect(w.visualCandidates[0].status).toBe('adopted');expect(w.clips[0].source.sha256).toBe(candidate.sha256);
  const evidence=denied.trace.findIndex(sql=>sql.startsWith('INSERT INTO local_identity.workspace_candidate_decisions'));
  expect(evidence).toBeGreaterThanOrEqual(0);expect(denied.trace.findIndex(sql=>sql.startsWith('SELECT revision,project_sha256,script_revision_id'))).toBeGreaterThan(evidence);
  expect(denied.trace.at(-1)).toBe('ROLLBACK');expect(adopted.trace.at(-1)).toBe('COMMIT');expect(adopted.reads).toBe(1);
 }finally{if(revoked)await f.c.query('GRANT SELECT ON local_identity.production_workspace_versions TO loop_app');await f.close();}
},120000);
