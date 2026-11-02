import {isRetiredProvider} from './providerLifecycle.js';
// Server/controlled-Worker interface. Never export resolved material to HTTP.
import type {PoolClient} from 'pg';
import {SecretStoreError,type SecretStore,type ConnectionProbe,type ProbeOutcome} from '../local-app/connectionPorts.js';
export interface OwnedConnectionVersion {id:string;connection_id:string;provider:string;adapter:string;endpoint:string;revoked_at:string|null;is_current:boolean;secret_ref:string|null;store_mode:string|null}
export async function ownedConnectionVersion(client:PoolClient,id:string):Promise<OwnedConnectionVersion|null>{
 return (await client.query('SELECT * FROM local_identity.connection_version($1)',[id])).rows[0]??null;
}
export async function verifyLocalConnection(client:PoolClient,store:SecretStore,probe:ConnectionProbe,version:OwnedConnectionVersion){
 if(isRetiredProvider(version.provider))throw new SecretStoreError('disabled');
 if(probe.mode==='disabled'||store.mode==='disabled')throw new SecretStoreError('disabled');
 if(version.revoked_at||!version.is_current||!version.secret_ref)throw new SecretStoreError('missing');
 if(version.store_mode!==store.mode||probe.mode==='live'&&store.mode!=='keychain')throw new SecretStoreError('unavailable');
 const availability=probe.verificationStatus?.(version.provider);
 if(availability&&!availability.available)return{versionId:version.id,mode:probe.mode,outcome:'retryable' as const,ready:false,attempted:false,code:availability.code,detail:availability.detail};
 let result:{outcome:ProbeOutcome;attempted:boolean;detail:string;code:string;httpStatus?:number};
 try{
  const secret=await store.get(version.secret_ref);
  result=probe.test?await probe.test({provider:version.provider,adapter:version.adapter,endpoint:version.endpoint,secret}):{outcome:await probe.verify({provider:version.provider,adapter:version.adapter,endpoint:version.endpoint,secret}),attempted:true,code:'legacy_probe',detail:'连接测试已完成。'};
 }catch{return{versionId:version.id,mode:probe.mode,outcome:'retryable' as const,ready:false,attempted:false,code:'keychain_unavailable',detail:'测试未开始：Keychain 条目缺失、锁定或系统授权不可用，未发出 Provider 请求。'};}
 const outcome=['verified','invalid','retryable'].includes(result.outcome)?result.outcome:'retryable';
 if(result.attempted)await client.query('SELECT local_identity.record_connection_probe($1,$2,$3)',[version.id,probe.mode,outcome]);
 return {versionId:version.id,mode:probe.mode,...result,outcome:probe.mode==='simulated'?'retryable':outcome,ready:probe.mode==='live'&&outcome==='verified'};
}
