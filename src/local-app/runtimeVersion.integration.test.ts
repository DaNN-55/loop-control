// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {join} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {workspaceAudioFixture} from './workspaceAudio.fixture';
import {withWorkspaceWorkerDatabase} from './workspaceDelivery.fixture';
import {startNativeWorkerService} from './localWorkerService';
import {createRuntimeStatusReader} from './runtimeStatus';
import {createLocalHandler} from './localRoute';
import * as runtimeBuild from '../orchestration/runtimeBuild';
const readPreparedRuntimeRelease=(runtimeBuild as typeof runtimeBuild & {readPreparedRuntimeRelease?:(root:string)=>Promise<{id:string;root:string}>}).readPreparedRuntimeRelease;

it.skipIf(process.env.LOOP_RUNTIME_VERSION_ACCEPTANCE!=='1'||!readPreparedRuntimeRelease)('reports the pinned backend and actual idle Worker through authenticated HTTP without changing production records',async()=>{
 const f=await workspaceAudioFixture();let ui:import('vite').ViteDevServer|undefined;
 try{await f.authorize();await withWorkspaceWorkerDatabase(f,async database=>{
  const projectRoot=process.cwd(),runtimeRelease=await readPreparedRuntimeRelease!(projectRoot);
  const config={projectRoot,runtimeRelease,database,applicationDatabase:database,mediaRoot:f.root,mountPath:f.root,minimumFreeBytes:0,visualCommand:[process.execPath,'--version'],actualCostCents:0,concurrency:1,environment:{...process.env,NODE_OPTIONS:'',LOOP_STATE_DIR:join(f.root,'version-worker-state')}};
  const service=await startNativeWorkerService(config);
  let handler:ReturnType<typeof createLocalHandler>;
  const server=createServer((q,r)=>handler(q,r));server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try{
   const runtimeStatus=createRuntimeStatusReader({pool:f.pool,projectRoot,mediaRoot:f.root,runtimeRelease,worker:service.status,workerRelease:()=>(service as typeof service & {runtimeRelease:{id:string}}).runtimeRelease.id});
   handler=createLocalHandler({pool:f.pool,origin,mediaRoot:f.root,runtimeStatus});
   const snapshot=async()=>(await f.c.query('SELECT (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.episodes e) episodes,(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tasks t) tasks')).rows[0];
   const before=await snapshot();expect((await fetch(origin+'/api/local/system-status')).status).toBe(401);
   await vi.waitFor(()=>expect(service.status().lastScanAt).toBeTruthy());
   const samples=[];let version;
   for(let i=0;i<2;i++){const at=performance.now(),response=await fetch(origin+'/api/local/system-status',{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);const result=await response.json();samples.push(performance.now()-at);version=result.runtime.version;expect(version).toMatchObject({state:'current',backendReleaseId:runtimeRelease.id,workerReleaseId:(service as typeof service & {runtimeRelease:{id:string}}).runtimeRelease.id,preparedReleaseId:runtimeRelease.id});expect(result.runtime.worker.state).toBe('healthy');expect(JSON.stringify(result)).not.toContain(runtimeRelease.root);}
   expect(await snapshot()).toEqual(before);
   const evidence=process.env.LOOP_RUNTIME_VERSION_EVIDENCE;
   if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'http-version.json'),JSON.stringify({version,samples,recordsUnchanged:true,paidCalls:0},null,2));}
   if(process.env.LOOP_RUNTIME_VERSION_BROWSER==='1'){
    if(!evidence)throw Error('Explicit browser evidence directory required');
    const {createServer:serve}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
    ui=await serve({configFile:false,envFile:false,root:projectRoot,cacheDir:join(f.root,'vite-cache'),plugins:[react()],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:origin,changeOrigin:true,configure(proxy){proxy.on('proxyReq',req=>req.setHeader('origin',origin));}}}}});await ui.listen();
    await writeFile(join(evidence,'browser.json'),JSON.stringify({url:`http://127.0.0.1:${(ui.httpServer!.address() as {port:number}).port}`,email:f.email,password:f.password,releaseId:runtimeRelease.id}));
    let done=false;for(let i=0;i<360;i++){try{done=JSON.parse(await readFile(join(evidence,'browser-done.json'),'utf8')).passed===true;}catch{}if(done)break;await new Promise(resolve=>setTimeout(resolve,1000));}expect(done,'Actual browser must verify the version drawer').toBe(true);
   }
  }finally{await ui?.close();await service.stop();server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
 });}finally{await f.close();}
},420000);
