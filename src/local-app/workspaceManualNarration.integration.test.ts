// @vitest-environment node
import {observeWorkspaceReadback} from './workspaceReadback.fixture';
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('unassigned MP3 can be used for narration, music and effects without provider calls',async()=>{
 const second=productionScriptTemplate.slice(productionScriptTemplate.indexOf('### 段落 01'),productionScriptTemplate.indexOf('## 本期补充约束')).replace('段落 01','段落 02');
 const f=await formalWorkflowFixture({scriptText:productionScriptTemplate.replace('## 本期补充约束',second+'## 本期补充约束')}),measure=observeWorkspaceReadback(f.pool);try{
  expect((await f.send('start')).status).toBe(200);
  const prepared=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);let w=prepared.body;expect(w.clips).toHaveLength(2);
  expect(w.captions[0].contract.contentMode).toBe('follow_tts');
  const initialCaption=w.captions[0].contract;
  const imported=await f.send('importMaterial',{sourceKind:'file',sourcePath:'manual.mp3',contentBase64:(await readFile(workspaceTestMedia('controlled-narration-tone.mp3'))).toString('base64'),materialType:'audio',mimeType:'audio/mpeg',isMainScript:false,materialPurpose:'general_reference'});expect(imported.status).toBe(200);
  for(const clip of w.clips.slice(1)){
   const mode={contentMode:'independent',text:'独立显示的字幕。'};
   const result=await f.send('saveWorkspaceNarrationCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id,...mode});
   expect(result.status,JSON.stringify(result.body)).toBe(200);w=result.body;
  }
  const base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  const saved=await f.send('saveWorkspaceNarration',{...base,mode:'manual',text:'人工口播正文。',materialRevisionId:imported.body.id});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body;
  expect(w.narration[0].audioTrackId).toBeTruthy();expect(w.narration[0].adoptedAudioTrackId).toBeNull();
  expect(w.captions[0].contract).toEqual(initialCaption);
  const tracks=(await f.c.query("SELECT * FROM public.audio_tracks WHERE episode_id=$1 AND track_kind='narration'",[f.newEpisode])).rows;expect(tracks).toHaveLength(1);expect(tracks[0].sha256).toBe(imported.body.sha256);
  expect((await f.c.query("SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1 AND status IN ('ready','running')",[f.newEpisode])).rows[0].n).toBe(0);
  expect((await f.c.query("SELECT count(*)::int n FROM public.approvals WHERE episode_id=$1 AND stage='storyboard_approved'",[f.newEpisode])).rows[0].n).toBe(0);
  const beforeTasks=(await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows[0].n;
  const again=await f.send('saveWorkspaceNarration',{...base,mode:'manual',text:'人工口播正文。',materialRevisionId:imported.body.id});expect(again.status,JSON.stringify(again.body)).toBe(200);w=again.body;
  expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(beforeTasks);
  for(const clipId of w.clips.slice(0,2).map((c:any)=>c.id)){
   const saved=await f.send('saveWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId,mode:'manual',text:'人工口播正文。',materialRevisionId:imported.body.id});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body;
   const confirm=await f.send('confirmWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId});expect(confirm.status,JSON.stringify(confirm.body)).toBe(200);w=confirm.body;
   const voice=w.narration.find((n:any)=>n.clipId===clipId),candidate=w.candidates.find((c:any)=>c.id===voice.audioTrackId);expect(candidate?.status).toBe('available');
   const target={workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id};
   const prepared=await f.send('prepareWorkspaceCandidate',{...target,durationPolicy:'use-candidate'});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
   const adopted=await f.send('adoptWorkspaceCandidate',{...target,adoptionId:prepared.body.adoptionId});expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);w=adopted.body;
   expect(w.narration.find((n:any)=>n.clipId===clipId).adoptedAudioTrackId).toBe(voice.audioTrackId);
  }
  expect(w.nativeEditRevision).toBeGreaterThan(1);
  expect(w.captions[0].contract).toMatchObject({contentMode:'follow_tts',text:'人工口播正文。',cues:[expect.objectContaining({text:'人工口播正文。',startMs:0})]});
  expect(w.captions[0].textConfirmed).toBe(false);
  expect(w.captions[1].contract).toMatchObject({contentMode:'independent',text:'独立显示的字幕。'});
  const frozenCaption=w.captions[0].contract,adoptedTrack=w.narration[0].adoptedAudioTrackId;
  const changedDraft=await f.send('saveWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,mode:'manual',text:'尚未采用的新文案。',materialRevisionId:imported.body.id});
  expect(changedDraft.status,JSON.stringify(changedDraft.body)).toBe(200);w=changedDraft.body;
  expect(w.captions[0].contract).toEqual(frozenCaption);expect(w.narration[0].adoptedAudioTrackId).toBe(adoptedTrack);
  const restoredDraft=await f.send('saveWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,mode:'manual',text:'人工口播正文。',materialRevisionId:imported.body.id});
  expect(restoredDraft.status,JSON.stringify(restoredDraft.body)).toBe(200);w=restoredDraft.body;
  const followAfter=await f.send('saveWorkspaceNarrationCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[1].id,contentMode:'follow_tts'});
  expect(followAfter.status,JSON.stringify(followAfter.body)).toBe(200);w=followAfter.body;
  expect(w.captions[1].contract).toMatchObject({contentMode:'follow_tts',text:'人工口播正文。'});
  const manual=w.narration[0],other=w.narration[1].adoptedAudioTrackId;
  const measured=await measure(()=>f.send('withdrawWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:manual.clipId,audioTrackId:manual.adoptedAudioTrackId})),withdrawn=measured.result;
  expect(withdrawn.status,JSON.stringify(withdrawn.body)).toBe(200);w=withdrawn.body;
  expect(w.narration[0]).toMatchObject({mode:'manual',text:manual.text,adoptedAudioTrackId:null,audioTrackId:manual.audioTrackId});
  expect(w.narration[1].adoptedAudioTrackId).toBe(other);expect(measured.reads).toBe(1);
  expect(w.candidates.find((c:any)=>c.id===manual.audioTrackId).status).toBe('available');
  const target={workspaceId:w.id,expectedRevision:w.revision,candidateId:manual.audioTrackId};
  const preparedAgain=await f.send('prepareWorkspaceCandidate',{...target,durationPolicy:'use-candidate'});
  expect(preparedAgain.status,JSON.stringify(preparedAgain.body)).toBe(200);
  const reused=await f.send('adoptWorkspaceCandidate',{...target,adoptionId:preparedAgain.body.adoptionId});
  expect(reused.status,JSON.stringify(reused.body)).toBe(200);w=reused.body;
  expect(w.narration[0].adoptedAudioTrackId).toBe(manual.audioTrackId);
  expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows[0].n).toBe(beforeTasks+2);
  const off=await f.send('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[1].id,captionContract:{...w.captions[1].contract,enabled:false}});
  expect(off.status,JSON.stringify(off.body)).toBe(200);w=off.body;const disabledCaption=w.captions[1].contract;
  const offDraft=await f.send('saveWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[1].id,mode:'manual',text:'人工口播正文。',materialRevisionId:imported.body.id});
  expect(offDraft.status,JSON.stringify(offDraft.body)).toBe(200);w=offDraft.body;expect(w.captions[1].contract).toEqual(disabledCaption);
  const offWithdraw=await f.send('withdrawWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[1].id,audioTrackId:w.narration[1].adoptedAudioTrackId});expect(offWithdraw.status,JSON.stringify(offWithdraw.body)).toBe(200);w=offWithdraw.body;
  const offTarget={workspaceId:w.id,expectedRevision:w.revision,candidateId:w.narration[1].audioTrackId};
  const offPlan=await f.send('prepareWorkspaceCandidate',{...offTarget,durationPolicy:'use-candidate'});expect(offPlan.status,JSON.stringify(offPlan.body)).toBe(200);
  const offAdopt=await f.send('adoptWorkspaceCandidate',{...offTarget,adoptionId:offPlan.body.adoptionId});expect(offAdopt.status,JSON.stringify(offAdopt.body)).toBe(200);w=offAdopt.body;expect(w.captions[1].contract).toEqual(disabledCaption);
  const stale=await f.send('saveWorkspaceNarration',{...base,mode:'manual',text:'不能覆盖新工程',materialRevisionId:imported.body.id});expect(stale.status).toBe(409);
  for(const kind of ['bgm','sfx']){
   const result=await f.send('prepareWorkspaceAudio',{workspaceId:w.id,expectedRevision:w.revision,
    kind,materialRevisionId:imported.body.id,description:'选用本期 MP3',durationSeconds:0.2});
   expect(result.status,JSON.stringify(result.body)).toBe(200);w=result.body;
   expect(w.audio.preparations).toContainEqual(expect.objectContaining({
    kind,taskId:null,status:'ready',source:{provider:'manual',materialRevisionId:imported.body.id},
   }));
  }
  expect((await f.c.query("SELECT material_purpose FROM public.production_material_revisions WHERE id=$1",[imported.body.id])).rows[0].material_purpose).toBe('general_reference');
  const foreign=await f.send('saveWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,mode:'manual',text:'跨生产单材料',materialRevisionId:f.material});expect(foreign.status).toBe(404);

 }finally{await f.close();}
},120_000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('first TTS draft preserves script subtitles and later drafts preserve independent captions',async()=>{
 const f=await formalWorkflowFixture({controlled:true});try{
  expect((await f.send('start')).status).toBe(200);
  const prepared=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);let w=prepared.body;
  const original=w.captions[0].contract,base=()=>({workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id});
  const saved=await f.send('saveWorkspaceNarration',{...base(),mode:'tts',...f.controlled!.narrationSettings,text:'第一次准备生成的新口播。'});
  expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body;expect(w.narration[0].text).toBe('第一次准备生成的新口播。');expect(w.captions[0].contract).toEqual(original);
  const independent=await f.send('saveWorkspaceNarrationCaptions',{...base(),contentMode:'independent',text:'原有精简字幕'});expect(independent.status,JSON.stringify(independent.body)).toBe(200);w=independent.body;const contract=w.captions[0].contract;
  const changed=await f.send('saveWorkspaceNarration',{...base(),mode:'tts',...f.controlled!.narrationSettings,text:'另一次准备生成的口播。'});
  expect(changed.status,JSON.stringify(changed.body)).toBe(200);w=changed.body;expect(w.captions[0].contract).toEqual(contract);
  expect((await f.c.query("SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1 AND task_type='generate_narration'",[f.newEpisode])).rows[0].n).toBe(0);
 }finally{await f.close();}
},120_000);
