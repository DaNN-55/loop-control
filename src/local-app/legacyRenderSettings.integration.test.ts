import {saveHistoricalPlanFixture} from './historicalSavedPlan.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile,mkdir,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {historicalProductionScriptV2} from '../reviews/productionScript.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {editStudioDocument} from './studioDocument.fixture';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('applies original render settings only when local candidates are explicitly adopted and preserves later native mix choices',async()=>{
 const script=historicalProductionScriptV2.replace('填写已上传图片的素材名称','原图').replace('生成时长（秒）：默认','生成时长（秒）：3').replace('字幕：开启','字幕：关闭').replace('字幕样式：默认','字幕样式：cinematic').replace('背景音乐素材：默认','背景音乐素材：配乐').replace('转场：cut','转场：fade\n- 旁白音量（dB）：-9\n- 音乐音量（dB）：-24\n- 音效音量（dB）：-18\n- 音乐闪避：strong').replace('音效素材：无','音效素材：音效\n- 音效起点（秒）：0.75\n- 音效时长（秒）：0.5');
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:script});
 try{
  const audio=join(f.root,'render-settings-tone.mp3');execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=220:sample_rate=48000','-t','6','-c:a','libmp3lame',audio]);
  const upload=async(name:string,type:string,path:string,purpose:string)=>{const r=await f.send('importMaterial',{sourceKind:'file',sourcePath:name,materialType:type,materialPurpose:purpose,mimeType:type==='image'?'image/png':'audio/mpeg',isMainScript:false,contentBase64:(await readFile(path)).toString('base64')});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body;};
  await upload('原图.png','image',workspaceTestMedia('still-striped.png'),'visual_reference');await upload('配乐.mp3','audio',audio,'background_music');await upload('音效.mp3','audio',audio,'sound_effect');const voice=await upload('人工口播.mp3','audio',workspaceTestMedia('controlled-narration-tone.mp3'),'narration');
  const saved=await saveHistoricalPlanFixture(f);expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect((await f.send('start')).status).toBe(200);
  const original=(await f.c.query('SELECT to_jsonb(s) value FROM local_identity.script_productions s WHERE episode_id=$1',[f.newEpisode])).rows[0].value;
  const source=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/saved-plan`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(source.status).toBe(200);const plan=await source.json();const imported=await f.send('adoptLegacyPlan',{expectedScriptRevisionId:f.main,expectedPlanSha256:plan.planSha256});expect(imported.status,JSON.stringify(imported.body)).toBe(200);let w=imported.body;
  expect(w.audio.mix.sounds).toHaveLength(0);expect(w.usedNarration).toHaveLength(0);expect(w.preparation.authorized).toBe(false);
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const picture=w.visualCandidates[0],image=await send('prepareWorkspaceVisualCandidate',{candidateId:picture.id,durationPolicy:'keep-target'});await send('adoptWorkspaceVisualCandidate',{candidateId:picture.id,adoptionId:image.adoptionId});
  const clip=w.clips[0];await send('saveWorkspaceNarration',{clipId:clip.id,mode:'manual',text:clip.text,materialRevisionId:voice.id});await send('confirmWorkspaceNarration',{clipId:clip.id});const track=w.narration[0].audioTrackId,ready=await send('prepareWorkspaceCandidate',{candidateId:track,durationPolicy:'keep-target'});await send('adoptWorkspaceCandidate',{candidateId:track,adoptionId:ready.adoptionId});
  for(const preparation of [...w.audio.preparations])await send('adoptWorkspaceAudio',{preparationId:preparation.id});
  expect(w.audio.mix.voices[0].gainDb).toBeCloseTo(-9);expect(w.audio.mix.sounds.find((s:any)=>s.kind==='bgm')).toMatchObject({gainDb:-24,duckDepthDb:14});expect(w.audio.mix.sounds.find((s:any)=>s.kind==='sfx')).toMatchObject({gainDb:-18,startSeconds:23/30,durationSeconds:0.5});
  const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{const timeline=doc.timelines[0],visual=timeline.items.find((i:any)=>i.id===clip.itemId)!;expect(visual.fadeInFrames).toBe(11);expect(visual.fadeOutFrames).toBe(11);const caption=Object.values(timeline.tracks).find((t:any)=>t.captions) as any;expect(caption.captions.template).toBe('black-bar');const sound=timeline.items.find((i:any)=>(i.loopControlAudio as any)?.kind==='bgm')!;sound.volume=10**(-15/20);timeline.tracks[String(sound.track)].audioRouting={duckDepthDb:-6};});w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256})).productionWorkspace;await send('closeWorkspaceStudio');
  await send('adoptWorkspaceAudio',{preparationId:w.audio.preparations.find((p:any)=>p.kind==='bgm').id});expect(w.audio.mix.sounds.find((s:any)=>s.kind==='bgm').gainDb).toBeCloseTo(-15);expect(w.audio.mix.sounds.find((s:any)=>s.kind==='bgm').duckDepthDb).toBe(6);await f.restart();const reloaded=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(reloaded.status).toBe(200);w=(await reloaded.json()).workspace;await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');
  expect((await f.c.query('SELECT to_jsonb(s) value FROM local_identity.script_productions s WHERE episode_id=$1',[f.newEpisode])).rows[0].value).toEqual(original);expect((await f.c.query('SELECT count(*)::int n FROM public.paid_generation_reservations r JOIN public.tasks t ON t.id=r.task_id WHERE t.episode_id=$1',[f.newEpisode])).rows[0].n).toBe(0);
 }finally{await f.close();}
},180000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('preserves per-shot music gain and ducking, continuous source intervals and manual timing when explicitly replacing the whole music source',async()=>{
 const second='### 段落 02\n\n- 口播：第二段保持自己的声音设置。\n- 画面提示：本地图片。\n- 首帧素材：原图\n- 视频生成提示词：仅历史资料，不调用视频API。\n- 生成时长（秒）：3\n- 构图：full\n- 音效素材：无\n- 音乐音量（dB）：-30\n- 音乐闪避：light\n\n';
 const script=historicalProductionScriptV2.replace('填写已上传图片的素材名称','原图').replace('生成时长（秒）：默认','生成时长（秒）：3').replace('字幕：开启','字幕：关闭').replace('背景音乐素材：默认','背景音乐素材：配乐\n- 音乐音量（dB）：-18\n- 音乐闪避：strong').replace('## 本期补充约束（可选）',second+'## 本期补充约束（可选）');
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:script});
 try{
  const file=join(f.root,'per-shot-music.mp3');execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=330:sample_rate=48000','-t','7','-c:a','libmp3lame',file]);
  const upload=async(name:string,type:string,path:string,purpose:string)=>{const r=await f.send('importMaterial',{sourceKind:'file',sourcePath:name,materialType:type,materialPurpose:purpose,mimeType:type==='image'?'image/png':'audio/mpeg',isMainScript:false,contentBase64:(await readFile(path)).toString('base64')});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body;};await upload('原图.png','image',workspaceTestMedia('still-striped.png'),'visual_reference');await upload('配乐.mp3','audio',file,'background_music');const replacement=await upload('新配乐.mp3','audio',file,'background_music');expect((await saveHistoricalPlanFixture(f)).status).toBe(200);expect((await f.send('start')).status).toBe(200);
  const response=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/saved-plan`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const plan=await response.json(),r=await f.send('adoptLegacyPlan',{expectedScriptRevisionId:f.main,expectedPlanSha256:plan.planSha256});expect(r.status,JSON.stringify(r.body)).toBe(200);let w=r.body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  for(const candidate of [...w.visualCandidates]){const ready=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target'});await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:ready.adoptionId});}
  const music=w.audio.preparations.find((p:any)=>p.kind==='bgm');await send('adoptWorkspaceAudio',{preparationId:music.id});expect(w.audio.mix.sounds).toHaveLength(2);expect(w.audio.mix.sounds.map((s:any)=>({start:s.startSeconds,gain:s.gainDb,duck:s.duckDepthDb})).sort((a:any,b:any)=>a.start-b.start)).toEqual([{start:0,gain:-18,duck:14},{start:3,gain:-30,duck:6}]);
  let project=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace/project?sha=${w.project.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(project.status).toBe(200);expect((await project.json()).project.timelines[0].items.filter((i:any)=>(i.loopControlAudio as any)?.kind==='bgm').sort((a:any,b:any)=>a.startFrame-b.startFrame).map((i:any)=>({start:i.startFrame,source:i.srcInFrame,duration:i.durationInFrames}))).toEqual([{start:0,source:0,duration:90},{start:90,source:90,duration:90}]);
  const later=w.audio.mix.sounds.find((s:any)=>s.startSeconds===3);await send('mixWorkspaceAudio',{edit:{kind:'sound',workspaceId:w.id,itemId:later.itemId,gainDb:-12,duckDepthDb:3,placement:{anchor:'absolute',offsetSeconds:3.2,durationSeconds:2.6}}});await send('prepareWorkspaceAudio',{kind:'bgm',materialRevisionId:replacement.id,description:'明确替换整期配乐',durationSeconds:6});const next=w.audio.preparations.find((p:any)=>p.id!==music.id);await send('adoptWorkspaceAudio',{preparationId:next.id});
  expect(w.audio.mix.sounds).toHaveLength(2);expect(w.audio.mix.sounds.find((s:any)=>s.itemId===later.itemId)).toMatchObject({gainDb:-12,duckDepthDb:3,startSeconds:3.2,durationSeconds:2.6});
  project=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace/project?sha=${w.project.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(project.status).toBe(200);expect((await project.json()).project.timelines[0].items.filter((i:any)=>(i.loopControlAudio as any)?.kind==='bgm').every((i:any)=>i.sourceAssetId===`material-${replacement.id}`)).toBe(true);const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;await send('closeWorkspaceStudio');await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');
 }finally{await f.close();}
},180000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each([
 {version:'future-render/v9',voiceGainDb:-4},
 {version:'workspace-render-preferences/v1',voiceGainDb:99},
 {version:'workspace-render-preferences/v1',connectionVersionId:'not-an-execution-authority'},
 {version:'workspace-render-preferences/v1',bgmDucking:'unknown'},
 {version:'workspace-render-preferences/v1',captionStyle:['cinematic']},
 {version:'workspace-render-preferences/v1',transition:['fade']},
])('rejects invalid native render preferences without changing the last accepted project: %j',async(preferences)=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){}}});
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;const before=await readFile(join(f.assetRoot,w.project.relativePath));
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{const item=doc.timelines[0].items.find((i:any)=>i.id===w.clips[0].itemId)!;(item.loopControlShot as any).renderPreferences=preferences;});
  const rejected=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(rejected.status,JSON.stringify(rejected.body)).toBe(409);expect(rejected.body.error).toContain('渲染预填');const response=await fetch(`${f.origin}/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);expect((await response.json()).workspace.project.sha256).toBe(w.project.sha256);expect(await readFile(join(f.assetRoot,w.project.relativePath))).toEqual(before);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE).each(['minimal','cinematic'] as const)('renders an explicitly confirmed visible %s subtitle with the current script style',async(style)=>{
 const text='字幕样式验收',script=`# 字幕呈现\n\n## 制作设置\n- 模板版本：3\n- 画幅：9:16\n- 字幕：开启\n- 字幕正文模式：independent\n- 字幕样式：${style}\n\n## 正文\n### 段落 01\n- 口播：${text}\n- 字幕正文：${text}\n- 画面来源：图片\n- 镜头时长（秒）：1\n`;
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:script});
 try{
  const file=join(f.root,'white.png');execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=white:s=1080x1920','-frames:v','1','-threads','1',file]);const image=await f.send('importMaterial',{sourceKind:'file',sourcePath:'white.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(file)).toString('base64')});expect(image.status).toBe(200);expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  await send('matchWorkspaceImage',{clipId:w.clips[0].id,materialRevisionId:image.body.id,usage:'still',durationSeconds:1,fit:'contain',focusX:0,focusY:0});const contract=defaultShotCaptionContract(text,'independent',true);contract.cues=[{id:'owner-timed',text,startMs:0,endMs:1000}];await send('saveWorkspaceCaptions',{clipId:w.clips[0].id,captionContract:contract});await send('confirmWorkspaceCaptionText',{clipId:w.clips[0].id,expectedInputFingerprint:w.captions[0].inputFingerprint});expect(w.captions[0]).toMatchObject({textConfirmed:true,timing:'current'});await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');
  if(process.env.LOOP_STORY_EVIDENCE){const evidence=join(process.env.LOOP_STORY_EVIDENCE,'render-style-'+style);await mkdir(evidence,{recursive:true});const video=join(evidence,'output.mp4');await copyFile(join(f.assetRoot,w.exports[0].artifact.relativePath),video);execFileSync('ffmpeg',['-nostdin','-v','error','-ss','0.5','-i',video,'-frames:v','1',join(evidence,'frame.png')]);await copyFile(join(f.assetRoot,w.exports[0].project.relativePath),join(evidence,'project.json'));}
 }finally{await f.close();}
},180000);
