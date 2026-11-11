// Loopback-only real components, controlled HTTP. No proxy, DB, Provider or daily writes.
import {createServer} from 'vite';import react from '@vitejs/plugin-react';
import {mkdir,readFile,writeFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';
const dir='.scratch/workflow-audio-consistency-20261111';await mkdir(dir,{recursive:true});
const sample=dir+'/sample.mp3';execFileSync('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2.4','-c:a','libmp3lame',sample]);
const selection={capability:'speech',provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0',connectionVersionId:'speech-v1'};
const settings={selection,voice:'zh_female_vv_uranus_bigtts',speakingRate:1,languageCode:'zh-CN'};
const services={groups:[{capability:'speech',services:[{id:'speech',provider:'volcengine_tts',adapter:'volcengine_tts',connectionVersionId:'speech-v1',connectionName:'豆包语音',connectionVersion:1,models:['seed-tts-2.0'],voiceCatalog:{'zh-CN':['zh_female_vv_uranus_bigtts']},constraints:{speakingRate:{min:.5,max:2}},executable:true}]},{capability:'music_sound',services:[{id:'fs-local',provider:'freesound',adapter:'freesound_audio',connectionVersionId:'fs-v1',connectionName:'本地连接',connectionVersion:2,mode:'search',executable:true},{id:'fs-other',provider:'freesound',adapter:'freesound_audio',connectionVersionId:'fs-v2',connectionName:'备用连接',connectionVersion:1,mode:'search',executable:true}]},{capability:'image',services:[]},{capability:'video',services:[]}]};
let workspace,materials,tracks,view,commands,receipts,sequence=0,fail='',singleSource=false;
function reset(next){view=next;sequence++;commands=[];receipts=new Map();fail='';materials=[{id:'existing-1',source_path:'视频原声-'+('cf2019e6032dcaab'.repeat(4))+'.mp3',storage_path:'media/existing.mp3',material_type:'audio',material_purpose:'narration'},{id:'existing-2',source_path:'第二段人工录音.mp3',storage_path:'media/second.mp3',material_type:'audio',material_purpose:'narration'}];tracks=[];workspace={id:'w'+sequence,episodeId:'e',revision:1,workflowVersion:'four-step/v1',scriptRevisionId:'s',stale:false,project:{sha256:'saved-sha',relativePath:'project.json'},clips:[{id:'c',itemId:'visual',shotId:'S1',text:'在清晨的光线里，记录真实发生的故事。',source:null}],readiness:{deliverable:false,placeholders:[],missingSources:[]},visualCandidates:[],visualTasks:[],candidates:[],narration:[{enabled:true,clipId:'c',shotId:'S1',mode:next==='manual'?'manual':'tts',text:'在清晨的光线里，记录真实发生的故事。',voice:settings.voice,speakingRate:1,languageCode:'zh-CN',selection,inputFingerprint:'initial',status:'pending',defaults:settings}],captions:[{clipId:'c',itemId:'visual',shotId:'S1',contract:{version:'shot-caption/v1',enabled:true,text:'在清晨的光线里，记录真实发生的故事。',contentMode:'follow_tts',cues:[],spatial:{anchor:'bottom-center',maxCharactersPerLine:14,safeArea:'default',insets:{top:.05,right:.05,bottom:.08,left:.05}}},timing:'missing',textConfirmed:false}],audio:{mix:{voices:[{shotId:'S1',mode:'none',gainDb:0,ambienceGainDb:null,sourceItemId:null,sourceAssetId:null}],sounds:[]},preparations:[]}};}
reset('manual');
const json=(res,value,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
const server=await createServer({configFile:false,envFile:false,plugins:[react(),{name:'audio-consistency',configureServer(server){server.middlewares.use(async(req,res,next)=>{try{
 const u=new URL(req.url,'http://127.0.0.1:5198');
 if(u.pathname==='/__fixture'){reset(u.searchParams.get('view')??'manual');singleSource=u.searchParams.get('single')==='1';res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(u.pathname,'<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>工作流音频一致性验收</title><style>.fixture-grid{display:grid;grid-template-columns:minmax(220px,1fr) minmax(400px,1fr);gap:16px}@media(max-width:800px){.fixture-grid{grid-template-columns:1fr}}</style><div id="root"></div><script type="module" src="/docs/verification/workflow-audio-consistency-20261111/browser-fixture.tsx"></script></html>'));return;}
 if(u.pathname==='/__state'){json(res,{view,workspace,materials,tracks});return;}
 if(u.pathname==='/__stats'){json(res,{commands,imports:commands.filter(c=>c.command==='importMaterial').length,candidates:workspace.candidates,revision:workspace.revision});return;}
 if(u.pathname==='/__fail'){fail=u.searchParams.get('command')??'';json(res,{armed:fail});return;}
 if(u.pathname==='/_local-artifact'){res.setHeader('Content-Type','audio/mpeg');res.end(await readFile(sample));return;}
 if(u.pathname==='/api/local/session'){json(res,{csrfToken:'fixture'});return;}
 if(u.pathname==='/api/local/connections'){json(res,{serviceCatalog:singleSource?{groups:services.groups.map(g=>g.capability==='music_sound'?{...g,services:[{...g.services[0],executable:false,unavailableReason:'连接尚未验证'}]}:g)}:services});return;}
 if(u.pathname.endsWith('/workspace')&&req.method==='GET'){json(res,{workspace});return;}
 if(u.pathname==='/api/local/episode-commands'){
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),{command,data,idempotencyKey}=body;commands.push(body);
  if(fail===command){fail='';json(res,{error:'验收：登记连接中断，请重试。'},503);return;}
  if(receipts.has(idempotencyKey)){json(res,receipts.get(idempotencyKey));return;}
  let result;
  if(command==='importMaterial'){const m={id:'material-'+materials.length,material_type:'audio',material_purpose:'narration',source_path:data.sourcePath,storage_path:'media/'+data.sourcePath};materials.push(m);result=m;}
  else if(command==='prepareWorkspaceCandidate'){const candidate=workspace.candidates.find(c=>c.id===data.candidateId);result={adoptionId:'adoption-'+candidate.id,candidateId:candidate.id,projectSha256:workspace.project.sha256,edit:{source:{kind:'audio'}},impact:{currentSeconds:2.4,sourceSeconds:2.4,appliedSeconds:2.4,deltaSeconds:0,affectedFragments:[]}};}
  else{
   if(data.expectedRevision!==undefined&&data.expectedRevision!==workspace.revision){json(res,{error:'验收检测到旧 revision' },409);return;}
   workspace={...workspace,revision:workspace.revision+1};const n=workspace.narration[0];
   if(command==='saveWorkspaceNarration'&&data.mode==='manual'){
    const m=materials.find(m=>m.id===data.materialRevisionId),id='track-'+m.id;
    if(!tracks.some(t=>t.id===id))tracks.push({id,track_kind:'narration',cue_id:'S1',source_material_revision_id:m.id,relative_path:m.storage_path});
    const candidate={id,audioTrackId:id,kind:'audio',shotId:'S1',clipId:'c',text:data.text||m.source_path,relativePath:m.storage_path,sha256:'a'.repeat(64),inputFingerprint:id,durationSeconds:2.4,status:'available',canRestoreNarration:false};
    if(!workspace.candidates.some(c=>c.id===id))workspace.candidates=[...workspace.candidates,candidate];
    workspace.narration=[{...n,mode:'manual',audioTrackId:id,relativePath:m.storage_path,inputFingerprint:id,status:'completed',durationSeconds:2.4}];
   }
   if(command==='adoptWorkspaceCandidate'){const c=workspace.candidates.find(c=>c.id===data.candidateId);workspace.candidates=workspace.candidates.map(v=>({...v,status:v.id===c.id?'adopted':v.status==='adopted'?'available':v.status}));workspace.narration=[{...n,adoptedAudioTrackId:c.audioTrackId}];workspace.project={...workspace.project,sha256:'adopted-'+workspace.revision};}
   if(command==='withdrawWorkspaceNarration'){workspace.narration=[{...n,adoptedAudioTrackId:null}];workspace.candidates=workspace.candidates.map(c=>({...c,status:'available'}));}
   if(command==='saveWorkspaceNarrationCaptions')workspace.captions=[{...workspace.captions[0],contract:{...workspace.captions[0].contract,contentMode:data.contentMode,text:data.text??n.text}}];
   result=workspace;
  }
  receipts.set(idempotencyKey,result);json(res,result);return;
 }
 if(u.pathname.startsWith('/api/')){json(res,{error:'Outside fixture boundary'},404);return;}next();
 }catch(error){json(res,{error:String(error)},500);}});}}],optimizeDeps:{entries:['docs/verification/workflow-audio-consistency-20261111/browser-fixture.tsx']},server:{host:'127.0.0.1',port:5198,strictPort:true},cacheDir:dir+'/vite-cache'});
await server.listen();console.log('http://127.0.0.1:5198/__fixture?view=manual');for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void server.close().then(()=>process.exit(0)));
