// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {defaultShotCaptionContract} from '../shotCaptions';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {editStudioDocument} from './studioDocument.fixture';
const exec=promisify(execFile);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('inline Simple Whoosh becomes an immutable episode source and survives repeated native saves and reopening',async()=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){}}});
 try{
  let w=await f.fillVisuals((await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body);
  const send=async(command:string,data={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body.productionWorkspace??r.body;return r.body;};
  for(const clip of w.clips)await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  let opened=await send('openWorkspaceStudio');
  // Read the actual transformed SDK library, the same source used by the inline sound browser.
  const library=await(await fetch(new URL('/src/audio/soundLibrary.ts',opened.studioUrl))).text();
  const {soundEffectSrc}=new Function(library.replace(/\bexport /g,'')+'\n;return {soundEffectSrc};')();
  const source=soundEffectSrc('simple-whoosh');
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{
   const timeline=doc.timelines[0];timeline.tracks.SFX={kind:'audio',alias:'SFX',muted:false,solo:false,volume:1};
   doc.assets.push({id:'sfx_simple-whoosh',name:'Simple Whoosh',kind:'audio',src:source,durationInFrames:39});
   timeline.items.push({id:'inline-simple-whoosh',name:'Simple Whoosh',kind:'audio',track:'SFX',src:source,sourceAssetId:'sfx_simple-whoosh',startFrame:12,durationInFrames:24,srcInFrame:3,volume:.4});
  });
  await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});
  const firstRevision=w.revision,firstSha=w.project.sha256;
  const validNative=await editStudioDocument(opened.studioUrl,w.project.projectId,()=>{});
  const saveArgs=()=>({workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});
  expect((await f.request('saveWorkspaceStudio',saveArgs(),{token:f.otherToken})).status).toBe(404);
  for(const untrusted of ['https://example.invalid/whoosh.mp3','../simple-whoosh.mp3','/sound-effects/not-in-catalog.mp3','episodes/00000000-0000-0000-0000-000000000000/materials/ec5a6364fd90dd071f93f2950924b95105ba02efa5f9f1776a7b10631b99d6c0-openchatcut-simple-whoosh.mp3']){
   await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{doc.timelines[0].items.find((item:any)=>item.id==='inline-simple-whoosh').src=untrusted;});
   expect((await f.request('saveWorkspaceStudio',saveArgs())).status).toBe(409);
   await editStudioDocument(opened.studioUrl,w.project.projectId,()=>structuredClone(validNative));
  }

  await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});
  expect(w.revision).toBe(firstRevision);expect(w.project.sha256).toBe(firstSha);
  const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));
  const effect=project.timelines[0].items.find((i:any)=>i.id==='inline-simple-whoosh');
  expect(effect).toMatchObject({startFrame:12,durationInFrames:24,srcInFrame:3,volume:.4});
  expect(effect.src).toMatch(/\/materials\/[a-f0-9]{64}-openchatcut-simple-whoosh\.mp3$/);
  const bytes=await readFile(join(f.assetRoot,effect.src));expect(bytes.length).toBeGreaterThan(1000);
  const material=await(await fetch(f.origin+`/api/local/episodes/${f.episode}`,{headers:{Cookie:'loop_owner_session='+f.token}})).json();
  expect(JSON.stringify(material)).toContain('openchatcut-simple-whoosh.mp3');expect(JSON.stringify(material)).toContain('openchatcut-bundled/0.2.17/');
  await send('closeWorkspaceStudio');await f.restart();opened=await send('openWorkspaceStudio');
  const native=await editStudioDocument(opened.studioUrl,w.project.projectId,()=>{});
  expect(native.timelines[0].items.find((i:any)=>i.id==='inline-simple-whoosh')).toMatchObject({src:source,startFrame:12,durationInFrames:24,srcInFrame:3,volume:.4});
  const audio=await fetch(new URL(source,opened.studioUrl));expect(audio.status).toBe(200);expect(Buffer.from(await audio.arrayBuffer())).toEqual(bytes);
  await send('closeWorkspaceStudio');
  // Cache/media outages cannot synthesize approval or change source identity.
  const episodeDirectory=join(f.assetRoot,f.episodeRelativePath);await rename(episodeDirectory,episodeDirectory+'.offline');
  try{expect((await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision})).status).toBe(409);}finally{await rename(episodeDirectory+'.offline',episodeDirectory);}
  const soundPath=join(f.assetRoot,effect.src),soundBackup=soundPath+'.offline';
  await rename(soundPath,soundBackup);
  try{const missing=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(missing.status).toBe(409);}finally{await rename(soundBackup,soundPath);}
  await writeFile(soundPath,Buffer.alloc(bytes.length,1));try{expect((await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision})).status).toBe(409);}finally{await writeFile(soundPath,bytes);}
  opened=await send('openWorkspaceStudio');await send('closeWorkspaceStudio');
  // Reopen using the episode copy even if this SDK sound is temporarily unavailable (no remote fallback).
  const sdkSound=join(f.runtime.root,'assets/sound-effects/simple-whoosh.mp3');await rename(sdkSound,sdkSound+'.offline');
  try{opened=await send('openWorkspaceStudio');await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});await send('closeWorkspaceStudio');}finally{await rename(sdkSound+'.offline',sdkSound);}
  await send('exportWorkspace');expect(w.exports[0].status,JSON.stringify(w.exports[0].checks)).toBe('ready');
  const exported=w.exports[0],video=join(f.assetRoot,exported.artifact.relativePath);
  const sourceCheck=exported.checks.find((check:any)=>check.name==='used_content');expect(sourceCheck.sources).toContainEqual({relativePath:effect.src,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length});
  // Independently decode the actual MP3 at the requested trim, placement and gain; compare the MP4 audio waveform.
  const decode=async(path:string,filter?:string)=>{const {stdout}=await exec('ffmpeg',['-nostdin','-v','error','-i',path,...(filter?['-af',filter]:[]),'-ar','48000','-ac','1','-f','f32le','pipe:1'],{encoding:'buffer',maxBuffer:16*1024*1024});return new Float32Array(stdout.buffer,stdout.byteOffset,stdout.length/4);};
  const actual=await decode(video),reference=await decode(soundPath,'atrim=start=0.1:end=0.9,asetpts=PTS-STARTPTS,volume=0.4,adelay=400:all=1,apad=whole_dur=4');
  // AAC encoder priming in the SDK adds 2048 samples; require the same decoded waveform within 50 ms.
  let correlation=-1,shift=0,aa=0,bb=0;
  for(let offset=0;offset<=2400;offset++){let dot=0,left=0,right=0;for(let i=19200;i<57600;i+=8){dot+=actual[i+offset]*reference[i];left+=actual[i+offset]**2;right+=reference[i]**2;}const similarity=dot/Math.sqrt(left*right);if(similarity>correlation){correlation=similarity;shift=offset;aa=left;bb=right;}}
  expect(Math.sqrt(aa/4800),'decoded sound is audible').toBeGreaterThan(.001);
  expect(correlation,'decoded MP4 matches trimmed MP3 placed at 0.4s, allowing <=50ms codec priming').toBeGreaterThan(.97);
  expect(Math.sqrt(aa/bb),'gain .4 is retained').toBeGreaterThan(.85);expect(Math.sqrt(aa/bb)).toBeLessThan(1.15);
  if(process.env.LOOP_SOUND_EVIDENCE){const out=process.env.LOOP_SOUND_EVIDENCE;await writeFile(join(out,'sound-final.mp4'),await readFile(video));await writeFile(join(out,'sound-source.mp3'),bytes);await writeFile(join(out,'sound-analysis.json'),JSON.stringify({correlation,codecPrimingSamples:shift,codecPrimingMs:shift/48,gainRatio:Math.sqrt(aa/bb),sampleRate:48000,sourceInFrame:3,startFrame:12,durationInFrames:24,volume:.4},null,2));}
  const quiet=actual.slice(0,14400);expect(Math.sqrt(quiet.reduce((sum,n)=>sum+n*n,0)/quiet.length),'sound does not move to frame zero').toBeLessThan(.0001);
  await send('confirmWorkspaceExport',{exportId:exported.id,expectedExportSha256:exported.artifact.sha256,expectedContentSha256:w.contentSha256});
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2)');
  await send('prepareWorkspaceDelivery',{exportId:exported.id,expectedExportSha256:exported.artifact.sha256,expectedContentSha256:w.contentSha256,title:'内置音效交付',description:'真实 MP3 与原生工程',tags:['N02'],coverBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});
  const worker=f.workerPool();try{const claimed=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_worker_capacity:2}))[0];expect((await runWorkspaceDeliveryProcess(f,claimed as any)).status).toBe('completed');}finally{await worker.end();}
  const final=await(await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}})).json();w=final.workspace;expect(w.deliveries[0].verified).toBe(true);
  const archive=await fetch(f.origin+`/api/local/episodes/${f.episode}/delivery-download?delivery=${w.deliveries[0].id}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(archive.status).toBe(200);
  const zip=join(f.root,'sound-delivery.zip');await writeFile(zip,Buffer.from(await archive.arrayBuffer()));const contents=await exec('unzip',['-Z1',zip]);expect(contents.stdout).toContain('final-video.mp4');
  const packed=await exec('unzip',['-p',zip,'final-video.mp4'],{encoding:'buffer',maxBuffer:16*1024*1024});expect(createHash('sha256').update(packed.stdout).digest('hex')).toBe(exported.artifact.sha256);

 }finally{await f.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a sound first adopted after a real collection move belongs to the current episode directory',async()=>{
 const f=await productionWorkspaceFixture();try{
  let w=await f.fillVisuals((await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body);
  const send=async(command:string,data={})=>{const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body.productionWorkspace??r.body;return r.body;};
  await send('openWorkspaceStudio');await send('closeWorkspaceStudio');
  const {prepareCollectionTargets}=await import('./episodeCollection.fixture');const {adoption}=await prepareCollectionTargets(f);
  await f.restart();const opened=await send('openWorkspaceStudio');
  const library=await(await fetch(new URL('/src/audio/soundLibrary.ts',opened.studioUrl))).text(),{soundEffectSrc}=new Function(library.replace(/\bexport /g,'')+'\n;return {soundEffectSrc};')(),source=soundEffectSrc('simple-whoosh');
  await editStudioDocument(opened.studioUrl,w.project.projectId,doc=>{doc.timelines[0].tracks.SFX={kind:'audio',alias:'SFX'};doc.assets.push({id:'moved-sound',kind:'audio',name:'Simple Whoosh',src:source,durationInFrames:39});doc.timelines[0].items.push({id:'moved-sound',kind:'audio',name:'Simple Whoosh',track:'SFX',src:source,startFrame:0,durationInFrames:24,srcInFrame:0,volume:.4});});
  await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});
  const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(project.timelines[0].items.find((i:any)=>i.id==='moved-sound').src).toMatch(adoption.episodes[0].targetPrefix+'/materials/');
 }finally{await f.close();}
},180000);
