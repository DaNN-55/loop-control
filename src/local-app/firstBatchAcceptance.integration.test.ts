// @vitest-environment node
import {it,expect} from 'vitest';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {editStudioDocument} from './studioDocument.fixture';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {narrationFixture} from './workspaceNarration.fixture';
import {readLocalCatalog,parseCatalogQuery} from './catalog';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
it.skipIf(!enabled)('initial native subtitles export directly without an empty editor save and detect later visual gaps',async()=>{
 const f=await productionWorkspaceFixture();try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  w=await f.fillVisuals(w);
  expect(w.captions.map((c:any)=>c.timing)).toEqual(['current','current']);
  expect(w.captions.every((c:any)=>!c.textConfirmed)).toBe(true);
  w=(await f.request('exportWorkspace',{workspaceId:w.id,expectedRevision:w.revision})).body;
  expect(w.exports[0].status,JSON.stringify(w.exports[0].checks)).toBe('ready');
  expect(w.exports[0].checks.find((c:any)=>c.name==='visual_coverage')).toMatchObject({passed:true});
  if(process.env.LOOP_FIRST_BATCH_EVIDENCE)await writeFile(join(process.env.LOOP_FIRST_BATCH_EVIDENCE,'direct-export.json'),JSON.stringify(w));
  const approved=w.exports[0],base=()=>({workspaceId:w.id,expectedRevision:w.revision});
  w=(await f.request('recordWorkspaceExportIssue',{...base(),exportId:approved.id,reason:'检查两镜衔接'})).body;
  const opened=await f.request('openWorkspaceStudio',base());expect(opened.status).toBe(200);w=opened.body.productionWorkspace;
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{doc.timelines[0].items[0].durationInFrames=30;});
  const saved=await f.request('saveWorkspaceStudio',{...base(),workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;
  w=(await f.request('closeWorkspaceStudio',base())).body;
  expect(w.captions[0].timing).toBe('stale');
  // An explicit unresolved issue survives a newer edit even before a new export exists.
  let catalog=await readLocalCatalog(f.pool,f.owner,parseCatalogQuery(new URLSearchParams('view=operations')));
  expect(catalog.operationRows.find((r:any)=>r.episodeId===f.episode)).toMatchObject({actionStatus:'blocked'});
  expect(catalog.blocked.items.some((r:any)=>r.blocker.code==='WORKSPACE_EXPORT_FAILED')).toBe(true);
  expect(Date.parse(catalog.episodes[0].updated_at)).toBeGreaterThanOrEqual(Date.parse(approved.createdAt));
  w=(await f.request('exportWorkspace',base())).body;
  expect(w.exports[0]).toMatchObject({status:'failed',artifact:null});
  expect(w.exports[0].checks.find((c:any)=>c.name==='visual_coverage')).toMatchObject({passed:false,detail:expect.stringContaining('1.00–2.00')});
  expect((await f.request('confirmWorkspaceExport',{...base(),exportId:approved.id,expectedExportSha256:approved.artifact.sha256,expectedContentSha256:approved.contentSha256})).status).toBe(409);
  if(process.env.LOOP_FIRST_BATCH_EVIDENCE)await writeFile(join(process.env.LOOP_FIRST_BATCH_EVIDENCE,'gap-blocked.json'),JSON.stringify(w));
 }finally{await f.close();}
},180000);
it.skipIf(!enabled)('unknown speech exposes original reservation and cannot resubmit; catalog surfaces the failed current task',async()=>{
 const f=await narrationFixture();try{
  await f.authorize();let w=f.made;const base={workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id};
  await f.request('saveWorkspaceNarration',{...base,mode:'tts',...f.narrationSettings,text:'核对未知请求。'});await f.request('confirmWorkspaceNarration',base);
  w=(await f.request('generateWorkspaceNarration',{...base,reservationCents:100})).body;
  await writeFile(f.responseMode,'unknown');await f.execute(w.narration[0].taskId);
  w=await f.read();expect(w.narration[0].generationTask).toMatchObject({submissionUnknown:true,reservationCents:100});
  expect((await f.request('generateWorkspaceNarration',{...base,retry:true,reservationCents:100})).status).toBe(409);
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
  const catalog=await readLocalCatalog(f.pool,f.owner,parseCatalogQuery(new URLSearchParams('view=operations')));
  expect(catalog.operationRows.find((r:any)=>r.episodeId===f.episode)).toMatchObject({actionStatus:'blocked'});
  expect(catalog.blocked.total).toBeGreaterThan(0);
  // Legacy interruptions may have Worker unknown evidence without a submission row.
  await f.c.query('DELETE FROM local_identity.workspace_narration_submissions WHERE task_id=$1',[w.narration[0].taskId]);
  w=await f.read();expect(w.narration[0].generationTask).toMatchObject({submissionUnknown:true,reservationCents:100});
  expect((await f.request('generateWorkspaceNarration',{...base,retry:true,reservationCents:100})).status).toBe(409);
  expect((await readFile(f.submissions,'utf8')).trim().split('\n')).toHaveLength(1);
 }finally{await f.close();}
},180000);
