// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner validates cover content and tag boundaries before queuing a package and preserves the exact confirmed delivery',async()=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){}}}),worker=f.workerPool();
 try{
 await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2)');
 let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
 const send=(name:string,extra:Record<string,unknown>={})=>f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...extra});
 for(const clip of w.clips)w=(await send('matchWorkspaceMaterial',{clipId:clip.id,materialRevisionId:f.material})).body;
 for(const clip of w.clips)w=(await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)})).body;
 w=(await send('exportWorkspace')).body;expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');const exported=w.exports[0];
 w=(await send('confirmWorkspaceExport',{exportId:exported.id,expectedExportSha256:exported.artifact.sha256,expectedContentSha256:w.contentSha256})).body;
 const png=await readFile(workspaceTestMedia('still-striped.png')),input={exportId:exported.id,expectedExportSha256:exported.artifact.sha256,expectedContentSha256:w.contentSha256,title:'封面与标签验收',description:'真实文件与字幕',tags:['#清晨'],coverBase64:png.toString('base64')};
 const existing=join(f.assetRoot,f.episodeRelativePath,'owner-kept.txt');await writeFile(existing,'keep this owner file');
 const before=await readdir(join(f.assetRoot,f.episodeRelativePath),{recursive:true});
 const invalid=await send('prepareWorkspaceDelivery',{...input,coverBase64:png.subarray(0,12).toString('base64')});expect(invalid.status,JSON.stringify(invalid.body)).toBe(400);
 const matrices=[{coverBase64:''},{coverBase64:Buffer.from('disguised image').toString('base64')},{coverBase64:Buffer.alloc(20*1024*1024+1).toString('base64')},{tags:Array.from({length:21},(_,i)=>`tag${i}`)},{tags:['字'.repeat(51)]},{tags:['#']}];
 for(const extra of matrices){const r=await send('prepareWorkspaceDelivery',{...input,...extra});expect(r.status,JSON.stringify(r.body)).toBe(400);}
 expect(await readdir(join(f.assetRoot,f.episodeRelativePath),{recursive:true})).toEqual(before);expect(await readFile(existing,'utf8')).toBe('keep this owner file');
 const unchanged=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect((await unchanged.json()).workspace.deliveries).toEqual([]);
 const tags=['#清晨','##山野','＃自然','#'+'字'.repeat(50),...Array.from({length:16},(_,i)=>`边界${i}`)];const queued=process.env.LOOP_T22_BROWSER==='1'?await (await import(process.env.LOOP_T22_BROWSER_MODULE!)).review({f,w,input:{...input,tags}}):await send('prepareWorkspaceDelivery',{...input,tags});expect(queued.status,JSON.stringify(queued.body)).toBe(200);w=queued.body;
 const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_worker_capacity:2}))[0] as any;expect(task.task_id).toBe(w.deliveries[0].taskId);const result=await runWorkspaceDeliveryProcess(f,task);expect(result.status,JSON.stringify(result)).toBe('completed');
 const reread=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});w=(await reread.json()).workspace;expect(w.deliveries[0].verified).toBe(true);
 const artifact=w.deliveries[0].artifacts.find((a:any)=>a.artifactType==='metadata'),response=await fetch(f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(artifact.relativePath)}&sha256=${artifact.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const metadata=await response.json();expect(metadata.tags.slice(0,4)).toEqual(['清晨','山野','自然','字'.repeat(50)]);expect(metadata.tags).toHaveLength(20);expect(metadata.exportId).toBe(exported.id);expect(metadata.contentSha256).toBe(exported.contentSha256);
 }finally{await worker.end();await f.close();}
},300000);
