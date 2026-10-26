// @vitest-environment node
import {request as httpRequest} from 'node:http';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {it,expect} from 'vitest';
import {createLocalHandler} from './localRoute';
import {createLocalDatabase} from './catalog';
it('rejects cross-origin and Host-mismatched local authentication without accessing the database',async()=>{
 const pool=createLocalDatabase({host:'127.0.0.1',port:1,user:'loop_app',database:'unused',password:'fixture'});
 const server=createServer(createLocalHandler({pool,origin:'http://127.0.0.1:55177',mediaRoot:'/tmp/unused'}));server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/local/login`;
  expect((await fetch(url,{method:'POST',headers:{Host:'127.0.0.1:55177',Origin:'https://other.example','Content-Type':'application/json'},body:'{}'})).status).toBe(403);
  const badHost=await new Promise<number|undefined>((resolve,reject)=>{const r=httpRequest(url,{headers:{Host:'untrusted.example'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);r.end();});expect(badHost).toBe(403);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
});
