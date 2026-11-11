// Loopback-only controlled HTTP; no live DB, credentials or Provider.
import {createServer} from 'vite';import react from '@vitejs/plugin-react';import {mkdir} from 'node:fs/promises';
import {draftCatalog,draftSnapshot,draftWorkspace} from '../../../src/local-app/fixtures/workspaceDraftFixture.ts';
const folder='docs/verification/state-machines-910-20261111',scratch='.scratch/state-machines-910';await mkdir(scratch,{recursive:true});
const connection={id:'reading-c',name:'Images',provider:'openai',adapter:'openai_images',current_version_id:'reading-v',status:'verified'};
let mode,created,archived,offline,commands,models,directoryName,holdNext,held;
function reset(next){mode=next;created=false;archived=false;offline=false;commands=[];holdNext=false;held=null;directoryName='Images';models={connectionId:connection.id,versionId:'reading-v',revision:'r1',enabledModels:['gpt-image-2'],models:[{id:'gpt-image-2',adapted:true,listed:false,capability:'图片'}],discovery:{supported:true,detail:'验收模型',readAt:null}};}
const connections=()=>({connections:[{...connection,name:directoryName}],versions:[],serviceCatalog:{version:1,groups:[{capability:'image',label:'图片',services:[{id:'images',label:'图片生成',connectionId:connection.id,provider:'openai',adapter:'openai_images',mode:'generation',connectionVersionId:'reading-v',models:models.enabledModels,executable:true}]}]},capabilities:{secrets:'keychain',verification:'live',externalReady:true}});
const episode=()=>({...draftCatalog.episodes[0],id:'created-episode',title:'验收创建已确认'});
const catalog=()=>({...draftCatalog,episodes:archived?[]:mode==='archive'?[draftCatalog.episodes[0]]:created?[episode()]:[],total:archived?0:created||mode==='archive'?1:0});
const json=(res,value,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};reset('create');
const server=await createServer({configFile:false,envFile:false,plugins:[react(),{name:'state-910',configureServer(server){server.middlewares.use(async(req,res,next)=>{try{
 const u=new URL(req.url,'http://127.0.0.1:5198');
 if(u.pathname==='/__fixture'){reset(u.searchParams.get('mode')??'create');res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(u.pathname,'<!doctype html><html lang="zh-CN" data-interface="impeccable"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/'+folder+'/browser-fixture.tsx"></script></body></html>'));return;}
 if(u.pathname==='/__state'){json(res,{mode,created,archived,offline,commands,held:!!held,directoryName});return;}
 if(u.pathname==='/__offline'){offline=true;json(res,{});return;}
 if(u.pathname==='/__online'){offline=false;json(res,{});return;}
 if(u.pathname==='/__hold-next'){offline=false;holdNext=true;json(res,{});return;}
 if(u.pathname==='/__new-name'){directoryName='新目录';json(res,{});return;}
 if(u.pathname==='/__release'){held?.();held=null;json(res,{});return;}
 if(u.pathname==='/api/local/session'){json(res,{owner:{id:'fixture-owner',email:'fixture@example.test'},csrfToken:'fixture'});return;}
 if(u.pathname==='/api/local/preferences'){if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;json(res,JSON.parse(raw).data);}else json(res,{});return;}
 if(u.pathname==='/api/local/system-status'){json(res,{});return;}
 if(u.pathname==='/api/local/catalog'){if(holdNext){holdNext=false;const value=catalog();held=()=>json(res,value);return;}json(res,offline?{error:'验收：目录读取暂时断开'}:catalog(),offline?503:200);return;}
 if(u.pathname==='/api/local/connections'){
  if(mode==='connections'&&holdNext){holdNext=false;const value=connections();held=()=>json(res,value);return;}
  json(res,offline?{error:'验收：连接目录读取断开'}:connections(),offline?503:200);return;
 }
 if(u.pathname==='/api/local/connection-models'&&req.method!=='POST'){json(res,models);return;}
 if(req.method==='POST'&&['/api/local/episode-commands','/api/local/episode-lifecycle','/api/local/connection-models'].includes(u.pathname)){
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);commands.push(body);offline=true;
  if(body.command==='create'){created=true;json(res,{id:'created-episode'});return;}
  if(body.command==='archiveEpisode'){archived=true;json(res,{archived:true});return;}
  if(body.command==='save'){models={...models,revision:'r2',enabledModels:body.data.enabledModels};json(res,models);return;}
  json(res,{error:'Unexpected fixture write'},400);return;
 }
 if(u.pathname.endsWith('/workspace')){json(res,{workspace:draftWorkspace('created-episode')});return;}
 if(u.searchParams.has('known')){json(res,{hashes:{},sections:{...draftSnapshot(),episode:episode()}});return;}
 if(u.pathname==='/api/local/notification-events'){json(res,[]);return;}
 if(u.pathname.startsWith('/api/')){json(res,{});return;}next();
 }catch(e){json(res,{error:String(e)},500);}});}}],optimizeDeps:{entries:[folder+'/browser-fixture.tsx']},cacheDir:scratch+'/vite-cache',server:{host:'127.0.0.1',port:5198,strictPort:true}});
await server.listen();console.log('http://127.0.0.1:5198/__fixture');for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void server.close().then(()=>process.exit(0)));
