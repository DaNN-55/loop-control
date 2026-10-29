// @vitest-environment node
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {it,expect} from 'vitest';
import {readFile,writeFile,unlink,mkdir,copyFile} from 'node:fs/promises';
import {setTimeout as pause} from 'node:timers/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {defaultShotCaptionContract} from '../shotCaptions';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner delivery requires an exact confirmed export',async()=>{
 const f=await productionWorkspaceFixture();
 try{
 const w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
 const r=await f.request('prepareWorkspaceDelivery',{workspaceId:w.id,expectedRevision:w.revision,exportId:'00000000-0000-0000-0000-000000000000',expectedExportSha256:'0'.repeat(64),expectedContentSha256:w.contentSha256,title:'交付',description:'',tags:[],coverBase64:''});
 expect(r.status,JSON.stringify(r.body)).toBe(409);
 }finally{await f.close();}
},300000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('real Worker verifies exact package, fences tamper and missing inputs, retries and survives restart',async()=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){}}});const worker=f.workerPool();
 try{
 await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2)');
 let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
 const send=async(name:string,extra={})=>{const r=await f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...extra});return r;};
 for(const clip of w.clips){const r=await send('matchWorkspaceMaterial',{clipId:clip.id,materialRevisionId:f.material});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;}
 for(const clip of w.clips){w=(await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)})).body;}
 w=(await send('exportWorkspace')).body;expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');
 w=(await send('confirmWorkspaceExport',{exportId:w.exports[0].id,expectedExportSha256:w.exports[0].artifact.sha256,expectedContentSha256:w.contentSha256})).body;
 const approved=w.exports[0],approvedProject=approved.project,videoBytes=await readFile(join(f.assetRoot,approved.artifact.relativePath));

 const opened=await send('openWorkspaceStudio');expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
 expect((await send('prepareWorkspaceDelivery',{exportId:approved.id,expectedExportSha256:approved.artifact.sha256,expectedContentSha256:w.contentSha256,title:'活跃编辑不可交付',description:'',tags:[],coverBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')})).status).toBe(409);
 const base=join(f.assetRoot,`episodes/${f.episode}/openchatcut-work/current/runtime`);let path=join(base,'project-store-v1.json'),store:any,doc:any;
 try{store=JSON.parse(await readFile(path,'utf8'));doc=store.entries[`project:${w.project.projectId}`];}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;path=join(base,'project-store-v1',`${encodeURIComponent(`project:${w.project.projectId}`)}.json`);doc=JSON.parse(await readFile(path,'utf8'));}
 doc.timelines[0].selectedId=w.clips[0].itemId;doc.timelines[0].selectedIds=[w.clips[0].itemId];await writeFile(path,JSON.stringify(store??doc));
 const saved=await send('saveWorkspaceStudio',{workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;
 w=(await send('closeWorkspaceStudio')).body;expect(w.revision).toBe(approved.projectContentVersion);expect(w.project.sha256).not.toBe(approvedProject.sha256);expect(w.exports[0].confirmed).toBe(true);
 const formWorkspace=structuredClone(w);
 const input={exportId:approved.id,expectedExportSha256:approved.artifact.sha256,expectedContentSha256:w.contentSha256,title:'交付验收',description:'真实文件',tags:['测试'],coverBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')};
 expect((await send('prepareWorkspaceDelivery',{...input,expectedExportSha256:'0'.repeat(64)})).status).toBe(409);
 expect((await send('prepareWorkspaceDelivery',{...input,coverBase64:''})).status).toBe(400);
 let r=await send('prepareWorkspaceDelivery',input);expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;expect(w.deliveries[0].status).toBe('ready');expect(w.deliveries[0].verified).toBe(false);
 const first=w.deliveries[0],port=nativeWorkerPort(worker);
 expect((await send('openWorkspaceStudio')).status).toBe(409);
 async function run(){const rows=await port.rpc('claim_next_worker_task',{p_worker_capacity:2});expect(rows.length).toBe(1);expect((await send('openWorkspaceStudio')).status).toBe(409);return runWorkspaceDeliveryProcess(f,rows[0] as any);}
 async function read(){const r=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);w=(await r.json()).workspace;return w;}
 await writeFile(join(f.assetRoot,approved.artifact.relativePath),'tampered');expect((await run()).status).toBe('failed');await read();expect(w.deliveries[0].status).toBe('failed');expect(w.deliveries[0].verified).toBe(false);
 const production=await fetch(f.origin+`/api/local/episodes/${f.episode}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(JSON.stringify(await production.json())).not.toContain('"stage":"production_completed"');
 expect((await send('retryWorkspaceDelivery',{deliveryId:first.id})).status).toBe(409);
 await writeFile(join(f.assetRoot,approved.artifact.relativePath),videoBytes);
 const restoredStudio=await send('openWorkspaceStudio');expect(restoredStudio.status,JSON.stringify(restoredStudio.body)).toBe(200);w=restoredStudio.body.productionWorkspace;
 expect((await send('retryWorkspaceDelivery',{deliveryId:first.id})).status).toBe(409);
 w=(await send('closeWorkspaceStudio')).body;
 r=await send('retryWorkspaceDelivery',{deliveryId:first.id});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;
 const projectBytes=await readFile(join(f.assetRoot,approvedProject.relativePath));await unlink(join(f.assetRoot,approvedProject.relativePath));expect((await run()).status).toBe('failed');
 await writeFile(join(f.assetRoot,approvedProject.relativePath),projectBytes);await read();expect(w.deliveries[0].verified).toBe(false);
 r=await send('retryWorkspaceDelivery',{deliveryId:w.deliveries[0].id});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;
 const coverPath=join(f.assetRoot,`episodes/${f.episode}/workspace-deliveries/${first.id}/cover.png`),coverBytes=await readFile(coverPath);await unlink(coverPath);expect((await run()).status).toBe('failed');await read();expect(w.deliveries[0].verified).toBe(false);await writeFile(coverPath,coverBytes);
 r=await send('retryWorkspaceDelivery',{deliveryId:w.deliveries[0].id});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;
 const result=await run();expect(result.status,JSON.stringify(result)).toBe('completed');await read();expect(w.deliveries[0].verified).toBe(true);expect(w.deliveries.length).toBe(4);
 const persisted=(await f.c.query('SELECT t.status,t.last_result,r.status run_status,r.result run_result,r.lease_token FROM public.tasks t JOIN public.task_runs r ON r.task_id=t.id WHERE t.id=$1',[w.deliveries[0].taskId])).rows;expect(persisted).toHaveLength(1);expect(persisted[0]).toMatchObject({status:'completed',run_status:'completed',last_result:result,run_result:result});expect(persisted[0].lease_token).toBeTruthy();
 expect((await f.c.query("SELECT count(*)::int count FROM public.state_transitions WHERE episode_id=$1 AND to_stage='production_completed'",[f.episode])).rows[0].count).toBe(1);
 expect((await f.c.query("SELECT payload FROM public.audit_events WHERE episode_id=$1 AND event_type='publish_package_verified'",[f.episode])).rows).toEqual([{payload:expect.objectContaining({task_id:result.taskId,export_id:approved.id,protocol:'publish-package/v2'})}]);
 const pack=w.deliveries[0].artifacts.find((a:any)=>a.artifactType==='publish_package'),manifest=JSON.parse(await readFile(join(f.assetRoot,pack.relativePath),'utf8'));
 expect(manifest.version).toBe('publish-package/v2');expect(manifest.artifacts.length).toBe(5);expect(manifest.identity.video.sha256).toBe(approved.artifact.sha256);expect(manifest.identity.project).toEqual({artifactType:'editable_project',...approvedProject});
 for(const artifact of [...manifest.artifacts,pack]){const url=f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(artifact.relativePath)}&sha256=${artifact.sha256}`,file=await fetch(url,{headers:{Cookie:'loop_owner_session='+f.token}});expect(file.status,artifact.relativePath).toBe(200);expect(createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex')).toBe(artifact.sha256);expect((await fetch(url,{headers:{Cookie:'loop_owner_session='+f.otherToken}})).status).toBe(404);}
 await f.restart();await read();expect(w.deliveries[0].verified).toBe(true);
 const done=await fetch(f.origin+`/api/local/episodes/${f.episode}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(JSON.stringify(await done.json())).toContain('production_completed');
 const evidence=process.env.LOOP_T12_EVIDENCE_DIR;if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'workspace.json'),JSON.stringify(w,null,2));await writeFile(join(evidence,'worker-result.json'),JSON.stringify(result,null,2));for(const a of [...manifest.artifacts,pack])await copyFile(join(f.assetRoot,a.relativePath),join(evidence,a.artifactType==='final_render'?'final.mp4':a.artifactType==='cover'?'cover.png':a.artifactType+'.json'));}
 if(process.env.LOOP_T12_BROWSER==='1'){
 const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
 const entry='src/local-app/t12-browser-entry.tsx';
 await writeFile(entry,`import {useState} from 'react';import {createRoot} from 'react-dom/client';import {WorkspaceExportPanel} from './WorkspaceExportPanel';import type {ProductionWorkspace} from '../productionWorkspace';import '../styles.css';import '../ui/impeccable/foundation.css';import '../ui/impeccable/production.css';import './production-workspace.css';function App(){const [w,set]=useState<ProductionWorkspace>(location.search.includes('form')?${JSON.stringify(formWorkspace)}:${JSON.stringify(w)});return <main className="impeccable-app dan-ui product-ui" style={{padding:24,maxWidth:1000,margin:'auto'}}><WorkspaceExportPanel workspace={w} pending={false} command={async()=>w} onChange={set}/></main>}createRoot(document.getElementById('root')!).render(<App/>);`);
 const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.removeHeader('origin'));}};
 const {createServer:portServer}=await import('node:net');const listener=portServer();await new Promise<void>(done=>listener.listen(0,'127.0.0.1',done));const freePort=(listener.address() as {port:number}).port;await new Promise<void>(done=>listener.close(()=>done()));
 const vite=await createServer({configFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),plugins:[react(),{name:'t12-fixture',configureServer(server:any){server.middlewares.use('/__t12',async(_req:any,res:any)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__t12','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>T12 交付验收</title><div id="root"></div><script type="module" src="/src/local-app/t12-browser-entry.tsx"></script>'));});}}],server:{host:'127.0.0.1',port:freePort,strictPort:true,proxy:{'/api':proxy,'/_local-artifact':proxy}}});
 await vite.listen();const address=vite.httpServer!.address() as {port:number};await writeFile('/private/tmp/loop-t12-browser.json',JSON.stringify({url:`http://127.0.0.1:${address.port}/__t12`,cookie:f.token,episode:f.episode}));
 try{for(let i=0;i<120;i++){try{await readFile('/private/tmp/loop-t12-browser-done');break;}catch{}await pause(1000);}}finally{await vite.close();await unlink(entry);}
 }
 const metadata=manifest.artifacts.find((a:any)=>a.artifactType==='metadata');await unlink(join(f.assetRoot,metadata.relativePath));await read();expect(w.deliveries[0].verified).toBe(false);expect(w.deliveries[0].error).toContain('缺失');
 }finally{await worker.end();await f.close();}
},300000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a queued package cannot complete or retry against a different final export',async()=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){}}}),worker=f.workerPool();
 try{
 await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2)');
 let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
 const send=(name:string,extra={})=>f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...extra});
 for(const clip of w.clips){w=(await send('matchWorkspaceMaterial',{clipId:clip.id,materialRevisionId:f.material})).body;}
 for(const clip of w.clips){w=(await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)})).body;}
 w=(await send('exportWorkspace')).body;expect(w.exports[0].status).toBe('ready');
 w=(await send('confirmWorkspaceExport',{exportId:w.exports[0].id,expectedExportSha256:w.exports[0].artifact.sha256,expectedContentSha256:w.contentSha256})).body;
 const input={exportId:w.exports[0].id,expectedExportSha256:w.exports[0].artifact.sha256,expectedContentSha256:w.contentSha256,title:'身份锁定',description:'',tags:[],coverBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')};
 const queued=await send('prepareWorkspaceDelivery',input);expect(queued.status,JSON.stringify(queued.body)).toBe(200);w=queued.body;const delivery=w.deliveries[0];
 const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_worker_capacity:2}))[0] as any;
 w=(await send('exportWorkspace')).body;expect(w.exports[0].id).not.toBe(input.exportId);expect(w.exports[0].confirmed).toBe(false);
 expect((await send('prepareWorkspaceDelivery',input)).status).toBe(409);
 w=(await send('confirmWorkspaceExport',{exportId:w.exports[0].id,expectedExportSha256:w.exports[0].artifact.sha256,expectedContentSha256:w.contentSha256})).body;
 const result=await runWorkspaceDeliveryProcess(f,task);expect(result.status).toBe('failed');expect(result.retry.reason).toContain('Confirmed export changed');
 expect((await send('retryWorkspaceDelivery',{deliveryId:delivery.id})).status).toBe(409);
 const r=await fetch(f.origin+`/api/local/episodes/${f.episode}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(JSON.stringify(await r.json())).not.toContain('"stage":"production_completed"');
 }finally{await worker.end();await f.close();}
},300000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('delivery records the used trimmed voice source and never substitutes an unadopted draft text',async()=>{
 const {narrationFixture}=await import('./workspaceNarration.fixture');const f=await narrationFixture();const worker=f.workerPool();
 try{
 await f.authorize();let w=f.made;const send=(name:string,extra={})=>f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...extra});const clip=w.clips[0],sourceText='这份实际音轨保留不可变的原口播正文。';
 let r=await send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',text:sourceText});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;
 await send('confirmWorkspaceNarration',{clipId:clip.id});const queued=await send('generateWorkspaceNarration',{clipId:clip.id});expect(queued.status,JSON.stringify(queued.body)).toBe(200);expect((await f.execute(queued.body.narration[0].taskId))?.status).toBe('completed');
 w=(await send('refreshWorkspaceNarration')).body;
 const uploaded=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'still.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(uploaded.status,JSON.stringify(uploaded.body)).toBe(200);
 for(const visual of w.clips){r=await send('matchWorkspaceImage',{clipId:visual.id,materialRevisionId:uploaded.body.id,usage:'still',durationSeconds:visual.shotId===clip.shotId?2.4:2,fit:'contain',focusX:.5,focusY:.5});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;}
 for(const visual of w.clips)w=(await send('saveWorkspaceCaptions',{clipId:visual.id,captionContract:defaultShotCaptionContract(visual.text,'independent',false)})).body;
 const opened=await send('openWorkspaceStudio');expect(opened.status).toBe(200);w=opened.body.productionWorkspace;
 const base=join(f.assetRoot,`episodes/${f.episode}/openchatcut-work/current/runtime`);let path=join(base,'project-store-v1.json'),store:any,doc:any;try{store=JSON.parse(await readFile(path,'utf8'));doc=store.entries[`project:${w.project.projectId}`];}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;path=join(base,'project-store-v1',`${encodeURIComponent(`project:${w.project.projectId}`)}.json`);doc=JSON.parse(await readFile(path,'utf8'));}
 const voice=doc.timelines[0].items.find((i:any)=>i.id===`workspace-narration-shot-${clip.shotId}`);voice.srcInFrame=12;voice.durationInFrames=60;await writeFile(path,JSON.stringify(store??doc));
 r=await send('saveWorkspaceStudio',{workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:w.project.sha256});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body.productionWorkspace;w=(await send('closeWorkspaceStudio')).body;
 r=await send('saveWorkspaceNarration',{clipId:clip.id,mode:'tts',text:'尚未采用的新草稿，不应替换实际说词。'});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;
 w=(await send('exportWorkspace')).body;expect(w.exports[0].status,JSON.stringify(w.exports[0])).toBe('ready');w=(await send('confirmWorkspaceExport',{exportId:w.exports[0].id,expectedExportSha256:w.exports[0].artifact.sha256,expectedContentSha256:w.contentSha256})).body;
 r=await send('prepareWorkspaceDelivery',{exportId:w.exports[0].id,expectedExportSha256:w.exports[0].artifact.sha256,expectedContentSha256:w.contentSha256,title:'裁切正文证据',description:'',tags:[],coverBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;
 const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_worker_capacity:2}))[0] as any;expect(task.task_id).toBe(w.deliveries[0].taskId);const result=await runWorkspaceDeliveryProcess(f,task);expect(result.status,JSON.stringify(result)).toBe('completed');
 const metadata=result.artifacts.find((a:any)=>a.artifactType==='metadata'),url=f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(metadata.relativePath)}&sha256=${metadata.sha256}`,download=await fetch(url,{headers:{Cookie:'loop_owner_session='+f.token}});expect(download.status).toBe(200);const json=await download.json(),record=json.narration.find((n:any)=>n.shotId===clip.shotId);
 expect(record.sourceText).toBe(sourceText);expect(record.adoptedText).toBeNull();expect(record.textCoverage).toBe('partial_or_retimed_unverified');expect(record.windows[0]).toMatchObject({srcInFrame:12,sourceDurationSeconds:2,playbackRate:1});expect(record.sourceDiffersFromBaseline).toBe(true);
 if(process.env.LOOP_T12_EVIDENCE_DIR)await writeFile(join(process.env.LOOP_T12_EVIDENCE_DIR,'trimmed-voice-metadata.json'),JSON.stringify(json,null,2));
 }finally{await worker.end();await f.close();}
},300000);
