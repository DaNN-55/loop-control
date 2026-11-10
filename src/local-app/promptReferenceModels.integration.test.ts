// @vitest-environment node
import {afterAll,afterEach,beforeAll,expect,it,vi} from 'vitest';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {narrationFixture} from './workspaceNarration.fixture';
import {workspaceImageGenerationFixture} from './workspaceImageGeneration.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {registeredAdapters} from '../worker/registeredAdapters';
import {videoProviders,type VideoProvider} from '../worker/videoProviderCatalog';
import {wanVideoModels,defaultWanModelSettings} from '../wanVideoModels';
import {openAiImageModels} from '../imageGeneration';
import {createWorkspaceGenerationFetcher} from './providerNetwork';

const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
const seam=vi.hoisted(()=>({ports:undefined as any}));
vi.mock('./narrationWorker',async original=>{const actual=await original<typeof import('./narrationWorker')>();return{...actual,narrationPorts:async(...args:Parameters<typeof actual.narrationPorts>)=>seam.ports??actual.narrationPorts(...args)};});
let mediaRoot='',imageA:Buffer,imageB:Buffer,videoBytes:Buffer;
beforeAll(async()=>{
 if(!enabled)return;
 mediaRoot=await mkdtemp('/private/tmp/loop-mention-matrix-');
 imageA=await readFile(workspaceTestMedia('still-striped.png'));
 imageB=(await promisify(execFile)('ffmpeg',['-v','error','-i',workspaceTestMedia('still-striped.png'),'-vf','negate','-frames:v','1','-f','image2pipe','-c:v','png','pipe:1'],{encoding:'buffer'})).stdout;
 expect(imageB.equals(imageA)).toBe(false);
 const path=join(mediaRoot,'six-seconds.mp4');
 await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=red:size=320x180:rate=24','-t','6','-c:v','libx264','-pix_fmt','yuv420p',path]);videoBytes=await readFile(path);
});
afterEach(()=>{seam.ports=undefined;});
afterAll(async()=>{if(mediaRoot)await rm(mediaRoot,{recursive:true,force:true});});
const videoCases=[...Object.entries(videoProviders).flatMap(([provider,p])=>p.models.map(model=>({provider:provider as VideoProvider|'bailian',model}))),...Object.keys(wanVideoModels).map(model=>({provider:'bailian' as const,model}))];

