// @vitest-environment node
import {it,expect} from 'vitest';
import {formalWorkflowFixture} from './formalWorkflow.fixture';
import {readFile} from 'node:fs/promises';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {editStudioDocument} from './studioDocument.fixture';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {setTimeout as pause} from 'node:timers/promises';

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('inherits filled caption limits and SFX timing into current v3 workspaces and preserves manual edits on reopen',async()=>{
 const source='# 模板继承\n## 制作设置\n- 模板版本：3\n- 字幕最大行数：2\n- 每行最大字数：14\n- 字幕位置：top-center\n- 音效起点（秒）：0.5\n- 音效时长（秒）：0.4\n## 正文\n### 段落 01\n- 口播：让字幕每行十四字的设置真正保留在剪辑工程里。\n- 画面来源：图片\n- 镜头时长（秒）：2\n- 音效起点（秒）：0\n### 段落 02\n- 口播：第二镜继承整片设置。\n- 画面来源：图片\n- 镜头时长（秒）：2\n- 字幕最大行数：1\n- 每行最大字数：8\n';
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:source});
 try{
  expect((await f.send('start')).status).toBe(200);const made=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(made.status,JSON.stringify(made.body)).toBe(200);let w=made.body;
  expect(w.captions[0].contract.spatial).toMatchObject({maxLines:2,maxCharactersPerLine:14,anchor:'top-center'});
  expect(w.captions[1].contract.spatial).toMatchObject({maxLines:1,maxCharactersPerLine:8,anchor:'top-center'});
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  const material=await f.send('importMaterial',{sourceKind:'file',sourcePath:'effect.mp3',materialType:'audio',materialPurpose:'sound_effect',mimeType:'audio/mpeg',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('controlled-narration-tone.mp3'))).toString('base64')});expect(material.status).toBe(200);
  for(const clip of w.clips){await send('prepareWorkspaceAudio',{kind:'sfx',shotId:clip.shotId,materialRevisionId:material.body.id,description:clip.shotId});const p=w.audio.preparations.find((p:any)=>p.shotId===clip.shotId);expect(p).toMatchObject({anchor:'shot',offsetSeconds:clip.shotId==='shot-01'?0:.5,durationSeconds:.4});await send('adoptWorkspaceAudio',{preparationId:p.id});}
  expect(w.audio.mix.sounds.map((s:any)=>s.startSeconds).sort()).toEqual([0,2.5]);
  await send('prepareWorkspaceAudio',{kind:'sfx',shotId:w.clips[0].shotId,materialRevisionId:material.body.id,description:'正数子帧音效',durationSeconds:.01,offsetSeconds:0});const tiny=w.audio.preparations.find((p:any)=>p.description==='正数子帧音效');await send('adoptWorkspaceAudio',{preparationId:tiny.id});expect(w.audio.mix.sounds.find((s:any)=>s.itemId===`workspace-sfx-${tiny.id}`).durationSeconds).toBeCloseTo(1/30);
  const edited=structuredClone(w.captions[0].contract);edited.contentMode='independent';edited.spatial.maxCharactersPerLine=9;await send('saveWorkspaceCaptions',{clipId:w.clips[0].id,captionContract:edited});
  const sha=w.project.sha256;await f.restart();const read=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});w=(await read.json()).workspace;
  expect(w.project.sha256).toBe(sha);expect(w.captions[0].contract.spatial.maxCharactersPerLine).toBe(9);const reopened=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(reopened.status).toBe(200);expect(reopened.body.project.sha256).toBe(sha);
 }finally{await f.close();}
},90000);

