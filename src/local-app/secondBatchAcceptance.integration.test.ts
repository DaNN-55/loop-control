// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {secondBatchWorkspaceFixture} from './secondBatchWorkspace.fixture';
import {workspaceScriptInput} from './workspaceScriptInput';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
for(const [kind,source,subtitles] of [
 ['plain','雨停了。\n\n街角亮着灯。',['雨停了。','街角亮着灯。']],
 ['structured','# 夜景\n## 制作设置\n- 模板版本：2\n## 正文\n### 段落 01\n- 口播：街角亮着灯。\n- 首帧素材：无\n- 视频生成提示词：镜头缓慢推进。',['街角亮着灯。']],
 ['independent','# 夜景\n## 制作设置\n- 模板版本：2\n- 字幕正文模式：independent\n## 正文\n### 段落 01\n- 口播：实际口播。\n- 字幕正文：独立字幕。\n- 首帧素材：无\n- 视频生成提示词：镜头缓慢推进。',['独立字幕。']],
 ['disabled','# 夜景\n## 制作设置\n- 模板版本：2\n- 字幕：关闭\n## 正文\n### 段落 01\n- 口播：关闭字幕的口播。\n- 首帧素材：无\n- 视频生成提示词：镜头缓慢推进。',['关闭字幕的口播。']],
] as const)it.skipIf(!enabled)(kind+' input reaches actual Owner registration, start and native subtitle preparation',async()=>{
 const f=await secondBatchWorkspaceFixture();try{
  await f.c.query("UPDATE public.episodes SET main_script_revision_id=null,stage='waiting_input' WHERE id=$1",[f.episode]);
  await f.c.query('UPDATE public.production_material_revisions SET is_main_script=false WHERE id=$1',[f.script]);
  const input=workspaceScriptInput(source);expect(input.error).toBeNull();
  const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'second-batch.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from(input.text).toString('base64')});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  const started=await f.request('start');expect(started.status,JSON.stringify(started.body)).toBe(200);
  const prepared=await f.request('prepareWorkspace',{expectedScriptRevisionId:imported.body.id});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  expect(prepared.body.clips.map((c:any)=>c.text)).toEqual(kind==='independent'?['实际口播。']:subtitles);
  expect(prepared.body.captions.map((c:any)=>c.contract.text)).toEqual(subtitles);expect(prepared.body.captions.every((c:any)=>c.contract.enabled===(kind!=='disabled'))).toBe(true);
  expect((await f.c.query("SELECT count(*) FROM public.tasks WHERE episode_id=$1 AND status IN ('ready','running')",[f.episode])).rows[0].count).toBe('0');
  if(process.env.LOOP_SECOND_BATCH_EVIDENCE)await writeFile(join(process.env.LOOP_SECOND_BATCH_EVIDENCE,kind+'-script.json'),JSON.stringify({input:source,canonical:input.text,shots:prepared.body.clips.map((c:any)=>({shotId:c.shotId,text:c.text})),subtitles:prepared.body.captions.map((c:any)=>c.contract.text)}));
 }finally{await f.close();}
},180000);
it.skipIf(!enabled)('local MP3 prepares without any external service and only explicit adoption changes native audio',async()=>{
 const f=await secondBatchWorkspaceFixture();try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const file=join(f.root,'second-music.mp3');execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=330:duration=6','-c:a','libmp3lame',file]);
  const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'second-music.mp3',materialType:'audio',materialPurpose:'background_music',mimeType:'audio/mpeg',isMainScript:false,contentBase64:(await readFile(file)).toString('base64')});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  const before=w.project.sha256;
  const prepared=await f.request('prepareWorkspaceAudio',{workspaceId:w.id,expectedRevision:w.revision,kind:'bgm',materialRevisionId:imported.body.id,description:'本地音乐',durationSeconds:4,anchor:'absolute',offsetSeconds:0});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);w=prepared.body;
  expect(w.audio.preparations).toHaveLength(1);expect(w.audio.preparations[0].taskId).toBeNull();expect(w.audio.mix.sounds).toEqual([]);expect(w.project.sha256).toBe(before);
  const adopted=await f.request('adoptWorkspaceAudio',{workspaceId:w.id,expectedRevision:w.revision,preparationId:w.audio.preparations[0].id});expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);expect(adopted.body.audio.mix.sounds).toHaveLength(1);
 }finally{await f.close();}
},180000);
it.skipIf(!enabled)('legacy a_roll and b_roll shots accept the same current video model through the Owner queue',async()=>{
 const {narrationFixture}=await import('./workspaceNarration.fixture'),{createHash}=await import('node:crypto');
 const f=await narrationFixture(undefined,undefined,{provider:'bailian',model:'wan2.6-i2v-flash'},true);try{
  const board=JSON.parse(await readFile(join(f.assetRoot,f.boardPath),'utf8'));board.shots[0].shotType='a_roll';board.shots[1].shotType='b_roll';
  const bytes=Buffer.from(JSON.stringify(board));await writeFile(join(f.assetRoot,f.boardPath),bytes);
  await f.c.query('UPDATE public.artifacts SET sha256=$2,file_size=$3 WHERE episode_id=$1 AND relative_path=$4',[f.episode,createHash('sha256').update(bytes).digest('hex'),bytes.length,f.boardPath]);
  await f.c.query('UPDATE public.review_packages SET context_snapshot=$2 WHERE id=$1',[f.board,{worker_result:{storyboard:board}}]);
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;await f.authorize();
  const path=join(f.root,'unified-frame.png');execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=360x640','-frames:v','1',path]);
  const image=await f.request('importMaterial',{sourceKind:'file',sourcePath:'unified-frame.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(path)).toString('base64')});expect(image.status).toBe(200);
  for(const clip of [...w.clips]){
   const queued=await f.request('requestWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:clip.itemId,selection:f.videoSelection,firstFrameMaterialRevisionId:image.body.id,prompt:'保持画面稳定',durationSeconds:5,reservationCents:200});expect(queued.status,JSON.stringify(queued.body)).toBe(200);w=queued.body;
  }
  const tasks=(await f.c.query("SELECT input_snapshot->'production_selection' selection FROM public.tasks WHERE episode_id=$1 AND status='ready'",[f.episode])).rows;
  expect(tasks).toHaveLength(2);expect(tasks.every(t=>t.selection.capability==='video'&&t.selection.model==='wan2.6-i2v-flash')).toBe(true);
 }finally{await f.close();}
},180000);