it.skipIf(!enabled).each(videoCases)('$model: every mode carries bound mentions through HTTP, frozen queue, actual Worker and provider request',async({provider,model})=>{
 const f=await narrationFixture(undefined,undefined,{provider,model});try{
  await f.authorize();const ids:string[]=[];
  for(const [sourcePath,bytes,mimeType]of [['A.png',imageA,'image/png'],['B.png',imageB,'image/png'],['V.mp4',videoBytes,'video/mp4']] as const){
   const imported=await f.request('importMaterial',{materialType:mimeType==='video/mp4'?'video':'image',sourceKind:'file',sourcePath,mimeType,contentBase64:bytes.toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(imported.status,JSON.stringify(imported.body)).toBe(200);ids.push(imported.body.id);
  }
  const [a,b,v]=ids,modes=registeredAdapters.productionChoices().find(choice=>choice.provider===provider)?.videoGenerationModes?.[model]??[{id:'first-frame',inputs:{}}];
  for(const mode of modes){
   const calls:any[]=[];let saved:string|undefined;
   const fetcher=createWorkspaceGenerationFetcher(provider,{reserve:async()=>{},videoTaskId:()=>saved},async(url,init={})=>{
    if(init.method==='POST'){calls.push(JSON.parse(String(init.body)));saved='controlled-mention-task';return Response.json({id:saved,task_id:saved,code:0,data:{task_id:saved},output:{task_id:saved}});}
    const host=new URL(url).hostname;
    if(host==='dashscope.aliyuncs.com')return Response.json({output:{task_status:'SUCCEEDED',video_url:'https://dashscope-f4de.oss-accelerate.aliyuncs.com/mentions.mp4'}});
    if(host==='ark.cn-beijing.volces.com')return Response.json({status:'succeeded',content:{video_url:'https://result.volccdn.com/mentions.mp4'}});
    if(host==='api.minimax.io')return Response.json({task:{status:'succeeded',content:{url:'https://cdn.hailuoai.com/mentions.mp4'}}});
    if(host==='api-singapore.klingai.com')return Response.json({code:0,data:{task_status:'succeed',task_result:{videos:[{url:'https://cdn.klingai.com/mentions.mp4'}]}}});
    return new Response(new Uint8Array(videoBytes),{headers:{'content-type':'video/mp4'}});
   });
   seam.ports={mode:'controlled',store:{mode:'keychain',get:async()=> 'synthetic-mention-key'},fetcher};
   const w=await f.read(),durationSeconds=provider==='bailian'?wanVideoModels[model].durations[0]:videoProviders[provider].minDuration;
   const references=mode.id==='references',keyframes=mode.id==='keyframes';
   const prompt=references?'让@图片1 参考@图片2，模仿@视频1':keyframes?'从@图片2 到@图片1':'保持@图片1';
   const bindings=[{token:'@图片1',materialRevisionId:a},...(references||keyframes?[{token:'@图片2',materialRevisionId:b}]:[]),...(references?[{token:'@视频1',materialRevisionId:v}]:[])];
   const visualInputs=keyframes?[{role:'firstFrame',materialRevisionId:b},{role:'lastFrame',materialRevisionId:a}]:[
    {role:'referenceImages',materialRevisionId:b,...(provider==='bailian'?{source:'https://media.example.com/B.png'}:{})},
    {role:'referenceVideos',materialRevisionId:v,...(provider==='minimax'?{}:{source:'https://media.example.com/V.mp4'})},
    {role:'referenceImages',materialRevisionId:a,...(provider==='bailian'?{source:'https://media.example.com/A.png'}:{})},
   ];
   const args={workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,prompt,promptReferences:bindings,durationSeconds,reservationCents:500,...(provider==='minimax'?{videoResolution:'768P'}:{}),...(provider==='bailian'?{videoSettings:defaultWanModelSettings(model)}:{}),...(mode.id==='first-frame'?{firstFrameMaterialRevisionId:a}:{videoMode:mode.id,visualInputs})};
   const queued=await f.chosenRequest('requestWorkspaceVisualCandidate',args);expect(queued.status,JSON.stringify(queued.body)).toBe(200);
   const task=queued.body.visualTasks[0],frozen=(await f.c.query('SELECT request_snapshot FROM local_identity.workspace_visual_candidates WHERE task_id=$1',[task.taskId])).rows[0].request_snapshot;
   await f.execute(task.taskId);const result=await f.read();expect(result.visualTasks.find((entry:any)=>entry.taskId===task.taskId)?.status).toBe('completed');expect(calls).toHaveLength(1);
   const body=calls[0],out=body.prompt??body.input?.prompt??body.content?.[0]?.text;
   const expected=references?({minimax:'让<Picture 2> 参考<Picture 1>，模仿<Video 1>',kling:'让<<<image_2>>> 参考<<<image_1>>>，模仿<<<video_1>>>',volcengine:'让图片2 参考图片1，模仿视频1',bailian:'让character3 参考character1，模仿character2'}[provider]):keyframes?'从首帧图像 到尾帧图像':'保持首帧图像';
   expect(out).toContain(expected);expect(out).not.toMatch(/@(图片|视频)\d/);expect(frozen.actualPrompt).toBe(out);expect(frozen.promptReferences).toEqual(bindings);expect(body.model??body.model_name).toBe(model);
   if(references){
    if(provider==='bailian')expect(body.input.reference_urls).toEqual(['https://media.example.com/B.png','https://media.example.com/V.mp4','https://media.example.com/A.png']);
    else if(provider==='kling'){expect(body.image_list.map((entry:any)=>entry.image_url)).toEqual([imageB.toString('base64'),imageA.toString('base64')]);expect(body.video_list[0].video_url).toBe('https://media.example.com/V.mp4');}
    else{expect(body.content.slice(1).map((entry:any)=>entry.role)).toEqual(['reference_image','reference_video','reference_image']);expect(body.content[1].image_url.url).toBe('data:image/png;base64,'+imageB.toString('base64'));expect(body.content[3].image_url.url).toBe('data:image/png;base64,'+imageA.toString('base64'));expect(body.content[2].video_url.url).toBe(provider==='minimax'?'data:video/mp4;base64,'+videoBytes.toString('base64'):'https://media.example.com/V.mp4');}
   }else if(provider==='bailian')expect(body.input.img_url).toBe('data:image/png;base64,'+imageA.toString('base64'));
   else if(provider==='kling'){expect(body.image).toBe((keyframes?imageB:imageA).toString('base64'));if(keyframes)expect(body.image_tail).toBe(imageA.toString('base64'));}
   else{expect(body.content[1].image_url.url).toBe('data:image/png;base64,'+(keyframes?imageB:imageA).toString('base64'));if(keyframes)expect(body.content[2].image_url.url).toBe('data:image/png;base64,'+imageA.toString('base64'));}
  }
 }finally{await f.close();}
},180000);

it.skipIf(!enabled)('all seven image models preserve bound IDs and reordered distinct image bytes through the actual Worker',async()=>{
 const {f,ref,submissions}=await workspaceImageGenerationFixture();try{
  const second=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'B.png',mimeType:'image/png',contentBase64:imageB.toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(second.status).toBe(200);
  const version=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='openai_images'")).rows[0].id;
  for(const model of openAiImageModels){
   const w=await f.read(),bindings=[{token:'@图片1',materialRevisionId:ref.body.id},{token:'@图片2',materialRevisionId:second.body.id}];
   const args={workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection:{capability:'image',provider:'openai',adapter:'openai_images',model,connectionVersionId:version},prompt:'让@图片1 参考@图片2',promptReferences:bindings,referenceMaterialRevisionIds:[second.body.id,ref.body.id],settings:{size:'1024x1024',quality:'low',count:1},reservationCents:100};
   const queued=await f.request('requestWorkspaceImageCandidates',args);expect(queued.status,JSON.stringify(queued.body)).toBe(200);const task=queued.body.visualTasks[0];
   await f.execute(task.taskId);const call=JSON.parse((await readFile(submissions,'utf8')).trim().split('\n').at(-1)!);
   expect(call.body.model).toBe(model);expect(call.body.prompt).toContain('让参考图 2 参考参考图 1');expect(call.body.prompt).not.toContain('@图片');expect(call.body.images.map((entry:any)=>entry.image_url)).toEqual(['data:image/png;base64,'+imageB.toString('base64'),'data:image/png;base64,'+imageA.toString('base64')]);
   const result=await f.read();expect(result.visualTasks.find((entry:any)=>entry.taskId===task.taskId)?.status).toBe('completed');
  }
 }finally{await f.close();}
},180000);
