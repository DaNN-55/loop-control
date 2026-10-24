import {EventEmitter} from 'node:events';
import {beforeEach,it,expect,vi} from 'vitest';
const {request}=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('node:https',()=>({request,default:{request}}));
import {createPexelsLiveProbe,type PexelsProbeEvent} from './pexelsLiveProbe';
const input={provider:'pexels',adapter:'pexels_video',endpoint:'https://api.pexels.com',secret:'synthetic-unit-only'};
const metadata={page:1,per_page:1,videos:[{id:123,duration:4,video_files:[{file_type:'video/mp4'}]}]};
beforeEach(()=>request.mockReset());
function respond(status:number,body:unknown,headers={'content-type':'application/json'}){
 request.mockImplementation((_url,_options,callback)=>{
  const req=Object.assign(new EventEmitter(),{destroy:vi.fn(),end:()=>{const res=Object.assign(new EventEmitter(),{statusCode:status,headers});callback(res);res.emit('data',Buffer.from(typeof body==='string'?body:JSON.stringify(body)));res.emit('end');}});return req;
 });
}
it('refuses unsupported adapters and a closed deployment budget before touching the network',async()=>{
 const reserveRequest=vi.fn(()=>false),probe=createPexelsLiveProbe({reserveRequest});
 expect(await probe.verify({...input,provider:'other'})).toBe('retryable');expect(reserveRequest).not.toHaveBeenCalled();
 expect(await probe.verify(input)).toBe('retryable');expect(request).not.toHaveBeenCalled();
});
it('uses exactly one pinned authenticated GET and grants success only for video metadata',async()=>{
 respond(200,metadata);const reserveRequest=vi.fn(()=>true),events:PexelsProbeEvent[]=[];
 expect(await createPexelsLiveProbe({reserveRequest,record:e=>events.push(e)}).verify(input)).toBe('verified');
 expect(reserveRequest).toHaveBeenCalledTimes(1);expect(request).toHaveBeenCalledTimes(1);
 expect(request.mock.calls[0].slice(0,2)).toEqual(['https://api.pexels.com/v1/videos/search?query=nature&per_page=1',{method:'GET',agent:false,headers:{Authorization:input.secret,Accept:'application/json'}}]);
 expect(events).toEqual([{code:'response',status:200,bytes:Buffer.byteLength(JSON.stringify(metadata)),outcome:'verified',videoId:123}]);
});
it.each([401,403,429,500,302])('handles HTTP %s without retries, redirects or reflected Provider diagnostics',async status=>{
 respond(status,{error:input.secret});const events:PexelsProbeEvent[]=[];
 expect(await createPexelsLiveProbe({reserveRequest:()=>true,record:e=>events.push(e)}).verify(input)).toBe(status===401?'invalid':'retryable');
 expect(request).toHaveBeenCalledTimes(1);expect(JSON.stringify(events)).not.toContain(input.secret);
});
it.each(['not-json',{page:1,per_page:1,videos:[]}])('rejects malformed or empty JSON metadata',async body=>{
 respond(200,body);expect(await createPexelsLiveProbe({reserveRequest:()=>true}).verify(input)).toBe('retryable');
});
it('rejects non-JSON content type even if its body resembles metadata',async()=>{
 respond(200,metadata,{'content-type':'text/html'});expect(await createPexelsLiveProbe({reserveRequest:()=>true}).verify(input)).toBe('retryable');
});
it('bounds response size and drops transport error text',async()=>{
 respond(200,'x'.repeat(262145));const events:PexelsProbeEvent[]=[];
 expect(await createPexelsLiveProbe({reserveRequest:()=>true,record:e=>events.push(e)}).verify(input)).toBe('retryable');
 request.mockImplementationOnce(()=>{throw Error(input.secret);});
 expect(await createPexelsLiveProbe({reserveRequest:()=>true,record:e=>events.push(e)}).verify(input)).toBe('retryable');expect(JSON.stringify(events)).not.toContain(input.secret);
});
