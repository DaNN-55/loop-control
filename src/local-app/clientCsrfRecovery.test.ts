import {beforeEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
const token='a'.repeat(64),episode='92b3067d-ced9-4e85-bc44-1968fa83695a';
beforeEach(()=>{vi.resetModules();sessionStorage.clear();vi.stubGlobal('crypto',webcrypto);});
it('recovers an empty module CSRF after reload before archiving an episode once',async()=>{
 const calls:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  calls.push((init?.method??'GET')+' '+path);
  if(path==='/api/local/session')return Response.json({owner:{id:'owner'},csrfToken:token});
  if(new Headers(init?.headers).get('X-CSRF-Token')!==token)return Response.json({error:'CSRF校验失败。'},{status:403});
  return Response.json({archived:true});
 }));
 // A reloaded helper has no token, while the browser still owns its valid session cookie.
 const {localCommand}=await import('./client');
 await expect(localCommand('archiveEpisode',{episodeId:episode,archived:true},undefined,'episode-lifecycle')).resolves.toEqual({archived:true});
 expect(calls).toEqual(['GET /api/local/session','POST /api/local/episode-lifecycle']);
});
it('does not refresh a populated token or replay a rejected mutation',async()=>{
 const calls:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  calls.push((init?.method??'GET')+' '+path);
  if(path==='/api/local/session')return Response.json({owner:{id:'owner'},csrfToken:token});
  return Response.json({error:'CSRF校验失败。'},{status:403});
 }));
 const {localCommand,localRequest}=await import('./client');await localRequest('session');calls.length=0;
 await expect(localCommand('archiveEpisode',{episodeId:episode,archived:true},undefined,'episode-lifecycle')).rejects.toThrow('CSRF校验失败。');
 expect(calls).toEqual(['POST /api/local/episode-lifecycle']);
});

it.each(['network','server','missing-token'])('allows a new attempt when %s failure prevents CSRF preparation from dispatching a mutation',async failure=>{
 const calls:string[]=[];let unavailable=true;
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  calls.push((init?.method??'GET')+' '+path);
  if(path==='/api/local/session'){
   if(unavailable){if(failure==='network')throw TypeError('session transport unavailable');return failure==='server'?Response.json({error:'session unavailable'},{status:503}):Response.json({owner:{id:'owner'}});}
   return Response.json({owner:{id:'owner'},csrfToken:token});
  }
  if(path==='/api/local/command-receipt')return Response.json({status:'unknown'});
  expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe(token);return Response.json({archived:true});
 }));
 const {localCommand}=await import('./client');
 await expect(localCommand('archiveEpisode',{episodeId:episode,archived:true},undefined,'episode-lifecycle')).rejects.toBeInstanceOf(Error);
 expect(calls.some(c=>c==='POST /api/local/episode-lifecycle')).toBe(false);
 expect(calls.some(c=>c==='POST /api/local/command-receipt')).toBe(false);
 expect(sessionStorage.length).toBe(0);
 unavailable=false;
 await expect(localCommand('archiveEpisode',{episodeId:episode,archived:true},undefined,'episode-lifecycle')).resolves.toEqual({archived:true});
 expect(calls.filter(c=>c==='POST /api/local/episode-lifecycle')).toHaveLength(1);
});
