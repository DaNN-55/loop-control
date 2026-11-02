import {requiresWorkspaceCall} from '../workspaceCall';
// New story content on the existing real Owner/HTTP/PG/Worker/native-document boundaries.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {nativeWorkspaceFixture} from './nativeWorkspace.fixture';
import {LocalConnections} from './connections';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {productionWorkspaceMigrations} from './productionWorkspace.fixture';
import {fixtureResources} from './fixtureResources';
import {inspectMediaRoot} from './mediaRootSettings';
import {csrfFor} from './sessions';
import {nativeWorkerPort} from './workerDatabase';
import {runWorkspaceDeliveryProcess} from './workspaceDelivery.fixture';
import {defaultShotCaptionContract} from '../shotCaptions';
import type {ProductionWorkspace} from '../productionWorkspace';

const exec=promisify(execFile);
export const storyTitle='末班车前的一把伞';
export const storyLines=['雨停了，她把伞留在长椅上。','伞柄的纸条写着：留给下一个人。'];

export async function storyE2eFixture(options:{blank?:boolean}={}){
 if(!process.env.LOOP_TEST_CONTEXT_MODULE)throw Error('Use npm run test:e2e; an explicit isolated cluster is required');
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE);
 const context=runtimeContext();if(context.dailyRuntime!==false)throw Error('Story E2E refuses the daily runtime');context.assertDatabase();
 const resources=fixtureResources();
 try{
  const volume=await workspaceAudioVolume();resources.defer(volume.close);
  const f=await nativeWorkspaceFixture({testRootParent:volume.mountPath,migrations:productionWorkspaceMigrations,
   connections:pool=>new LocalConnections(pool,{mode:'keychain',putImmutable:async()=>{throw Error('Story fixture does not write real credentials');},get:async()=> 'synthetic-story-only'},
    {mode:'live',networkAvailable:true,verify:async()=>{throw Error('Story fixture does not contact real providers');}}),
   runtime:{mountPath:volume.mountPath,wake(){},postReady:async()=>{},mediaReady:async()=>{},narrationReady:async()=>{},checkReferences:async()=>{}}});
  resources.defer(f.close);
  const binding=await inspectMediaRoot(f.root);
  await f.c.query('SELECT local_identity.bind_media_root($1,$2,$3,$4,false,$5)',[binding.path,binding.deviceId,binding.inodeId,binding.mountPath,f.owner]);
  await f.start();
  const post=async(endpoint:string,command:string,data:Record<string,unknown>,key:string=randomUUID())=>{
   const r=await fetch(f.origin+'/api/local/'+endpoint,{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:key,data})});
   return{status:r.status,body:await r.json()};
  };
  const ok=async(p:ReturnType<typeof post>)=>{const r=await p;assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
  const account=await ok(post('configuration','createAccount',{name:'雨后小故事',slug:'umbrella-'+randomUUID(),timezone:'Asia/Shanghai',policy:{positioning:'六秒钟的城市善意',tone:'克制、温暖',visual_style:'深蓝站台与黄色雨伞'}}));
  const series=await ok(post('configuration','createSeries',{accountId:account.id,name:'城市善意',rules:{positioning:'以一个小动作留下悬念'}}));
  const created=await ok(post('episode-commands','create',{accountId:account.id,seriesVersionId:series.id,title:storyTitle}));
  const episode=created.id as string;
  const directory=await ok(post('account-commands','readAssetDirectory',{accountId:account.id}));
  const assetRoot=directory.assetRoot as string;
  const callKeys=new Map<string,{proposalKey:string;revision:unknown}>();
  const request=async(command:string,data:Record<string,unknown>={},key?:string)=>{
   const payload={episodeId:episode,...data};
   if(!requiresWorkspaceCall(command,payload))return post('episode-commands',command,payload,key);
   const submitKey=key??randomUUID(),saved=callKeys.get(submitKey)??{proposalKey:randomUUID(),revision:data.expectedRevision};callKeys.set(submitKey,saved);
   const callData={...payload,expectedRevision:saved.revision};
   const proposal=await post('episode-commands','prepareWorkspaceCall',{episodeId:episode,workspaceId:data.workspaceId,expectedRevision:saved.revision,callCommand:command,callData},saved.proposalKey);
   if(proposal.status!==200)return proposal;
   return post('episode-commands','confirmWorkspaceCall',{episodeId:episode,workspaceId:data.workspaceId,expectedRevision:saved.revision,confirmationId:proposal.body.confirmationId},submitKey);
  };
  const scriptText=await readFile('src/local-app/fixtures/story-e2e/umbrella.md','utf8');
  const sourceDirectory=join(f.root,'story-source');await mkdir(sourceDirectory);
  const files={first:join(sourceDirectory,'站台黄伞.png'),second:join(sourceDirectory,'伞柄纸条.png'),candidate:join(sourceDirectory,'候选黄伞.png'),video:join(sourceDirectory,'纸条轻晃.mp4'),voice:join(sourceDirectory,'温暖旁白.mp3')};
  // Distinct deterministic media made for this story, never earlier acceptance outputs.
  const station='color=c=0x14283f:s=360x640,drawbox=x=35:y=380:w=290:h=20:color=0x815d45:t=fill,drawbox=x=60:y=400:w=15:h=90:color=0x815d45:t=fill,drawbox=x=280:y=400:w=15:h=90:color=0x815d45:t=fill,drawbox=x=155:y=220:w=120:h=45:color=0xffd43b:t=fill,drawbox=x=210:y=265:w=8:h=150:color=0xffd43b:t=fill';
  const note='color=c=0x14283f:s=360x640,drawbox=x=150:y=90:w=14:h=470:color=0xffd43b:t=fill,drawbox=x=170:y=270:w=145:h=100:color=white:t=fill';
  for(const [file,filter]of [[files.first,station],[files.second,note],[files.candidate,station+',drawbox=x=15:y=15:w=330:h=8:color=0xffd43b:t=fill']])await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',filter,'-frames:v','1',file]);
  await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',note,'-t','4','-r','30','-c:v','libx264','-pix_fmt','yuv420p',files.video]);
  await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=660:sample_rate=48000','-t','2.5','-c:a','libmp3lame',files.voice]);
  const importFile=async(path:string,type:string,purpose:string,isMainScript=false)=>ok(request('importMaterial',{sourceKind:'file',sourcePath:path.split('/').at(-1),materialType:type,materialPurpose:purpose,mimeType:type==='image'?'image/png':type==='video'?'video/mp4':type==='audio'?'audio/mpeg':'text/markdown',isMainScript,contentBase64:(await readFile(path)).toString('base64')}));
  const materials={first:await importFile(files.first,'image','visual_reference'),second:await importFile(files.second,'image','visual_reference')};
  let script:string|null=null,w:ProductionWorkspace|undefined;
  if(!options.blank){
   script=(await ok(request('importMaterial',{sourceKind:'file',sourcePath:'末班车前的一把伞.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from(scriptText).toString('base64')}))).id;
   await ok(request('start'));w=await ok(request('prepareWorkspace',{expectedScriptRevisionId:script}));
  }
  const selections:Record<string,any>={};
  for(const [capability,provider,adapter,model,endpoint]of [
   ['image','openai','openai_images','gpt-image-2','https://api.openai.com/v1'],
   ['video','volcengine','seedance_video','doubao-seedance-2-0-260128','https://ark.cn-beijing.volces.com/api/v3'],
   ['speech','volcengine_tts','volcengine_tts','seed-tts-2.0','https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse'],
  ]){
   const connection=randomUUID(),version=randomUUID(),secret=randomUUID();
   await f.c.query('BEGIN');await f.c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);
   await f.c.query('INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,$2,$3,$4,$5,$6,$7)',[connection,provider,adapter,'雨伞故事受控'+capability,f.owner,version,endpoint]);
   await f.c.query('INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES($1,$2,1,$3,$4,$5,$6)',[version,connection,provider,adapter,endpoint,secret]);
   await f.c.query("INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES($1,$2,$3,'keychain')",[version,f.owner,secret]);
   await f.c.query('INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified) VALUES($1,$2,true)',[version,f.owner]);
   await f.c.query("INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome) VALUES($1,$2,'live','verified')",[version,f.owner]);await f.c.query('COMMIT');
   selections[capability]={capability,provider,adapter,model,connectionVersionId:version};
  }
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,1)');
  const mode=join(f.root,'provider-mode'),submissions=join(f.root,'provider-submissions.jsonl'),modulePath=join(f.root,'story-provider.mjs');
  await writeFile(mode,'success');
  await writeFile(modulePath,`import{readFileSync,appendFileSync}from'node:fs';
export async function createNarrationPorts(){return{mode:'controlled',store:{mode:'keychain',get:async()=> 'synthetic-story-only'},fetcher:async(url,init={})=>{
 const host=new URL(String(url)).hostname;
 if(init.method==='POST'){
  const action=readFileSync(${JSON.stringify(mode)},'utf8');appendFileSync(${JSON.stringify(submissions)},JSON.stringify({url:String(url),body:JSON.parse(init.body),action})+'\\n');
  if(action==='unknown')throw Error('Story provider accepted but response was lost');
  if(action==='reject')return new Response('Story provider definite rejection',{status:400});
  if(host==='api.openai.com')return Response.json({data:Array.from({length:JSON.parse(init.body).n},()=>({b64_json:readFileSync(${JSON.stringify(files.candidate)}).toString('base64')}))});
  if(host==='openspeech.bytedance.com')return new Response('data: '+JSON.stringify({code:0,data:readFileSync(${JSON.stringify(files.voice)}).toString('base64')})+'\\n');
  return Response.json({id:'story-umbrella-remote-task'});
 }
 if(host==='ark.cn-beijing.volces.com'){if(readFileSync(${JSON.stringify(mode)},'utf8')==='poll-fail')throw Error('Story poll interrupted');return Response.json({status:'succeeded',content:{video_url:'https://result.volccdn.com/story.mp4'}});}
 if(host==='result.volccdn.com')return new Response(readFileSync(${JSON.stringify(files.video)}),{headers:{'content-type':'video/mp4'}});
 throw Error('Uncontrolled provider destination: '+host);
}};}`);
  const worker=f.workerPool();
  const read=async()=>{const r=await fetch(f.origin+`/api/local/episodes/${episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});assert.equal(r.status,200);w=(await r.json()).workspace;return w!;};
  const send=async(command:string,data:Record<string,unknown>={},key?:string)=>{const result=await request(command,{...(w?{workspaceId:w.id,expectedRevision:w.revision}:{}),...data},key);if(result.status===200&&result.body?.id===w?.id)w=result.body;return result;};
  const execute=async(taskId:string)=>{
   const task=(await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:taskId,p_worker_capacity:1}) as any[])[0];assert.ok(task,'Real Worker must claim the submitted story task');
   const result=await runWorkspaceDeliveryProcess(f,task,{mountPath:volume.mountPath,visualCommand:[process.execPath,'--version'],narration:{mode:'controlled',modulePath},media:{mode:'controlled',modulePath}});
   if(process.env.LOOP_STORY_EVIDENCE)await writeFile(join(process.env.LOOP_STORY_EVIDENCE,taskId+'-worker.json'),JSON.stringify(result,null,2));
   return result;
  };
  const fill=async()=>{
   for(const [index,clip]of w!.clips.entries()){
    await ok(send('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:index===0?materials.first.id:materials.second.id,usage:'still',durationSeconds:3,fit:'contain',focusX:0,focusY:0}));
    await ok(send('saveWorkspaceNarration',{clipId:clip.id,mode:'none',text:storyLines[index]}));
    const caption=defaultShotCaptionContract(storyLines[index],'independent');
    caption.cues=[{id:'story-line-'+index,text:storyLines[index],startMs:100,endMs:2800}];
    await ok(send('saveWorkspaceCaptions',{clipId:clip.id,captionContract:caption}));
   }
   return read();
  };
  return{...f,volume,episode,account,series,assetRoot,script,scriptText,files,materials,selections,mode,submissions,post,request,send,read,ok,fill,execute,importFile,get workspace(){return w!;},close:resources.close};
 }catch(error){return resources.fail(error);}
}
