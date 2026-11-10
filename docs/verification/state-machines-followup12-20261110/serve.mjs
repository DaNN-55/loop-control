// Controlled loopback boundaries only; no database, real credentials, Provider or business proxy.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {readFileSync} from 'node:fs';
const entry='/docs/verification/state-machines-followup12-20261110/browser-fixture.tsx';
const media=Object.fromEntries(['A','B'].map(voice=>[voice,readFileSync(new URL(`voice-${voice}.mp3`,import.meta.url)).toString('base64')]));
let sampleCase='cached',modelCase='clean',settings,samples=[],models=[],drafts=[],held=[],generated=new Set();
const initial=()=>({connectionId:'c',versionId:'v',revision:'r1',enabledModels:['model-1'],models:['model-1','model-2','model-3'].map(id=>({id,adapted:true,listed:true,capability:'图片'})),discovery:{supported:true,detail:'受控模型目录',readAt:null}});settings=initial();
const json=(res,value,status=200)=>{if(res.destroyed)return;res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
const server=await createServer({configFile:false,envFile:false,plugins:[react(),{name:'ownership-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
 const url=new URL(req.url??'/','http://127.0.0.1:5195');
 if(url.pathname==='/__followup12'){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(url.pathname,`<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>样音与模型基线核对</title><div id="root"></div><script type="module" src="${entry}"></script></html>`));return;}
 if(url.pathname==='/__stats'){json(res,{sampleCase,modelCase,samples,models,drafts,settings,held:held.map(({voice})=>voice)});return;}
 if(url.pathname==='/api/local/session'){json(res,{csrfToken:'fixture-csrf'});return;}
 if(url.pathname.startsWith('/__release/')){const voice=url.pathname.split('/').at(-1);const picked=held.filter(x=>x.voice===voice);held=held.filter(x=>x.voice!==voice);for(const item of picked)json(item.res,{audioBase64:media[voice]});json(res,{released:picked.length});return;}
 if(url.pathname==='/__models/read'){json(res,settings);return;}
 if(['/_sample-case','/_model-case','/__models/sync','/__models/save','/__draft','/api/local/speech-sample'].includes(url.pathname)){
  let text='';for await(const chunk of req)text+=chunk;const data=JSON.parse(text);
  if(url.pathname==='/_sample-case'){sampleCase=data.name;samples=[];held=[];generated=new Set();json(res,{ok:true});return;}
  if(url.pathname==='/_model-case'){modelCase=data.name;settings=initial();models=[];drafts=[];json(res,{ok:true});return;}
  if(url.pathname==='/__draft'){drafts.push(data);json(res,{ok:true});return;}
  if(url.pathname==='/api/local/speech-sample'){
   if(req.headers['x-csrf-token']!=='fixture-csrf'){json(res,{error:'Wrong CSRF'},403);return;}samples.push(data);
   if(sampleCase==='delayed'){held.push({voice:data.voice,res});return;}
   if(data.generate)generated.add(data.voice);
   json(res,{audioBase64:sampleCase==='missing'&&!generated.has(data.voice)?null:media[data.voice]});return;
  }
  models.push({operation:url.pathname.endsWith('sync')?'sync':'save',data});
  if(data.connectionId!=='c'||data.versionId!=='v'){json(res,{error:'连接版本已变化'},409);return;}
  if(url.pathname.endsWith('/sync')){
   settings={...settings,revision:'r2',enabledModels:modelCase==='concurrent'?['model-2']:settings.enabledModels,discovery:{...settings.discovery,readAt:'now'}};json(res,settings);return;
  }
  if(modelCase==='save-race')settings={...settings,revision:'r3',enabledModels:['model-2']};
  if(data.revision!==settings.revision){json(res,{error:'模型设置已被修改，请重新打开后保存。'},409);return;}
  settings={...settings,revision:'r3',enabledModels:data.enabledModels};json(res,settings);return;
 }
 if(url.pathname.startsWith('/api/')){json(res,{error:'No business API'},404);return;}
 next();
});}}],optimizeDeps:{entries:[entry.slice(1)]},cacheDir:'.scratch/state-machines-followup12-20261110/vite-cache',server:{host:'127.0.0.1',port:5195,strictPort:true}});
await server.listen();console.log('http://127.0.0.1:5195/__followup12');for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void server.close().then(()=>process.exit(0)));
