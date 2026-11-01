import {beforeEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
const token='a'.repeat(64),episode='92b3067d-ced9-4e85-bc44-1968fa83695a';
beforeEach(()=>{vi.resetModules();sessionStorage.clear();vi.stubGlobal('crypto',webcrypto);});
it('recovers an empty module CSRF after reload before sending a history archive once',async()=>{
 const calls:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  calls.push((init?.method??'GET')+' '+path);
  if(path==='/api/local/session')return Response.json({owner:{id:'owner'},csrfToken:token});
  if(new Headers(init?.headers).get('X-CSRF-Token')!==token)return Response.json({error:'CSRF校验失败。'},{status:403});
  return Response.json({archived:true});
 }));
 // A reloaded helper has no token, while the browser still owns its valid session cookie.
 const {localCommand}=await import('./client');
 await expect(localCommand('archive',{episodeId:episode},undefined,'history-episode-management')).resolves.toEqual({archived:true});
 expect(calls).toEqual(['GET /api/local/session','POST /api/local/history-episode-management']);
});
it('does not refresh a populated token or replay a rejected mutation',async()=>{
 const calls:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  calls.push((init?.method??'GET')+' '+path);
  if(path==='/api/local/session')return Response.json({owner:{id:'owner'},csrfToken:token});
  return Response.json({error:'CSRF校验失败。'},{status:403});
 }));
 const {localCommand,localRequest}=await import('./client');await localRequest('session');calls.length=0;
 await expect(localCommand('archive',{episodeId:episode},undefined,'history-episode-management')).rejects.toThrow('CSRF校验失败。');
 expect(calls).toEqual(['POST /api/local/history-episode-management']);
});
