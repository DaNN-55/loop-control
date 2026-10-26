// Server/controlled-Worker interface. Never export resolved material to HTTP.
import type {PoolClient} from 'pg';
import {SecretStoreError,type SecretStore,type ConnectionProbe,type ProbeOutcome} from '../local-app/connectionPorts.js';
export interface OwnedConnectionVersion {id:string;connection_id:string;provider:string;adapter:string;endpoint:string;revoked_at:string|null;is_current:boolean;secret_ref:string|null;store_mode:string|null}
export async function ownedConnectionVersion(client:PoolClient,id:string):Promise<OwnedConnectionVersion|null>{
 return (await client.query('SELECT * FROM local_identity.connection_version($1)',[id])).rows[0]??null;
}
export async function verifyLocalConnection(client:PoolClient,store:SecretStore,probe:ConnectionProbe,version:OwnedConnectionVersion){
 if(probe.mode==='disabled'||store.mode==='disabled')throw new SecretStoreError('disabled');
 if(version.revoked_at||!version.is_current||!version.secret_ref)throw new SecretStoreError('missing');
 if(version.store_mode!==store.mode||probe.mode==='live'&&store.mode!=='keychain')throw new SecretStoreError('unavailable');
 let outcome:ProbeOutcome;
 try{
  const secret=await store.get(version.secret_ref);
  const result=await probe.verify({provider:version.provider,adapter:version.adapter,endpoint:version.endpoint,secret});
  outcome=['verified','invalid','retryable'].includes(result)?result:'retryable';
 }catch{outcome='retryable';} // Never propagate provider/helper diagnostics.
 await client.query('SELECT local_identity.record_connection_probe($1,$2,$3)',[version.id,probe.mode,outcome]);
 return {versionId:version.id,mode:probe.mode,outcome:probe.mode==='simulated'?'retryable':outcome,ready:probe.mode==='live'&&outcome==='verified'};
}
export async function resolveLocalWorkerCredential(client:PoolClient,store:SecretStore,input:{versionId:string;accountId:string;provider:string;adapter:string}):Promise<string>{
 const version=await ownedConnectionVersion(client,input.versionId);
 if(!version||version.revoked_at||!version.is_current||version.provider!==input.provider||version.adapter!==input.adapter||version.store_mode!=='keychain'||store.mode!=='keychain'||!version.secret_ref)throw new SecretStoreError('missing');
 const allowed=await client.query(`SELECT EXISTS(SELECT 1 FROM public.account_memberships WHERE account_id=$1 AND user_id=local_identity.owner_id() AND role='owner') AND public.connection_version_is_verified($2) AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence WHERE version_id=$2 AND mode='live' AND outcome='verified') allowed`,[input.accountId,version.id]);
 if(!allowed.rows[0].allowed)throw new SecretStoreError('denied');
 return store.get(version.secret_ref); // Exact version only: no latest/env/Vault fallback.
}
