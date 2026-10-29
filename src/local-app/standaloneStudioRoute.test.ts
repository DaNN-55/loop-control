// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {createLocalHandler} from './localRoute';
import {LocalEpisodeCommands} from './episodeCommands';
import {csrfFor,sessionCookie} from './sessions';
import {openStandaloneOpenChatCutStudio,closeStandaloneOpenChatCutStudio} from '../worker/openchatcutStudio';

vi.mock('../worker/openchatcutStudio',async original=>({...await original<typeof import('../worker/openchatcutStudio')>(),openStandaloneOpenChatCutStudio:vi.fn(async()=>({studioUrl:'http://127.0.0.1:5175/'})),closeStandaloneOpenChatCutStudio:vi.fn(async()=>{})}));

it('opens standalone Studio through session/CSRF without any account or Episode, scopes its directory to the Owner and closes it with the app',async()=>{
 const mediaRoot=await realpath(await mkdtemp(join(tmpdir(),'standalone-studio-'))),owner=randomUUID(),token='b'.repeat(64);
 let valid=true;const receipts=new Map<string,{payload_hash:string;result:unknown}>();
 const query=async(sql:string,values?:unknown[])=>{
  if(sql.includes('JOIN local_identity.owners'))return{rows:valid?[{id:owner,email:'fixture@example.invalid'}]:[],rowCount:valid?1:0};
  if(sql.includes('media_deployment()'))return{rows:[{state:'ready',config:{targetRoot:mediaRoot,sourceRoots:[]}}]};
  if(sql.includes('token_hash FROM local_identity.sessions'))return{rows:valid?[{token_hash:'fixture'}]:[],rowCount:valid?1:0};
  if(sql.includes('SELECT payload_hash,result FROM'))return{rows:receipts.has(String(values?.[1]))?[receipts.get(String(values?.[1]))]:[]};
  if(sql.includes('INSERT INTO local_identity.command_receipts')){receipts.set(String(values?.[1]),{payload_hash:String(values?.[2]),result:values?.[3]});return{rows:[]};}
  if(sql.startsWith('BEGIN')||sql==='COMMIT'||sql==='ROLLBACK'||sql.includes('set_config')||sql.includes('pg_advisory_xact_lock'))return{rows:[]};
  throw Error('Unexpected account or Episode access: '+sql);
 };
 const pool={query,connect:async()=>({query,release(){}})} as unknown as Pool;
 const wake=vi.fn(),runtime=vi.fn(async()=>({root:'/fixture/OpenChatCut',environment:{PATH:'/fixture/bin'}}));
 const episodes=new LocalEpisodeCommands(pool,mediaRoot,{ready:async()=>{},studioRuntime:runtime,wake,mountPath:mediaRoot,minimumFreeBytes:0,checkReferences:async()=>{}});
 let handler:ReturnType<typeof createLocalHandler>;
 const server=createServer((q,r)=>handler(q,r));server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 handler=createLocalHandler({pool,mediaRoot,origin,episodes});
 const request=async(data:Record<string,unknown>={},csrf=true,key=randomUUID())=>{
  const response=await fetch(origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:origin,Cookie:sessionCookie+'='+token,'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrfFor(token)}:{})},body:JSON.stringify({command:'openStandaloneStudio',idempotencyKey:key,data})});
  return{status:response.status,body:await response.json()};
 };
 try{
  expect((await request({},false)).status).toBe(403);
  expect((await request({root:'/untrusted'})).status).toBe(400);
  expect(openStandaloneOpenChatCutStudio).not.toHaveBeenCalled();
  const key=randomUUID(),opened=await request({},true,key);
  expect(opened).toEqual({status:200,body:{studioUrl:'http://127.0.0.1:5175/'}});
  expect(openStandaloneOpenChatCutStudio).toHaveBeenCalledWith(join(mediaRoot,'openchatcut/standalone',owner),await runtime.mock.results[0].value);
  // Reopen even with a persisted receipt: the process may have stopped since.
  expect(await request({},true,key)).toEqual(opened);expect(openStandaloneOpenChatCutStudio).toHaveBeenCalledTimes(2);
  expect(wake).not.toHaveBeenCalled();
  valid=false;expect((await request()).status).toBe(401);expect(openStandaloneOpenChatCutStudio).toHaveBeenCalledTimes(2);
 }finally{
  await episodes.close();expect(closeStandaloneOpenChatCutStudio).toHaveBeenCalledWith(join(mediaRoot,'openchatcut/standalone',owner));
  server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(mediaRoot,{recursive:true,force:true});vi.clearAllMocks();
 }
});
