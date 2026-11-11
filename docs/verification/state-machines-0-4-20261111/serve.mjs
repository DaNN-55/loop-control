// Isolated HTTP and native-file fixture. All endpoints remain on loopback.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {defaultShotCaptionContract} from '../../../dist/local-app/shotCaptions.js';
import {applyWorkspaceCaptionEdit,readWorkspaceCaption} from '../../../dist/local-app/workspaceCaptions.js';
const port=5197,entry='/docs/verification/state-machines-0-4-20261111/browser-fixture.tsx';
const scratch='.scratch/state-machines-0-4-20261111';await mkdir(scratch,{recursive:true});
const nativePath=scratch+'/native-project.json';
let mode,w,studio,counts,receipts,heldModel,heldSave,failedImport,registrationFailed,heldAudio,preferenceFailed,materials;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const model=id=>({connectionId:id,versionId:id+'-version',revision:'r1',enabledModels:[id+'-model'],models:[{id:id+'-model',adapted:true,listed:true,capability:'图片'}],discovery:{supported:true,detail:'夹具目录',readAt:null}});
const json=(res,value,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
async function reset(value){
 mode=value;counts={reads:0,nativeWrites:0,imports:0,registrations:0,saves:0,musicWrites:0,refreshes:0,preferences:0,commands:[]};receipts=new Map();heldModel=null;heldSave=null;failedImport=false;registrationFailed=false;heldAudio=null;preferenceFailed=false;materials=new Map();
 const contract=defaultShotCaptionContract('验证字幕','independent');contract.cues=[{id:'cue',text:contract.text,startMs:0,endMs:1200}];
 const project=applyWorkspaceCaptionEdit({version:3,activeTimelineId:'main',assets:[],mediaFolders:[],timelines:[{id:'main',name:'main',order:0,fps:30,width:1080,height:1920,fit:'contain',items:[{id:'item',kind:'image',track:'V1',startFrame:0,durationInFrames:90}],trackOrder:['V1'],tracks:{V1:{kind:'video',name:'video'}},transitions:[],selectedId:null,captionsHidden:false}]},'item',contract);
 await writeFile(nativePath,JSON.stringify(project),{mode:0o600});
 studio={relativePath:'work/project.json',sha256:digest(project),fileSize:Buffer.byteLength(JSON.stringify(project)),projectId:'loop-control-e'};
 w={id:'w',episodeId:'e',workflowVersion:'four-step/v1',scriptRevisionId:'s',revision:2,project:{...studio,relativePath:'project.json'},contentSha256:'c'.repeat(64),clips:[{id:'clip',itemId:'item',shotId:'S1',text:'验证镜头',source:null}],readiness:{deliverable:false,placeholders:[],missingSources:[]},stale:false,visualCandidates:[],visualTasks:[],captions:[{clipId:'clip',itemId:'item',shotId:'S1',contract:readWorkspaceCaption(project,'item').contract,inputFingerprint:'input',timing:'current',textConfirmed:false,audioTrackId:'voice',taskId:'alignment',durationMs:3000}]};
 if(mode.startsWith('audio'))w.audio={mix:{voices:[],sounds:[]},preparations:[{id:'pending-audio',kind:'bgm',description:'处理中配乐',status:'running',taskId:'task',offsetSeconds:0,durationSeconds:3,source:{provider:'manual'}}]};
 if(mode==='delivery'){w.exports=[{id:'export',status:'ready',checks:[],current:true,confirmed:true,contentSha256:w.contentSha256,artifact:{sha256:'video'}}];w.deliveries=[{id:'delivery',status:'running'}];}
}
await reset('captions');
const server=await createServer({configFile:false,envFile:false,plugins:[react(),{name:'state04-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
 try{
 const url=new URL(req.url,'http://127.0.0.1:'+port);
 if(url.pathname==='/__ui'){
  await reset(url.searchParams.get('case')||'captions');res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(url.pathname,`<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>工作区恢复验收</title><div id="root"></div><script type="module" src="${entry}"></script></html>`));return;
 }
 if(url.pathname==='/__studio'){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(url.pathname,'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>原生消息夹具</title><body><p>原生工程文件与字幕操作</p><script type="module" src="/docs/verification/state-machines-0-4-20261111/native-fixture.ts"></script></body></html>'));return;}
 if(url.pathname==='/__state'){json(res,{mode,workspace:w,studio});return;}
 if(url.pathname==='/__release-audio'){
  if(heldAudio){w={...w,revision:w.revision+1};if(heldAudio.name==='saveWorkspaceMusicSettings')counts.musicWrites++;else counts.refreshes++;receipts.set(heldAudio.key,w);json(heldAudio.res,w);heldAudio=null;}json(res,{released:true});return;
 }
 if(url.pathname==='/api/local/preferences'){
  let raw='';for await(const chunk of req)raw+=chunk;const {data,idempotencyKey}=JSON.parse(raw);counts.preferences++;
  if(!preferenceFailed){preferenceFailed=true;json(res,{error:'偏好保存暂时中断'},503);return;}
  receipts.set(idempotencyKey,data);json(res,data);return;
 }
 if(url.pathname==='/__stats'){json(res,counts);return;}
 if(url.pathname==='/__models'){const id=url.searchParams.get('id');if(mode==='models'&&id==='old')heldModel=res;else json(res,model(id));return;}
 if(url.pathname==='/__model-save'){heldSave=res;return;}
 if(url.pathname==='/__release-model'){if(heldModel){json(heldModel,model('old'));heldModel=null;}if(heldSave){json(heldSave,model('old'));heldSave=null;}json(res,{released:true});return;}
 if(url.pathname==='/_local-artifact'){const bytes=materials.get(url.searchParams.get('path'));if(!bytes){json(res,{error:'Fixture material missing'},404);return;}res.setHeader('Content-Type','image/png');res.end(bytes);return;}
 if(url.pathname==='/__native'){
  if(req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;await writeFile(nativePath,body,{mode:0o600});counts.nativeWrites++;json(res,{saved:true});}
  else{res.setHeader('Content-Type','application/json');res.end(await readFile(nativePath));}return;
 }
 if(url.pathname==='/api/local/session'){json(res,{csrfToken:'state04-fixture'});return;}
 if(url.pathname==='/api/local/connections'){json(res,{serviceCatalog:{version:1,groups:[]}});return;}
 if(url.pathname.includes('/workspace/project')){json(res,{project:JSON.parse(await readFile(nativePath,'utf8'))});return;}
 if(url.pathname==='/api/local/episodes/e/workspace'){counts.reads++;json(res,{workspace:w});return;}
 if(url.pathname==='/api/local/episode-commands'){
  let raw='';for await(const chunk of req)raw+=chunk;const {command,data,idempotencyKey}=JSON.parse(raw);counts.commands.push({command,data,idempotencyKey});
  if(req.headers['x-csrf-token']!=='state04-fixture'){json(res,{error:'Wrong fixture CSRF'},403);return;}
  if(receipts.has(idempotencyKey)){json(res,receipts.get(idempotencyKey));return;}
  if(command==='saveWorkspaceMusicSettings'||command==='refreshWorkspaceAudio'){
   if(data.expectedRevision!==w.revision){json(res,{error:'Audio revision mismatch'},409);return;}
   if(mode==='audio-write'&&command==='saveWorkspaceMusicSettings'||mode==='audio-refresh'&&command==='refreshWorkspaceAudio'){heldAudio={name:command,res,key:idempotencyKey};return;}
   w={...w,revision:w.revision+1};if(command==='saveWorkspaceMusicSettings')counts.musicWrites++;else counts.refreshes++;receipts.set(idempotencyKey,w);json(res,w);return;
  }
  if(command==='saveWorkspaceStudio'){
   if(data.expectedRevision!==w.revision||data.expectedWorkspaceSha256!==studio.sha256){json(res,{error:'Wrong saved baseline'},409);return;}
   const project=JSON.parse(await readFile(nativePath,'utf8'));counts.saves++;studio={...studio,sha256:digest(project),fileSize:Buffer.byteLength(JSON.stringify(project))};w={...w,revision:w.revision+1,project:{...studio,relativePath:'project.json'},captions:[{...w.captions[0],contract:readWorkspaceCaption(project,'item').contract}]};const result={...studio,productionWorkspace:w};receipts.set(idempotencyKey,result);json(res,result);return;
  }
  if(command==='prepareWorkspaceCaptionAlignment'){json(res,{captionContract:w.captions[0].contract});return;}
  if(command==='saveWorkspaceCaptions'||command==='applyWorkspaceCaptionAlignment'){
   if(mode==='captions'&&!registrationFailed){registrationFailed=true;json(res,{error:'字幕登记暂时中断，工程已保留。'},503);return;}
   counts.registrations++;w={...w,revision:w.revision+1};receipts.set(idempotencyKey,w);
   if(mode==='caption-unknown'&&!registrationFailed){registrationFailed=true;json(res,{error:'登记回执暂不可用'},503);return;}
   json(res,w);return;
  }
  if(command==='importMaterial'){
   if(data.sourcePath.includes('retry')&&!failedImport){failedImport=true;json(res,{error:'素材导入暂时中断'},503);return;}
   counts.imports++;const result={id:data.sourcePath,source_path:data.sourcePath,material_type:data.materialType,storage_path:'media/'+data.sourcePath};materials.set(result.storage_path,Buffer.from(data.contentBase64,'base64'));receipts.set(idempotencyKey,result);json(res,result);return;
  }
  json(res,{error:'Outside fixture command scope'},400);return;
 }
 if(url.pathname.startsWith('/api/')){json(res,{error:'Outside fixture API scope'},404);return;}next();
 }catch(error){json(res,{error:error.message},500);}
 });}}],optimizeDeps:{entries:[entry.slice(1)]},server:{host:'127.0.0.1',port,strictPort:true},cacheDir:scratch+'/vite-cache'});
await server.listen();console.log('http://127.0.0.1:'+port+'/__ui');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void server.close().then(()=>process.exit(0)));
