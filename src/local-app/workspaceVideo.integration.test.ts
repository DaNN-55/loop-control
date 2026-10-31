// @vitest-environment node
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {adjustWorkspaceVideoRange} from '../workspaceVideo';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {editStudioDocument} from './studioDocument.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner prepares independent exact ranges from one source across multiple shots',async()=>{
 const f=await productionWorkspaceFixture();try{
  const made=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(made.status).toBe(200);let w=made.body;
  const result=await f.request('saveWorkspaceVideoRanges',{workspaceId:w.id,expectedRevision:w.revision,shotId:w.clips[0].shotId,ranges:[{materialRevisionId:f.material,sourceInFrame:15,durationInFrames:15,durationLocked:true},{materialRevisionId:f.material,sourceInFrame:30,durationInFrames:30,durationLocked:false}]});
  expect(result.status,JSON.stringify(result.body)).toBe(200);w=result.body;
  expect(w.clips.filter((c:{shotId:string})=>c.shotId===made.body.clips[0].shotId)).toHaveLength(2);
  const response=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace/project?sha=${w.project.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});const {project}=await response.json();
  expect(project.timelines[0].items.slice(0,2).map((i:Record<string,unknown>)=>[i.srcInFrame,i.durationInFrames])).toEqual([[15,15],[30,30]]);
  expect(project.assets).toHaveLength(1);expect(await readFile(join(f.assetRoot,f.videoPath))).toHaveLength(f.files[0].fileSize);
 }finally{await f.close();}
},180000);

