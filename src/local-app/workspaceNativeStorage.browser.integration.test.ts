// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';

it.skipIf(process.env.LOOP_T09_BROWSER!=='1').each(['registered','legacy'] as const)('formal page edits, restarts, plays and delivers native workspace (%s)',async layout=>{
 const evidenceRoot=process.env.LOOP_T09_BROWSER_EVIDENCE,session=process.env.LOOP_T09_BROWSER_SESSION;
 if(!evidenceRoot||!session)throw Error('Explicit isolated browser evidence/session required');
 const evidence=join(evidenceRoot,layout);await mkdir(evidence,{recursive:true});
 const f=await productionWorkspaceFixture({episodeRelativePath:layout==='registered'?()=> '浏览器 [T09]_100%_%20_#?/本单 空间':undefined,migrations:['db/local/118-visual-storage-locations.sql','db/local/119-audio-caption-storage-locations.sql','db/local/120-native-workspace-storage-locations.sql'],runtime:{wake(){}}});
 let vite:import('vite').ViteDevServer|undefined;const worker=f.workerPool();
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;w=await f.fillVisuals(w);
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,1)');
  const frozen=(await f.c.query('SELECT id,input_snapshot,budget_limit_cents,actual_cost_cents FROM public.tasks WHERE id=$1',[f.task])).rows;
  const {createServer:createPortServer}=await import('node:net');const listener=createPortServer();await new Promise<void>(done=>listener.listen(0,'127.0.0.1',done));const browserPort=(listener.address() as {port:number}).port;await new Promise<void>(done=>listener.close(()=>done()));
  const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
  const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',f.origin));}};
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},plugins:[react(),{name:'t09-fixture',configureServer(s){s.middlewares.use('/__t09',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__t09','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>T09 原生工程位置验收</title><div id="root"></div><script type="module" src="/src/local-app/main.tsx"></script>'));});}}],server:{host:'127.0.0.1',port:browserPort,strictPort:true,proxy:{'/api':proxy,'/_local-artifact':proxy}}});
  await vite.listen();const port=(vite.httpServer!.address() as {port:number}).port;
  for(const name of ['browser-done.json','browser-failed.json','restart-request.json','restarted.json'])await rm(join(evidence,name),{force:true});
  await writeFile(join(evidence,'browser.json'),JSON.stringify({layout,url:`http://127.0.0.1:${port}/__t09?episode=${f.episode}`,email:f.email,password:f.password,episodeId:f.episode,episodeRelativePath:f.episodeRelativePath,assetRoot:f.assetRoot,projectId:w.project.projectId,evidence}));
  let done=false,restarted=false,restartToken="";
  for(let i=0;i<900;i++){
   try{const failure=JSON.parse(await readFile(join(evidence,'browser-failed.json'),'utf8'));throw Error(failure.error);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   try{const request=JSON.parse(await readFile(join(evidence,'restart-request.json'),'utf8'));if(request.ready&&request.token!==restartToken){await f.restart();restarted=true;restartToken=request.token;await writeFile(join(evidence,'restarted.json'),JSON.stringify({restarted:true,token:restartToken}));}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   const tasks=await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_worker_capacity:1});
   for(const task of tasks){expect((task as {task_type:string}).task_type).toBe('prepare_publish_package');const result=await runWorkspaceDeliveryProcess(f,task as any);expect(result.status,JSON.stringify(result)).toBe('completed');await writeFile(join(evidence,'worker-result.json'),JSON.stringify(result,null,2));}
   try{done=JSON.parse(await readFile(join(evidence,'browser-done.json'),'utf8')).passed===true;if(done)break;}catch{}
   await pause(1000);
  }
  expect(done,'External browser must finish actual native UI/save/restart/play/export/delivery').toBe(true);expect(restarted).toBe(true);
  const response=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);w=(await response.json()).workspace;
  expect(w.deliveries[0].verified).toBe(true);expect(w.exports[0].confirmed).toBe(true);
  expect((await f.c.query('SELECT id,input_snapshot,budget_limit_cents,actual_cost_cents FROM public.tasks WHERE id=$1',[f.task])).rows).toEqual(frozen);
  const receipt=JSON.parse(await readFile(join(evidence,'browser-done.json'),'utf8'));expect(receipt.playback.end).toBeGreaterThan(receipt.playback.start);expect(receipt.playback.frames).toBeGreaterThan(0);expect(receipt.readbacks).toHaveLength(6);
  const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(project.timelines[0].items.find((item:any)=>item.kind==='video').transform.x).toBe(1);await writeFile(join(evidence,'project-readback.json'),JSON.stringify(project,null,2));await writeFile(join(evidence,'workspace-readback.json'),JSON.stringify(w,null,2));
 }finally{
  // Close this owned browser before its native origin/files disappear.
  await promisify(execFile)('agent-browser',['--session',session,'close'],{timeout:30000}).catch(()=>{});
  await vite?.close();await worker.end();await f.close();await rm(join(evidence,'browser.json'),{force:true});
 }
},960000);
