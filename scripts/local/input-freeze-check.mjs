// Metadata-only freeze contract in loop_empty, one rolled-back transaction.
// No secret, Keychain or Provider exists for these UUIDs; not live-auth evidence.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {root,sql} from './environment.mjs';
const owner=randomUUID(),account=randomUUID(),connection=randomUUID(),version=randomUUID(),reference=randomUUID(),intent=randomUUID();
const statement=`BEGIN;
INSERT INTO local_identity.owners(id,email) VALUES('${owner}','t16-freeze-${owner}@example.invalid');
INSERT INTO public.accounts(id,slug,name,timezone) VALUES('${owner}','t16-seed-${owner}','T16 rollback seed','UTC');
INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('${owner}','${owner}','owner');
SET SESSION AUTHORIZATION loop_app;
SELECT set_config('loop.owner_id','${owner}',true);
SELECT public.create_account('T16 rollback metadata','t16-${account}','UTC','{}');
DO $$DECLARE a public.accounts;s public.series_versions;e public.episodes;new_series public.series_versions;p jsonb; BEGIN
SELECT x.* INTO a FROM public.accounts x WHERE x.slug='t16-${account}';
INSERT INTO local_identity.connection_intents(owner_id,idempotency_key,metadata,connection_id,version_id,secret_ref,store_mode) VALUES('${owner}','${intent}','{"command":"create","provider":"pexels","adapter":"pexels_video","name":"T16 rollback metadata only"}','${connection}','${version}','${reference}','keychain');
PERFORM local_identity.apply_connection_intent('${intent}');
PERFORM local_identity.record_connection_probe('${version}','live','verified');
p:=jsonb_build_object('b_roll',jsonb_build_object('execution_path','external','credential_ref','${version}','max_attempts',1,'executor',jsonb_build_object('provider','pexels','adapter','pexels_video','model','pexels-video-v1','prompt_version','b-roll-v1')));
PERFORM public.update_current_blueprint(a.id,p);
s:=public.create_series(a.id,'T16 rollback series','{"format":"original"}');
e:=public.create_episode(a.id,a.current_blueprint_version_id,s.id,'Metadata freeze',true);
PERFORM public.update_current_blueprint(a.id,'{}');
new_series:=public.create_series_version(s.series_id,'{"format":"later"}');
IF NOT EXISTS(SELECT 1 FROM public.episodes x JOIN public.account_blueprint_versions b ON b.id=x.blueprint_version_id JOIN public.series_versions v ON v.id=x.series_version_id WHERE x.id=e.id AND b.is_snapshot AND b.policy=p AND b.policy#>>'{b_roll,credential_ref}'='${version}' AND v.id=s.id AND v.rules->>'format'='original' AND b.policy::text NOT LIKE '%${reference}%') THEN RAISE EXCEPTION 'Opaque version / policy / series freeze failed'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
ROLLBACK;
SELECT NOT EXISTS(SELECT 1 FROM local_identity.owners WHERE id='${owner}');`;
const result=sql(statement,'loop_empty');assert.equal(result.split('\n').at(-1),'t');
writeFileSync(join(root,'state/t16-20261024/freeze-metadata-result.json'),JSON.stringify({at:new Date().toISOString(),database:'loop_empty',actualDomainFunctions:true,metadataOnly:true,providerCalls:0,keychainOperations:0,noSecretMaterial:true,qualification:'rollback SQL metadata only; real authentication remains T15 evidence',blueprintPolicyFrozen:true,seriesVersionFrozen:true,opaqueConnectionVersionUuidFrozen:true,secretReferenceNotCopiedToBlueprint:true,allFixtureRowsRolledBack:true,passed:true},null,2)+'\n',{mode:0o600});console.log({passed:true,scope:'rolled-back metadata freeze only'});