const exec=promisify(execFile);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each([false,true])('Owner renders many-to-many exact video ranges in native Studio (landscape=%s)',async landscape=>{
 const f=await productionWorkspaceFixture({landscape});try{
  const upload=async(name:string)=>{const bytes=await readFile(workspaceTestMedia(name));const r=await f.request('importMaterial',{materialType:'video',sourceKind:'file',sourcePath:name,mimeType:'video/mp4',contentBase64:bytes.toString('base64'),isMainScript:false,materialPurpose:'a_roll',deferRefresh:true});expect(r.status,JSON.stringify(r.body)).toBe(200);return{...r.body,bytes};};
  const source=await upload('landscape-red-blue.mp4'),portrait=await upload('portrait-green.mp4');
  expect(source.storage_path).toContain(source.sha256);expect(source.sha256).toBe('7328eafc62fad1f3537bc91fccb097bcb19698427e7bee0badae74334bc64ba6');
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const save=async(shotId:string,ranges:unknown[])=>{const result=await f.request('saveWorkspaceVideoRanges',{workspaceId:w.id,expectedRevision:w.revision,shotId,ranges});expect(result.status,JSON.stringify(result.body)).toBe(200);w=result.body;};
  const first=w.clips[0],second=w.clips[1];
  await save(first.shotId,[{clipId:first.id,materialRevisionId:source.id,sourceInFrame:0,durationInFrames:30,durationLocked:true},{materialRevisionId:portrait.id,sourceInFrame:30,durationInFrames:30,durationLocked:false}]);
  await save(second.shotId,[{clipId:second.id,materialRevisionId:source.id,sourceInFrame:60,durationInFrames:30,durationLocked:true}]);
  expect(w.clips.map((c:{itemId:string})=>c.itemId)).toContain(first.itemId);expect(w.clips.map((c:{itemId:string})=>c.itemId)).toContain(second.itemId);
  await f.restart();const read=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});w=(await read.json()).workspace;
  const doc=async()=>{const r=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace/project?sha=${w.project.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);return(await r.json()).project;};
  let project=await doc();expect(project.assets).toHaveLength(2);expect(project.timelines[0].items.map((i:Record<string,unknown>)=>[i.srcInFrame,i.durationInFrames])).toEqual([[0,30],[30,30],[60,30]]);
  const beforeOther=structuredClone(project.timelines[0].items[2]);
  // Remove only the portrait reference; a retained native item and both immutable sources survive.
  await save(first.shotId,[{clipId:first.id,materialRevisionId:source.id,sourceInFrame:0,durationInFrames:60,durationLocked:true}]);project=await doc();expect(project.timelines[0].items[1]).toEqual(beforeOther);expect(project.assets).toHaveLength(2);
  expect(await readFile(join(f.assetRoot,portrait.storage_path))).toEqual(portrait.bytes);
  // Restore a second source; the reused second-shot interval remains independent.
  await save(first.shotId,[{clipId:first.id,materialRevisionId:source.id,sourceInFrame:0,durationInFrames:30,durationLocked:true},{materialRevisionId:portrait.id,sourceInFrame:30,durationInFrames:30,durationLocked:false}]);
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
  expect((await fetch(opened.body.studioUrl)).status).toBe(200);
  const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;
  await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});project=await doc();
  expect(project.timelines[0].items.map((i:Record<string,unknown>)=>[i.srcInFrame,i.durationInFrames])).toEqual([[0,30],[30,30],[60,30]]);expect(project.timelines[0].items[0].loopControlVideo).toEqual({durationLocked:true});
  const state={...project.timelines[0],width:landscape?640:360,height:landscape?360:640},spec=join(f.root,'render.json'),output=join(f.root,'native-video.mp4');
  await writeFile(spec,JSON.stringify({openchatcutRoot:f.runtime.root,assetRoot:f.assetRoot,outputPath:output,state,sources:[{relativePath:source.storage_path},{relativePath:portrait.storage_path}]}));
  await exec(process.execPath,['scripts/openchatcut-render.mjs',spec],{timeout:180000,maxBuffer:4*1024*1024});
  const color=async(time:string)=>{const {stdout}=await exec('ffmpeg',['-v','error','-ss',time,'-i',output,'-vf','crop=20:20:(iw-20)/2:(ih-20)/2,scale=1:1','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer'});return[...stdout];};
  const red=await color('0.5'),green=await color('1.5'),blue=await color('2.5');expect(red[0]).toBeGreaterThan(200);expect(red[2]).toBeLessThan(20);expect(green[1]).toBeGreaterThan(90);expect(green[0]).toBeLessThan(20);expect(blue[2]).toBeGreaterThan(200);expect(blue[0]).toBeLessThan(20);
  const sourceHash=createHash('sha256').update(await readFile(join(f.assetRoot,source.storage_path))).digest('hex');expect(sourceHash).toBe(source.sha256);
  const evidence=process.env.LOOP_VIDEO_EVIDENCE_DIR;if(evidence){await mkdir(evidence,{recursive:true});const name=landscape?'landscape':'portrait';await writeFile(join(evidence,name+'.mp4'),await readFile(output));await writeFile(join(evidence,name+'.json'),JSON.stringify({sourceHash,portraitHash:portrait.sha256,red,green,blue,projectSha256:w.project.sha256,width:state.width,height:state.height,items:state.items.map((i:Record<string,unknown>)=>({id:i.id,sourceRevision:i.sourceRevision,srcInFrame:i.srcInFrame,durationInFrames:i.durationInFrames,loopControlVideo:i.loopControlVideo}))},null,2));}
 }finally{await f.close();}
},240000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner moves a locked range by exactly one frame in real native output',async()=>{
 const f=await productionWorkspaceFixture();try{
  const bytes=await readFile(workspaceTestMedia('landscape-red-blue.mp4')),upload=await f.request('importMaterial',{materialType:'video',sourceKind:'file',sourcePath:'transition.mp4',mimeType:'video/mp4',contentBase64:bytes.toString('base64'),isMainScript:false,materialPurpose:'a_roll',deferRefresh:true});expect(upload.status).toBe(200);
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const moved=adjustWorkspaceVideoRange({materialRevisionId:upload.body.id,sourceInFrame:59,durationInFrames:30,durationLocked:true},'in',1,120);
  const matched=await f.request('saveWorkspaceVideoRanges',{workspaceId:w.id,expectedRevision:w.revision,shotId:w.clips[0].shotId,ranges:[moved]});expect(matched.status).toBe(200);w=matched.body;
  const r=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace/project?sha=${w.project.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}}),project=(await r.json()).project;
  const state={...project.timelines[0],width:640,height:360,items:project.timelines[0].items.filter((i:Record<string,unknown>)=>i.kind==='video')};expect(state.items[0]).toMatchObject({srcInFrame:60,durationInFrames:30});
  const spec=join(f.root,'frame-render.json'),output=join(f.root,'frame.mp4');await writeFile(spec,JSON.stringify({openchatcutRoot:f.runtime.root,assetRoot:f.assetRoot,outputPath:output,state,sources:[{relativePath:upload.body.storage_path}]}));await exec(process.execPath,['scripts/openchatcut-render.mjs',spec],{timeout:180000,maxBuffer:4*1024*1024});
  const frame=await exec('ffmpeg',['-v','error','-i',output,'-vf','crop=20:20:(iw-20)/2:(ih-20)/2,scale=1:1','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer'});expect(frame.stdout[2]).toBeGreaterThan(200);expect(frame.stdout[0]).toBeLessThan(20);
  const probe=await exec('ffprobe',['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=duration,nb_read_frames','-of','json',output]);expect(JSON.parse(probe.stdout).streams[0]).toMatchObject({duration:'1.000000',nb_read_frames:'30'});
  const evidence=process.env.LOOP_VIDEO_EVIDENCE_DIR;if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'one-frame.mp4'),await readFile(output));await writeFile(join(evidence,'one-frame.json'),JSON.stringify({before:{sourceInFrame:59,durationInFrames:30},after:moved,firstPixel:[...frame.stdout],durationSeconds:1},null,2));}
 }finally{await f.close();}
},240000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner boundaries reject stale, foreign, invalid, tampered and active-editor range writes',async()=>{
 const f=await productionWorkspaceFixture();try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const payload={workspaceId:w.id,expectedRevision:w.revision,shotId:w.clips[0].shotId,ranges:[{clipId:w.clips[0].id,materialRevisionId:f.material,sourceInFrame:0,durationInFrames:30,durationLocked:true}]};
  expect((await f.request('saveWorkspaceVideoRanges',payload,{token:f.otherToken})).status).toBe(404);expect((await f.request('saveWorkspaceVideoRanges',payload,{csrf:false})).status).toBe(403);expect((await f.request('saveWorkspaceVideoRanges',payload,{origin:'http://foreign.invalid'})).status).toBe(403);
  expect((await f.request('saveWorkspaceVideoRanges',{...payload,expectedRevision:0})).status).toBe(409);
  for(const range of [{...payload.ranges[0],sourceInFrame:-1},{...payload.ranges[0],sourceInFrame:0.5},{...payload.ranges[0],durationInFrames:0},{...payload.ranges[0],durationInFrames:61},{...payload.ranges[0],durationLocked:'yes'},{...payload.ranges[0],url:'file:///outside'}])expect((await f.request('saveWorkspaceVideoRanges',{...payload,ranges:[range]})).status).toBe(400);
  expect((await f.request('saveWorkspaceVideoRanges',{...payload,ranges:[{...payload.ranges[0],materialRevisionId:f.script}]})).status).toBe(404);
  expect((await f.request('saveWorkspaceVideoRanges',{...payload,ranges:[{...payload.ranges[0],clipId:w.clips[1].id}]})).status).toBe(409);
  expect((await f.request('saveWorkspaceVideoRanges',{...payload,ranges:[payload.ranges[0],payload.ranges[0]]})).status).toBe(400);
  const source=join(f.assetRoot,f.videoPath),original=await readFile(source);await writeFile(source,Buffer.alloc(original.length));expect((await f.request('saveWorkspaceVideoRanges',payload)).status).toBe(409);await writeFile(source,original);w=await f.fillVisuals(w);
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status).toBe(200);w=opened.body.productionWorkspace;
  expect((await f.request('saveWorkspaceVideoRanges',{...payload,expectedRevision:w.revision})).status).toBe(409);
  // Persist an actual native edit through the Studio ownership boundary, then save through Owner HTTP.
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,project=>{project.timelines[0].items[1].transform.x=17;});
  const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;
  await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});const denied=await f.request('saveWorkspaceVideoRanges',{...payload,expectedRevision:w.revision});expect(denied.status).toBe(409);expect(denied.body.error).toContain('剪辑');
  const r=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace/project?sha=${w.project.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect((await r.json()).project.timelines[0].items[1].transform.x).toBe(17);
 }finally{await f.close();}
},180000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner cannot select audio-only tail beyond the video stream',async()=>{
 const f=await productionWorkspaceFixture();try{
  const path=join(f.root,'long-audio.mp4');await exec('ffmpeg',['-nostdin','-v','error','-i',join(f.assetRoot,f.videoPath),'-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-t','4',path]);
  const uploaded=await f.request('importMaterial',{materialType:'video',sourceKind:'file',sourcePath:'long-audio.mp4',mimeType:'video/mp4',contentBase64:(await readFile(path)).toString('base64'),isMainScript:false,materialPurpose:'a_roll',deferRefresh:true});expect(uploaded.status).toBe(200);
  const w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const result=await f.request('saveWorkspaceVideoRanges',{workspaceId:w.id,expectedRevision:w.revision,shotId:w.clips[0].shotId,ranges:[{materialRevisionId:uploaded.body.id,sourceInFrame:90,durationInFrames:30,durationLocked:false}]});expect(result.status,JSON.stringify(result.body)).toBe(400);
 }finally{await f.close();}
},180000);
