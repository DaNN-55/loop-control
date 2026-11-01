// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('uploaded narration is selectable in a current workspace without legacy approvals or provider calls',async()=>{
 const second=productionScriptTemplate.slice(productionScriptTemplate.indexOf('### 段落 01'),productionScriptTemplate.indexOf('## 本期补充约束')).replace('段落 01','段落 02');
 const f=await formalWorkflowFixture({scriptText:productionScriptTemplate.replace('## 本期补充约束',second+'## 本期补充约束')});try{
  expect((await f.send('start')).status).toBe(200);
  const prepared=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);let w=prepared.body;expect(w.clips).toHaveLength(2);
  const imported=await f.send('importMaterial',{sourceKind:'file',sourcePath:'manual.mp3',contentBase64:(await readFile(workspaceTestMedia('controlled-narration-tone.mp3'))).toString('base64'),materialType:'audio',mimeType:'audio/mpeg',isMainScript:false,materialPurpose:'narration'});expect(imported.status).toBe(200);
  const base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  const saved=await f.send('saveWorkspaceNarration',{...base,mode:'manual',text:'人工口播正文。',materialRevisionId:imported.body.id});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body;
  expect(w.narration[0].audioTrackId).toBeTruthy();expect(w.narration[0].adoptedAudioTrackId).toBeNull();
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
  const stale=await f.send('saveWorkspaceNarration',{...base,mode:'manual',text:'不能覆盖新工程',materialRevisionId:imported.body.id});expect(stale.status).toBe(409);
  const foreign=await f.send('saveWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,mode:'manual',text:'跨生产单材料',materialRevisionId:f.material});expect(foreign.status).toBe(404);

 }finally{await f.close();}
},120_000);
