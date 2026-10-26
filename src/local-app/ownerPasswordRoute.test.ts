// @vitest-environment node
import{createServer}from'node:http';import{once}from'node:events';import{it,expect,vi}from'vitest';import type{Pool}from'pg';import{createLocalHandler}from'./localRoute';
const session={id:'10000000-0000-4000-8000-000000000001',email:'owner@example.test',token:'a'.repeat(64)};
vi.mock('./sessions.js',async original=>({...await original<typeof import('./sessions.js')>(),lookupSession:async()=>session}));
it('requires CSRF and a bounded password, hashes server-side and rechecks the active session atomically',async()=>{
 const queries:unknown[][]=[];let active=true;const pool={query:vi.fn(async(...args:unknown[])=>{queries.push(args);return{rows:[{changed:active}]};})}as unknown as Pool;
 const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+(server.address()as{port:number}).port;server.on('request',createLocalHandler({pool,origin,mediaRoot:'/unused'}));const{csrfFor}=await import('./sessions');
 const post=(password:unknown,csrf=true)=>fetch(origin+'/api/local/password',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrfFor(session.token)}:{})},body:JSON.stringify({password})});
 try{expect((await post('a-valid-local-password',false)).status).toBe(403);expect((await post('short')).status).toBe(400);expect(queries).toHaveLength(0);
 expect((await post('a-valid-local-password')).status).toBe(200);expect(queries).toHaveLength(1);expect(queries[0][0]).toContain('change_owner_password');const args=queries[0][1]as string[];expect(args[0]).toBe(session.id);expect(args[2]).not.toContain('a-valid-local-password');expect(JSON.parse(args[2])).toMatchObject({version:'scrypt-v1'});
 active=false;expect((await post('another-valid-password')).status).toBe(401);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
