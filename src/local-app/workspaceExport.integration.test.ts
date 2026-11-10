import {editStudioDocument} from './studioDocument.fixture';
// @vitest-environment node
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,copyFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {it,expect} from 'vitest';
import {defaultShotCaptionContract} from '../shotCaptions';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner checks actual used content before exporting and confirms exact final bytes',async()=>{
 const f=await productionWorkspaceFixture({migrations:['db/local/093-workspace-export.sql']});
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const send=(name:string,extra={})=>f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...extra});
  const blocked=await send('exportWorkspace');expect(blocked.status,JSON.stringify(blocked.body)).toBe(200);w=blocked.body;expect(w.exports[0].status).toBe('failed');expect(w.exports[0].checks.some((x:{name:string;passed:boolean})=>x.name==='used_content'&&!x.passed)).toBe(true);
  for(const clip of w.clips){const matched=await send('matchWorkspaceMaterial',{clipId:clip.id,materialRevisionId:f.material});expect(matched.status,JSON.stringify(matched.body)).toBe(200);w=matched.body;}
  const defaultCaptions=await send('exportWorkspace');expect(defaultCaptions.status).toBe(200);w=defaultCaptions.body;expect(w.exports[0].status).toBe('ready');expect(w.exports[0].checks.find((x:{name:string})=>x.name==='captions').passed).toBe(true);
  for(const clip of w.clips){const saved=await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body;}
  // Native project-store is the real editor persistence boundary; Owner save still performs CAS.
  async function nativeEdit(edit:(doc:any)=>void){
   const opened=await send('openWorkspaceStudio');expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
   await editStudioDocument(opened.body.studioUrl,w.project.projectId,edit);
   const saved=await send('saveWorkspaceStudio',{workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;
   const closed=await send('closeWorkspaceStudio');expect(closed.status,JSON.stringify(closed.body)).toBe(200);w=closed.body;
  }
  const unused=await f.request('importMaterial',{sourceKind:'file',sourcePath:'unused-library.mp4',materialType:'video',materialPurpose:'visual_reference',mimeType:'video/mp4',isMainScript:false,contentBase64:(await readFile(join(f.assetRoot,f.videoPath))).toString('base64')});expect(unused.status,JSON.stringify(unused.body)).toBe(200);
  await nativeEdit(doc=>{doc.assets.push({id:'unused-rejected',name:'discarded',kind:'video',src:unused.body.storage_path,durationInFrames:30});const main=doc.timelines[0],first=structuredClone(main.items[0]),child={...structuredClone(main),id:'nested-used',name:'nested',items:[first],selectedId:null};doc.timelines.push(child);main.items[0]={id:'nested-reference',name:'nested sequence',kind:'sequence',track:first.track,timelineId:child.id,startFrame:first.startFrame,durationInFrames:first.durationInFrames,srcInFrame:0};});
  await unlink(join(f.assetRoot,unused.body.storage_path));
  const rendered=await send('exportWorkspace');expect(rendered.status,JSON.stringify(rendered.body)).toBe(200);w=rendered.body;expect(w.exports[0].status).toBe('ready');expect(w.exports[0].artifact.fileSize).toBeGreaterThan(1000);expect(w.exports[0].checks.every((x:{passed:boolean})=>x.passed)).toBe(true);
  const videoUrl=f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(w.exports[0].artifact.relativePath)}&sha256=${w.exports[0].artifact.sha256}`,video=await fetch(videoUrl,{headers:{Cookie:'loop_owner_session='+f.token}});expect(video.status).toBe(200);expect(createHash('sha256').update(Buffer.from(await video.arrayBuffer())).digest('hex')).toBe(w.exports[0].artifact.sha256);expect((await fetch(videoUrl,{headers:{Cookie:'loop_owner_session='+f.otherToken}})).status).toBe(404);expect((await fetch(videoUrl,{headers:{Cookie:'loop_owner_session='+f.token,Range:'bytes=0-127'}})).status).toBe(206);
  expect((await send('confirmWorkspaceExport',{exportId:w.exports[0].id,expectedExportSha256:'0'.repeat(64),expectedContentSha256:w.contentSha256})).status).toBe(409);
  const confirmed=await send('confirmWorkspaceExport',{exportId:w.exports[0].id,expectedExportSha256:w.exports[0].artifact.sha256,expectedContentSha256:w.contentSha256});expect(confirmed.status,JSON.stringify(confirmed.body)).toBe(200);w=confirmed.body;expect(w.exports[0].confirmed).toBe(true);
  const approved=w.exports[0],contentRevision=w.revision;
  await nativeEdit(doc=>{doc.timelines[0].selectedId='nested-reference';doc.timelines[0].selectedIds=['nested-reference'];});expect(w.revision).toBe(contentRevision);expect(w.exports[0].confirmed).toBe(true);
  await nativeEdit(doc=>{doc.timelines[1].items[0].transform.x=12;});expect(w.revision).toBeGreaterThan(contentRevision);expect(w.exports[0].confirmed).toBe(false);
  expect((await send('confirmWorkspaceExport',{exportId:approved.id,expectedExportSha256:approved.artifact.sha256,expectedContentSha256:approved.contentSha256})).status).toBe(409);
  const retry=await send('exportWorkspace');expect(retry.status,JSON.stringify(retry.body)).toBe(200);w=retry.body;expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');expect(w.exports.length).toBe(4);
  const issue=await send('recordWorkspaceExportIssue',{exportId:w.exports[0].id,reason:'检查开头画面位置'});expect(issue.status).toBe(200);w=issue.body;
  const confirm=()=>send('confirmWorkspaceExport',{exportId:w.exports[0].id,expectedExportSha256:w.exports[0].artifact.sha256,expectedContentSha256:w.contentSha256});expect((await confirm()).status).toBe(409);
  w=(await send('resolveWorkspaceExportIssue',{issueId:w.exportIssues[0].id})).body;w=(await confirm()).body;expect(w.exports[0].confirmed).toBe(true);
  const evidence=process.env.LOOP_T11_EVIDENCE_DIR;if(evidence){await mkdir(evidence,{recursive:true});await copyFile(join(f.assetRoot,w.exports[0].artifact.relativePath),join(evidence,'final.mp4'));await writeFile(join(evidence,'workspace.json'),JSON.stringify(w,null,2));await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-ss','0.5','-i',join(evidence,'final.mp4'),'-frames:v','1',join(evidence,'representative.jpg')]);}
  await f.restart();const read=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});w=(await read.json()).workspace;expect(w.exports[0].confirmed).toBe(true);
  await writeFile(join(f.assetRoot,w.exports[0].artifact.relativePath),'tampered');const corrupt=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect((await corrupt.json()).workspace.exports[0].confirmed).toBe(false);expect((await send('confirmWorkspaceExport',{exportId:w.exports[0].id,expectedExportSha256:w.exports[0].artifact.sha256,expectedContentSha256:w.contentSha256})).status).toBe(409);
 }finally{await f.close();}
},300000);
