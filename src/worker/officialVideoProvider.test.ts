// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {videoProviders} from './videoProviderCatalog';
import {generateOfficialVideo,officialVideoBody,videoAuthorization,officialVideoDownloadUrl} from './officialVideoProvider';
import {officialVideoOperation} from '../local-app/officialVideoNetwork';
const image=Uint8Array.from([1,2,3]);
describe('official video protocols',()=>{
 it.each(Object.entries(videoProviders))('%s submits once, saves ID, polls and downloads without credentials',async(provider,p)=>{
  const kind=provider as keyof typeof videoProviders;
  const url=kind==='volcengine'?'https://result.volccdn.com/a.mp4':kind==='minimax'?'https://video-product.cdn.minimax.io/a.mp4':'https://v.klingai.com/a.mp4';
  const created=kind==='volcengine'?{id:'task-1'}:kind==='minimax'?{task_id:'task-1'}:{code:0,data:{task_id:'task-1'}};
  const completed=kind==='volcengine'?{status:'succeeded',content:{video_url:url}}:kind==='minimax'?{task:{status:'succeeded',content:{url}}}:{code:0,data:{task_status:'succeed',task_result:{videos:[{url}]}}};
  const calls:string[]=[],record=vi.fn(async()=>{calls.push('saved');});
  const fetcher=vi.fn(async(input:string|URL,init:RequestInit={})=>{const u=new URL(input);calls.push(officialVideoOperation(kind,'execute',u,init));if(init.method==='POST')return Response.json(created);if(u.origin===new URL(p.endpoint).origin)return Response.json(completed);expect(new Headers(init.headers).has('Authorization')).toBe(false);return new Response(new Uint8Array([1,2]),{headers:{'content-type':'video/mp4'}});});
  const input={provider:kind,model:p.models[0],credentials:'synthetic-key',fetcher,image,imageMime:'image/png',prompt:'A slow turn',durationSeconds:5,reserve:async()=>({new:true}),recordSubmission:record};
  expect(await generateOfficialVideo(input)).toEqual(new Uint8Array([1,2]));expect(calls).toEqual(['generate','saved','poll','download']);expect(record).toHaveBeenCalledWith('task-1');
  calls.length=0;await generateOfficialVideo({...input,reserve:async()=>({new:false,provider_task_id:'task-1'})});expect(calls).toEqual(['poll','download']);
  fetcher.mockClear();await expect(generateOfficialVideo({...input,reserve:async()=>({new:false})})).rejects.toThrow('结果未知');expect(fetcher).not.toHaveBeenCalled();
 });
 it('validates before reservation and blocks nonofficial result hosts',async()=>{
  const reserve=vi.fn();await expect(generateOfficialVideo({provider:'minimax',model:'MiniMax-H3',image,imageMime:'image/png',prompt:'test',durationSeconds:3,credentials:'key',fetcher:vi.fn(),reserve,recordSubmission:vi.fn()})).rejects.toThrow();expect(reserve).not.toHaveBeenCalled();
  for(const provider of Object.keys(videoProviders) as (keyof typeof videoProviders)[]){expect(()=>officialVideoDownloadUrl(provider,'https://localhost/a.mp4')).toThrow();expect(()=>officialVideoDownloadUrl(provider,'https://evil.test/a.mp4')).toThrow();}
 });
 it('supports current Kling API Key and legacy signed credentials',()=>{
  expect(videoAuthorization('kling','key')).toBe('Bearer key');const token=videoAuthorization('kling','access:secret').slice(7).split('.');expect(JSON.parse(Buffer.from(token[1],'base64url').toString()).iss).toBe('access');
 });
 it('freezes official model IDs and distinct output formats',()=>{
  const base={image,imageMime:'image/png',prompt:'test',durationSeconds:5};
  expect(officialVideoBody({...base,provider:'minimax',model:'MiniMax-H3'})).toMatchObject({resolution:'768P',content:[{type:'text'},{role:'first_frame'}]});
  expect(officialVideoBody({...base,provider:'kling',model:'kling-v3'})).toMatchObject({model_name:'kling-v3',image:'AQID',sound:'off'});
 });
});

it('keeps MiniMax domestic submission and resumed polling on the selected site',async()=>{
 const seen:string[]=[],fetcher=vi.fn(async(input:string|URL,init:RequestInit={})=>{
  const url=new URL(input);seen.push(officialVideoOperation('minimax','execute',url,init));
  if(url.origin==='https://api.minimax.cn'){
   expect(new Headers(init.headers).get('Authorization')).toBe('Bearer synthetic-cn-key');
   return Response.json(init.method==='POST'?{task_id:'cn-task'}:{task:{status:'succeeded',content:{url:'https://video-product.cdn.minimax.io/cn.mp4'}}});
  }
  expect(new Headers(init.headers).has('Authorization')).toBe(false);
  return new Response(new Uint8Array([1,2]),{headers:{'content-type':'video/mp4'}});
 });
 const input={provider:'minimax' as const,model:'MiniMax-H3',credentials:JSON.stringify({region:'cn',apiKey:'synthetic-cn-key'}),fetcher,image,imageMime:'image/png',prompt:'test',durationSeconds:5,recordSubmission:vi.fn()};
 expect(await generateOfficialVideo({...input,reserve:async()=>({new:true})})).toEqual(new Uint8Array([1,2]));
 expect(seen).toEqual(['generate','poll','download']);seen.length=0;
 await generateOfficialVideo({...input,reserve:async()=>({new:false,provider_task_id:'cn-task'})});expect(seen).toEqual(['poll','download']);
});

it('resumes a completed domestic MiniMax task from its exact OSS result bucket without another submission',async()=>{
 const url='https://algeng-video-infer.oss-cn-shanghai.aliyuncs.com/video/result.mp4?Expires=9999999999&OSSAccessKeyId=synthetic&Signature=synthetic';
 const fetcher=vi.fn(async(input:string|URL,init:RequestInit={})=>{
  expect(init.method).not.toBe('POST');
  expect(officialVideoOperation('minimax','execute',new URL(input),init)).toBe(String(input).startsWith('https://api.minimax.cn/')?'poll':'download');
  if(String(input).startsWith('https://api.minimax.cn/'))return Response.json({task:{status:'succeeded',content:{url}}});
  expect(new Headers(init.headers).has('Authorization')).toBe(false);
  return new Response(new Uint8Array([3,4]),{headers:{'content-type':'video/mp4'}});
 });
 expect(await generateOfficialVideo({provider:'minimax',model:'MiniMax-H3',credentials:JSON.stringify({region:'cn',apiKey:'synthetic'}),fetcher,image,imageMime:'image/png',prompt:'test',durationSeconds:4,reserve:async()=>({new:false,provider_task_id:'existing-task'}),recordSubmission:vi.fn()})).toEqual(new Uint8Array([3,4]));
 expect(fetcher).toHaveBeenCalledTimes(2);
 for(const bad of ['https://another-bucket.oss-cn-shanghai.aliyuncs.com/result.mp4','https://algeng-video-infer.oss-cn-shanghai.aliyuncs.com.evil.test/result.mp4','http://algeng-video-infer.oss-cn-shanghai.aliyuncs.com/result.mp4','https://key@algeng-video-infer.oss-cn-shanghai.aliyuncs.com/result.mp4'])expect(()=>officialVideoDownloadUrl('minimax',bad)).toThrow();
 for(const provider of ['volcengine','kling'] as const)expect(()=>officialVideoDownloadUrl(provider,url)).toThrow();
});
