// @vitest-environment node
import{afterEach,it,expect,vi}from'vitest';
import{createWorkspaceSearchFetcher}from'./providerNetwork';
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
function virtualClock(){vi.useFakeTimers();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const c=new AbortController();setTimeout(()=>c.abort(new DOMException('Controlled clock deadline','TimeoutError')),ms);return c.signal;});}
function delayedResponse(delay:number){return async(_input:unknown,init?:RequestInit)=>new Promise<Response>((resolve,reject)=>{setTimeout(()=>resolve(new Response('complete-preview',{headers:{'content-type':'audio/mpeg'}})),delay);init?.signal?.addEventListener('abort',()=>reject(init.signal!.reason),{once:true});});}
it('a bounded Freesound preview that needs 45 seconds downloads once without being mistaken for invalid audio',async()=>{
 virtualClock();const transport=vi.fn(delayedResponse(45000)),fetcher=createWorkspaceSearchFetcher('freesound',['download'],transport),result=fetcher('https://cdn.freesound.org/previews/833/833140-preview.mp3').then(r=>r.text());const settled=result.then(text=>({text}),error=>({error}));await vi.advanceTimersByTimeAsync(45000);expect(await settled).toEqual({text:'complete-preview'});await expect(fetcher('https://cdn.freesound.org/previews/833/833140-preview.mp3')).rejects.toThrow();expect(transport).toHaveBeenCalledTimes(1);
});
it('Freesound searches retain the shorter deadline and preview responses retain the 20 MiB ceiling',async()=>{
 virtualClock();const search=createWorkspaceSearchFetcher('freesound',['search'],delayedResponse(45000)),outcome=search('https://freesound.org/apiv2/search/?query=stream').then(()=>null,error=>error);await vi.advanceTimersByTimeAsync(31000);expect(await outcome).toMatchObject({name:'TimeoutError'});
 const download=createWorkspaceSearchFetcher('freesound',['download'],async()=>new Response('x',{headers:{'content-length':String(21*1024*1024)}}));await expect(download('https://cdn.freesound.org/previews/1/1-preview.mp3')).rejects.toThrow();
});
