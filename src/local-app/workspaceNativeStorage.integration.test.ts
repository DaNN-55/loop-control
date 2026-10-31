// @vitest-environment node
import {it,expect} from 'vitest';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {createHash} from 'node:crypto';
import {editStudioDocument} from './studioDocument.fixture';
import {readFile,rename,mkdir,readdir,writeFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(['legacy','registered'] as const)('Owner edits, restarts, exports and delivers the sole native workspace (%s)',async layout=>{
 const f=await productionWorkspaceFixture({episodeRelativePath:layout==='registered'?()=> '系列 [T09]_百分%/生产单 空间':undefined,runtime:{wake(){}},migrations:['db/local/118-visual-storage-locations.sql','db/local/119-audio-caption-storage-locations.sql','db/local/120-native-workspace-storage-locations.sql']});
 try{
  const prepared=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);let w=prepared.body;
  expect(w.project.relativePath).toBe(`${f.episodeRelativePath}/production-workspace/versions/${w.project.sha256}.json`);
  w=await f.fillVisuals(w);const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);
  expect(opened.body.workspace.relativePath).toBe(`${f.episodeRelativePath}/openchatcut-work/current/project.json`);
  const nativeReceipt=JSON.parse(await readFile(join(f.assetRoot,f.episodeRelativePath,'openchatcut-work/current/runtime/.loop-control-studio-process.json'),'utf8'));expect(nativeReceipt.cache.path).not.toContain(f.assetRoot);expect((await lstat(nativeReceipt.cache.path)).isDirectory()).toBe(true);
  w=opened.body.productionWorkspace;const send=(command:string,data={})=>f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});
  const repeated=await send('openWorkspaceStudio');expect(repeated.status).toBe(200);expect(repeated.body.studioUrl).toBe(opened.body.studioUrl);w=repeated.body.productionWorkspace;
  await editStudioDocument(opened.body.studioUrl,w.project.projectId,doc=>{doc.timelines[0].items[0].name='T09 保存并重开';});
  const saved=await send('saveWorkspaceStudio',{workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;
  expect((await send('closeWorkspaceStudio')).status).toBe(200);await expect(lstat(nativeReceipt.cache.path)).rejects.toMatchObject({code:'ENOENT'});await f.restart();const reopened=await send('openWorkspaceStudio');expect(reopened.status,JSON.stringify(reopened.body)).toBe(200);w=reopened.body.productionWorkspace;
  await f.c.query("UPDATE public.episodes SET title='改名后仍可使用' WHERE id=$1",[f.episode]);
  const doc=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(doc.timelines[0].items[0].name).toBe('T09 保存并重开');
  expect((await send('closeWorkspaceStudio')).status).toBe(200);
  if(layout==='registered'){
   const actual=join(f.assetRoot,f.episodeRelativePath),retained=actual+'-retained';await rename(actual,retained);await mkdir(actual);
   for(const command of ['openWorkspaceStudio','exportWorkspace','prepareWorkspaceDelivery'])expect((await send(command)).status).toBe(409);
   expect(await readdir(actual)).toEqual([]);await (await import('node:fs/promises')).rmdir(actual);await rename(retained,actual);
  }
  const exported=await send('exportWorkspace');expect(exported.status,JSON.stringify(exported.body)).toBe(200);w=exported.body;expect(w.exports[0].status,JSON.stringify(w.exports[0].checks)).toBe('ready');expect(w.exports[0].artifact.relativePath.startsWith(f.episodeRelativePath+'/workspace-exports/')).toBe(true);

  w=(await send('confirmWorkspaceExport',{exportId:w.exports[0].id,expectedExportSha256:w.exports[0].artifact.sha256,expectedContentSha256:w.contentSha256})).body;
  const delivery=await send('prepareWorkspaceDelivery',{exportId:w.exports[0].id,expectedExportSha256:w.exports[0].artifact.sha256,expectedContentSha256:w.contentSha256,title:'T09 交付',description:'实际文件',tags:['测试'],coverBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(delivery.status,JSON.stringify(delivery.body)).toBe(200);w=delivery.body;
  expect(await readFile(join(f.assetRoot,f.episodeRelativePath,'workspace-deliveries',w.deliveries[0].id,'cover.png'))).toEqual(await readFile(workspaceTestMedia('still-striped.png')));
  const worker=f.workerPool();try{await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,1)');const tasks=await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_worker_capacity:1});expect(tasks).toHaveLength(1);const result=await runWorkspaceDeliveryProcess(f,tasks[0] as any);expect(result.status,JSON.stringify(result)).toBe('completed');const pack=result.artifacts.find((a:any)=>a.artifactType==='publish_package');expect(pack.relativePath.startsWith(f.episodeRelativePath+'/workspace-deliveries/')).toBe(true);const manifest=JSON.parse(await readFile(join(f.assetRoot,pack.relativePath),'utf8'));
   for(const artifact of [...manifest.artifacts,pack]){const res=await fetch(f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(artifact.relativePath)}&sha256=${artifact.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(res.status,artifact.relativePath).toBe(200);const bytes=Buffer.from(await res.arrayBuffer());expect(bytes.length).toBe(artifact.fileSize);expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);}
   await f.restart();const readback=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(readback.status).toBe(200);expect((await readback.json()).workspace.deliveries[0].verified).toBe(true);
   if(process.env.LOOP_T09_EVIDENCE){const dir=join(process.env.LOOP_T09_EVIDENCE,layout);await mkdir(dir,{recursive:true});await writeFile(join(dir,'result.json'),JSON.stringify({result,manifest,workspace:w,compilerCache:nativeReceipt.cache,compilerCacheRemovedAfterClose:true},null,2));for(const a of [...manifest.artifacts,pack])await writeFile(join(dir,a.artifactType==='final_render'?'final.mp4':a.artifactType==='cover'?'cover.png':a.artifactType+'.json'),await readFile(join(f.assetRoot,a.relativePath)));}
  }finally{await worker.end();}
 }finally{await f.close();}
},120000);
