// @vitest-environment node
import {request as httpRequest} from 'node:http';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {it,expect} from 'vitest';
import {createLocalHandler} from './localRoute';
import {createLocalDatabase} from './catalog';
import {SecretStoreError} from './connectionPorts';
it('rejects cross-origin and Host-mismatched local authentication without accessing the database',async()=>{
 const pool=createLocalDatabase({host:'127.0.0.1',port:1,user:'loop_app',database:'unused',password:'fixture'});
 const server=createServer(createLocalHandler({pool,origin:'http://127.0.0.1:55177',mediaRoot:'/tmp/unused'}));server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/local/login`;
  expect((await fetch(url,{method:'POST',headers:{Host:'127.0.0.1:55177',Origin:'https://other.example','Content-Type':'application/json'},body:'{}'})).status).toBe(403);
  const badHost=await new Promise<number|undefined>((resolve,reject)=>{const r=httpRequest(url,{headers:{Host:'untrusted.example'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);r.end();});expect(badHost).toBe(403);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
});

it.each([['runtime_not_prepared','runtime_not_prepared','runtime:prepare'],['runtime_release_invalid','runtime_release_invalid','runtime:prepare'],['unrecognized_failure','local_service_unavailable','系统状态'],['denied','keychain_access_denied','系统授权']])('returns a safe actionable %s error through the real HTTP boundary',async(code,expectedCode,detail)=>{
 const pool={query:async()=>({rows:[{id:'fixture-owner',email:'owner@fixture.invalid',state:'ready',config:{targetRoot:null,sourceRoots:[]}} ]})} as unknown as import('pg').Pool;
 let handler:ReturnType<typeof createLocalHandler>;const server=createServer((q,r)=>handler(q,r));server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;handler=createLocalHandler({pool,origin,mediaRoot:'/tmp/unused',runtimeStatus:async()=>{throw code==='denied'?new SecretStoreError('denied'):Object.assign(Error('private file path and credential diagnostic'),{code});}});
 try{const r=await fetch(origin+'/api/local/system-status',{headers:{Cookie:'loop_owner_session='+'a'.repeat(64)}});expect(r.status).toBe(503);const b=await r.json();expect(b.code,JSON.stringify(b)).toBe(expectedCode);expect(b.error).toContain(detail);expect(JSON.stringify(b)).not.toContain('private file');}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
