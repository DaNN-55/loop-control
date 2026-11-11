// Loopback-only controlled HTTP. No business API proxy, database, or Provider.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const entry='/docs/verification/state-machines-20261111/browser-fixture.tsx';
const base={id:'w',episodeId:'e',workflowVersion:'four-step/v1',scriptRevisionId:'s',revision:1,contentSha256:'a'.repeat(64),clips:[{id:'clip',itemId:'item',shotId:'S01',text:'第一镜',source:null}],project:{relativePath:'project.json',sha256:'a'.repeat(64),fileSize:2,projectId:'loop-control-e'},readiness:{deliverable:false,placeholders:[],missingSources:[]},stale:false};
let reads=0,revision=1,heldOpen,heldRead;
const json=(res,value)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
const server=await createServer({configFile:false,envFile:false,plugins:[react(),{name:'reload-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
 const url=new URL(req.url,'http://127.0.0.1:5196');
 if(url.pathname==='/__fixture'){
  reads=0;revision=Number(url.searchParams.get('revision')??1);
  res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(url.pathname,`<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>刷新顺序核对</title><div id="root"></div><script type="module" src="${entry}"></script></html>`));return;
 }
 if(url.pathname==='/api/local/episodes/e/workspace'){if(++reads===2)heldRead=res;else json(res,{workspace:base});return;}
 if(url.pathname.includes('/workspace/project')){json(res,{project:null});return;}
 if(url.pathname==='/api/local/connections'){json(res,{serviceCatalog:{version:1,groups:[]}});return;}
 if(url.pathname==='/__command'){let body='';for await(const chunk of req)body+=chunk;const {name,data}=JSON.parse(body);if(name!=='openWorkspaceStudio'||data.expectedRevision!==1)throw Error('Unexpected fixture command');heldOpen=res;return;}
 if(url.pathname==='/__release-open'){if(heldOpen){json(heldOpen,{studioUrl:'http://127.0.0.1:5196/__studio',workspace:{projectId:'loop-control-e',relativePath:'work/project.json',sha256:'b'.repeat(64),fileSize:2},productionWorkspace:{...base,revision:2,clips:[{...base.clips[0],text:'已接收的新镜头'}]}});heldOpen=null;}json(res,{released:true});return;}
 if(url.pathname==='/__release-read'){if(heldRead){json(heldRead,{workspace:{...base,revision}});heldRead=null;}json(res,{released:true});return;}
 if(url.pathname.startsWith('/api/')){res.statusCode=404;json(res,{error:'Outside fixture scope'});return;}
 next();
 });}}],server:{host:'127.0.0.1',port:5196,strictPort:true},optimizeDeps:{entries:[entry.slice(1)]},cacheDir:'.scratch/state-machines-20261111/vite-cache'});
await server.listen();console.log('http://127.0.0.1:5196/__fixture');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void server.close().then(()=>process.exit(0)));
