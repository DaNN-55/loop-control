// @vitest-environment node
import {it,expect,vi,afterEach} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {narrationFixture} from './workspaceNarration.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {registeredAdapters} from '../worker/registeredAdapters';
import {videoProviders,minimaxVideoModels,type VideoProvider} from '../worker/videoProviderCatalog';
import {wanVideoModels,defaultWanModelSettings} from '../wanVideoModels';
import {createWorkspaceGenerationFetcher} from './providerNetwork';
const seam=vi.hoisted(()=>({ports:undefined as any}));
vi.mock('./narrationWorker',async original=>{const actual=await original<typeof import('./narrationWorker')>();return{...actual,narrationPorts:async(...args:Parameters<typeof actual.narrationPorts>)=>seam.ports??actual.narrationPorts(...args)};});
afterEach(()=>{seam.ports=undefined;});
const cases=[...Object.entries(videoProviders).flatMap(([provider,p])=>p.models.map(model=>({provider:provider as VideoProvider|'bailian',model}))),...Object.keys(wanVideoModels).map(model=>({provider:'bailian' as const,model}))];
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1').each(cases)('$model: confirmation → actual Owner HTTP → frozen queue → Worker → network boundary for every mode',async({provider,model})=>{
 const f=await narrationFixture(undefined,undefined,{provider,model});try{
  await f.authorize();
  const resultVideo=join(f.root,'matrix-six-seconds.mp4');await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=red:size=320x180:rate=24','-t','6','-c:v','libx264','-pix_fmt','yuv420p',resultVideo]);
  const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'matrix.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(image.status).toBe(200);
  const modes=registeredAdapters.productionChoices().find(c=>c.provider===provider)?.videoGenerationModes?.[model]??[{id:'first-frame'}];
  for(const mode of modes)for(const videoResolution of provider==='minimax'?minimaxVideoModels[model].resolutions:[undefined]){
   let saved:string|undefined;const calls:any[]=[];
   const fetcher=createWorkspaceGenerationFetcher(provider,{reserve:async()=>{},videoTaskId:()=>saved},async(url,init={})=>{
    if(init.method==='POST'){calls.push(JSON.parse(String(init.body)));saved='matrix-task';return Response.json({id:saved,task_id:saved,code:0,data:{task_id:saved},output:{task_id:saved}});}
    const host=new URL(url).hostname;
    if(host==='dashscope.aliyuncs.com')return Response.json({output:{task_status:'SUCCEEDED',video_url:'https://dashscope-f4de.oss-accelerate.aliyuncs.com/matrix.mp4'}});
    if(host==='ark.cn-beijing.volces.com')return Response.json({status:'succeeded',content:{video_url:'https://result.volccdn.com/matrix.mp4'}});
    if(host==='api.minimax.io')return Response.json({task:{status:'succeeded',content:{url:'https://cdn.hailuoai.com/matrix.mp4'}}});
    if(host==='api-singapore.klingai.com')return Response.json({code:0,data:{task_status:'succeed',task_result:{videos:[{url:'https://cdn.klingai.com/matrix.mp4'}]}}});
    return new Response(await readFile(resultVideo),{headers:{'content-type':'video/mp4'}});
   });
   seam.ports={mode:'controlled',store:{mode:'keychain',get:async()=> 'synthetic-matrix-key'},fetcher};
   const w=await f.read(),durationSeconds=provider==='bailian'?wanVideoModels[model].durations[0]:videoProviders[provider].minDuration;
   const videoSettings=provider==='bailian'?{...defaultWanModelSettings(model),negativePrompt:'不要文字',seed:0,watermark:true,...(model==='wan2.6-r2v'?{promptExtend:false}:{})}:undefined;
   const visualInputs=mode.id==='keyframes'?[{role:'firstFrame',materialRevisionId:image.body.id},{role:'lastFrame',materialRevisionId:image.body.id}]:[{role:'referenceImages',materialRevisionId:image.body.id,...(model==='wan2.6-r2v'?{source:'https://cdn.aliyuncs.com/synthetic.png'}:{})}];
   const args={workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,prompt:'移动镜头',durationSeconds,reservationCents:500,...(videoResolution?{videoResolution}:{}),...(videoSettings?{videoSettings}:{}),...(mode.id==='first-frame'?{firstFrameMaterialRevisionId:image.body.id,firstFrameFit:'contain'}:{videoMode:mode.id,visualInputs})};
   const queued=await f.chosenRequest('requestWorkspaceVisualCandidate',args);expect(queued.status,JSON.stringify(queued.body)).toBe(200);const task=queued.body.visualTasks[0];
   await f.execute(task.taskId);const result=await f.read();expect(result.visualTasks.find((t:any)=>t.taskId===task.taskId)?.status).toBe('completed');expect(result.project.sha256).toBe(w.project.sha256);expect(calls).toHaveLength(1);
   const body=calls[0];if(videoResolution){expect(body.resolution).toBe(videoResolution);expect(result.visualTasks.find((t:any)=>t.taskId===task.taskId)?.generation.videoResolution).toBe(videoResolution);if(model==='MiniMax-H3-Lite'&&mode.id==='references')expect(body.ratio).toBe('9:16');}expect(body.model??body.model_name).toBe(model);expect(body.prompt??body.input?.prompt??body.content?.[0]?.text).toContain('移动镜头');
   if(videoSettings){expect(body.input.negative_prompt).toBe('不要文字');expect(body.parameters).toMatchObject({seed:0,watermark:true});}
   if(mode.id==='keyframes'&&provider==='kling')expect(body.image_tail).toBeTruthy();
   const frozen=(await f.c.query('SELECT request_snapshot FROM local_identity.workspace_visual_candidates WHERE task_id=$1',[task.taskId])).rows[0].request_snapshot;expect(frozen.selection.model).toBe(model);
  }
 }finally{await f.close();}
},180000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('shows actual insufficient video duration after real Worker media validation, retaining the supplier task',async()=>{
 const f=await narrationFixture(undefined,undefined,{provider:'bailian',model:'wan2.5-i2v-preview'});try{
  await f.authorize();let id:string|undefined;
  const fetcher=createWorkspaceGenerationFetcher('bailian',{reserve:async()=>{},videoTaskId:()=>id},async(url,init={})=>{
   if(init.method==='POST'){id='short-original';return Response.json({output:{task_id:id}});}
   if(new URL(url).hostname==='dashscope.aliyuncs.com')return Response.json({output:{task_status:'SUCCEEDED',video_url:'https://dashscope-f4de.oss-accelerate.aliyuncs.com/short.mp4'}});
   return new Response(await readFile(workspaceTestMedia('landscape-red-blue.mp4')),{headers:{'content-type':'video/mp4'}});
  });
  seam.ports={mode:'controlled',store:{mode:'keychain',get:async()=> 'synthetic'},fetcher};
  const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'short.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'}),w=await f.read();
  const queued=await f.chosenRequest('requestWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,firstFrameMaterialRevisionId:image.body.id,prompt:'短视频校验',durationSeconds:5,reservationCents:500,videoSettings:defaultWanModelSettings('wan2.5-i2v-preview')});expect(queued.status,JSON.stringify(queued.body)).toBe(200);
  const task=queued.body.visualTasks[0];await f.execute(task.taskId,false);const actual=(await f.read()).visualTasks.find((v:any)=>v.taskId===task.taskId);
  expect(actual).toMatchObject({status:'failed',providerTaskId:'short-original'});expect(actual.error).toContain('实际 4 秒');expect(actual.error).toContain('至少 5 秒');expect(actual.error).not.toContain('媒体执行或产物验证失败');
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('MiniMax candidate retains actual shorter media without pretending it covers the shot',async()=>{
 const f=await narrationFixture(undefined,undefined,{provider:'minimax',model:'MiniMax-H3-Highspeed'});try{
  await f.authorize();const resultVideo=join(f.root,'three-point-seven-five.mp4');await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=red:size=320x480:rate=24','-t','3.75','-c:v','libx264','-pix_fmt','yuv420p',resultVideo]);let id:string|undefined;
  const sourceVideo=join(f.root,'source-six.mp4');await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-stream_loop','-1','-i',resultVideo,'-t','6','-c','copy',sourceVideo]);const sourceMaterial=await f.request('importMaterial',{materialType:'video',sourceKind:'file',sourcePath:'source-six.mp4',mimeType:'video/mp4',contentBase64:(await readFile(sourceVideo)).toString('base64'),isMainScript:false,materialPurpose:'b_roll'});expect(sourceMaterial.status).toBe(200);
  seam.ports={mode:'controlled',store:{mode:'keychain',get:async()=> 'synthetic'},fetcher:createWorkspaceGenerationFetcher('minimax',{reserve:async()=>{},videoTaskId:()=>id},async(url,init={})=>{if(init.method==='POST'){id='short-original';return Response.json({task_id:id});}if(new URL(url).hostname==='api.minimax.io')return Response.json({task:{status:'succeeded',content:{url:'https://cdn.hailuoai.com/short.mp4'}}});return new Response(await readFile(resultVideo),{headers:{'content-type':'video/mp4'}});})};
  const imported=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'short.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});const initial=await f.read(),expanded=await f.request('saveWorkspaceVideoRanges',{workspaceId:initial.id,expectedRevision:initial.revision,shotId:initial.clips[0].shotId,ranges:[{clipId:initial.clips[0].id,materialRevisionId:sourceMaterial.body.id,sourceInFrame:0,durationInFrames:120,durationLocked:false}]});expect(expanded.status,JSON.stringify(expanded.body)).toBe(200);const w=expanded.body;
  const queued=await f.chosenRequest('requestWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,firstFrameMaterialRevisionId:imported.body.id,prompt:'实际视频长度',videoResolution:'480P',durationSeconds:4,reservationCents:150});expect(queued.status).toBe(200);await f.execute(queued.body.visualTasks[0].taskId);const result=await f.read();expect(result.visualTasks[0].status).toBe('completed');expect(result.visualCandidates[0].durationSeconds).toBe(3.75);expect(result.project.sha256).toBe(w.project.sha256);
  const prepared=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:result.id,expectedRevision:result.revision,candidateId:result.visualCandidates[0].id,durationPolicy:'keep-target'});expect(prepared.status).toBeGreaterThanOrEqual(400);
 }finally{await f.close();}
},120000);