it.skipIf(!process.env.LOOP_TEMPLATE_EXPORT)('exports native template motion, four basic transitions and exact sound windows from a newly editable workspace',async()=>{
 const text='让字幕每行十四字的设置真正保留在剪辑工程里，不再出现第三行。';
 const overrides=['','- 缩放：1.1\n- 动画：慢推\n- 动画幅度（%）：20\n- 转场：轻推\n','- 动画：拉远\n- 动画幅度（%）：20\n- 转场：叠化\n- 字幕最大行数：1\n- 每行最大字数：10\n','- 动画：无\n- 转场：关闭\n','- 转场：淡出到黑\n','- 转场：柔和擦除\n'];
 const source=`# 模板配置实际导出验收\n## 制作设置\n- 模板版本：3\n- 字幕样式：minimal\n- 字幕正文模式：independent\n- 字幕最大行数：2\n- 每行最大字数：14\n- 音效起点（秒）：0.75\n- 音效时长（秒）：0.4\n- 音效音量（dB）：0\n- 转场时长（秒）：0.4\n## 正文\n${overrides.map((settings,index)=>`### 段落 0${index+1}\n- 口播：${text}\n- 字幕正文：${text}\n- 画面来源：${index===3?'视频':'图片'}\n- 镜头时长（秒）：2\n${settings}`).join('')}`;
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:source}),evidence=process.env.LOOP_TEMPLATE_EVIDENCE!;
 try{
  const real=process.env.LOOP_TEMPLATE_REAL_MEDIA?JSON.parse(await readFile(process.env.LOOP_TEMPLATE_REAL_MEDIA,'utf8')):null;
  const upload=async(path:string,type:string,purpose:string)=>{const r=await f.send('importMaterial',{sourceKind:'file',sourcePath:path.split('/').pop(),materialType:type,materialPurpose:purpose,mimeType:type==='image'?'image/png':type==='video'?'video/mp4':'audio/mpeg',isMainScript:false,contentBase64:(await readFile(path)).toString('base64')});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body.id;};
  const images=await Promise.all([real?.imageA??workspaceTestMedia('still-striped.png'),real?.imageB??workspaceTestMedia('still-striped.png')].map(path=>upload(path,'image','visual_reference')));
  const video=await upload(real?.video??workspaceTestMedia('landscape-red-blue.mp4'),'video','visual_reference');
  const tone=join(f.root,'timing-880.mp3');execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-t','0.4','-c:a','libmp3lame',tone]);const sound=await upload(tone,'audio','sound_effect');
  const voice=await upload(workspaceTestMedia('controlled-narration-tone.mp3'),'audio','narration');
  expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const send=async(command:string,data:Record<string,unknown>={})=>{const r=await f.send(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,command+JSON.stringify(r.body)).toBe(200);if(r.body.id===w.id)w=r.body;return r.body;};
  for(const [index,clip]of [...w.clips].entries()){
   if(index===3)await send('matchWorkspaceMaterial',{clipId:clip.id,materialRevisionId:video});
   else await send('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:images[index%2],usage:'still',durationSeconds:2,fit:'contain',focusX:0,focusY:0});
   await send('prepareWorkspaceAudio',{kind:'sfx',shotId:clip.shotId,description:clip.shotId+' 时点探针',materialRevisionId:sound});await send('adoptWorkspaceAudio',{preparationId:w.audio.preparations.find((p:any)=>p.shotId===clip.shotId).id});
   if(index<2){await send('saveWorkspaceNarration',{clipId:clip.id,mode:'manual',text:clip.text,materialRevisionId:voice});await send('confirmWorkspaceNarration',{clipId:clip.id});const candidate=w.narration.find((n:any)=>n.shotId===clip.shotId).audioTrackId,prepared=await send('prepareWorkspaceCandidate',{candidateId:candidate,durationPolicy:'keep-target'});await send('adoptWorkspaceCandidate',{candidateId:candidate,adoptionId:prepared.adoptionId});}
  }
  const readProject=async()=>JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));
  const before=await readProject();expect(before.timelines[0].transitions.map((t:any)=>t.type)).toEqual(['anticipation-zoom','cross-dissolve','dip-to-black','soft-wipe']);
  const starts=before.timelines[0].items.filter((i:any)=>i.loopControlShot).map((i:any)=>i.startFrame);expect(starts).toEqual([0,60,120,180,240,300]);
  expect(before.timelines[0].items.find((i:any)=>i.id===w.clips[1].itemId)).toMatchObject({transform:{scale:1.1},zoom:{magnification:1.2,envelope:[0,1]}});
  const opened=await send('openWorkspaceStudio');w=opened.productionWorkspace;
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{expect(doc.timelines[0].transitions).toHaveLength(4);expect(doc.timelines[0].items.find((i:any)=>i.id===w.clips[1].itemId).zoom.envelope).toEqual([0,1]);});
  w=(await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256})).productionWorkspace;await send('closeWorkspaceStudio');await f.restart();
  const resumed=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});w=(await resumed.json()).workspace;
  const reopened=await readProject(),semantic=(transitions:any[])=>transitions.map(({trackId,...rest})=>rest);expect(semantic(reopened.timelines[0].transitions)).toEqual(semantic(before.timelines[0].transitions));for(const transition of reopened.timelines[0].transitions){expect(transition.trackId).toBe(reopened.timelines[0].items.find((i:any)=>i.id===transition.incomingItemId).track);expect(transition.trackId).toBe(reopened.timelines[0].items.find((i:any)=>i.id===transition.outgoingItemId).track);}expect(reopened.timelines[0].items.filter((i:any)=>i.loopControlShot).map((i:any)=>i.startFrame)).toEqual(starts);
  for(const caption of [...w.captions]){await send('saveWorkspaceCaptions',{clipId:caption.clipId,captionContract:{...caption.contract,contentMode:'independent'}});}
  await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'script.md'),source);await writeFile(join(evidence,'before-export.json'),JSON.stringify(w,null,2));
  await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');
  const output=join(evidence,'template-settings.mp4');await copyFile(join(f.assetRoot,w.exports[0].artifact.relativePath),output);
  // Measure the encoded MP4 itself, independently of timeline JSON and render success.
  const pcm=execFileSync('ffmpeg',['-v','error','-i',output,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{maxBuffer:8*1024*1024}),samples=new Float32Array(pcm.buffer,pcm.byteOffset,pcm.length/4),window=480;
  const cosine=Array.from({length:window},(_,i)=>Math.cos(2*Math.PI*880*i/48000)),sine=Array.from({length:window},(_,i)=>Math.sin(2*Math.PI*880*i/48000)),amplitudes:number[]=[];
  for(let start=0;start+window<=samples.length;start+=window){let real=0,imaginary=0;for(let i=0;i<window;i++){real+=samples[start+i]*cosine[i];imaginary+=samples[start+i]*sine[i];}amplitudes.push(2*Math.hypot(real,imaginary)/window);}
  const threshold=Math.max(...amplitudes)*.25,regions:Array<[number,number]>=[];
  for(const[index,amplitude]of amplitudes.entries())if(amplitude>threshold){if(!regions.length||index>regions.at(-1)![1])regions.push([index,index+1]);else regions.at(-1)![1]=index+1;}
  expect(regions).toHaveLength(6);const measured=regions.map(([start,end],index)=>{const observed={startSeconds:start/100,durationSeconds:(end-start)/100,expectedStartSeconds:index*2+23/30};expect(Math.abs(observed.startSeconds-observed.expectedStartSeconds)).toBeLessThan(.02);expect(observed.durationSeconds).toBeCloseTo(.4,2);return observed;});
  await writeFile(join(evidence,'audio-timing.json'),JSON.stringify({passed:true,probeHz:880,resolutionSeconds:.01,measured},null,2));
  const editable=join(evidence,'editable');await mkdir(join(editable,'media'),{recursive:true});const project=await readProject(),paths=new Map<string,string>();
  for(const asset of project.assets){if(!asset.src||paths.has(asset.src))continue;const bytes=await readFile(join(f.assetRoot,asset.src)),hash=createHash('sha256').update(bytes).digest('hex'),path='media/'+hash+extname(asset.src);await writeFile(join(editable,path),bytes);paths.set(asset.src,path);}
  const rewrite=(v:any)=>{if(Array.isArray(v))v.forEach(rewrite);else if(v&&typeof v==='object')for(const[key,value]of Object.entries(v)){if(key==='src'&&typeof value==='string'&&paths.has(value))v[key]=paths.get(value);else rewrite(value);}};rewrite(project);
  await writeFile(join(editable,'project.json'),JSON.stringify(project,null,2));await writeFile(join(evidence,'export-result.json'),JSON.stringify({workspace:w,project,originalSources:real,starts,paidCalls:0},null,2));
  for(const seconds of [.5,1.5,1.9,2,2.1,2.5,3.5,4,4.5,6.5,8,10])execFileSync('ffmpeg',['-nostdin','-v','error','-ss',String(seconds),'-i',output,'-frames:v','1',join(evidence,`frame-${seconds.toFixed(1)}.png`)]);
 }finally{await f.close();}
},360000);

