// @vitest-environment node
import {createServer} from 'node:http';
import {once} from 'node:events';
import {describe,it,expect} from 'vitest';
import {createCatalogHandler} from './catalogRoute';
describe('local directory HTTP boundary',()=>{
 it('rejects missing Owner and cross-origin requests before reading business data',async()=>{
  const server=createServer(createCatalogHandler({origin:'http://127.0.0.1:55177',authenticate:async()=>null,catalog:async()=>{throw Error('unauthorized read');}}));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
   const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/local/catalog`;
   expect((await fetch(url)).status).toBe(401);
   expect((await fetch(url,{headers:{Origin:'https://other.example'}})).status).toBe(403);
   expect((await fetch(url,{method:'POST'})).status).toBe(405);
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
 });
});
