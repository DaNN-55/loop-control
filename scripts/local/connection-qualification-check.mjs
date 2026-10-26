// SQL state-machine regression only. Metadata fixtures live inside one rolled
// back transaction in loop_empty, which is never served by the D application.
// No secret exists for these UUIDs, no helper/probe is invoked.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {root,sql,writePrivateFile} from './environment.mjs';
const owner=randomUUID(),connection=randomUUID(),version=randomUUID(),ref=randomUUID(),key=randomUUID(),rebind=randomUUID(),rotate=randomUUID(),second=randomUUID(),secondRef=randomUUID();
const assertion=(expression,message)=>`DO $$ BEGIN IF NOT (${expression}) THEN RAISE EXCEPTION '${message}'; END IF; END $$;`;
const result=sql(`BEGIN;
 INSERT INTO local_identity.owners(id,email) VALUES('${owner}','t15-sql-only-${owner}@example.invalid');
 INSERT INTO public.accounts(id,slug,name,timezone) VALUES('${owner}','t15-sql-${owner}','SQL-only rollback fixture','UTC');
 INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('${owner}','${owner}','owner');
 SET SESSION AUTHORIZATION loop_app;
 SELECT set_config('loop.owner_id','${owner}',true);
 INSERT INTO local_identity.connection_intents(owner_id,idempotency_key,metadata,connection_id,version_id,secret_ref,store_mode)
 VALUES('${owner}','${key}','{"command":"create","provider":"pexels","adapter":"pexels_video","name":"SQL-only metadata, no secret"}','${connection}','${version}','${ref}','keychain');
 SELECT local_identity.apply_connection_intent('${key}');
 ${assertion(`NOT public.connection_version_is_verified('${version}')`,'New binding cannot qualify without a successful probe')}
 SELECT local_identity.record_connection_probe('${version}','live','verified');
 ${assertion(`public.connection_version_is_verified('${version}')`,'Successful probe should qualify')}
 SELECT local_identity.record_connection_probe('${version}','live','retryable');
 ${assertion(`public.connection_version_is_verified('${version}')`,'Transient failure must retain qualification')}
 ${assertion(`EXISTS(SELECT 1 FROM public.external_connection_verifications WHERE connection_version_id='${version}' AND status='retryable')`,'Retryable result must be preserved')}
 SELECT local_identity.record_connection_probe('${version}','live','invalid');
 ${assertion(`NOT public.connection_version_is_verified('${version}')`,'Invalid credentials must clear qualification')}
 SELECT local_identity.record_connection_probe('${version}','live','retryable');
 ${assertion(`NOT public.connection_version_is_verified('${version}')`,'Transient result must not create qualification')}
 SELECT local_identity.record_connection_probe('${version}','live','verified');
 INSERT INTO local_identity.connection_intents(owner_id,idempotency_key,metadata,connection_id,version_id,secret_ref,store_mode)
 VALUES('${owner}','${rebind}','{"command":"rebind","versionId":"${version}"}','${connection}','${version}','${ref}','keychain');
 SELECT local_identity.apply_connection_intent('${rebind}');
 ${assertion(`NOT public.connection_version_is_verified('${version}')`,'Explicit rebind must clear qualification')}
 SELECT local_identity.record_connection_probe('${version}','live','verified');
 INSERT INTO local_identity.connection_intents(owner_id,idempotency_key,metadata,connection_id,version_id,secret_ref,store_mode)
 VALUES('${owner}','${rotate}','{"command":"rotate","connectionId":"${connection}","provider":"pexels","adapter":"pexels_video"}','${connection}','${second}','${secondRef}','keychain');
 SELECT local_identity.apply_connection_intent('${rotate}');
 ${assertion(`NOT public.connection_version_is_verified('${version}') AND NOT public.connection_version_is_verified('${second}')`,'Rotation must not transfer qualification')}
 SELECT local_identity.record_connection_probe('${second}','live','verified');
 SELECT public.revoke_external_connection_version('${second}');
 ${assertion(`NOT public.connection_version_is_verified('${second}')`,'Revocation must clear effective qualification')}
 RESET SESSION AUTHORIZATION;
 ROLLBACK;
 SELECT NOT EXISTS(SELECT 1 FROM local_identity.owners WHERE id='${owner}');`,'loop_empty');
assert.equal(result.split('\n').at(-1),'t');
const evidence={ticket:121,at:new Date().toISOString(),database:'loop_empty',fixture:'SQL-only metadata, one transaction rolled back',nativeKeychainOperations:0,providerCalls:0,liveMode:'database state-machine branch only, not real authentication or Provider evidence',assertions:9,verifiedRetainedAfterRetryable:true,invalidClears:true,rebindClears:true,rotationDoesNotTransfer:true,revokedBlocks:true,allFixtureRowsRolledBack:true,passed:true};
writePrivateFile(join(root,'state/t15-qualification-sql.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
