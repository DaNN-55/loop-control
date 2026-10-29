// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {createServer} from 'node:http';
import {createManualVerificationFetcher} from './providerNetwork';
import {synthesizeVolcengineTts} from '../worker/mediaProviders';
const url='https://api.pexels.com/v1/videos/search?query=nature&per_page=1';
afterEach(()=>vi.useRealTimers());
it('allows one request per test and rejects content-generation paths, retired providers and alternate hosts',async()=>{
 const transport=vi.fn(async()=>Response.json({}));const fetcher=createManualVerificationFetcher('pexels',transport);
 for(const target of ['https://outside.invalid/v1/videos/search','http://api.pexels.com/v1/videos/search','https://api.pexels.com:444/v1/videos/search'])await expect(fetcher(target)).rejects.toThrow();
 await fetcher(url);await expect(fetcher(url)).rejects.toThrow();expect(transport).toHaveBeenCalledTimes(1);
 await expect(createManualVerificationFetcher('bailian',transport)('https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',{method:'POST',body:'{}'})).rejects.toThrow();
 await expect(createManualVerificationFetcher('google_tts',transport)('https://texttospeech.googleapis.com/v1/voices')).rejects.toThrow();expect(transport).toHaveBeenCalledTimes(1);
});
it.each(['redirect','declared-size','stream-size'])('bounds the manual response on %s without following redirects',async kind=>{
 const transport=vi.fn(async(_url:string|URL,init?:RequestInit)=>{expect(init?.redirect).toBe('manual');return kind==='redirect'?new Response(null,{status:302,headers:{Location:'https://outside.invalid'}}):kind==='declared-size'?new Response('x',{headers:{'content-length':String(1024*1024+1)}}):new Response('x'.repeat(1024*1024+1));});
 await expect(createManualVerificationFetcher('pexels',transport)(url)).rejects.toThrow();expect(transport).toHaveBeenCalledTimes(1);
});
it('times out even when the transport ignores abort, and a subsequent test has a fresh scope',async()=>{
 vi.useFakeTimers();let signal:AbortSignal|null|undefined;
 const transport=vi.fn((_url:string|URL,init?:RequestInit)=>{signal=init?.signal;return new Promise<Response>(()=>{});});
 const pending=createManualVerificationFetcher('pexels',transport)(url);const assertion=expect(pending).rejects.toThrow();
 await vi.advanceTimersByTimeAsync(15000);await assertion;expect(signal?.aborted).toBe(true);
 await expect(createManualVerificationFetcher('pexels',async()=>Response.json({}))(url)).resolves.toBeInstanceOf(Response);
});
it('cancels a real in-flight HTTP request on caller abort',async()=>{
 let received!:()=>void,closed!:()=>void;const requestReceived=new Promise<void>(resolve=>received=resolve),requestClosed=new Promise<void>(resolve=>closed=resolve);
 const server=createServer((request)=>{request.once('close',closed);received();});await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{const port=(server.address()as{port:number}).port,controller=new AbortController();const pending=createManualVerificationFetcher('pexels',(_url,init)=>fetch(`http://127.0.0.1:${port}/probe`,init))(url,{signal:controller.signal});const assertion=expect(pending).rejects.toThrow();await requestReceived;controller.abort();await assertion;await requestClosed;}
 finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it('permits only the fixed TTS sample, not arbitrary short synthesis text',async()=>{
 const transport=vi.fn(async()=>new Response('data: '+JSON.stringify({code:0,data:Buffer.from('ID3sample').toString('base64')})+'\n'));
 const sample=(text:string)=>synthesizeVolcengineTts({apiKey:'synthetic-key',fetcher:createManualVerificationFetcher('volcengine_tts',transport),model:'seed-tts-2.0',text,voice:{languageCode:'zh-CN',name:'zh_female_vv_uranus_bigtts',speakingRate:1}});
 await expect(sample('任意文本')).rejects.toThrow();expect(transport).not.toHaveBeenCalled();await expect(sample('这是一条测试。')).resolves.toBeInstanceOf(Uint8Array);expect(transport).toHaveBeenCalledTimes(1);
});
