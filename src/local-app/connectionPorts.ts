export type SecretStoreMode='disabled'|'keychain'|'simulated';
export class SecretStoreError extends Error {
 constructor(public code:'disabled'|'missing'|'denied'|'conflict'|'unavailable'){super('Secret storage unavailable');}
}
export interface SecretStore {
 readonly mode:SecretStoreMode;
 // Must not overwrite an existing reference with different bytes.
 putImmutable(reference:string,secret:string):Promise<void>;
 get(reference:string):Promise<string>;
}
export const disabledSecretStore:SecretStore={mode:'disabled',async putImmutable(){throw new SecretStoreError('disabled');},async get(){throw new SecretStoreError('disabled');}};
export type ProbeOutcome='verified'|'invalid'|'retryable';
export interface ConnectionProbe {
 readonly mode:'disabled'|'simulated'|'live';
 readonly networkAvailable?:boolean;
 verify(input:{provider:string;adapter:string;endpoint:string;secret:string}):Promise<ProbeOutcome>;
}
export const disabledConnectionProbe:ConnectionProbe={mode:'disabled',async verify(){return 'retryable';}};