it.skipIf(!process.env.LOOP_TEMPLATE_BROWSER)('keeps the current template workspace available for actual browser acceptance',async()=>{
 const script='# 浏览器模板验收\n## 制作设置\n- 模板版本：3\n- 每行最大字数：14\n- 字幕最大行数：2\n- 音效起点（秒）：0.75\n- 音效时长（秒）：0.4\n## 正文\n### 段落 01\n- 口播：让字幕每行十四字的设置真正保留在剪辑工程里。\n- 画面来源：图片\n- 镜头时长（秒）：2\n### 段落 02\n- 口播：第二个镜头保留明确填写的音效零起点。\n- 画面来源：图片\n- 镜头时长（秒）：2\n- 音效起点（秒）：0\n';
 const f=await formalWorkflowFixture({freshAccount:true,scriptText:script}),evidence=process.env.LOOP_TEMPLATE_EVIDENCE!;let ui:Awaited<ReturnType<typeof createServer>>|undefined;
 try{
  expect((await f.send('start')).status).toBe(200);let w=(await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main})).body;
  const upload=async(path:string,type:string,purpose:string)=>{const r=await f.send('importMaterial',{sourceKind:'file',sourcePath:path.split('/').pop(),materialType:type,materialPurpose:purpose,mimeType:type==='image'?'image/png':'audio/mpeg',isMainScript:false,contentBase64:(await readFile(path)).toString('base64')});expect(r.status).toBe(200);return r.body;};
  const image=await upload(workspaceTestMedia('still-striped.png'),'image','visual_reference'),sound=await upload(workspaceTestMedia('controlled-narration-tone.mp3'),'audio','sound_effect');
  for(const clip of w.clips){const r=await f.send('matchWorkspaceImage',{workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id,materialRevisionId:image.id,usage:'still',durationSeconds:2,fit:'contain',focusX:0,focusY:0});expect(r.status).toBe(200);w=r.body;}
  const entry=`import{createRoot}from'react-dom/client';import{ProductionWorkspacePanel}from'/src/local-app/ProductionWorkspacePanel';import{localRequest,localCommand}from'/src/local-app/client';import'/src/styles.css';import'/src/ui/impeccable/foundation.css';import'/src/ui/impeccable/production.css';async function start(){await localRequest('login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({email:f.email,password:f.password})})});createRoot(document.getElementById('root')).render(<main className="impeccable-app dan-ui product-ui" style={{padding:20,maxWidth:1440,margin:'auto',height:'100dvh',display:'flex',flexDirection:'column',boxSizing:'border-box'}}><ProductionWorkspacePanel episodeId=${JSON.stringify(f.newEpisode)} title="模板配置验收" scriptRevisionId=${JSON.stringify(f.main)} materials={${JSON.stringify([image,sound])}} command={(name,data)=>localCommand(name,data,undefined,'episode-commands')} onLegacy={()=>{}}/></main>);}void start();`;
  const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(q:any)=>q.setHeader('origin',f.origin));}};
  ui=await createServer({configFile:false,root:process.cwd(),envFile:false,cacheDir:join(f.root,'browser-cache'),optimizeDeps:{entries:[]},plugins:[react(),{name:'template-browser',resolveId(id){if(id==='virtual:template-browser')return '\0template-browser';},load(id){if(id==='\0template-browser')return{code:entry,map:null};},async transform(code,id){if(id==='\0template-browser'){const{transformWithEsbuild}=await import('vite');return transformWithEsbuild(code,'template.tsx',{loader:'tsx',jsx:'automatic'});}},configureServer(server){server.middlewares.use('/__template',async(_q,r)=>{r.setHeader('Content-Type','text/html');r.end(await server.transformIndexHtml('/__template','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>模板配置验收</title><div id="root"></div><script type="module" src="/@id/virtual:template-browser"></script></html>'));});}}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await ui.listen();
  await writeFile(join(evidence,'browser.json'),JSON.stringify({url:`http://127.0.0.1:${(ui.httpServer!.address() as {port:number}).port}/__template`,soundId:sound.id,workspaceId:w.id,episodeId:f.newEpisode}));
  let done=false;for(let i=0;i<300;i++){try{done=JSON.parse(await readFile(join(evidence,'browser-done.json'),'utf8')).passed===true;if(done)break;}catch{}await pause(1000);}expect(done).toBe(true);
  const final=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});await writeFile(join(evidence,'browser-persistence.json'),JSON.stringify(await final.json(),null,2));
 }finally{await ui?.close();await f.close();}
},330000);
