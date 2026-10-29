import {it,expect,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {LocalConnections} from './connections';
import {validateConfigurationPolicy} from './configurationCommands';
import type {SecretStore,ConnectionProbe} from './connectionPorts';
const id='10000000-0000-4000-8000-000000000001',reference='10000000-0000-4000-8000-000000000002';
it('keeps the default policy gate closed and validates reference shape when explicitly enabled',()=>{
 expect(()=>validateConfigurationPolicy({credential_ref:id})).toThrow('尚未就绪');
 expect(validateConfigurationPolicy({credential_ref:id},true)).toEqual([id]);
 expect(()=>validateConfigurationPolicy({credential_ref:'arbitrary'},true)).toThrow('引用无效');
 expect(()=>validateConfigurationPolicy({secret:'synthetic'},true)).toThrow('不能保存密钥');
});
it('requires a current native binding, live verification, and available exact secret before blueprint save',async()=>{
 const row={id,connection_id:id,secret_ref:reference,store_mode:'keychain',is_current:true,revoked_at:null};
 const get=vi.fn(async()=> 'synthetic-only'),query=vi.fn().mockResolvedValueOnce({rows:[row]}).mockResolvedValueOnce({rows:[{owned:true}]}).mockResolvedValueOnce({rows:[row]}).mockResolvedValueOnce({rows:[{allowed:true}]});
 const service=new LocalConnections({} as Pool,{mode:'keychain',get,putImmutable:vi.fn()} as SecretStore,{mode:'live',verify:vi.fn()} as ConnectionProbe);
 await service.assertBlueprintReferences({query} as unknown as PoolClient,[id]);expect(get).toHaveBeenCalledExactlyOnceWith(reference);
});
it('never calls a secret port for disabled, revoked, foreign, or non-native references',async()=>{
 const get=vi.fn(),store={mode:'keychain',get,putImmutable:vi.fn()} as SecretStore,probe={mode:'live',verify:vi.fn()} as ConnectionProbe;
 const disabled=new LocalConnections({} as Pool);await expect(disabled.assertBlueprintReferences({} as PoolClient,[id])).rejects.toThrow('尚未就绪');
 for(const row of [null,{revoked_at:'now',is_current:true,store_mode:'keychain',secret_ref:reference},{revoked_at:null,is_current:true,store_mode:'simulated',secret_ref:reference}]){
  const client={query:vi.fn(async()=>({rows:row?[row]:[]}))} as unknown as PoolClient;
  await expect(new LocalConnections({} as Pool,store,probe).assertBlueprintReferences(client,[id])).rejects.toThrow('版本');
 }
 expect(get).not.toHaveBeenCalled();
});
it('saves a qualified reference with closed networking without reading its secret, while execution stays blocked',async()=>{
 const row={id,connection_id:id,secret_ref:reference,store_mode:'keychain',is_current:true,revoked_at:null};
 const get=vi.fn(),query=vi.fn().mockResolvedValueOnce({rows:[row]}).mockResolvedValueOnce({rows:[{owned:true}]}).mockResolvedValueOnce({rows:[row]}).mockResolvedValueOnce({rows:[{allowed:true}]});
 const service=new LocalConnections({}as Pool,{mode:'keychain',get,putImmutable:vi.fn()}as SecretStore,{mode:'live',networkAvailable:false,verify:vi.fn()}as ConnectionProbe);
 expect(service.configurationReady).toBe(true);expect(service.externalReady).toBe(false);
 await service.assertBlueprintReferences({query}as unknown as PoolClient,[id],{purpose:'save'});expect(get).not.toHaveBeenCalled();
 const runtimeQuery=vi.fn().mockResolvedValueOnce({rows:[row]}).mockResolvedValueOnce({rows:[{owned:true}]}).mockResolvedValueOnce({rows:[row]}).mockResolvedValueOnce({rows:[{allowed:true}]});
 await expect(service.assertBlueprintReferences({query:runtimeQuery}as unknown as PoolClient,[id])).rejects.toMatchObject({status:409,preflight:{checks:[expect.objectContaining({check:'provider_network_policy'})]}});expect(get).not.toHaveBeenCalled();
});
