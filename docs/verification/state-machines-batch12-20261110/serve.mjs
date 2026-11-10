// Loopback-only fixtures with controlled HTTP, no database or Provider proxy.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {audioFixture,deliveryFixture} from './fixture-data.mjs';
const script='/docs/verification/state-machines-batch12-20261110/browser-fixture.tsx';
let audio=audioFixture(),delivery=deliveryFixture();
const waiting=[],stats={deliveryReads:0,audioReads:0,reconciliations:[],controls:[]};
const json=(response,value,status=200)=>{response.statusCode=status;response.setHeader('Content-Type','application/json');response.end(JSON.stringify(value));};
const server=await createServer({configFile:false,envFile:false,optimizeDeps:{entries:[script.slice(1)]},plugins:[react(),{name:'state-batch12-fixture',configureServer(server){server.middlewares.use(async(request,response,next)=>{
 const path=request.url?.split('?')[0];
 if(path==='/__state-batch12'){response.setHeader('Content-Type','text/html');response.end(await server.transformIndexHtml(path,`<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>任务展示与交付读取核对</title><div id="root"></div><script type="module" src="${script}"></script></html>`));return;}
 if(path==='/api/local/connections'){json(response,{serviceCatalog:{groups:[]}});return;}
 if(path==='/api/local/session'){json(response,{csrfToken:'isolated-fixture'});return;}
 if(path==='/api/local/episodes/audio-fixture/workspace'){stats.audioReads++;json(response,{workspace:audio});return;}
 if(path==='/api/local/episodes/delivery-fixture/workspace'){stats.deliveryReads++;waiting.push({response,value:structuredClone(delivery)});return;}
 if(path==='/__fixture-stats'){json(response,{...stats,waiting:waiting.filter(item=>!item.response.destroyed).length});return;}
 if(path==='/__fixture-control'||path==='/api/local/native-output/reconcile'){
  let text='';for await(const chunk of request)text+=chunk;const data=JSON.parse(text||'{}');
  if(path==='/api/local/native-output/reconcile'){
   if(data.episodeId!=='audio-fixture'||data.taskId!=='task-held'||data.attempt!==0){json(response,{error:'Unexpected reconciliation'},400);return;}
   stats.reconciliations.push(data);audio={...audio,revision:audio.revision+1,audio:{...audio.audio,preparations:audio.audio.preparations.map(entry=>entry.id==='held'?{...entry,status:'completed',generationTask:{...entry.generationTask,status:'completed',publicationAttempt:null}}:entry)}};json(response,{recovered:true});return;
  }
  stats.controls.push(data);
  if(data.action==='state')delivery=deliveryFixture(data.revision,data.deliveryId,data.status);
  if(data.action==='release')for(const item of waiting.splice(0)){if(!item.response.destroyed)json(item.response,{workspace:item.value});}
  if(data.action==='fail')for(const item of waiting.splice(0)){if(!item.response.destroyed)json(item.response,{error:'Controlled old read failure'},503);}
  json(response,{passed:true});return;
 }
 if(path?.startsWith('/api/')){json(response,{error:'No business API in this fixture'},404);return;}
 next();
});}}],server:{host:'127.0.0.1',port:5191,strictPort:true},cacheDir:'.scratch/state-machines-batch12-20261110/vite-cache'});
await server.listen();console.log('http://127.0.0.1:5191/__state-batch12');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{for(const item of waiting.splice(0))item.response.destroy();void server.close().then(()=>process.exit(0));});
