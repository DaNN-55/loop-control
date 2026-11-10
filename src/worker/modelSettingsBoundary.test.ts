// @vitest-environment node
import {it,expect} from 'vitest';
import {officialVideoBody} from './officialVideoProvider';
import {officialVideoOperation} from '../local-app/officialVideoNetwork';
import {registeredAdapters} from './registeredAdapters';
import {videoProviders,klingOmniPath} from './videoProviderCatalog';
for(const choice of registeredAdapters.productionChoices().filter(c=>['minimax','volcengine','kling'].includes(c.provider)))for(const [model,modes] of Object.entries(choice.videoGenerationModes??{}))for(const mode of modes)it(`${model} / ${mode.id}: registered serializer crosses actual network boundary`,()=>{
 const provider=choice.provider as keyof typeof videoProviders,p=videoProviders[provider];
 const inputs=Object.entries(mode.inputs).filter(([,limit])=>(limit?.min??0)>0||!Object.values(mode.inputs).some(v=>(v?.min??0)>0)).slice(0,mode.id==='keyframes'?2:1).map(([role])=>({role,materialRevisionId:role,image:Uint8Array.of(1,2,3),mimeType:'image/png'})) as any;
 for(const durationSeconds of [p.minDuration,p.maxDuration]){
  const body=officialVideoBody({provider,model,prompt:'边界测试',durationSeconds,referenceRatio:'9:16',...(mode.id==='first-frame'?{image:Uint8Array.of(1),imageMime:'image/png'}:{visualMode:mode.id,visualInputs:inputs})});
  const path=provider==='volcengine'?'/contents/generations/tasks':provider==='minimax'?'/v2/video_generation':model==='kling-v3-omni'?klingOmniPath:'/v1/videos/image2video';
  expect(officialVideoOperation(provider,'execute',new URL(p.endpoint+path),{method:'POST',body:JSON.stringify(body)})).toBe('generate');
 }
});

it('forwards every image model × size × quality × count with and without reference images through network admission',async()=>{
 const {openAiImageModels,imageSizes,openAiImageQualities}=await import('../imageGeneration');
 const {generateOpenAiImages}=await import('./mediaProviders');
 const {createWorkspaceGenerationFetcher}=await import('../local-app/providerNetwork');
 const png=Buffer.from([137,80,78,71,13,10,26,10]);let combinations=0;
 for(const model of openAiImageModels)for(const size of imageSizes)for(const quality of openAiImageQualities(model))for(const count of [1,2,4] as const)for(const edit of [false,true]){
  let calls=0,reserves=0;
  const fetcher=createWorkspaceGenerationFetcher('openai',{reserve:async()=>{reserves++;}},async(url,init)=>{
   calls++;expect(String(url)).toBe(`https://api.openai.com/v1/images/${edit?'edits':'generations'}`);
   const body=JSON.parse(String(init?.body));expect(body).toMatchObject({model,size,quality,n:count,output_format:'png',prompt:'测试'});
   expect(body.images?.length??0).toBe(edit?1:0);
   return Response.json({data:Array.from({length:count},()=>({b64_json:png.toString('base64')}))});
  });
  expect(await generateOpenAiImages({model,apiKey:'synthetic',prompt:'测试',settings:{size,quality,count},references:edit?[{mimeType:'image/png',bytes:png}]:[],fetcher})).toHaveLength(count);
  expect([calls,reserves]).toEqual([1,1]);combinations++;
 }
 expect(combinations).toBe(2400);
},30000);

