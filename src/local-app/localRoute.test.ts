// @vitest-environment node
import {request as httpRequest} from 'node:http';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {it,expect} from 'vitest';
import {createLocalHandler} from './localRoute';
import {createLocalDatabase} from './catalog';
import {SecretStoreError} from './connectionPorts';
import {canonicalFingerprint} from './configurationCommands';
import {nativeMaterialUploadPath,nativeMaterialReceiptPath} from './harnessProductionPolicy';
it('dispatches dedicated native upload and receipt paths only with a private production scope',async()=>{
 const episodeId='11111111-1111-4111-8111-111111111111',owner={id:'22222222-2222-4222-8222-222222222222',email:'owner@fixture.invalid'};
 const operation={command:'importMaterial',idempotencyKey:episodeId,data:{episodeId,sourceKind:'file',sourcePath:'storyboard.png',materialType:'image',mimeType:'image/png',contentBase64:'YWJj',isMainScript:false,materialPurpose:'visual_reference'}};
 const result={id:'registered-material'};
 let writes=0,receipts=0;
 const client={release(){},query:async(sql:string)=>{
  if(sql.includes('command_receipts')){receipts++;return{rows:[{payload_hash:canonicalFingerprint(operation),result}]};}
  if(sql.includes('episode_recycle_bin'))return{rowCount:0,rows:[]};
  return{rowCount:1,rows:[owner]};
 }};
 const pool={connect:async()=>client,query:async()=>({rows:[{state:'ready',config:{targetRoot:null,sourceRoots:[]}}]})} as unknown as import('pg').Pool;
 const episodes={async execute(session:{id:string},intent:unknown){expect(session.id).toBe(owner.id);expect(intent).toEqual(operation);writes++;return result;}} as unknown as NonNullable<Parameters<typeof createLocalHandler>[0]['episodes']>;
 const handler=createLocalHandler({pool,episodes,origin:'http://loop-control.internal',mediaRoot:'/tmp/unused'});
 let restricted=false;
 const server=createServer((q,r)=>void handler(q,r,restricted?undefined:{owner,episodeIds:[episodeId]}));server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const post=(path:string,body:unknown)=>new Promise<{status:number|undefined;body:unknown}>((resolve,reject)=>{
  const q=httpRequest(address+path,{method:'POST',headers:{Host:'loop-control.internal','Content-Type':'application/json'}},res=>{
   res.setEncoding('utf8');let json='';res.on('data',value=>{json+=value;});res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(json)});}catch(error){reject(error);}});
  });q.on('error',reject);q.end(JSON.stringify(body));
 });
 try{
  expect(await post(nativeMaterialUploadPath,operation)).toEqual({status:200,body:result});
  expect(await post(nativeMaterialReceiptPath,{endpoint:'episode-commands',operation})).toEqual({status:200,body:{status:'committed',result}});
  expect((await post('/api/local/episode-commands',operation)).status).toBe(403);
  restricted=true;
  expect((await post(nativeMaterialUploadPath,operation)).status).toBe(403);
  expect((await post(nativeMaterialReceiptPath,{endpoint:'episode-commands',operation})).status).toBe(403);
  expect([writes,receipts]).toEqual([1,1]);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
 });
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
