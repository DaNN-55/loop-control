// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {editStudioDocument} from './studioDocument.fixture';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
it.skipIf(!enabled)('native upload is archived and registered on save, then reopens without the transient upload',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  const prepared=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(prepared.status).toBe(200);let w=await f.fillVisuals(prepared.body);
  const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
  const png=join(f.root,'native-only.png');await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=360x640','-frames:v','1',png]);
  const origin=new URL(opened.body.studioUrl).origin,bytes=await readFile(png),headers={Origin:origin,'Sec-Fetch-Site':'none','Content-Type':'image/png'};
  const response=await fetch(origin+'/upload?name=native-only.png',{method:'POST',headers,body:new Uint8Array(bytes)});expect(response.status,await response.clone().text()).toBe(200);const uploaded=await response.json(),src=uploaded.path??uploaded.downloadUrl;
  expect(src).toMatch(/^\/media\/uploads\//);
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{
   doc.assets.push({id:'native-imported-image',kind:'image',name:'自己的画面.png',src,width:360,height:640,durationInFrames:90});
   const item={...doc.timelines[0].items.find((i:any)=>i.kind==='video'),id:'free-native-image',kind:'image',src,sourceAssetId:'native-imported-image',startFrame:0,durationInFrames:30,width:360,height:640};delete item.loopControlShot;delete item.loopControlCandidate;delete item.loopControlSourceAudio;delete item.sourceContentHash;doc.timelines[0].items.push(item);
  });
  for(const [kind,path,mime] of [['video',join(f.assetRoot,f.videoPath),'video/mp4'],['audio',join(f.assetRoot,f.files.find(file=>file.relativePath.endsWith('.mp3'))!.relativePath),'audio/mpeg']] as const){
   const mediaBytes=await readFile(path),uploadedMedia=await fetch(origin+'/upload?name=native-'+kind+(kind==='video'?'.mp4':'.mp3'),{method:'POST',headers:{...headers,'Content-Type':mime},body:new Uint8Array(mediaBytes)});expect(uploadedMedia.status).toBe(200);const result=await uploadedMedia.json(),mediaSrc=result.path??result.downloadUrl;
   await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{const timeline=doc.timelines[0],track=kind==='audio'?'native-audio':timeline.items[0].track;doc.assets.push({id:'native-'+kind,name:'原生导入'+kind,kind,src:mediaSrc,durationInFrames:60,...(kind==='video'?{width:360,height:640}:{})});if(kind==='audio'){timeline.tracks[track]={kind:'audio',name:'原生音频'};timeline.trackOrder.push(track);}const item={...timeline.items.find((i:any)=>i.id==='free-native-image'),id:'free-native-'+kind,kind,src:mediaSrc,sourceAssetId:'native-'+kind,track,volume:1,startFrame:0,durationInFrames:30};timeline.items.push(item);});
  }
  const save=()=>f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});
  const saved=await save();expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;
  const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),item=project.timelines[0].items.find((i:any)=>i.id==='free-native-image');expect(item.src).toMatch(/\/materials\/[a-f0-9]{64}-native.png$/);expect(item.loopControlShot).toBeUndefined();expect(await readFile(join(f.assetRoot,item.src))).toEqual(bytes);
  expect((await f.c.query("SELECT count(*)::int n FROM public.production_material_revisions WHERE episode_id=$1 AND storage_path=$2",[f.episode,item.src])).rows[0].n).toBe(1);
  expect((await f.c.query("SELECT material_type FROM public.production_material_revisions WHERE episode_id=$1 AND source_path LIKE 'openchatcut-native/%' ORDER BY material_type",[f.episode])).rows.map(row=>row.material_type)).toEqual(['audio','image','video']);
  const second=await save();expect(second.status,JSON.stringify(second.body)).toBe(200);w=second.body.productionWorkspace;
  expect((await f.c.query("SELECT count(*)::int n FROM public.production_material_revisions WHERE episode_id=$1 AND storage_path=$2",[f.episode,item.src])).rows[0].n).toBe(1);
  await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});
  await rm(join(f.assetRoot,opened.body.workspace.relativePath.replace(/project.json$/,'runtime')+src));
  const reopen=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(reopen.status,JSON.stringify(reopen.body)).toBe(200);
  w=reopen.body.productionWorkspace;
  const native=await editStudioDocument(reopen.body.studioUrl,w.project.projectId,doc=>{
   delete doc.loopControl.editorAuthority; // Native history/tools may omit host metadata.
   const timeline=doc.timelines[0],image=timeline.items.find((i:any)=>i.id==='free-native-image');image.startFrame=0;image.durationInFrames=45;timeline.items=[image];
   for(const track of Object.values(timeline.tracks) as any[])if(track.kind==='caption')track.captions.sourceEntries=[{id:'my-manual-caption',itemId:image.id,label:'自己的字幕',slotId:'full',widthRatio:1,heightRatio:1,words:[{text:'直接在剪辑台完成',start:100,end:1200}]}];
  });expect(native.timelines[0].items).toHaveLength(1);
  const finalSave=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:reopen.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});expect(finalSave.status,JSON.stringify(finalSave.body)).toBe(200);w=finalSave.body.productionWorkspace;
  expect(w.clips).toHaveLength(0);expect(w.editorAuthority).toBe('native');
  const close=await f.request('closeWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(close.status).toBe(200);
  const exported=await f.request('exportWorkspace',{workspaceId:w.id,expectedRevision:w.revision});expect(exported.status,JSON.stringify(exported.body)).toBe(200);w=exported.body;expect(w.exports[0].status,JSON.stringify(w.exports[0].checks)).toBe('ready');
  const result=w.exports[0],confirmed=await f.request('confirmWorkspaceExport',{workspaceId:w.id,expectedRevision:w.revision,exportId:result.id,expectedExportSha256:result.artifact.sha256,expectedContentSha256:result.contentSha256});expect(confirmed.status,JSON.stringify(confirmed.body)).toBe(200);expect(confirmed.body.exports[0].confirmed).toBe(true);
 }finally{await f.close();}
},120000);
