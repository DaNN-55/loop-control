// Real isolated PostgreSQL and HTTP; in-memory secret store + simulated probe.
// Never imports or invokes configuredKeychainStore or the native candidate.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createLocalDatabase} from '../../dist/local-app/local-app/catalog.js';
import {LocalConnections} from '../../dist/local-app/local-app/connections.js';
import {SecretStoreError} from '../../dist/local-app/local-app/connectionPorts.js';
import {createLocalHandler} from '../../dist/local-app/local-app/localRoute.js';
import {hashPassword} from '../../dist/local-app/local-app/password.js';
import {ownerTransaction} from '../../dist/local-app/local-app/ownerTransaction.js';
import {resolveLocalWorkerCredential} from '../../dist/local-app/worker/localConnection.js';
import {root,configuration,sql,docker,container,writePrivateFile} from './environment.mjs';
const pool=createLocalDatabase(configuration().database),secrets=new Map(),responses=[],newSecrets=[randomBytes(32).toString('hex'),randomBytes(32).toString('hex'),randomBytes(32).toString('hex')];
let interrupt=false,probeError=false,probeCalls=0,writes=0;
const store={mode:'simulated',async putImmutable(reference,secret){if(secrets.has(reference)&&secrets.get(reference)!==secret)throw new SecretStoreError('conflict');if(!secrets.has(reference)){secrets.set(reference,secret);writes++;}if(interrupt){interrupt=false;throw new SecretStoreError('unavailable');}},async get(reference){if(!secrets.has(reference))throw new SecretStoreError('missing');return secrets.get(reference);}};
const probe={mode:'simulated',async verify(input){probeCalls++;assert(newSecrets.includes(input.secret));assert.equal(input.endpoint,'https://api.pexels.com');if(probeError)throw Error('untrusted provider output '+input.secret);return 'verified';}};
const servers=[];let unrelatedId;
async function serverFor(connections){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;server.on('request',createLocalHandler({pool,origin,mediaRoot:join(root,'media'),connections}));servers.push(server);return origin;}
async function login(base,owner){const r=await fetch(base+'/api/local/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:owner.email,password:owner.password})});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(base,identity,command,data,key=randomUUID(),status=200){const r=await fetch(base+'/api/local/connections',{method:'POST',headers:{Origin:base,Cookie:identity.cookie,'X-CSRF-Token':identity.csrf,'Content-Type':'application/json'},body:JSON.stringify({command,data,idempotencyKey:key})});const body=await r.json();responses.push(JSON.stringify(body));assert.equal(r.status,status,body.error??'unexpected status');return body;}
async function read(base,identity){const r=await fetch(base+'/api/local/connections',{headers:{Cookie:identity.cookie}});assert.equal(r.status,200);const body=await r.json();responses.push(JSON.stringify(body));return body;}
try{
 const main=JSON.parse(readFileSync(join(root,'state/t13-owner.json'))),base=await serverFor(new LocalConnections(pool,store,probe)),disabled=await serverFor(undefined),identity=await login(base,main),disabledIdentity=await login(disabled,main);
 const name='T15 simulated '+randomUUID().slice(0,8),key=randomUUID(),create={name,provider:'pexels',adapter:'pexels_video',secret:newSecrets[0]};
 await call(disabled,disabledIdentity,'create',create,randomUUID(),503);
 assert.equal(secrets.size,0);
 const created=await Promise.all(Array.from({length:8},()=>call(base,identity,'create',create,key)));
 assert.equal(new Set(created.map(x=>x.connection.id)).size,1);assert.equal(writes,1);
 const connection=created[0].connection,firstVersion=connection.current_version_id;
 assert.equal(Number(sql(`select count(*) from public.external_connections where id='${connection.id}'`)),1);
 await call(base,identity,'create',{...create,name:name+' conflict'},key,409);
 const replay=await call(base,identity,'create',{...create,secret:newSecrets[1]},key);assert.equal(replay.replayed,true);assert.equal(writes,1,'completed intent never overwrites a secret');
 const checked=await call(base,identity,'verify',{connectionId:connection.id});assert.equal(checked.mode,'simulated');assert.equal(checked.ready,false);assert.equal(checked.outcome,'retryable');
 assert.equal(sql(`select outcome from local_identity.connection_probe_evidence where version_id='${firstVersion}' order by created_at desc limit 1`),'verified');
 assert.equal(sql(`select status from public.external_connections where id='${connection.id}'`),'retryable');
 assert.equal(sql(`select public.connection_version_is_verified('${firstVersion}')`),'f');
 const firstRef=sql(`select secret_ref from local_identity.connection_bindings where version_id='${firstVersion}'`);assert.equal(secrets.get(firstRef),newSecrets[0]);
 const rotateKey=randomUUID();const rotations=await Promise.all(Array.from({length:6},()=>call(base,identity,'rotate',{connectionId:connection.id,provider:'pexels',adapter:'pexels_video',secret:newSecrets[1]},rotateKey)));
 const secondVersion=rotations[0].connection.current_version_id;assert.notEqual(firstVersion,secondVersion);assert.equal(new Set(rotations.map(x=>x.connection.current_version_id)).size,1);assert.equal(writes,2);assert.equal(secrets.get(firstRef),newSecrets[0]);
 await call(base,identity,'verify',{connectionId:connection.id});
 const beforeError=probeCalls;probeError=true;const safeFailure=await call(base,identity,'verify',{connectionId:connection.id});assert.equal(safeFailure.outcome,'retryable');assert.equal(probeCalls,beforeError+1);probeError=false;
 await call(base,identity,'update',{connectionId:connection.id,name:name+' renamed',description:'synthetic local test'});
 await call(base,identity,'revoke',{versionId:secondVersion});const revokedProbeCount=probeCalls;await call(base,identity,'verify',{connectionId:connection.id},randomUUID(),503);assert.equal(probeCalls,revokedProbeCount);
 // Simulated external-store success followed by an interruption before SQL.
 interrupt=true;const retryKey=randomUUID(),rotateThird={connectionId:connection.id,provider:'pexels',adapter:'pexels_video',secret:newSecrets[2]};
 await call(base,identity,'rotate',rotateThird,retryKey,503);const writeAfterInterrupt=writes;
 assert.equal(Number(sql(`select count(*) from local_identity.connection_intents where idempotency_key='${retryKey}' and applied_at is null`)),1);
 const resumed=await call(base,identity,'rotate',rotateThird,retryKey);assert.equal(writes,writeAfterInterrupt);const thirdVersion=resumed.connection.current_version_id;
 assert.equal(Number(sql(`select count(*) from public.external_connection_versions where connection_id='${connection.id}'`)),3);
 // Restore a missing binding for this NEW synthetic version only.
 const thirdRef=sql(`select secret_ref from local_identity.connection_bindings where version_id='${thirdVersion}'`);secrets.delete(thirdRef);
 sql(`delete from local_identity.connection_bindings where version_id='${thirdVersion}'`);
 assert.equal((await read(base,identity)).versions.find(v=>v.id===thirdVersion).secretState,'unbound');
 await call(base,identity,'rebind',{versionId:thirdVersion,secret:newSecrets[2]});
 const restoredRef=sql(`select secret_ref from local_identity.connection_bindings where version_id='${thirdVersion}'`);assert.notEqual(restoredRef,thirdRef);assert.equal(secrets.get(restoredRef),newSecrets[2]);
 await call(base,identity,'verify',{connectionId:connection.id});
 const attemptsBefore=probeCalls;
 const account=JSON.parse(readFileSync(join(root,'state/t14-http.json'))).accountId;
 await assert.rejects(ownerTransaction(pool,main.id??'644f8c5a-b668-48a3-8a25-94c4e502fa04',true,client=>resolveLocalWorkerCredential(client,store,{versionId:thirdVersion,accountId:account,provider:'pexels',adapter:'pexels_video'})));
 assert.equal(probeCalls,attemptsBefore,'simulated checks cannot authorize a production Worker');
 const anonymous=await fetch(base+'/api/local/connections');assert.equal(anonymous.status,401);
 const csrfDenied=await fetch(base+'/api/local/connections',{method:'POST',headers:{Cookie:identity.cookie,Origin:base,'Content-Type':'application/json'},body:'{}'});assert.equal(csrfDenied.status,403);
 unrelatedId=randomUUID();const unrelated={email:`t15-${unrelatedId}@example.invalid`,password:randomBytes(32).toString('hex')};const digest=await hashPassword(unrelated.password);
 sql(`begin;insert into local_identity.owners(id,email) values('${unrelatedId}','${unrelated.email}');insert into local_identity.credentials(owner_id,password_digest) values('${unrelatedId}','${JSON.stringify(digest)}');commit;`);
 const other=await login(base,unrelated);const otherRead=await read(base,other);assert.equal(otherRead.connections.length,0);assert.equal(otherRead.versions.length,0);
 const writesBeforeOther=writes;await call(base,other,'create',create,randomUUID(),403);assert.equal(writes,writesBeforeOther);
 for(const [command,data] of [['rotate',{connectionId:connection.id,provider:'pexels',adapter:'pexels_video',secret:newSecrets[0]}],['rebind',{versionId:thirdVersion,secret:newSecrets[0]}],['verify',{connectionId:connection.id}],['revoke',{versionId:thirdVersion}],['update',{connectionId:connection.id,name:'must not change',description:''}]])await call(base,other,command,data,randomUUID(),404);
 const visible=await read(base,identity);assert.equal(visible.capabilities.externalReady,false);assert(visible.versions.filter(v=>v.connection_id===connection.id).every(v=>v.status!=='verified'));
 assert(visible.connections.every(c=>c.status!=='verified'),'historical flags cannot imply native readiness');
 const catalog=await (await fetch(base+'/api/local/catalog',{headers:{Cookie:identity.cookie}})).json(),fixtureAccount=catalog.accounts.find(a=>a.id===account),blueprint=catalog.blueprints.find(b=>b.id===fixtureAccount.current_blueprint_version_id);
 const forbidden=await fetch(base+'/api/local/configuration',{method:'POST',headers:{Origin:base,Cookie:identity.cookie,'X-CSRF-Token':identity.csrf,'Content-Type':'application/json'},body:JSON.stringify({command:'updateBlueprint',idempotencyKey:randomUUID(),expectedRevision:catalog.blueprintRevisions[blueprint.id],data:{accountId:account,policy:{...blueprint.policy,b_roll:{execution_path:'external',credential_ref:thirdVersion}}}})});assert.equal(forbidden.status,409,'simulated verification must not enable blueprint selection');
 const backup=docker(['exec','-i',container,'pg_dump','-U','postgres','-d','loop_imported','--data-only','--schema=public','--schema=local_identity']);
 for(const secret of newSecrets){assert(!backup.includes(secret),'secret leaked into database backup');assert(responses.every(body=>!body.includes(secret)),'secret leaked into HTTP');assert(!readFileSync(join(root,'logs/app.log'),'utf8').includes(secret),'secret leaked into app log');}
 const result={ticket:121,at:new Date().toISOString(),realPostgres:true,realHttp:true,secretStore:'in-memory simulated',provider:'simulated, no outbound calls',nativeKeychainOperations:0,connectionId:connection.id,versions:[firstVersion,secondVersion,thirdVersion],concurrentCreate8SingleResult:true,concurrentRotate6SingleVersion:true,completedIntentReplayNeverWrites:true,interruptedAfterStoreWriteResumedWithoutDuplicate:true,explicitMissingBindingRestored:true,revokedVersionNeverFallsBack:true,untrustedProviderErrorRedacted:true,simulatedVerificationCannotMarkReady:true,simulatedBlueprintSelection409:true,historicalVerifiedFlagsDoNotImplyNativeReadiness:true,productionWorkerRejectsSimulatedBinding:true,anonymous401:true,csrf403:true,crossOwnerCommands404:true,secretsAbsentFromHttpDatabaseBackupAndAppLog:true,passed:true};
 writePrivateFile(join(root,'state/t15-http-simulated.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{
 if(unrelatedId)sql(`begin;delete from local_identity.sessions where owner_id='${unrelatedId}';delete from local_identity.credentials where owner_id='${unrelatedId}';delete from local_identity.owners where id='${unrelatedId}';commit;`);
 for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await pool.end();
}
