// Controlled HTTP and clipboard boundary; real components, no daily media or credentials.
import {createServer} from 'vite';import react from '@vitejs/plugin-react';import {mkdir,readFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';
const folder='docs/verification/state-machines-111213-20261111',scratch='.scratch/state111213-ui';await mkdir(scratch,{recursive:true});const sample=scratch+'/人工口播.mp3';execFileSync('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:a','libmp3lame',sample]);
let workspace,view,materials,commands,receipts,failConfirm,online,heldOpen,sequence=0;
function reset(next){view=next;materials=[];commands=[];receipts=new Map();failConfirm=true;online=false;heldOpen=null;sequence++;workspace={id:'manual-w'+sequence,episodeId:'manual-e'+sequence,revision:1,stale:false,project:{sha256:'saved-sha'},clips:[1,2].map(i=>({id:'clip'+i,shotId:'S0'+i,itemId:'item'+i,text:'口播 '+i})),candidates:[],narration:[1,2].map(i=>({clipId:'clip'+i,shotId:'S0'+i,mode:'manual',enabled:true,text:'镜头 '+i+' 正文',status:'pending',inputFingerprint:'initial'+i}))};}reset('manual');
const json=(res,value,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
const server=await createServer({configFile:false,envFile:false,plugins:[react(),{name:'state111213-ui',configureServer(server){server.middlewares.use(async(req,res,next)=>{try{
 const u=new URL(req.url,'http://127.0.0.1:5198');
 if(u.pathname==='/__fixture'){reset(u.searchParams.get('view')??'manual');res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(u.pathname,'<!doctype html><html lang="zh-CN" data-interface="impeccable"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/'+folder+'/browser-fixture.tsx"></script></body></html>'));return;}
 if(u.pathname==='/__state'){json(res,{view,workspace,commands,online,held:!!heldOpen});return;}
 if(u.pathname==='/__online'){online=true;json(res,{});return;}
 if(u.pathname==='/__release-open'){heldOpen?.();heldOpen=null;json(res,{});return;}
 if(u.pathname==='/api/local/session'){json(res,{csrfToken:'ui-fixture'});return;}
 if(u.pathname==='/api/local/connections'){json(res,{serviceCatalog:{version:1,groups:[]}});return;}
 if(u.pathname.endsWith('/workspace')){json(res,{workspace});return;}
 if(u.pathname==='/_local-artifact'){res.setHeader('Content-Type','audio/mpeg');res.end(await readFile(sample));return;}
 if(u.pathname==='/api/local/account-commands'){
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);commands.push(body);
  if(body.command==='readAssetDirectory'){if(body.data.accountId==='account-a'&&!online){json(res,{error:'验收：素材盘已断开'},503);return;}json(res,{assetRoot:body.data.accountId==='account-a'?'/fixture/账号A':'/fixture/账号B',status:'ready'});return;}
  if(body.command==='openAssetDirectory'){heldOpen=()=>json(res,{error:'验收：旧账号打开失败'},503);return;}
 }
 if(u.pathname==='/api/local/episode-commands'){
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),{command,data,idempotencyKey}=body;commands.push({...body,data:{...data,contentBase64:undefined}});if(receipts.has(idempotencyKey)){json(res,receipts.get(idempotencyKey));return;}
  let result;
  if(command==='importMaterial'){result={id:'material'+(materials.length+1),material_type:'audio',source_path:data.sourcePath,storage_path:'voice/imported.mp3'};materials.push(result);}
  else{if(data.expectedRevision!==workspace.revision){json(res,{error:'验收：旧工程版本'},409);return;}if(command==='confirmWorkspaceNarration'&&failConfirm){failConfirm=false;json(res,{error:'验收：口播确认中断'},503);return;}
   const n=workspace.narration.find(n=>n.clipId===data.clipId);workspace={...workspace,revision:workspace.revision+1};if(command==='saveWorkspaceNarration'){const track='track-'+data.materialRevisionId;workspace.narration=workspace.narration.map(v=>v.clipId===n.clipId?{...v,mode:'manual',audioTrackId:track,inputFingerprint:track}:v);workspace.candidates=[...workspace.candidates,{id:track,audioTrackId:track,kind:'audio',shotId:n.shotId,clipId:n.clipId,relativePath:'voice/imported.mp3',text:n.text,durationSeconds:1,inputFingerprint:track,status:'available'}];}result=workspace;
  }receipts.set(idempotencyKey,result);json(res,result);return;
 }
 if(u.pathname.startsWith('/api/')){json(res,{error:'Outside fixture'},404);return;}next();
 }catch(e){json(res,{error:String(e)},500);}});}}],optimizeDeps:{entries:[folder+'/browser-fixture.tsx']},cacheDir:scratch+'/vite-cache',server:{host:'127.0.0.1',port:5198,strictPort:true}});
await server.listen();console.log('http://127.0.0.1:5198/__fixture');for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void server.close().then(()=>process.exit(0)));
