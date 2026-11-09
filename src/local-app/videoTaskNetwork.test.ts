// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {mkdtemp,realpath,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {generateWanVideo} from '../worker/wanVideoProvider';
import {generateOfficialVideo} from '../worker/officialVideoProvider';
import type {MediaFetcher} from '../worker/mediaProviders';
import {createWorkspaceGenerationFetcher,createVideoContinuationFetcher} from './providerNetwork';

const providers=['bailian','kling'] as const;
type Provider=typeof providers[number];
const origins={bailian:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com',kling:'https://v.klingai.com'};
function complete(provider:Provider){const url=origins[provider]+'/result.mp4';return Response.json(provider==='bailian'?{output:{task_status:'SUCCEEDED',video_url:url}}:{code:0,data:{task_status:'succeed',task_result:{videos:[{url}]}}});}
function run(provider:Provider,fetcher:MediaFetcher){
 const input={credentials:'synthetic-video-key',image:Uint8Array.of(1,2),imageMime:'image/png',prompt:'保持原图',durationSeconds:5,fetcher,reserve:async()=>({new:false,provider_task_id:'original-task'}),recordSubmission:vi.fn(async()=>{}),maxPolls:1};
 return provider==='bailian'?generateWanVideo(input):generateOfficialVideo({...input,provider,model:'kling-v3'});
}

it.each(providers.flatMap(provider=>(['redirect','invalid-length','oversized','wrong-task'] as const).map(fault=>({provider,fault}))))('$provider retains the live network restriction on $fault through the real generator',async({provider,fault})=>{
 const reserve=vi.fn(async()=>{}),transport=vi.fn<MediaFetcher>(async(value,init={})=>{
  expect(init.method).not.toBe('POST');
  if(new URL(value).origin!==origins[provider])return complete(provider);
  if(fault==='redirect')return new Response(null,{status:302,headers:{Location:origins[provider]+'/next.mp4'}});
  return new Response('video',{headers:{'content-type':'video/mp4','content-length':fault==='invalid-length'?'invalid':'104857601'}});
 });
 const fetcher=createWorkspaceGenerationFetcher(provider,{reserve,videoTaskId:()=>fault==='wrong-task'?'another-task':'original-task'},transport);
 await expect(run(provider,fetcher)).rejects.toThrow();expect(transport).toHaveBeenCalledTimes(fault==='wrong-task'?0:2);expect(reserve).not.toHaveBeenCalled();
});

async function continuationFixture(provider:Provider,timeoutMs=1000){
 const directory=await realpath(await mkdtemp(join(tmpdir(),'video-continuation-contract-')));
 const limit={maxRequests:1,maxBytes:1024,timeoutMs,costMicrounits:0},policy={version:1,runId:'video-contract',enabled:true,expiresAt:'2020-01-01T00:00:00Z',maxRequests:3,currency:'CNY',maxCostMicrounits:10,priceEvidenceSha256:'a'.repeat(64),approvalSha256:'b'.repeat(64),providers:[provider],operations:{[provider+'.generate']:{...limit,costMicrounits:10},[provider+'.poll']:limit,[provider+'.download']:limit}},bytes=JSON.stringify(policy),policySha256=createHash('sha256').update(bytes).digest('hex');
 const state=JSON.stringify({version:1,policySha256,used:1,costMicrounits:10,byOperation:{[provider+'.generate']:1},halted:false,events:[]});
 await writeFile(join(directory,'policy.json'),bytes,{mode:0o600});await writeFile(join(directory,'state.json'),state,{mode:0o600});
 return{directory,configuration:{directory,policySha256},state};
}

it.each(providers)('%s completes the original task under an expired new-submission grant without changing its network ledger',async provider=>{
 const f=await continuationFixture(provider);
 try{
  const transport=vi.fn<MediaFetcher>(async(value,init={})=>{expect(init.method).not.toBe('POST');if(new URL(value).origin!==origins[provider]){expect(new URL(value).pathname.endsWith('/original-task')).toBe(true);return complete(provider);}expect(new Headers(init.headers).has('Authorization')).toBe(false);return new Response(Uint8Array.of(7),{headers:{'content-type':'video/mp4'}});});
  expect(await run(provider,createVideoContinuationFetcher(f.configuration,provider,'original-task',transport))).toEqual(Uint8Array.of(7));expect(transport).toHaveBeenCalledTimes(2);expect(await readFile(join(f.directory,'state.json'),'utf8')).toBe(f.state);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});

it.each(providers)('%s observes the stricter continuation policy timeout while querying its original task',async provider=>{
 const f=await continuationFixture(provider,10);
 try{
  const transport=vi.fn<MediaFetcher>(async(_value,init)=>new Promise((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true});}));
  await expect(run(provider,createVideoContinuationFetcher(f.configuration,provider,'original-task',transport))).rejects.toMatchObject({name:'TimeoutError'});expect(transport).toHaveBeenCalledOnce();
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
