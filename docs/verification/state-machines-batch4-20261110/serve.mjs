// Loopback fixtures only: no business API, database, Provider, or production proxy.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const entry='/docs/verification/state-machines-batch4-20261110/browser-fixture.tsx';
let name='start-failed',episode,script='',saves=0,starts=0,reads=0;const calls=[];
function reset(value){name=value;saves=0;starts=0;reads=0;script=name==='revision-start-failed'?'# 主脚本\n\n## 正文\n\n原正文\n':'';episode={id:'phase-'+name,title:'脚本分步核对',stage:script?'script_approved':'waiting_input',main_script_revision_id:script?'old':null,archived_at:null};calls.length=0;}
reset(name);
function snapshot(){return{sections:{episode:{...episode},materialRevisions:episode.main_script_revision_id?[{id:episode.main_script_revision_id,material_type:'script',source_path:'script.md',storage_path:'script.md',is_main_script:true}]:[],historicalReadOnly:false}};}
const json=(r,v,s=200)=>{r.statusCode=s;r.setHeader('Content-Type','application/json');r.end(JSON.stringify(v));};
const server=await createServer({configFile:false,envFile:false,plugins:[react(),{name:'script-phase-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
 const url=new URL(req.url??'/','http://127.0.0.1:5193');
 if(url.pathname==='/__stage4'){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(url.pathname,`<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>脚本分步核对</title><div id="root"></div><script type="module" src="${entry}"></script></html>`));return;}
 if(url.pathname==='/api/local/session'){json(res,{csrfToken:'fixture-csrf'});return;}
 if(url.pathname==='/__state'){json(res,{name,...snapshot()});return;}
 if(url.pathname==='/__stats'){json(res,{name,calls,reads,saves,starts,episode,script});return;}
 if(url.pathname==='/_local-artifact'){res.setHeader('Content-Type','text/markdown');res.end(script);return;}
 if(url.pathname.endsWith('/workspace')){await new Promise(resolve=>setTimeout(resolve,120));json(res,{workspace:null});return;}
 if(url.pathname==='/__case'){
  let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);reset(body.name);json(res,snapshot());return;
 }
 if(url.pathname==='/api/local/connections'){json(res,{serviceCatalog:{version:1,groups:[]}});return;}
 if(url.pathname.startsWith('/api/local/episodes/')){
  if(starts){reads++;if(name==='read-failed'&&reads===1){json(res,{error:'核对连接中断'},503);return;}if(name==='conflict')episode.main_script_revision_id='other';}
  json(res,snapshot());return;
 }
 if(url.pathname==='/api/local/episode-commands'){
  let text='';for await(const chunk of req)text+=chunk;const {command,data,idempotencyKey}=JSON.parse(text);calls.push({command,data,idempotencyKey});
  if(req.headers['x-csrf-token']!=='fixture-csrf'||data.episodeId!==episode.id){json(res,{error:'Wrong command scope'},409);return;}
  if(command==='importMaterial'||command==='reconfirmScript'){
   if(name==='save-failed'&&saves++===0){json(res,{error:'保存连接中断'},503);return;}
   if(command==='reconfirmScript'&&(data.expectedScriptRevisionId!==episode.main_script_revision_id||!data.reason)){json(res,{error:'Wrong revision baseline'},409);return;}
   if(command==='importMaterial'&&episode.main_script_revision_id){json(res,{error:'Already saved'},409);return;}
   script=command==='importMaterial'?Buffer.from(data.contentBase64,'base64').toString('utf8'):data.text;episode.main_script_revision_id='saved';episode.stage='waiting_input';json(res,{id:'saved'});return;
  }
  if(command==='start'){
   starts++;if(starts===1&&name!=='save-failed'){if(name==='unknown-start')episode.stage='script_approved';json(res,{error:'启动连接中断'},503);return;}
   episode.stage='script_approved';json(res,{...episode});return;
  }
  if(command==='prepareWorkspace'){json(res,{planning:true});return;}
  json(res,{error:'Outside fixture scope'},400);return;
 }
 if(url.pathname.startsWith('/api/')){json(res,{error:'No business API'},404);return;}
 next();
});}}],optimizeDeps:{entries:[entry.slice(1)]},cacheDir:'.scratch/state-machines-batch4-20261110/vite-cache',server:{host:'127.0.0.1',port:5193,strictPort:true}});
await server.listen();console.log('http://127.0.0.1:5193/__stage4');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void server.close().then(()=>process.exit(0)));
