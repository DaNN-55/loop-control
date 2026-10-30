// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {editStudioDocument} from './studioDocument.fixture';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('native text, style and timing save once, final-file approval confirms captions and later edits invalidate it',async()=>{
 const f=await productionWorkspaceFixture();
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  const send=(name:string,extra={})=>f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...extra});
  w=await f.fillVisuals(w);

  async function nativeEdit(edit:(doc:any)=>void){
   const opened=await send('openWorkspaceStudio');expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
   await editStudioDocument(opened.body.studioUrl,w.project.projectId,edit);
   const saved=await send('saveWorkspaceStudio',{workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;
   const closed=await send('closeWorkspaceStudio');expect(closed.status).toBe(200);w=closed.body;
  }
  const firstLane=(doc:any)=>Object.values(doc.timelines[0].tracks).flatMap((t:any)=>t.captions?.sourceEntries??[]).find((lane:any)=>lane.id===`workspace-caption-shot-${w.clips[0].shotId}`) as any;
  await nativeEdit(doc=>{const lane=firstLane(doc);lane.words[0].text='原生修改正文';lane.words[0].start=100;lane.words[0].end=800;lane.style.fontSize=.06;lane.style.color='#00ff00';lane.offsetXRatio=.12;});
  expect(w.captions[0].contract.text).toBe('原生修改正文');expect(w.captions.every((c:any)=>c.timing==='current')).toBe(true);expect(w.captions.every((c:any)=>!c.textConfirmed)).toBe(true);
  const {applyWorkspaceCaptionEdit,readWorkspaceCaption}=await import('../workspaceCaptions');
  const styled=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),aligned=applyWorkspaceCaptionEdit(styled,w.clips[0].itemId,{...readWorkspaceCaption(styled,w.clips[0].itemId)!.contract,cues:[{id:'new-time',text:'原生修改正文',startMs:120,endMs:750}]},{timingOnly:true});
  expect(firstLane(aligned).style).toEqual(firstLane(styled).style);expect(firstLane(aligned).offsetXRatio).toBe(.12);
  await f.restart();w=(await (await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}})).json()).workspace;
  let lane=firstLane(JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')));expect(lane.style.fontSize).toBe(.06);expect(lane.style.color).toBe('#00ff00');expect(lane.offsetXRatio).toBe(.12);
  const exported=await send('exportWorkspace');expect(exported.status,JSON.stringify(exported.body)).toBe(200);w=exported.body;expect(w.exports[0].status,JSON.stringify(w.exports[0].checks)).toBe('ready');expect(w.captions[0].textConfirmed).toBe(false);
  const approve={exportId:w.exports[0].id,expectedExportSha256:w.exports[0].artifact.sha256,expectedContentSha256:w.contentSha256};
  expect((await send('confirmWorkspaceExport',{...approve,expectedExportSha256:'0'.repeat(64)})).status).toBe(409);
  const confirmed=await send('confirmWorkspaceExport',approve);expect(confirmed.status,JSON.stringify(confirmed.body)).toBe(200);w=confirmed.body;expect(w.exports[0].confirmed).toBe(true);expect(w.captions.every((c:any)=>c.textConfirmed)).toBe(true);expect(w.readiness.deliverable).toBe(true);
  await nativeEdit(doc=>{firstLane(doc).style.fontSize=.055;});expect(w.captions[0].timing).toBe('current');expect(w.captions[0].textConfirmed).toBe(true);expect(w.exports[0].confirmed).toBe(false);expect(w.exports[0].current).toBe(false);
  await nativeEdit(doc=>{firstLane(doc).words[0].end=99999;});expect(w.captions[0].timing).toBe('stale');const invalid=await send('exportWorkspace');expect(invalid.status).toBe(200);w=invalid.body;expect(w.exports[0].status).toBe('failed');expect(w.exports[0].checks.find((x:any)=>x.name==='captions').passed).toBe(false);
  await nativeEdit(doc=>{firstLane(doc).words[0].end=700;});expect(w.captions[0].timing).toBe('current');expect(w.captions[0].textConfirmed).toBe(false);
  await nativeEdit(doc=>{const timeline=doc.timelines[0];for(const track of Object.values(timeline.tracks) as any[])if(track.captions)track.captions.sourceEntries=track.captions.sourceEntries.filter((entry:any)=>entry.id!==`workspace-caption-shot-${w.clips[0].shotId}`);});expect(w.captions[0].contract.enabled).toBe(false);
 }finally{await f.close();}
},300_000);
