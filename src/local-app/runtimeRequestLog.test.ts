// @vitest-environment node
import {expect,it} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {Pool} from 'pg';
import {createLocalHandler} from './localRoute';
import {observeLocalRequest,recordValidatedRequestLogContext,type RuntimeRequestLogEvent} from './runtimeRequestLog';
import {mkdtemp,appendFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readRuntimeLogs} from './runtimeLogs';
import {csrfFor} from './sessions';

it('names command routes and isolates verified context across concurrent HTTP requests',async()=>{
 const events:RuntimeRequestLogEvent[]=[];
 const episode='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222';
 const server=createServer((q,r)=>{
  const observation=observeLocalRequest(q,r,e=>events.push(e));
  void observation.run(async()=>{
   observation.start();
   recordValidatedRequestLogContext({operation:q.url?.includes('episode-commands')?'episode.openDirectory':'account.readAssetDirectory'});
   await new Promise(resolve=>setTimeout(resolve,q.url?.includes('episode-commands')?15:1));
   recordValidatedRequestLogContext(q.url?.includes('episode-commands')?{episodeId:episode}:{accountId:account});
   if(q.url?.includes('episode-commands')){
    recordValidatedRequestLogContext({taskId:'33333333-3333-4333-8333-333333333333'});
    recordValidatedRequestLogContext({taskId:'44444444-4444-4444-8444-444444444444'});
   }
   r.end('{}');
  });
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 try{
  await Promise.all(['episode-commands','account-commands'].map(path=>fetch(origin+'/api/local/'+path,{method:'POST'})));
  const finished=events.filter(e=>e.phase==='responded');expect(finished).toHaveLength(2);
  expect(finished.find(e=>e.operation==='episode.openDirectory')).toMatchObject({route:'/api/local/episode-commands',episodeId:episode});
  expect(finished.find(e=>e.operation==='episode.openDirectory')).not.toHaveProperty('accountId');
  expect(finished.find(e=>e.operation==='episode.openDirectory')?.taskIds).toEqual(['33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444']);
  expect(finished.find(e=>e.operation==='account.readAssetDirectory')).toMatchObject({route:'/api/local/account-commands',accountId:account});
  expect(finished.find(e=>e.operation==='account.readAssetDirectory')).not.toHaveProperty('episodeId');
  expect(events.filter(e=>e.phase==='started').every(e=>!e.episodeId&&!e.accountId)).toBe(true);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it('does not attribute a raw URL identity before ownership validation or let a failed log sink fail HTTP',async()=>{
 const events:RuntimeRequestLogEvent[]=[];
 const server=createServer((q,r)=>{const observation=observeLocalRequest(q,r,e=>{events.push(e);throw Error('sink failed');});observation.run(()=>{observation.start();r.statusCode=404;r.end('{}');});});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const response=await fetch('http://127.0.0.1:'+(server.address() as {port:number}).port+'/api/local/episodes/11111111-1111-4111-8111-111111111111',{method:'POST'});expect(response.status).toBe(404);expect(events.every(e=>!e.episodeId)).toBe(true);}
 finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it('records real successful and unknown writes with one request identity without logging credentials or treating HTTP success as production completion',async()=>{
 const token='a'.repeat(64),events:RuntimeRequestLogEvent[]=[];let fail=false;const root=await realpath(await mkdtemp(join(tmpdir(),'request-log-'))),file=join(root,'events.log');
 const pool={query:async()=>{if(fail)throw Object.assign(Error('sensitive diagnostic synthetic-unlabelled-key'),{code:'ECONNRESET'});return{rows:[{id:'fixture-owner',email:'owner@example.invalid'}]};}} as unknown as Pool;
 let handler:ReturnType<typeof createLocalHandler>;const server=createServer((q,r)=>handler(q,r));server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 let writes=0;
 handler=createLocalHandler({pool,origin,mediaRoot:'/unused',log:event=>events.push(event),mediaRootSettings:{execute:async()=>{writes++;if(fail)throw Object.assign(Error('Authorization: Bearer synthetic-secret-credential /Users/private-user/data'),{code:'ECONNRESET'});return{ok:true};}} as never});
 try{
  const headers={Cookie:'loop_owner_session='+token,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(token)};
  const body=JSON.stringify({command:'choose',password:'synthetic-private-password',secret:'synthetic-unlabelled-key'});
  const a=await fetch(origin+'/api/local/media-root',{method:'POST',headers,body});expect(a.status).toBe(200);expect(a.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);expect(events).toHaveLength(2);expect(events.map(e=>e.phase)).toEqual(['started','responded']);expect(events[1]).toMatchObject({level:'INFO',httpStatus:200,requestId:events[0].requestId,operationId:events[0].requestId});
  // Fail after session lookup, inside the actual write port. The real HTTP layer
  // must keep the conservative 503 while retaining a diagnostic event.
  pool.query=async()=>({rows:[{id:'fixture-owner',email:'owner@example.invalid'}]}) as never;fail=true;
  const b=await fetch(origin+'/api/local/media-root',{method:'POST',headers,body});expect(b.status).toBe(503);const result=await b.json();expect(result.code).toBe('local_service_unavailable');expect(events).toHaveLength(4);expect(events[3]).toMatchObject({phase:'responded',level:'ERROR',httpStatus:503,errorCode:'ECONNRESET'});expect(events[3].requestId).toBe(events[2].requestId);expect(events[3].requestId).not.toBe(events[0].requestId);expect(writes).toBe(2);
  for(const event of events)await appendFile(file,JSON.stringify(event)+'\n');const report=await readRuntimeLogs([file]);expect(report.entries).toHaveLength(4);expect(report.entries.map(event=>event.level)).toEqual(['ERROR','INFO','INFO','INFO']);expect(report.entries[2].explanation.result).toContain('不代表后台任务');expect(report.entries[0].raw).toContain('ECONNRESET');expect(report.entries[0].raw).toContain('responded');
  expect(JSON.stringify(events)).not.toMatch(/synthetic-private-password|synthetic-unlabelled-key|synthetic-secret-credential|private-user|production_completed/);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});