it('forwards all Wan model duration/resolution/audio/prompt extension/shot/watermark/seed settings through network admission',async()=>{
 const {wanVideoModels,wanVideoSettingsError}=await import('../wanVideoModels');
 const {generateWanVideo}=await import('./wanVideoProvider');
 const {createWorkspaceGenerationFetcher}=await import('../local-app/providerNetwork');
 let combinations=0;
 for(const [model,profile] of Object.entries(wanVideoModels))for(const durationSeconds of profile.durations)for(const resolution of profile.resolutions)for(const audio of [false,true])for(const promptExtend of [false,true])for(const shotType of ['single','multi'] as const)for(const watermark of [false,true]){
  const settings={resolution,audio,promptExtend,shotType,watermark,negativePrompt:'不要文字',seed:2147483647};if(wanVideoSettingsError(model,settings))continue;
  let id:string|undefined,calls=0;
  const fetcher=createWorkspaceGenerationFetcher('bailian',{reserve:async()=>{},videoTaskId:()=>id},async(url,init)=>{
   if(init?.method==='POST'){
    calls++;const body=JSON.parse(String(init.body));expect(body.model).toBe(model);expect(body.input.negative_prompt).toBe('不要文字');expect(body.parameters).toMatchObject({watermark,seed:2147483647});
    if(!profile.fixedDuration)expect(body.parameters.duration).toBe(durationSeconds);
    if(model==='wan2.6-r2v'){expect(body.parameters.size).toBe(resolution==='720P'?'720*1280':'1080*1920');expect(body.input.reference_urls).toEqual(['https://cdn.aliyuncs.com/synthetic.png']);}
    else{expect(body.parameters).toMatchObject({resolution,prompt_extend:promptExtend});if(profile.audio==='optional')expect(body.parameters.audio).toBe(audio);if(profile.multiShot&&promptExtend)expect(body.parameters.shot_type).toBe(shotType);}
    return Response.json({output:{task_id:'matrix-task'}});
   }
   if(new URL(url).hostname==='dashscope.aliyuncs.com')return Response.json({output:{task_status:'SUCCEEDED',video_url:`https://${model==='wan2.2-i2v-plus'?'dashscope-7c2c.oss-cn-shanghai.aliyuncs.com':'dashscope-f4de.oss-accelerate.aliyuncs.com'}/matrix.mp4`}});
   return new Response(Uint8Array.of(1),{headers:{'content-type':'video/mp4'}});
  });
  await generateWanVideo({model,settings,durationSeconds,credentials:'synthetic',prompt:'测试',fetcher,reserve:async()=>({new:true}),recordSubmission:async value=>{id=value;},...(model==='wan2.6-r2v'?{referenceRatio:'9:16',visualInputs:[{role:'referenceImages',materialRevisionId:'ref',source:'https://cdn.aliyuncs.com/synthetic.png'}]}:{image:Uint8Array.of(1),imageMime:'image/png'})});
  expect(calls).toBe(1);combinations++;
 }
 expect(combinations).toBe(620);
},30000);

it('admits the maximum registered reference images and videos, including Seedance asset IDs and MiniMax inline MP4',()=>{
 for(const choice of registeredAdapters.productionChoices().filter(c=>['minimax','volcengine','kling'].includes(c.provider)))for(const [model,modes] of Object.entries(choice.videoGenerationModes??{})){
  const mode=modes.find(m=>m.id==='references');if(!mode)continue;
  const provider=choice.provider as keyof typeof videoProviders,p=videoProviders[provider];
  for(const withVideos of [false,true])for(const referenceRatio of ['16:9','9:16','1:1'] as const){
   const nVideos=withVideos?mode.inputs.referenceVideos?.max??0:0,nImages=Math.min(mode.inputs.referenceImages?.max??0,nVideos?mode.maxImagesWithVideo??Infinity:Infinity);
   const inputs:any[]=[...Array.from({length:nImages},(_,i)=>({role:'referenceImages',materialRevisionId:`img-${i}`,image:Uint8Array.of(1),mimeType:'image/png'})),...Array.from({length:nVideos},(_,i)=>({role:'referenceVideos',materialRevisionId:`vid-${i}`,mimeType:'video/mp4',...(mode.allowInlineMp4?{video:Uint8Array.of(1)}:{source:mode.allowAssetVideoSource?'asset://test-video':'https://cdn.klingai.com/test.mp4'})}))];
   const body=officialVideoBody({provider,model,prompt:'参考素材',durationSeconds:p.minDuration,visualMode:mode.id,visualInputs:inputs,referenceRatio});
   const path=provider==='volcengine'?'/contents/generations/tasks':provider==='minimax'?'/v2/video_generation':klingOmniPath;
   expect(officialVideoOperation(provider,'execute',new URL(p.endpoint+path),{method:'POST',body:JSON.stringify(body)})).toBe('generate');
   expect(()=>officialVideoOperation(provider,'execute',new URL(p.endpoint+path),{method:'POST',body:JSON.stringify({...body,unexpected:true})})).toThrow();
  }
 }
});
