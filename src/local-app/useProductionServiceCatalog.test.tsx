import {act,cleanup,fireEvent,renderHook,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useProductionServiceCatalog} from './useProductionServiceCatalog';
import {localRequest} from './client';
import type {ProductionServiceCatalog} from '../connections/serviceCatalog';
const catalog=(label:string)=>({version:1,groups:[{capability:'video',label,services:[]}]} as ProductionServiceCatalog);
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(cause:unknown)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};}
function setup(active=true){
 const requests:Array<ReturnType<typeof deferred<Response>>&{signal:AbortSignal}>=[];
 vi.stubGlobal('fetch',vi.fn((_path,init)=>{const reply=deferred<Response>();requests.push({...reply,signal:init.signal});return reply.promise;}));
 return{...renderHook(props=>useProductionServiceCatalog(props),{initialProps:{scope:'episode:workspace',active,refreshKey:'initial'}}),requests};
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('publishes only the newest focus read and ignores stale failures without unlocking pending',async()=>{
 const f=setup();await act(async()=>{f.requests[0].resolve(Response.json({serviceCatalog:catalog('initial')}));});
 act(()=>fireEvent.focus(window));act(()=>fireEvent.focus(window));expect(f.requests).toHaveLength(3);expect(f.requests[1].signal.aborted).toBe(true);
 await act(async()=>{f.requests[1].reject(Error('older failure'));});expect(f.result.current.pending).toBe(true);expect(f.result.current.error).toBeNull();
 await act(async()=>{f.requests[2].resolve(Response.json({serviceCatalog:catalog('latest')}));});expect(f.result.current.catalog).toEqual(catalog('latest'));expect(f.result.current.pending).toBe(false);
});
it('ignores a late success after a newer successful read',async()=>{
 const f=setup();act(()=>f.result.current.refresh());
 await act(async()=>{f.requests[1].resolve(Response.json({serviceCatalog:catalog('latest')}));});await act(async()=>{f.requests[0].resolve(Response.json({serviceCatalog:catalog('old')}));});
 expect(f.result.current.catalog).toEqual(catalog('latest'));
});
it('clears another scope immediately and never revives it after switching back',async()=>{
 const f=setup();await act(async()=>{f.requests[0].resolve(Response.json({serviceCatalog:catalog('old scope')}));});act(()=>f.result.current.refresh());
 f.rerender({scope:'other:workspace',active:true,refreshKey:'initial'});expect(f.result.current.catalog).toBeNull();expect(f.requests[1].signal.aborted).toBe(true);
 f.rerender({scope:'episode:workspace',active:true,refreshKey:'initial'});
 await act(async()=>{f.requests[1].resolve(Response.json({serviceCatalog:catalog('late old scope')}));});expect(f.result.current.catalog).toBeNull();
 await act(async()=>{f.requests.at(-1)!.resolve(Response.json({serviceCatalog:catalog('reopened')}));});expect(f.result.current.catalog).toEqual(catalog('reopened'));
});
it('stops inactive readers and starts a fresh read when reactivated',async()=>{
 const f=setup(false);expect(f.requests).toHaveLength(0);act(()=>fireEvent.focus(window));act(()=>f.result.current.refresh());expect(f.requests).toHaveLength(0);
 f.rerender({scope:'episode:workspace',active:true,refreshKey:'initial'});expect(f.requests).toHaveLength(1);
 f.rerender({scope:'episode:workspace',active:false,refreshKey:'initial'});expect(f.requests[0].signal.aborted).toBe(true);
 await act(async()=>{f.requests[0].resolve(Response.json({serviceCatalog:catalog('inactive')}));});expect(f.result.current.catalog).toBeNull();expect(f.result.current.pending).toBe(false);
 f.rerender({scope:'episode:workspace',active:true,refreshKey:'initial'});expect(f.requests).toHaveLength(2);
});
it('keeps the previous display on ordinary failure and retries without a new scope',async()=>{
 const f=setup();await act(async()=>{f.requests[0].resolve(Response.json({serviceCatalog:catalog('saved')}));});act(()=>f.result.current.refresh());
 await act(async()=>{f.requests[1].resolve(Response.json({error:'temporary'},{status:503}));});expect(f.result.current.catalog).toEqual(catalog('saved'));expect(f.result.current.pending).toBe(false);expect(f.result.current.error?.message).toBe('temporary');
 act(()=>f.result.current.refresh());await act(async()=>{f.requests[2].resolve(Response.json({serviceCatalog:catalog('recovered')}));});expect(f.result.current.error).toBeNull();expect(f.result.current.catalog).toEqual(catalog('recovered'));
});
it('explicit invalidation reads fresh state without clearing the previous display',async()=>{
 const f=setup();await act(async()=>{f.requests[0].resolve(Response.json({serviceCatalog:catalog('shown')}));});
 f.rerender({scope:'episode:workspace',active:true,refreshKey:'task-completed'});expect(f.result.current.catalog).toEqual(catalog('shown'));expect(f.requests).toHaveLength(2);
});
it('session expiry clears the directory and prevents focus or late results from restoring it',async()=>{
 const f=setup();await act(async()=>{f.requests[0].resolve(Response.json({serviceCatalog:catalog('shown')}));});act(()=>f.result.current.refresh());
 act(()=>window.dispatchEvent(new Event('loop-local-session-expired')));expect(f.result.current.catalog).toBeNull();expect(f.result.current.pending).toBe(false);expect(f.requests[1].signal.aborted).toBe(true);
 act(()=>fireEvent.focus(window));act(()=>f.result.current.refresh());expect(f.requests).toHaveLength(2);
 await act(async()=>{f.requests[1].resolve(Response.json({serviceCatalog:catalog('expired')}));});expect(f.result.current.catalog).toBeNull();
});
it('a new mount after the same Owner logs in cannot reuse the old read or old 401',async()=>{
 const f=setup();f.unmount();
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({owner:{id:'same-owner'},csrfToken:'new-token'})));await localRequest('login',{method:'POST'});
 const newer=setup();await act(async()=>{newer.requests[0].resolve(Response.json({serviceCatalog:catalog('new login')}));});
 const expired=vi.fn();window.addEventListener('loop-local-session-expired',expired);
 try{await act(async()=>{f.requests[0].resolve(Response.json({error:'expired old request'},{status:401}));});expect(expired).not.toHaveBeenCalled();expect(newer.result.current.catalog).toEqual(catalog('new login'));}finally{window.removeEventListener('loop-local-session-expired',expired);}
});
it('unmount aborts the request and removes the focus listener',async()=>{
 const f=setup();f.unmount();expect(f.requests[0].signal.aborted).toBe(true);act(()=>fireEvent.focus(window));expect(f.requests).toHaveLength(1);
 await act(async()=>{f.requests[0].reject(Error('after close'));});
});
it('rejects a malformed response at the reading seam',async()=>{
 const f=setup();await act(async()=>{f.requests[0].resolve(Response.json({serviceCatalog:{groups:null}}));});await waitFor(()=>expect(f.result.current.error?.message).toBe('制作目录格式无效。'));expect(f.result.current.catalog).toBeNull();expect(f.result.current.pending).toBe(false);
});
it('a late aborted 401 from an abandoned scope cannot expire the current reader',async()=>{
 const f=setup(),expired=vi.fn();window.addEventListener('loop-local-session-expired',expired);
 try{
  f.rerender({scope:'next-workspace',active:true,refreshKey:'initial'});
  await act(async()=>{f.requests[1].resolve(Response.json({serviceCatalog:catalog('current')}));});
  await act(async()=>{f.requests[0].resolve(Response.json({error:'late old scope'},{status:401}));});
  expect(expired).not.toHaveBeenCalled();expect(f.result.current.catalog).toEqual(catalog('current'));
 }finally{window.removeEventListener('loop-local-session-expired',expired);}
});
it.each([{groups:[{capability:'image',services:[{id:'x',provider:'x',adapter:'x',mode:'search',executable:true}]}]},{groups:[{capability:'video',services:[{id:'x',provider:'x',adapter:'x',mode:'search',executable:true}]}]},{groups:[null]},{groups:[{capability:'video',services:null}]},{groups:[{capability:'video',services:[null]}]},{groups:[{capability:'image',services:[{id:'image',provider:'openai',adapter:'openai_images',executable:true,models:null}]}]}])('rejects malformed catalog structure without losing a previous directory',async malformed=>{
 const f=setup();await act(async()=>{f.requests[0].resolve(Response.json({serviceCatalog:catalog('valid')}));});act(()=>f.result.current.refresh());
 await act(async()=>{f.requests[1].resolve(Response.json({serviceCatalog:malformed}));});
 expect(f.result.current.error?.message).toBe('制作目录格式无效。');expect(f.result.current.catalog).toEqual(catalog('valid'));
});
