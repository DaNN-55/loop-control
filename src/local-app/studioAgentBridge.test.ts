// @vitest-environment node
import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
const ports=vi.hoisted(()=>({resolve:vi.fn(),version:vi.fn(),query:vi.fn()}));
vi.mock('./ownerTransaction',()=>({ownerTransaction:async(_pool:unknown,_owner:unknown,_read:unknown,run:(c:unknown)=>unknown)=>run({query:ports.query})}));
vi.mock('./productionSelection',()=>({resolveProductionSelection:ports.resolve}));
vi.mock('../worker/localConnection',()=>({ownedConnectionVersion:ports.version}));
import {StudioAgentBridge} from './studioAgentBridge';
it('offers no linked credentials without Keychain and rejects arbitrary loopback callers',async()=>{
 const transport=vi.fn(),bridge=await new StudioAgentBridge({} as Pool,{mode:'disabled',get:vi.fn(),putImmutable:vi.fn()},transport).start();
 try{expect(await bridge.environment({} as PoolClient,'episode')).toEqual({});const origin=(bridge as unknown as {origin:string}).origin;const r=await fetch(origin+'/openai/responses',{method:'POST',headers:{Authorization:'Bearer random'},body:'{}'});expect(r.status).toBe(403);expect(transport).not.toHaveBeenCalled();expect(await r.text()).not.toContain('random');}finally{await bridge.close();}
});
it('streams native proxy sends with a fresh connection check, but blocks disabled models, foreign origins and revoked leases',async()=>{
 const get=vi.fn(async()=> 'upstream-secret'),transport=vi.fn(async()=>new Response('data: complete\n\n',{headers:{'Content-Type':'text/event-stream'}}));
 const bridge=await new StudioAgentBridge({} as Pool,{mode:'keychain',get,putImmutable:vi.fn()},transport).start();
 const internal=bridge as unknown as {origin:string;leases:Map<string,unknown>};internal.leases.set('capability',{ownerId:'owner',episodeId:'episode',expires:Date.now()+10000,choices:[{capability:'language_model',provider:'openai',adapter:'openai_responses',model:'enabled',connectionVersionId:'version'}]});
 ports.query.mockResolvedValue({rowCount:1});ports.version.mockResolvedValue({secret_ref:'reference',endpoint:'https://api.openai.com/v1'});ports.resolve.mockResolvedValue({});
 const send=(model='enabled',origin='http://127.0.0.1:5175')=>fetch(internal.origin+'/openai/responses',{method:'POST',headers:{Authorization:'Bearer capability',Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({model,stream:true,store:true})});
 try{
  const r=await send();expect(r.status).toBe(200);expect(await r.text()).toBe('data: complete\n\n');expect(ports.resolve).toHaveBeenCalled();expect(get).toHaveBeenCalledWith('reference');expect(transport).toHaveBeenCalledWith('https://api.openai.com/v1/responses',expect.objectContaining({headers:expect.objectContaining({Authorization:'Bearer upstream-secret'}),body:JSON.stringify({model:'enabled',stream:true,store:false})}));
  expect((await send('disabled')).status).toBe(403);expect((await send('enabled','https://foreign.invalid')).status).toBe(403);
  ports.resolve.mockRejectedValueOnce(Error('model disabled'));expect((await send()).status).toBe(403);expect(transport).toHaveBeenCalledTimes(1);
  bridge.revoke('episode');expect((await send()).status).toBe(403);expect(transport).toHaveBeenCalledTimes(1);
 }finally{await bridge.close();vi.clearAllMocks();}
});
