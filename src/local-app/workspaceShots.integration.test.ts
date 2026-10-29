// @vitest-environment node
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner reorders native shot instances without rewriting registered sources or storyboard history',async()=>{
 const f=await productionWorkspaceFixture();try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const before=await readFile(join(f.assetRoot,f.boardPath),'utf8');
  const moved=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'move',shotId:w.clips[1].shotId,beforeShotId:w.clips[0].shotId}});
  expect(moved.status,JSON.stringify(moved.body)).toBe(200);w=moved.body;
  const project=(await (await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace/project?sha=${w.project.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}})).json()).project;
  expect(project.timelines[0].items.find((i:{id:string})=>i.id===w.clips[0].itemId).startFrame).toBe(0);
  expect(w.clips[0].shotId).toBe('shot-2');expect(await readFile(join(f.assetRoot,f.boardPath),'utf8')).toBe(before);
  expect((await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision-1,operation:{kind:'remove',shotId:'shot-2'}})).status).toBe(409);
  await f.restart();const resumed=(await (await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}})).json()).workspace;
  expect(resumed.clips[0].shotId).toBe('shot-2');expect(resumed.history.length).toBeGreaterThan(1);
 }finally{await f.close();}
},180_000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a shot with two visual ranges owns one stable caption lane when its first range is removed',async()=>{
 const {defaultShotCaptionContract}=await import('../shotCaptions');
 const f=await productionWorkspaceFixture();try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const shot=w.clips[0].shotId,first=w.clips[0].id;
  w=(await f.request('saveWorkspaceVideoRanges',{workspaceId:w.id,expectedRevision:w.revision,shotId:shot,ranges:[{clipId:first,materialRevisionId:f.material,sourceInFrame:0,durationInFrames:30,durationLocked:false},{materialRevisionId:f.material,sourceInFrame:30,durationInFrames:30,durationLocked:true}]})).body;
  const contract=defaultShotCaptionContract('完整字幕正文','independent');contract.cues=[{id:'body',text:contract.text,startMs:0,endMs:1900}];
  const saved=await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:first,captionContract:contract});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body;
  expect(w.captions.filter((c:{shotId:string})=>c.shotId===shot)).toHaveLength(1);
  expect((await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'remove-range',itemId:w.clips[0].itemId}})).status).toBe(409);
  contract.cues[0].endMs=900;w=(await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:first,captionContract:contract})).body;
  const removed=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'remove-range',itemId:w.clips[0].itemId}});expect(removed.status,JSON.stringify(removed.body)).toBe(200);w=removed.body;
  const caption=w.captions.find((c:{shotId:string})=>c.shotId===shot);expect(caption.contract.text).toBe(contract.text);expect(caption.contract.cues[0].id).toContain('body');expect(caption.contract.cues[0].endMs).toBe(900);
  const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),lanes=Object.values(project.timelines[0].tracks).flatMap((t:any)=>t.captions?.sourceEntries??[]);
  expect(lanes).toHaveLength(1);expect(lanes[0].id).toBe(`workspace-caption-shot-${shot}`);
  await f.restart();const restored=(await (await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}})).json()).workspace;expect(restored.captions.find((c:{shotId:string})=>c.shotId===shot).contract.text).toBe(contract.text);
 }finally{await f.close();}
},180_000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('native range locks, frame steps and parallel composition preserve source instances through Owner persistence',async()=>{
 const f=await productionWorkspaceFixture();try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const ranged=await f.request('saveWorkspaceVideoRanges',{workspaceId:w.id,expectedRevision:w.revision,shotId:w.clips[0].shotId,ranges:[{clipId:w.clips[0].id,materialRevisionId:f.material,sourceInFrame:0,durationInFrames:30,durationLocked:false},{materialRevisionId:f.material,sourceInFrame:30,durationInFrames:30,durationLocked:false}]});expect(ranged.status).toBe(200);w=ranged.body;
  const op=async(operation:unknown)=>{const result=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation});expect(result.status,JSON.stringify(result.body)).toBe(200);w=result.body;};
  const id=w.clips[0].itemId;await op({kind:'lock',itemId:id,locked:true});await op({kind:'range',itemId:id,edge:'in',deltaFrames:1});
  let project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),item=project.timelines[0].items.find((i:any)=>i.id===id);expect(item.srcInFrame).toBe(1);expect(item.durationInFrames).toBe(30);
  await op({kind:'composition',shotId:w.clips[0].shotId,layout:'2up-horizontal'});
  await op({kind:'appearance',itemId:id,fit:'contain',focusX:12,transition:'fade'});
  project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));const visuals=project.timelines[0].items.filter((i:any)=>w.clips.filter((c:any)=>c.shotId===w.clips[0].shotId).some((c:any)=>c.itemId===i.id));expect(visuals.map((i:any)=>i.startFrame)).toEqual([0,0]);expect(new Set(visuals.map((i:any)=>i.track)).size).toBe(2);expect(visuals[0].fadeInFrames).toBe(11);expect(visuals[0].transform.x).toBe(12);expect(visuals[0].sourceAssetId).toBe('material-'+f.material);
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);expect(opened.body.productionWorkspace.clips.map((c:any)=>c.itemId)).toEqual(w.clips.map((c:any)=>c.itemId));
 }finally{await f.close();}
},180_000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('two ranges retain one actual main voice and full following captions after deleting their first visual instance',async()=>{
 const {narrationFixture}=await import('./workspaceNarration.fixture'),{defaultShotCaptionContract}=await import('../shotCaptions'),{writeFile,mkdir,copyFile}=await import('node:fs/promises'),{execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{createHash}=await import('node:crypto');
 const f=await narrationFixture();try{
  await f.authorize();let w=f.made;const first=w.clips[0],base={workspaceId:w.id,expectedRevision:w.revision,clipId:first.id},text='完整口播跟随字幕，删除首个画面也不会丢失。';
  expect((await f.request('saveWorkspaceNarration',{...base,mode:'tts',text})).status).toBe(200);expect((await f.request('confirmWorkspaceNarration',base)).status).toBe(200);const generated=await f.request('generateWorkspaceNarration',base);expect(generated.status,JSON.stringify(generated.body)).toBe(200);const taskId=generated.body.narration[0].taskId;await f.execute(taskId);
  w=(await f.request('refreshWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision})).body;const voice=w.narration[0];
  const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'source.mp4',contentBase64:(await readFile(workspaceTestMedia('landscape-red-blue.mp4'))).toString('base64'),materialType:'video',mimeType:'video/mp4',isMainScript:false,materialPurpose:'a_roll'});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
  const ranges=await f.request('saveWorkspaceVideoRanges',{workspaceId:w.id,expectedRevision:w.revision,shotId:first.shotId,ranges:[{clipId:first.id,materialRevisionId:imported.body.id,sourceInFrame:0,durationInFrames:72,durationLocked:false},{materialRevisionId:imported.body.id,sourceInFrame:48,durationInFrames:72,durationLocked:false}]});expect(ranges.status,JSON.stringify(ranges.body)).toBe(200);w=ranges.body;
  const contract=defaultShotCaptionContract(text,'follow_tts');contract.cues=[{id:'full-voice',text,startMs:0,endMs:2400}];contract.spatial.maxCharactersPerLine=12;
  const caption=await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:first.id,captionContract:contract});expect(caption.status,JSON.stringify(caption.body)).toBe(200);w=caption.body;expect(w.captions.filter((c:any)=>c.shotId===first.shotId)).toHaveLength(1);
  const removed=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'remove-range',itemId:first.itemId}});expect(removed.status,JSON.stringify(removed.body)).toBe(200);w=removed.body;
  const current=w.captions.find((c:any)=>c.shotId===first.shotId);expect(current.contract.text).toBe(text);expect(current.contract.cues.at(-1).endMs).toBe(2400);expect(current.durationMs).toBe(2400);expect(current.audioTrackId).toBe(voice.audioTrackId);
  expect(w.narration[0]).toMatchObject({taskId,audioTrackId:voice.audioTrackId,itemId:voice.itemId,text});
  expect((await f.request('generateWorkspaceNarration',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id})).body.narration[0].taskId).toBe(taskId);expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
  const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(project.timelines[0].items.filter((i:any)=>i.id===voice.itemId)).toHaveLength(1);expect(Object.values(project.timelines[0].tracks).flatMap((t:any)=>t.captions?.sourceEntries??[])).toHaveLength(1);
  await f.restart();const resumed=await f.read();expect(resumed.captions.find((c:any)=>c.shotId===first.shotId).contract.text).toBe(text);
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);await f.closeStudio();
  const output=join(f.root,'t10-structure.mp4'),spec=join(f.root,'t10-render.json');await writeFile(spec,JSON.stringify({openchatcutRoot:f.runtime.root,assetRoot:f.assetRoot,outputPath:output,state:{...project.timelines[0],width:180,height:320},sources:project.assets.map((a:any)=>({relativePath:a.src}))}));await promisify(execFile)(process.execPath,['scripts/openchatcut-render.mjs',spec],{timeout:120000,maxBuffer:4*1024*1024});
  const measure=async(path:string)=>{const {stderr}=await promisify(execFile)('ffmpeg',['-nostdin','-v','info','-i',path,'-t','2','-af','aformat=channel_layouts=stereo,volumedetect','-f','null','-']);return Number(stderr.match(/mean_volume: (-?[\d.]+) dB/)?.[1]);};const outputDb=await measure(output),sourceDb=await measure(join(f.assetRoot,voice.relativePath));expect(Math.abs(outputDb-sourceDb)).toBeLessThan(.6);
  const evidence=join(process.cwd(),'docs/verification/issue-162-workspace-editing/evidence');await mkdir(evidence,{recursive:true});await copyFile(output,join(evidence,'structure-caption-voice.mp4'));await writeFile(join(evidence,'cross-ticket.json'),JSON.stringify({taskId,voiceItemId:voice.itemId,voiceTrackId:voice.audioTrackId,remainingVisualItemId:w.clips[0].itemId,captionLaneId:`workspace-caption-shot-${first.shotId}`,cueText:text,cueEndMs:2400,submissions:1,sourceDb,outputDb,sha256:createHash('sha256').update(await readFile(output)).digest('hex')},null,2)+'\n');
 }finally{await f.close();}
},180_000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('reopening an actively edited native structure reuses its running Studio and latest project',async()=>{
 const {writeFile}=await import('node:fs/promises'),{applyWorkspaceShotOperation}=await import('../workspaceShots');const f=await productionWorkspaceFixture();try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status).toBe(200);w=opened.body.productionWorkspace;
  const path=join(f.assetRoot,`episodes/${f.episode}/openchatcut-work/current/runtime/project-store-v1.json`),store=JSON.parse(await readFile(path,'utf8'));store.entries[`project:${w.project.projectId}`]=applyWorkspaceShotOperation(store.entries[`project:${w.project.projectId}`],{kind:'insert',afterShotId:w.clips[0].shotId,text:'保留原生结构与会话'});await writeFile(path,JSON.stringify(store));
  const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;expect(w.clips).toHaveLength(3);
  const reopened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(reopened.status,JSON.stringify(reopened.body)).toBe(200);expect(reopened.body.studioUrl).toBe(opened.body.studioUrl);expect(reopened.body.productionWorkspace.clips).toHaveLength(3);
 }finally{await f.close();}
},180_000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('upgrades duplicate legacy visual caption lanes into one shot lane without losing the complete body or cues',async()=>{
 const {defaultShotCaptionContract}=await import('../shotCaptions'),{writeFile}=await import('node:fs/promises');const f=await productionWorkspaceFixture();try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;const first=w.clips[0];w=(await f.request('saveWorkspaceVideoRanges',{workspaceId:w.id,expectedRevision:w.revision,shotId:first.shotId,ranges:[{clipId:first.id,materialRevisionId:f.material,sourceInFrame:0,durationInFrames:30,durationLocked:false},{materialRevisionId:f.material,sourceInFrame:30,durationInFrames:30,durationLocked:false}]})).body;
  const contract=defaultShotCaptionContract('完整的旧字幕正文','follow_tts');contract.cues=[{id:'legacy-body',text:contract.text,startMs:0,endMs:900}];
  w=(await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:first.id,captionContract:{...contract,contentMode:'independent'}})).body;
  await f.c.query("UPDATE public.shot_preparation_drafts SET audio_mode='tts',tts_text=$3,tts_voice='fixture',tts_speaking_rate=1 WHERE episode_id=$1 AND shot_id=$2",[f.episode,first.shotId,contract.text]);
  const captions=await f.request('saveWorkspaceCaptions',{workspaceId:w.id,expectedRevision:w.revision,clipId:first.id,captionContract:contract});expect(captions.status,JSON.stringify(captions.body)).toBe(200);w=captions.body;
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status).toBe(200);w=opened.body.productionWorkspace;const path=join(f.assetRoot,`episodes/${f.episode}/openchatcut-work/current/runtime/project-store-v1.json`),store=JSON.parse(await readFile(path,'utf8')),doc=store.entries[`project:${w.project.projectId}`],track=Object.values(doc.timelines[0].tracks).find((t:any)=>t.kind==='caption') as any,lane=track.captions.sourceEntries[0];lane.id=`workspace-caption-${first.itemId}`;lane.itemId=`manual:${lane.id}`;const duplicate=structuredClone(lane);duplicate.id=`workspace-caption-${w.clips[1].itemId}`;duplicate.itemId=`manual:${duplicate.id}`;for(const word of duplicate.words){word.start+=1000;word.end+=1000;}track.captions.sourceEntries.push(duplicate);await writeFile(path,JSON.stringify(store));
  const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});
  const removed=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'remove-range',itemId:first.itemId}});expect(removed.status,JSON.stringify(removed.body)).toBe(200);w=removed.body;const current=w.captions.find((c:any)=>c.shotId===first.shotId);expect(current.contract.text).toBe(contract.text);expect(current.contract.cues).toHaveLength(1);expect(current.contract.cues[0].endMs).toBe(900);const upgraded=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(Object.values(upgraded.timelines[0].tracks).flatMap((t:any)=>t.captions?.sourceEntries??[])).toHaveLength(1);
 }finally{await f.close();}
},180_000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('added native shots accept registered images and source video while the approved storyboard stays unchanged',async()=>{
 const f=await productionWorkspaceFixture();try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;const boardBefore=await readFile(join(f.assetRoot,f.boardPath),'utf8');
  const insert=async(text:string)=>{const r=await f.request('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'insert',afterShotId:w.clips.at(-1).shotId,text}});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;return w.clips.at(-1);};
  const imageClip=await insert('新增的静态画面');expect(w.nativeEditRevision).toBeGreaterThan(0);
  const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'added.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(image.status).toBe(200);
  const picture=await f.request('matchWorkspaceImage',{workspaceId:w.id,expectedRevision:w.revision,clipId:imageClip.id,materialRevisionId:image.body.id,usage:'pan-zoom',durationSeconds:1.2,fit:'contain',focusX:7,focusY:0});expect(picture.status,JSON.stringify(picture.body)).toBe(200);w=picture.body;
  const videoClip=await insert('新增的原片引用');const video=await f.request('importMaterial',{materialType:'video',sourceKind:'file',sourcePath:'added.mp4',mimeType:'video/mp4',contentBase64:(await readFile(workspaceTestMedia('landscape-red-blue.mp4'))).toString('base64'),isMainScript:false,materialPurpose:'a_roll'});expect(video.status).toBe(200);
  const filled=await f.request('matchWorkspaceMaterial',{workspaceId:w.id,expectedRevision:w.revision,clipId:videoClip.id,materialRevisionId:video.body.id});expect(filled.status,JSON.stringify(filled.body)).toBe(200);w=filled.body;
  const doc=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),item=doc.timelines[0].items.find((i:any)=>i.id===videoClip.itemId),still=doc.timelines[0].items.find((i:any)=>i.id===imageClip.itemId);expect([item.width,item.height]).toEqual([640,360]);expect(item.sourceAssetId).toBe('material-'+video.body.id);expect(still.kind).toBe('image');expect(still.keyframes.x[0].value).toBe(7);expect(await readFile(join(f.assetRoot,f.boardPath),'utf8')).toBe(boardBefore);
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);
 }finally{await f.close();}
},180_000);
