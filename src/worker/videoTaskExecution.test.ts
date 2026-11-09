// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import {generateWanVideo,type WanVideoInput} from './wanVideoProvider';
import {generateOfficialVideo} from './officialVideoProvider';
import type {MediaFetcher} from './mediaProviders';
import {ProviderOutcomeUnknownError} from './providerOutcome';

const providers=['bailian','volcengine','minimax','kling'] as const;
type Provider=typeof providers[number];
const resultOrigins={bailian:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com',volcengine:'https://result.volccdn.com',minimax:'https://video-product.cdn.minimax.io',kling:'https://v.klingai.com'};
const models={volcengine:'doubao-seedance-2-0-260128',minimax:'MiniMax-H3',kling:'kling-v3'};
function completed(provider:Provider,url:string){
 return Response.json(provider==='bailian'?{output:{task_status:'SUCCEEDED',video_url:url}}:provider==='volcengine'?{status:'succeeded',content:{video_url:url}}:provider==='minimax'?{task:{status:'succeeded',content:{url}}}:{code:0,data:{task_status:'succeed',task_result:{videos:[{url}]}}});
}
function submitted(provider:Provider,id:unknown){return Response.json(provider==='bailian'?{output:{task_id:id}}:provider==='volcengine'?{id}:provider==='minimax'?{task_id:id}:{code:0,data:{task_id:id}});}
type ExecutionOverrides=Partial<Pick<WanVideoInput,'reserve'|'recordSubmission'|'sleep'|'maxPolls'|'onProgress'>>;
function generate(provider:Provider,fetcher:MediaFetcher,overrides:ExecutionOverrides={}){
 const input={credentials:'synthetic-video-key',image:Uint8Array.of(1,2),imageMime:'image/png',prompt:'保持原图',durationSeconds:5,fetcher,reserve:async()=>({new:false,provider_task_id:'original-task'}),recordSubmission:vi.fn(async()=>{}),sleep:vi.fn(async()=>{}),maxPolls:2,...overrides};
 return provider==='bailian'?generateWanVideo(input):generateOfficialVideo({...input,provider,model:models[provider]});
}

describe.each(providers)('%s video execution contract',provider=>{
 it('resumes the original task and follows a relative result redirect without sending credentials',async()=>{
  const origin=resultOrigins[provider],requests:string[]=[],record=vi.fn(async()=>{});
  const fetcher:MediaFetcher=async(value,init={})=>{
   const url=new URL(value);expect(init.method).not.toBe('POST');
   if(url.origin!==origin){expect(url.pathname.endsWith('/original-task')).toBe(true);return completed(provider,origin+'/start.mp4');}
   requests.push(url.href);expect(new Headers(init.headers).has('Authorization')).toBe(false);expect(init.redirect).toBe('manual');expect(init.signal).toBeInstanceOf(AbortSignal);
   return requests.length===1?new Response(null,{status:302,headers:{Location:'./final.mp4'}}):new Response(Uint8Array.of(4,5),{headers:{'content-type':'video/mp4'}});
  };
  expect(await generate(provider,fetcher,{recordSubmission:record})).toEqual(Uint8Array.of(4,5));
  expect(requests).toEqual([origin+'/start.mp4',origin+'/final.mp4']);expect(record).not.toHaveBeenCalled();
 });

 it.each(['foreign-redirect','redirect-loop','http','mime','declared-length','stream-length','empty','read-error'] as const)('preserves download rejection and stream cleanup for %s',async kind=>{
  const origin=resultOrigins[provider],cancel=vi.fn(async()=>{throw Error('cancel failed');});let downloads=0;
  const fetcher:MediaFetcher=async(value)=>{
   if(new URL(value).origin!==origin)return completed(provider,origin+'/result.mp4');
   downloads++;
   if(kind==='foreign-redirect')return new Response(null,{status:302,headers:{Location:'https://outside.invalid/result.mp4'}});
   if(kind==='redirect-loop')return new Response(null,{status:302,headers:{Location:'./result.mp4'}});
   if(kind==='http')return new Response(null,{status:503});
   if(kind==='mime')return new Response('html',{headers:{'content-type':'text/html'}});
   if(kind==='declared-length')return new Response('x',{headers:{'content-type':'video/mp4','content-length':'104857601'}});
   if(kind==='empty')return new Response(new Uint8Array(),{headers:{'content-type':'video/mp4'}});
   const chunk=new Uint8Array(64*1024);
   return new Response(new ReadableStream<Uint8Array>({pull(controller){if(kind==='read-error')controller.error(Error('result stream broke'));else controller.enqueue(chunk);},cancel}),{headers:{'content-type':'video/mp4'}});
  };
  const wan=provider==='bailian',expected=kind==='foreign-redirect'?(wan?'万相视频地址不属于官方结果存储域名。':'视频下载地址不属于对应供应商。'):kind==='redirect-loop'?(wan?'万相结果地址重定向次数过多。':'视频下载重定向过多。'):kind==='stream-length'?(wan?'万相视频超过本机 100MB 单镜头限制。':'视频超过 100MB 限制。'):kind==='empty'?(wan?'万相下载视频为空。':'下载视频为空。'):kind==='read-error'?'result stream broke':wan?'万相视频下载失败或响应不是有效 MP4。':'视频下载不是有效 MP4。';
  await expect(generate(provider,fetcher)).rejects.toThrow(expected);
  expect(downloads).toBe(kind==='redirect-loop'?4:1);
  if(kind==='stream-length')expect(cancel).toHaveBeenCalledOnce();
 });

 it('reserves, awaits durable task registration, polls with its own cadence and reports progress before downloading',async()=>{
  const events:string[]=[],origin=resultOrigins[provider];let polls=0;
  const fetcher:MediaFetcher=async(value,init={})=>{
   if(init.method==='POST'){events.push('POST');return submitted(provider,'new-task');}
   if(new URL(value).origin===origin){events.push('download');return new Response(Uint8Array.of(1),{headers:{'content-type':'video/mp4'}});}
   expect(new URL(value).pathname.endsWith('/new-task')).toBe(true);events.push('poll');polls++;
   if(polls>2)return completed(provider,origin+'/result.mp4');
   return Response.json(provider==='bailian'?{output:{task_status:polls===1?'PENDING':'RUNNING'}}:provider==='volcengine'?{status:polls===1?'queued':'running'}:provider==='minimax'?{task:{status:polls===1?'submitted':'processing'}}:{code:0,data:{task_status:polls===1?'pending':'processing'}});
  };
  expect(await generate(provider,fetcher,{maxPolls:undefined,reserve:async()=>{events.push('reserve');return{new:true};},recordSubmission:async id=>{expect(id).toBe('new-task');events.push('record-start');await Promise.resolve();events.push('record-end');},onProgress:async phase=>{events.push(phase);},sleep:async ms=>{events.push('sleep:'+ms);}})).toEqual(Uint8Array.of(1));
  const waits=provider==='bailian'?['sleep:5000','sleep:6000']:['sleep:10000','sleep:10000'];
  expect(events).toEqual(['reserve','POST','record-start','record-end','poll','queued',waits[0],'poll','processing',waits[1],'poll','saving','download']);
 });

 it.each(['reserve','POST','record','poll','saving','download'] as const)('stops at a failed %s without retrying or swallowing the original failure',async stage=>{
  const failure=stage==='POST'?new ProviderOutcomeUnknownError():Error(stage+' interrupted'),events:string[]=[],origin=resultOrigins[provider];
  const step=(name:string)=>{events.push(name);if(name===stage)throw failure;};
  const fetcher:MediaFetcher=async(value,init={})=>{
   if(init.method==='POST'){step('POST');return submitted(provider,'new-task');}
   if(new URL(value).origin===origin){step('download');return new Response('video',{headers:{'content-type':'video/mp4'}});}
   step('poll');return completed(provider,origin+'/result.mp4');
  };
  await expect(generate(provider,fetcher,{reserve:async()=>{step('reserve');return{new:true};},recordSubmission:async()=>{step('record');},onProgress:async phase=>{step(phase);}})).rejects.toBe(failure);
  const expected={reserve:['reserve'],POST:['reserve','POST'],record:['reserve','POST','record'],poll:['reserve','POST','record','poll'],saving:['reserve','POST','record','poll','saving'],download:['reserve','POST','record','poll','saving','download']};
  expect(events).toEqual(expected[stage]);
 });

 it.each(['unknown','invalid-saved','invalid-submitted'] as const)('blocks %s task identity before any follow-up request',async state=>{
  const fetcher=vi.fn<MediaFetcher>(async()=>submitted(provider,undefined)),record=vi.fn(async()=>{});
  const reserve=async()=>state==='unknown'?{new:false}:state==='invalid-saved'?{new:false,provider_task_id:'bad/id'}:{new:true};
  await expect(generate(provider,fetcher,{reserve,recordSubmission:record})).rejects.toThrow(state==='unknown'?'提交结果未知':'任务 ID');
  expect(fetcher).toHaveBeenCalledTimes(state==='invalid-submitted'?1:0);expect(record).not.toHaveBeenCalled();
 });

 it('continues a recorded task beyond sixty polls and preserves the original provider ID',async()=>{
  const origin=resultOrigins[provider],record=vi.fn(async()=>{}),sleep=vi.fn(async()=>{});let polls=0;
  const fetcher:MediaFetcher=async(value,init={})=>{
   expect(init.method).not.toBe('POST');
   if(new URL(value).origin===origin)return new Response(Uint8Array.of(9),{headers:{'content-type':'video/mp4'}});
   expect(new URL(value).pathname.endsWith('/original-task')).toBe(true);polls++;
   return polls>61?completed(provider,origin+'/result.mp4'):Response.json(provider==='bailian'?{output:{task_status:'RUNNING'}}:provider==='volcengine'?{status:'running'}:provider==='minimax'?{task:{status:'processing'}}:{code:0,data:{task_status:'processing'}});
  };
  expect(await generate(provider,fetcher,{maxPolls:undefined,recordSubmission:record,sleep})).toEqual(Uint8Array.of(9));expect(polls).toBe(62);expect(sleep).toHaveBeenCalledTimes(61);expect(record).not.toHaveBeenCalled();
 });

 it('resumes a failed download with its recorded ID and only one paid POST',async()=>{
  const origin=resultOrigins[provider],failure=Error('download disconnected'),queries:string[]=[];let id:string|undefined,posts=0,broken=true;
  const record=vi.fn(async(value:string)=>{id=value;}),fetcher:MediaFetcher=async(value,init={})=>{
   if(init.method==='POST'){posts++;return submitted(provider,'durable-task');}
   if(new URL(value).origin===origin){if(broken)throw failure;return new Response(Uint8Array.of(8),{headers:{'content-type':'video/mp4'}});}
   queries.push(new URL(value).pathname);return completed(provider,origin+'/result.mp4');
  };
  const ports={reserve:async()=>({new:!id,provider_task_id:id}),recordSubmission:record};
  await expect(generate(provider,fetcher,ports)).rejects.toBe(failure);broken=false;
  expect(await generate(provider,fetcher,ports)).toEqual(Uint8Array.of(8));expect(posts).toBe(1);expect(record).toHaveBeenCalledOnce();expect(queries).toHaveLength(2);expect(queries.every(path=>path.endsWith('/durable-task'))).toBe(true);
 });
});
