// @vitest-environment node
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';

const transport=globalThis.fetch;
const {JSDOM}=createRequire(import.meta.url)('jsdom');
let browser:{window:{sessionStorage:Storage;Event:typeof Event;close():void}};
beforeEach(()=>{vi.resetModules();browser=new JSDOM('',{url:'http://localhost'});vi.stubGlobal('sessionStorage',browser.window.sessionStorage);vi.stubGlobal('window',browser.window);vi.stubGlobal('Event',browser.window.Event);vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>{sessionStorage.clear();browser.window.close();vi.unstubAllGlobals();});

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('a failed session bootstrap sends no real Owner write; the next attempt archives exactly once',async()=>{
 const f=await productionWorkspaceFixture();let sessionUnavailable=true,writes=0,lookups=0;
 try{
  const before=Number((await f.c.query('SELECT count(*) n FROM local_identity.command_receipts WHERE owner_id=$1',[f.owner])).rows[0].n);
  vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
   if(path==='/api/local/session'&&sessionUnavailable)return Response.json({error:'session temporarily unavailable'},{status:503});
   if(path==='/api/local/episode-lifecycle')writes++;
   if(path==='/api/local/command-receipt')lookups++;
   const headers=new Headers(init?.headers);headers.set('Cookie','loop_owner_session='+f.token);headers.set('Origin',f.origin);
   return transport(f.origin+path,{...init,headers});
  }));
  const {localCommand}=await import('./client'),data={episodeId:f.episode,archived:true};
  await expect(localCommand('archiveEpisode',data,undefined,'episode-lifecycle')).rejects.toMatchObject({requestSent:false,status:503});
  expect(writes).toBe(0);expect(lookups).toBe(0);expect(sessionStorage.length).toBe(0);
  expect((await f.c.query('SELECT archived_at FROM public.episodes WHERE id=$1',[f.episode])).rows[0].archived_at).toBeNull();
  expect(Number((await f.c.query('SELECT count(*) n FROM local_identity.command_receipts WHERE owner_id=$1',[f.owner])).rows[0].n)).toBe(before);
  sessionUnavailable=false;await expect(localCommand('archiveEpisode',data,undefined,'episode-lifecycle')).resolves.toMatchObject({id:f.episode});
  expect(writes).toBe(1);expect(lookups).toBe(0);expect(sessionStorage.length).toBe(0);
  expect((await f.c.query('SELECT archived_at FROM public.episodes WHERE id=$1',[f.episode])).rows[0].archived_at).not.toBeNull();
  expect(Number((await f.c.query('SELECT count(*) n FROM local_identity.command_receipts WHERE owner_id=$1',[f.owner])).rows[0].n)).toBe(before+1);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('a real committed write stays uncertain through failed session readback and recovers its exact receipt without replay',async()=>{
 const f=await productionWorkspaceFixture();let phase:'write'|'session-unavailable'|'recover'='write',writes=0;let committed:unknown;
 try{
  vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
   if(path==='/api/local/session'&&phase==='session-unavailable')return Response.json({error:'session temporarily unavailable'},{status:503});
   if(path==='/api/local/command-receipt'&&phase==='write')return Response.json({error:'receipt temporarily unavailable'},{status:503});
   const headers=new Headers(init?.headers);headers.set('Cookie','loop_owner_session='+f.token);headers.set('Origin',f.origin);
   const response=await transport(f.origin+path,{...init,headers});
   if(path==='/api/local/episode-lifecycle'){
    writes++;expect(response.status).toBe(200);committed=await response.json();throw TypeError('response lost after commit');
   }
   return response;
  }));
  let client=await import('./client');const data={episodeId:f.episode,archived:true};
  await expect(client.localCommand('archiveEpisode',data,undefined,'episode-lifecycle')).rejects.toMatchObject({code:'LOCAL_COMMAND_OUTCOME_UNKNOWN'});
  expect((await f.c.query('SELECT archived_at FROM public.episodes WHERE id=$1',[f.episode])).rows[0].archived_at).not.toBeNull();
  const afterCommit=(await f.c.query('SELECT to_jsonb(r) value FROM local_identity.command_receipts r WHERE owner_id=$1 ORDER BY idempotency_key',[f.owner])).rows;
  vi.resetModules();client=await import('./client');phase='session-unavailable';
  await expect(client.localCommand('archiveEpisode',data,undefined,'episode-lifecycle')).rejects.toMatchObject({code:'LOCAL_COMMAND_OUTCOME_UNKNOWN'});
  expect(writes).toBe(1);expect(sessionStorage.length).toBe(2);
  phase='recover';await expect(client.localCommand('archiveEpisode',data,undefined,'episode-lifecycle')).resolves.toEqual(committed);
  expect(writes).toBe(1);expect(sessionStorage.length).toBe(0);
  expect((await f.c.query('SELECT to_jsonb(r) value FROM local_identity.command_receipts r WHERE owner_id=$1 ORDER BY idempotency_key',[f.owner])).rows).toEqual(afterCommit);
 }finally{await f.close();}
},120000);
