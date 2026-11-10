// Private loopback HTTP + iframe protocol fixture; no database, Provider, or business proxy.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {createHash} from 'node:crypto';
const entry='/docs/verification/state-machines-batch5-20261110/browser-fixture.tsx';
let mode='ready',w,studio,text='尚未保存的编辑',counts={},held=null;const calls=[];
function reset(name){mode=name;counts={};held=null;calls.length=0;text='尚未保存的编辑';studio={projectId:'loop-control-e',relativePath:'work/project.json',sha256:'b'.repeat(64),fileSize:2};w=name==='prepare-failed'?null:{id:'w',episodeId:'e',workflowVersion:'four-step/v1',scriptRevisionId:'s',revision:1,contentSha256:'a'.repeat(64),clips:[{id:'clip',itemId:'item',shotId:'S01',text:'第一镜',source:null}],project:{relativePath:'project.json',sha256:'a'.repeat(64),fileSize:2,projectId:'loop-control-e'},readiness:{deliverable:false,placeholders:[],missingSources:[]},stale:false};}
reset(mode);
const json=(res,value,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
const opened=()=>({studioUrl:'http://127.0.0.1:5194/__studio#/editor/loop-control-e',workspace:studio,productionWorkspace:w});
const server=await createServer({configFile:false,envFile:false,optimizeDeps:{entries:[entry.slice(1)]},plugins:[react(),{name:'operation-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
 const url=new URL(req.url??'/','http://127.0.0.1:5194');
 if(url.pathname==='/__stage5'){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(url.pathname,`<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>工作区操作核对</title><div id="root"></div><script type="module" src="${entry}"></script></html>`));return;}
 if(url.pathname==='/__studio'){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font:16px sans-serif;padding:24px}textarea{width:90%;height:100px}</style><label>原生夹具正文<textarea aria-label="原生夹具正文">${text}</textarea></label><script>
 const p=new URLSearchParams(location.search),channel=p.get('lcChannel'),projectId=p.get('lcProject'),origin=p.get('lcParent');
 const send=data=>parent.postMessage({channel,projectId,...data},origin);
 addEventListener('message',async e=>{const d=e.data;if(e.source!==parent||e.origin!==origin||d.channel!==channel||d.projectId!==projectId||d.type!=='loop-control:command')return;
 if(d.action==='flush'){const r=await fetch('/__flush',{method:'POST',body:JSON.stringify({text:document.querySelector('textarea').value})});const v=await r.json();send({type:'loop-control:result',requestId:d.requestId,ok:r.ok,error:v.error});}
 else {if(d.action==='select')clearInterval(timer);send({type:'loop-control:result',requestId:d.requestId,ok:true});}});
 const state=()=>send({type:'loop-control:state',writable:true,revision:1,items:[{id:'item',startFrame:0,durationInFrames:60}],selectedIds:['item'],shots:[{id:'S01',text:'第一镜',itemIds:['item']}]});const timer=setInterval(state,200);state();</script></html>`);return;}
 if(url.pathname==='/__stats'){json(res,{mode,w,studio,text,calls,counts});return;}
 if(url.pathname==='/__release'){if(held){const pending=held;held=null;w={...w,revision:w.revision+1};json(pending,opened());}json(res,{released:true});return;}
 if(url.pathname==='/api/local/session'){json(res,{csrfToken:'fixture-csrf'});return;}
 if(url.pathname==='/__case'||url.pathname==='/__flush'){
  let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body);
  if(url.pathname==='/__case'){reset(data.mode);json(res,{mode});return;}
  counts.flush=(counts.flush??0)+1;if(mode==='flush-failed'&&counts.flush===1){json(res,{error:'夹具刷盘失败'},503);return;}text=data.text;json(res,{flushed:true});return;
 }
 if(url.pathname==='/api/local/episodes/e/workspace'){json(res,{workspace:w});return;}
 if(url.pathname.includes('/workspace/project')){json(res,{project:null});return;}
 if(url.pathname==='/api/local/connections'){json(res,{serviceCatalog:{version:1,groups:[]}});return;}
 if(url.pathname==='/api/local/episode-commands'){
  let body='';for await(const chunk of req)body+=chunk;const{command,data,idempotencyKey}=JSON.parse(body);calls.push({command,data,idempotencyKey});counts[command]=(counts[command]??0)+1;
  if(req.headers['x-csrf-token']!=='fixture-csrf'||data.episodeId!=='e'){json(res,{error:'Wrong fixture scope'},409);return;}
  if(command==='prepareWorkspace'){
   if(counts[command]===1){json(res,{error:'夹具准备失败'},503);return;}const kept=calls.slice(),keptCounts={...counts};reset('ready');calls.push(...kept);counts=keptCounts;mode='prepare-failed';json(res,w);return;
  }
  if(!w||data.workspaceId!==w.id||data.expectedRevision!==w.revision){json(res,{error:'Wrong expected revision'},409);return;}
  if(command==='openWorkspaceStudio'){
   if(mode==='open-failed'&&counts[command]===1){json(res,{error:'夹具打开失败'},503);return;}
   if(mode==='slow-open'&&counts[command]===1){held=res;return;}json(res,opened());return;
  }
  if(command==='saveWorkspaceStudio'){
   if(data.workspaceRelativePath!==studio.relativePath||data.projectId!==studio.projectId||data.expectedWorkspaceSha256!==studio.sha256){json(res,{error:'Wrong saved file identity'},409);return;}
   if(mode==='save-failed'&&counts[command]===1){json(res,{error:'夹具保存失败'},503);return;}
   studio={...studio,sha256:createHash('sha256').update(text).digest('hex'),fileSize:Buffer.byteLength(text)};w={...w,revision:w.revision+1};json(res,{...studio,productionWorkspace:w});return;
  }
  if(command==='closeWorkspaceStudio'){
   if(mode==='close-failed'&&counts[command]===1){json(res,{error:'夹具关闭失败'},503);return;}w={...w,revision:w.revision+1};json(res,w);return;
  }
  json(res,{error:'Outside fixture scope'},400);return;
 }
 if(url.pathname.startsWith('/api/')){json(res,{error:'No business API'},404);return;}
 next();
});}}],server:{host:'127.0.0.1',port:5194,strictPort:true},cacheDir:'.scratch/state-machines-batch5-20261110/vite-cache'});
await server.listen();console.log('http://127.0.0.1:5194/__stage5');for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void server.close().then(()=>process.exit(0)));
