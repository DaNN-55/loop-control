// @vitest-environment jsdom
import {act,cleanup,fireEvent,renderHook,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {transferableAbortController} from 'node:util';
import {connectionCatalogFixture} from './connectionCatalog.fixture';
import {useProductionServiceCatalog} from './useProductionServiceCatalog';
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('reads fresh Owner HTTP facts through the real catalog hook and expires only the current session',async()=>{
 const f=await connectionCatalogFixture(),network=globalThis.fetch;let token=f.token;
 const expired=vi.fn();window.addEventListener('loop-local-session-expired',expired);
 // Bridge jsdom's DOM signal to the native Node fetch transport.
 vi.stubGlobal('fetch',((input:string|URL|Request,init?:RequestInit)=>{
  const local=String(input)==='/api/local/connections';
  const controller=transferableAbortController(),abort=()=>controller.abort();
  if(init?.signal?.aborted)abort();else init?.signal?.addEventListener('abort',abort,{once:true});
  return network(local?f.origin+'/api/local/connections':input,{...init,signal:controller.signal,...(local?{headers:{Origin:f.origin,...(token?{Cookie:'loop_owner_session='+token}:{})}}:{})})
   .finally(()=>init?.signal?.removeEventListener('abort',abort));
 }) as typeof fetch);
 try{
  const scope='episode:workspace',read=()=>useProductionServiceCatalog({scope}),hook=renderHook(read);
  await waitFor(()=>expect(hook.result.current.pending).toBe(false));expect(hook.result.current.error?.message).toBeUndefined();expect(expired).not.toHaveBeenCalled();expect(hook.result.current.catalog).not.toBeNull();
  const created=await f.command('create',{name:'Catalog hook fixture',provider:'openai',adapter:'openai_images',secret:'synthetic-openai-key'});expect(created.status).toBe(200);
  const verified=await f.command('verify',{connectionId:created.body.connection.id});expect(verified.status).toBe(200);expect(verified.body.ready).toBe(true);
  const before=f.secretReads;act(()=>hook.result.current.refresh());
  await waitFor(()=>expect(hook.result.current.catalog?.groups.flatMap(g=>g.services).find(s=>s.connectionId===created.body.connection.id)?.status).toBe('verified'));expect(f.secretReads).toBe(before);
  // This fixture permits manual verification, not production inference.
  expect(hook.result.current.catalog?.groups.flatMap(g=>g.services).find(s=>s.connectionId===created.body.connection.id)?.executable).toBe(false);
  const rotated=await f.command('rotate',{connectionId:created.body.connection.id,provider:'openai',adapter:'openai_images',secret:'synthetic-openai-key'});expect(rotated.status).toBe(200);act(()=>fireEvent.focus(window));
  await waitFor(()=>expect(hook.result.current.catalog?.groups.flatMap(g=>g.services).find(s=>s.connectionId===created.body.connection.id)?.connectionVersionId).toBe(rotated.body.connection.current_version_id));
  f.setNetworkAvailable(false);act(()=>fireEvent.focus(window));
  await waitFor(()=>expect(hook.result.current.pending).toBe(false));expect(hook.result.current.catalog?.groups.flatMap(g=>g.services).find(s=>s.connectionId===created.body.connection.id)?.executable).toBe(false);expect(f.secretReads).toBe(before);
  hook.unmount();token=f.otherToken;const other=renderHook(read);
  await waitFor(()=>expect(other.result.current.catalog).not.toBeNull());expect(JSON.stringify(other.result.current.catalog)).not.toContain(created.body.connection.id);
  token='';act(()=>other.result.current.refresh());await waitFor(()=>expect(expired).toHaveBeenCalledOnce());expect(other.result.current.catalog).toBeNull();expect(other.result.current.pending).toBe(false);
 }finally{cleanup();vi.unstubAllGlobals();window.removeEventListener('loop-local-session-expired',expired);await f.close();}
},60000);
