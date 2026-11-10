// Isolated loopback HTTP fixtures. Never proxy a business API or Provider.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {readFileSync} from 'node:fs';
import {scenario,scenarios} from './fixture-data.mjs';
import media from './media.json' with {type:'json'};
const script='/docs/verification/state-machines-batch3-20261110/browser-fixture.tsx',root=new URL('./',import.meta.url);
let workspace=scenario('await-confirmation');const calls=[],reads=[];
const json=(response,value,status=200)=>{response.statusCode=status;response.setHeader('Content-Type','application/json');response.end(JSON.stringify(value));};
const server=await createServer({configFile:false,envFile:false,optimizeDeps:{entries:[script.slice(1)]},plugins:[react(),{name:'stage3-fixture',configureServer(server){server.middlewares.use(async(request,response,next)=>{
 const url=new URL(request.url??'/','http://127.0.0.1:5192');
 if(url.pathname==='/__stage3'){response.setHeader('Content-Type','text/html');response.end(await server.transformIndexHtml(url.pathname,`<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>导出与交付下一步核对</title><div id="root"></div><script type="module" src="${script}"></script></html>`));return;}
 if(url.pathname==='/_local-artifact'){
  const path=url.searchParams.get('path'),sha=url.searchParams.get('sha256'),video=['exports/current.mp4','exports/old.mp4','delivery/history-final.mp4'].includes(path);
  const file=video?'fixture.mp4':path==='delivery/cover.png'?'cover.png':null;
  if(!file||sha!==media[file].sha256){json(response,{error:'Unregistered fixture artifact'},404);return;}
  reads.push({path,sha});response.setHeader('Content-Type',video?'video/mp4':'image/png');const bytes=readFileSync(new URL(file,root));response.setHeader('Content-Length',bytes.length);response.end(bytes);return;
 }
 if(url.pathname==='/api/local/episodes/stage3-fixture/delivery-download'){
  if(url.searchParams.get('delivery')!=='verified-history'){json(response,{error:'Unexpected delivery'},404);return;}
  const bytes=readFileSync(new URL('delivery.zip',root));reads.push({delivery:'verified-history'});response.setHeader('Content-Type','application/zip');response.end(bytes);return;
 }
 if(url.pathname==='/api/local/episodes/stage3-fixture/workspace'){json(response,{workspace});return;}
 if(url.pathname==='/__fixture-stats'){json(response,{calls,reads});return;}
 if(url.pathname==='/__fixture-case'||url.pathname==='/__fixture-command'){
  let text='';for await(const chunk of request)text+=chunk;const body=JSON.parse(text);
  if(url.pathname==='/__fixture-case'){if(!scenarios.includes(body.name)){json(response,{error:'Unknown case'},400);return;}workspace=scenario(body.name);json(response,{workspace});return;}
  const {command,data}=body,source=workspace.exports[0];calls.push({command,data});
  if(data.episodeId!==workspace.episodeId||data.workspaceId!==workspace.id||data.expectedRevision!==workspace.revision){json(response,{error:'Unexpected command identity'},409);return;}
  if(command==='exportWorkspace')workspace=scenario('await-confirmation');
  else if(command==='confirmWorkspaceExport'){
   if(data.exportId!==source.id||data.expectedExportSha256!==source.artifact.sha256||data.expectedContentSha256!==workspace.contentSha256){json(response,{error:'Wrong export identity'},409);return;}
   source.confirmed=true;
  }else if(command==='resolveWorkspaceExportIssue')workspace.exportIssues=workspace.exportIssues.map(issue=>({...issue,resolved:true}));
  else if(command==='retryWorkspaceDelivery'){
   if(data.deliveryId!==workspace.deliveries[0].id){json(response,{error:'Wrong original delivery'},409);return;}workspace.deliveries[0]={...workspace.deliveries[0],status:'ready',error:null};
  }else if(command==='prepareWorkspaceDelivery'){
   if(data.exportId!==source.id||data.expectedExportSha256!==source.artifact.sha256||data.expectedContentSha256!==source.contentSha256||!data.coverBase64){json(response,{error:'Wrong delivery identity'},409);return;}
   workspace.deliveries=[{id:'new-delivery',exportId:source.id,taskId:'controlled-task',status:'ready',verified:false,error:null,artifacts:[]}];
  }else{json(response,{error:'Command outside fixture scope'},400);return;}
  json(response,{workspace});return;
 }
 if(url.pathname.startsWith('/api/')){json(response,{error:'No business API'},404);return;}
 next();
});}}],server:{host:'127.0.0.1',port:5192,strictPort:true},cacheDir:'.scratch/state-machines-batch3-20261110/vite-cache'});
await server.listen();console.log('http://127.0.0.1:5192/__stage3');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void server.close().then(()=>process.exit(0)));
