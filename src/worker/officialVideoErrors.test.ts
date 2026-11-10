// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {generateOfficialVideo} from './officialVideoProvider';
it('retains a MiniMax HTTP 200 business rejection instead of reporting a missing task ID',async()=>{
 const record=vi.fn(),fetcher=vi.fn(async()=>Response.json({base_resp:{status_code:1008,status_msg:'insufficient balance'}}));
 await expect(generateOfficialVideo({provider:'minimax',model:'MiniMax-H3',credentials:'synthetic',image:Uint8Array.of(1),imageMime:'image/png',prompt:'转头',durationSeconds:5,reserve:async()=>({new:true}),recordSubmission:record,fetcher})).rejects.toThrow(/MiniMax.*1008.*insufficient balance/);
 expect(fetcher).toHaveBeenCalledOnce();expect(record).not.toHaveBeenCalled();
});
it('sends a registered MiniMax reference image through the real workspace network boundary',async()=>{
 const {createWorkspaceGenerationFetcher}=await import('../local-app/providerNetwork');
 const record=vi.fn(),transport=vi.fn(async(input:string|URL,init:RequestInit={})=>{
  if(init.method==='POST')return Response.json({task_id:'reference-task'});
  if(new URL(input).hostname==='api.minimax.io')return Response.json({task:{status:'succeeded',content:{url:'https://cdn.hailuoai.com/test.mp4'}}});
  return new Response(Uint8Array.of(1,2),{headers:{'content-type':'video/mp4'}});
 });let saved:string|undefined;
 const fetcher=createWorkspaceGenerationFetcher('minimax',{reserve:async()=>{},videoTaskId:()=>saved},transport);
 const result=await generateOfficialVideo({provider:'minimax',model:'MiniMax-H3',credentials:'synthetic',prompt:'转头',durationSeconds:5,visualMode:'references',visualInputs:[{role:'referenceImages',materialRevisionId:'image-1',image:Uint8Array.of(1),mimeType:'image/png'}],reserve:async()=>({new:true}),recordSubmission:async id=>{saved=id;record(id);},fetcher});
 expect(result).toEqual(Uint8Array.of(1,2));expect(transport).toHaveBeenCalledTimes(3);expect(record).toHaveBeenCalledWith('reference-task');
});
it.each([
 {status:402,body:{type:'error',error:{type:'insufficient_balance_error',message:'insufficient balance (1008)',http_code:'402'},request_id:'request-1'},outcome:'rejected',message:'insufficient balance'},
 {status:500,body:{type:'error',error:{type:'server_error',message:'internal error'}},outcome:'unknown',message:'internal error'},
 {status:200,body:{unexpected:'no ID'},outcome:'unknown',message:'任务 ID'},
])('classifies MiniMax $status responses and retains the supplier reason',async({status,body,outcome,message})=>{
 const fetcher=vi.fn(async()=>Response.json(body,{status}));
 const error=await generateOfficialVideo({provider:'minimax',model:'MiniMax-H3',credentials:'synthetic',image:Uint8Array.of(1),imageMime:'image/png',prompt:'转头',durationSeconds:5,reserve:async()=>({new:true}),recordSubmission:vi.fn(),fetcher}).catch(e=>e);
 expect(error).toMatchObject({outcome,message:expect.stringContaining(message)});expect(fetcher).toHaveBeenCalledOnce();
});
it('redacts credentials, inline media and signed URLs in provider errors',async()=>{
 const secret='synthetic-private-key',fetcher=vi.fn(async()=>Response.json({error:{message:`Invalid ${secret} Bearer ${secret} data:image/png;base64,ABC https://example.test/result?Signature=secret`,http_code:'400'},type:'error'},{status:400}));
 const error=await generateOfficialVideo({provider:'minimax',model:'MiniMax-H3',credentials:secret,image:Uint8Array.of(1),imageMime:'image/png',prompt:'转头',durationSeconds:5,reserve:async()=>({new:true}),recordSubmission:vi.fn(),fetcher}).catch(e=>e);
 expect(error.message).toContain('<REDACTED>');for(const value of [secret,'ABC','Signature=secret'])expect(error.message).not.toContain(value);
});
it('retains and redacts an OpenAI structured error',async()=>{
 const {generateOpenAiImages}=await import('./mediaProviders');
 const error=await generateOpenAiImages({apiKey:'synthetic-private',model:'gpt-image-2',prompt:'测试',fetcher:async()=>Response.json({error:{code:'model_not_found',message:'Model unavailable synthetic-private https://example.com/signed?key=private'}},{status:404})}).catch(e=>e);
 expect(error.message).toContain('model_not_found');expect(error.message).toContain('Model unavailable');expect(error.message).not.toContain('synthetic-private');expect(error.message).not.toContain('key=private');
});
it('retains a definite Wan rejection code and request ID instead of a generic media error',async()=>{
 const {generateWanVideo}=await import('./wanVideoProvider');
 const error=await generateWanVideo({credentials:'synthetic-private',image:Uint8Array.of(1),imageMime:'image/png',prompt:'测试',durationSeconds:2,reserve:async()=>({new:true}),recordSubmission:async()=>{},fetcher:async()=>Response.json({code:'InvalidParameter',message:'Invalid input synthetic-private',request_id:'wan-request-1'},{status:400})}).catch(e=>e);
 expect(error).toMatchObject({outcome:'rejected'});expect(error.message).toContain('InvalidParameter');expect(error.message).toContain('wan-request-1');expect(error.message).not.toContain('synthetic-private');
});
it('retains the Wan terminal failure and summarizes vendor stack traces',async()=>{
 const {generateWanVideo}=await import('./wanVideoProvider');let sent=false;
 const error=await generateWanVideo({credentials:'synthetic',image:Uint8Array.of(1),imageMime:'image/png',prompt:'测试',durationSeconds:2,reserve:async()=>({new:true}),recordSubmission:async()=>{},fetcher:async()=>{if(!sent){sent=true;return Response.json({output:{task_id:'failed-task'}});}return Response.json({output:{task_status:'FAILED',code:'AlgoError',message:'Traceback (most recent call last):\n File "/provider/private/file.py"\nTypeError: expected str, not NoneType'}});}}).catch(e=>e);
 expect(error).toMatchObject({outcome:'accepted'});expect(error.message).toContain('AlgoError');expect(error.message).toContain('TypeError');expect(error.message).not.toContain('/provider/private');
});
