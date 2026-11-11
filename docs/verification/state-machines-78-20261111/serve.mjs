// Loopback controlled HTTP; real components, no real media, providers or databases.
import {createServer} from 'vite';import react from '@vitejs/plugin-react';import {mkdir,writeFile} from 'node:fs/promises';
const folder='docs/verification/state-machines-78-20261111',scratch='.scratch/state-machines-78';await mkdir(scratch,{recursive:true});
await writeFile(scratch+'/bad.png','fixture');await writeFile(scratch+'/imported.png','fixture');await writeFile(scratch+'/new.png','fixture');
let view,workspace,root,reads,commands,sequence=0,heldImport;
const manifest={sourceBinding:{path:'/fixture/old'},targetBinding:{path:'/fixture/new'},accounts:[],episodes:[],fileCount:2,totalBytes:200,space:{freeBytes:1000,reserveBytes:100,requiredBytes:300},canExecute:true,conflicts:[],blockers:[]};
function reset(next){view=next;reads=0;commands=[];sequence++;root={path:'/fixture/old',canInitialize:false,status:'ready',executing:true,migration:{id:'plan',status:'copying',manifest,progress:{copiedFiles:1,copiedBytes:100}}};workspace={id:'w'+sequence,episodeId:'e'+sequence,workflowVersion:'four-step/v1',scriptRevisionId:'s',revision:1,clips:[{id:'c',itemId:'target',shotId:'S1',text:'上传恢复',source:null}],project:{relativePath:'project.json',sha256:'sha',fileSize:1,projectId:'project'},readiness:{deliverable:false,placeholders:['target'],missingSources:[]},visualCandidates:[],visualTasks:[],visualTargets:[],selectedImages:[],stale:false};}
reset('storage');
const json=(res,value,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
const server=await createServer({configFile:false,envFile:false,plugins:[react(),{name:'state-78',configureServer(server){server.middlewares.use(async(req,res,next)=>{try{
 const u=new URL(req.url,'http://127.0.0.1:5198');
 if(u.pathname==='/__fixture'){reset(u.searchParams.get('view')??'storage');res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(u.pathname,'<!doctype html><html lang="zh-CN" data-interface="impeccable"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/'+folder+'/browser-fixture.tsx"></script></body></html>'));return;}
 if(u.pathname==='/__state'){json(res,{view,workspace,root,reads,commands});return;}
 if(u.pathname==='/__release'){heldImport?.();heldImport=null;json(res,{});return;}
 if(u.pathname==='/__complete'){root={...root,path:'/fixture/new',executing:false,migration:{...root.migration,status:'completed'}};json(res,{});return;}
 if(u.pathname==='/api/local/media-root'){reads++;json(res,root);return;}
 if(u.pathname.endsWith('/workspace')){json(res,{workspace});return;}
 if(u.pathname==='/api/local/connections'){json(res,{serviceCatalog:{groups:[{capability:'image',services:[]},{capability:'video',services:[]}]}});return;}
 if(u.pathname==='/api/local/session'){json(res,{csrfToken:'fixture'});return;}
 if(u.pathname==='/api/local/episode-commands'){
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),{command,data}=body;commands.push({command,data:{...data,contentBase64:undefined}});
  if(command==='importMaterial'){
   if(data.sourcePath==='imported.png')await new Promise(resolve=>{heldImport=resolve;});
   if(data.sourcePath==='bad.png'){json(res,{error:'验收：文件无法导入'},400);return;}
   json(res,{id:data.sourcePath,material_type:'image',source_path:data.sourcePath,storage_path:'media/'+data.sourcePath});return;
  }
  if(command==='registerWorkspaceVisualCandidate'){
   if(data.materialRevisionId==='imported.png'){json(res,{error:'验收：候选未登记'},503);return;}
   workspace={...workspace,revision:workspace.revision+1,visualCandidates:[...workspace.visualCandidates,{id:'c-'+data.materialRevisionId,targetItemId:'target',kind:'image',materialRevisionId:data.materialRevisionId,relativePath:'media/'+data.materialRevisionId,sha256:'sha',status:'available',durationSeconds:3,currentDurationSeconds:3}]};json(res,workspace);return;
  }
  json(res,{error:'Unexpected command'},400);return;
 }
 if(u.pathname==='/_local-artifact'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="96"><rect width="64" height="96" fill="#3c6"/></svg>');return;}
 if(u.pathname.startsWith('/api/')){if(u.pathname.includes('/files/')){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="96"><rect width="64" height="96" fill="#3c6"/></svg>');return;}json(res,{},404);return;}next();
 }catch(e){json(res,{error:String(e)},500);}});}}],optimizeDeps:{entries:[folder+'/browser-fixture.tsx']},cacheDir:scratch+'/vite-cache',server:{host:'127.0.0.1',port:5198,strictPort:true}});
await server.listen();console.log('http://127.0.0.1:5198/__fixture');for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void server.close().then(()=>process.exit(0)));
