import {beforeEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
beforeEach(()=>{vi.resetModules();vi.stubGlobal('crypto',webcrypto);});
it('never persists billing credentials or credential digests and reuses an in-flight operation key',async()=>{
 const token='a'.repeat(64),secret='synthetic-admin-key-012345';let finish!:(r:Response)=>void;
 const fetcher=vi.fn(async(path:string,init?:RequestInit)=>{if(path==='/api/local/session')return Response.json({owner:{id:'owner'},csrfToken:token});expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe(token);return new Promise<Response>(resolve=>{finish=resolve;});});vi.stubGlobal('fetch',fetcher);
 const set=vi.spyOn(Storage.prototype,'setItem'),{localRequest,localBillingCommand}=await import('./client');await localRequest('session');
 const data={connectionId:'id',revision:'default',credential:JSON.stringify({apiKey:secret})},first=localBillingCommand('save',data,'same-key'),second=localBillingCommand('save',data,'same-key');
 expect(fetcher.mock.calls.filter(c=>c[0]==='/api/local/connection-billing')).toHaveLength(1);expect(set).not.toHaveBeenCalled();
 finish(Response.json({configured:true}));expect(await first).toEqual(await second);set.mockRestore();
});
