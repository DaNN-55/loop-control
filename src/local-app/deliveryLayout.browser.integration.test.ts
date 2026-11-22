// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
import type {ClaimedTaskRow} from '../orchestration/workerDispatch';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('keeps explicit publication editing independent of the verified video and survives Owner restart',async()=>{
 const f=await productionWorkspaceFixture({runtime:{wake(){}}}),worker=f.workerPool();let vite:import('vite').ViteDevServer|undefined;
 const evidence=join(process.cwd(),'docs/verification/delivery-layout-20261122'),browser=process.env.LOOP_DELIVERY_LAYOUT_BROWSER==='1';
 const wait=async(name:string)=>{for(let n=0;n<600;n++){try{return JSON.parse(await readFile(join(evidence,name),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}await pause(500);}throw Error('Missing browser milestone '+name);};
 try{
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2)');
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  async function send(command:string,data={}){const r=await f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;return w;}
  w=await f.fillVisuals(w);for(const clip of w.clips)await send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  await send('exportWorkspace');const output=w.exports[0];expect(output.status).toBe('ready');
  await send('completeWorkspaceExport',{exportId:output.id,expectedExportSha256:output.artifact.sha256,expectedContentSha256:w.contentSha256});
  const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_worker_capacity:2}))[0] as ClaimedTaskRow;expect((await runWorkspaceDeliveryProcess(f,task)).status).toBe('completed');
  const readWorkspace=async()=>{const r=await fetch(f.origin+'/api/local/episodes/'+f.episode+'/workspace',{headers:{Cookie:'loop_owner_session='+f.token}});expect(r.status).toBe(200);return(await r.json()).workspace;};w=await readWorkspace();expect(w.deliveries[0].verified).toBe(true);
  const identity={content:w.contentSha256,project:w.project.sha256,revision:w.revision,video:w.exports[0].artifact.sha256},endpoint='episodes/'+f.episode+'/publication';
  const initial={title:'交付布局隔离测试',description:'仅用于当前布局与真实保存验证。',tags:['隔离验证'],instruction:''};
  let r=await f.post(endpoint,'save',{expectedRevision:0,content:initial});expect(r.status,JSON.stringify(r.body)).toBe(200);
  r=await f.post(endpoint,'cover',{expectedRevision:1,kind:'frame',exportId:w.exports[0].id,videoSha256:identity.video,timeSeconds:.5});expect(r.status,JSON.stringify(r.body)).toBe(200);expect(r.body.revision).toBe(2);
  const readPublication=async()=>{const response=await fetch(f.origin+'/api/local/'+endpoint,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);return response.json();};
  const finalTitle='隔离验收：保存后重新打开';
  if(browser){
   for(const name of ['typed.json','typed-checked.json','browser-done.json'])await rm(join(evidence,name),{force:true});
   const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');const proxy={target:f.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>{req.setHeader('origin',f.origin);req.setHeader('cookie','loop_owner_session='+f.token);});}};
   vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},optimizeDeps:{entries:['src/local-app/main.tsx']},plugins:[react(),{name:'delivery-layout-formal',configureServer(s){s.middlewares.use('/__delivery-layout',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__delivery-layout','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离工程 · 交付布局验收</title><div id="root"></div><script type="module" src="/src/local-app/main.tsx"></script>'));});}}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});await vite.listen();
   await writeFile(join(evidence,'browser-url.txt'),`http://127.0.0.1:${(vite.httpServer!.address() as {port:number}).port}/__delivery-layout?view=episodes&episode=${f.episode}`);
   await wait('typed.json');await pause(650);const untouched=await readPublication();expect(untouched.revision).toBe(2);expect(untouched.content.title).toBe(initial.title);await writeFile(join(evidence,'typed-checked.json'),JSON.stringify({revision:untouched.revision,title:untouched.content.title}));
   const done=await wait('browser-done.json');expect(done.passed).toBe(true);
  }else{r=await f.post(endpoint,'save',{expectedRevision:2,content:{...initial,title:finalTitle}});expect(r.status).toBe(200);}
  const saved=await readPublication();expect(saved.revision).toBe(3);expect(saved.content.title).toBe(finalTitle);
  await f.restart();const reopened=await readPublication();expect(reopened.revision).toBe(3);expect(reopened.content.title).toBe(finalTitle);w=await readWorkspace();
  expect({content:w.contentSha256,project:w.project.sha256,revision:w.revision,video:w.exports[0].artifact.sha256}).toEqual(identity);
  expect((await f.c.query('SELECT stage FROM public.episodes WHERE id=$1',[f.episode])).rows[0].stage).toBe('production_completed');
  if(browser)await writeFile(join(evidence,'saved-proof.json'),JSON.stringify({publicationRevision:reopened.revision,title:reopened.content.title,videoIdentityUnchanged:true,identity},null,2));
 }finally{await vite?.close();await f.close();}
},660000);
