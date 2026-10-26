// Owner-authorized T15 acceptance. Real dedicated Keychain/HTTP/PG; no online Provider.
// Run native first, then http, then cleanup. Private journal preserves each attempt.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,appendFileSync,mkdirSync,chmodSync,lstatSync,realpathSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {Socket} from 'node:net';
import {root,projectRoot,configuration,assertDatabase,sql,docker,container} from './environment.mjs';

const run=join(root,'state/t15-real-keychain-20261024'),journal=join(run,'raw-events.jsonl');
const keychain=join(root,'keychain/t15-synthetic.keychain-db'),controller=join(root,'native/t15-test-control');
const helper=join(root,'native/keychain-helper'),baseline=JSON.parse(readFileSync(join(run,'baseline.json')));
const mode=process.argv[2];assert(['native','http','cleanup'].includes(mode),'Pass native, http or cleanup');
const sha=value=>createHash('sha256').update(value).digest('hex');
function save(name,value){const path=join(run,name);writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});chmodSync(path,0o600);}
function event(name,value){appendFileSync(journal,JSON.stringify({at:new Date().toISOString(),phase:mode,name,...value})+'\n',{mode:0o600});}
function tool(command,args,input){return spawnSync(command,args,{input,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',CLANG_MODULE_CACHE_PATH:join(root,'native/module-cache')},encoding:'utf8',timeout:30000,maxBuffer:262144});}
function control(operation,password){const r=tool(controller,[],JSON.stringify({operation,...(password===undefined?{}:{password})}));assert(!r.error,'Control process failed');assert.equal(r.stderr,'','Control emitted diagnostics; stop');const result=JSON.parse(r.stdout);event('control',{operation,...result,...(operation==='snapshot'?{paths:undefined,defaultPath:undefined,pathHashes:result.paths.map(sha),defaultPathHash:sha(result.defaultPath)}:{})});return result;}
function candidate(operation,reference,secret){const r=tool(helper,['--keychain',keychain],JSON.stringify({operation,reference,...(secret===undefined?{}:{secret})}));assert(!r.error,'Helper process failed');assert.equal(r.stderr,'','Helper emitted diagnostics; stop');const result=JSON.parse(r.stdout);event('helper',{operation,reference,status:r.status,ok:result.ok,code:result.code,resolvedBytes:typeof result.secret==='string'?Buffer.byteLength(result.secret):0});return result;}
function scopedSnapshot(before,after,deleted=false){assert.equal(after.defaultStatus,before.defaultStatus);assert.equal(after.defaultPath,before.defaultPath,'Default keychain changed; stop without rewriting preferences');assert.deepEqual(after.paths.filter(p=>p!==keychain),before.paths,'Other search list entries/order changed; stop');assert(after.paths.filter(p=>p===keychain).length<2);if(deleted)assert.deepEqual(after.paths,before.paths);}
const activeHelperHash=()=>existsSync(join(run,'helper-build.json'))?JSON.parse(readFileSync(join(run,'helper-build.json'))).sha256:baseline.helperSha256;
async function store(){const {configuredKeychainStore}=await import('../../dist/local-app/local-app/keychainStore.js');return configuredKeychainStore({approved:true,runtimeRoot:root,helperSha256:activeHelperHash()});}
function ownership(){const m=JSON.parse(readFileSync(join(run,'ownership.json')));assert.equal(m.path,keychain);assert.equal(m.run,run);assert.equal(m.createdByThisRun,true);const s=lstatSync(keychain);assert(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&s.nlink===1&&realpathSync(keychain)===keychain);return m;}

async function native(){
 assert(!existsSync(join(run,'ownership.json'))&&!existsSync(keychain),'Unknown or existing keychain: do not overwrite');
 assert.equal(sha(readFileSync(helper)),activeHelperHash());
 const compiled=tool('/usr/bin/xcrun',['clang','-fobjc-arc','-Wall','-Wextra','-Werror','-DLOOP_KEYCHAIN_PATH='+JSON.stringify(keychain),join(projectRoot,'scripts/local/keychain-test-control.m'),'-framework','Foundation','-framework','Security','-o',controller]);
 writeFileSync(join(run,'control-build.txt'),compiled.stdout+compiled.stderr,{mode:0o600});assert.equal(compiled.status,0,'Read private control-build.txt');chmodSync(controller,0o700);
 const built=tool(process.execPath,[join(projectRoot,'node_modules/typescript/bin/tsc'),'-p','tsconfig.local-app.json']);writeFileSync(join(run,'local-types.txt'),built.stdout+built.stderr,{mode:0o600});assert.equal(built.status,0,'Read private local-types.txt');
 const before=control('snapshot');assert(before.ok);assert(!before.paths.includes(keychain));save('search-before.json',before);
 chmodSync(root,0o700);
 if(existsSync(join(root,'keychain'))){assert(JSON.parse(readFileSync(join(run,'cleanup-result-attempt1.json'))).passed,'Unexpected existing keychain directory');const s=lstatSync(join(root,'keychain'));assert(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid());}
 else mkdirSync(join(root,'keychain'),{mode:0o700});
 const password=randomBytes(32).toString('hex');save('recovery-private.json',{password});event('createIntent',{path:keychain,service:'com.loop-control.stage-d.connections.v1'});
 const created=control('create',password);assert(created.ok,'Dedicated keychain creation refused; stop');assert(existsSync(keychain));chmodSync(keychain,0o600);
 save('ownership.json',{path:keychain,run,createdByThisRun:true,createdAt:new Date().toISOString(),references:[]});
 const after=control('snapshot');scopedSnapshot(before,after);save('search-created.json',after);
 const reference=randomUUID(),secret=randomBytes(32).toString('hex'),nativeStore=await store();
 const own=ownership();own.references.push(reference);save('ownership.json',own);
 await nativeStore.putImmutable(reference,secret);assert.equal(await nativeStore.get(reference),secret);event('adapter',{case:'real-put-get',passed:true});
 await nativeStore.putImmutable(reference,secret);await assert.rejects(nativeStore.putImmutable(reference,randomBytes(32).toString('hex')),{code:'conflict'});assert.equal(await nativeStore.get(reference),secret);event('adapter',{case:'immutable-repeat-and-conflict',passed:true});
 assert(control('lock').ok);assert.equal(control('status').unlocked,false);
 const locked=candidate('get',reference);assert.equal(locked.ok,false);assert.equal(locked.code,'locked_or_denied');
 await assert.rejects(nativeStore.get(reference),{code:'denied'});event('adapter',{case:'locked-access-denied-without-ui',passed:true});
 assert(control('unlock',password).ok);assert.equal(control('status').unlocked,true);assert.equal(await nativeStore.get(reference),secret);
 assert(candidate('remove',reference).ok);assert.equal(candidate('get',reference).code,'missing');
 save('native-result.json',{at:new Date().toISOString(),realKeychain:true,realHelper:true,realAdapter:true,putGet:true,immutableRepeat:true,differentSecretConflict:true,lockedAccessDenied:true,lockedAdapterDenied:true,dedicatedUnlockRestored:true,removedReferenceMissing:true,existingAclModified:false,onlineProviderCalls:0,otherSearchItemsAndOrderUnchanged:true,defaultKeychainUnchanged:true,helperSha256:activeHelperHash(),controllerSha256:sha(readFileSync(controller)),passed:true});
}

async function http(){
 ownership();assert(JSON.parse(readFileSync(join(run,'native-result.json'))).passed);assertDatabase();
 const {createLocalDatabase}=await import('../../dist/local-app/local-app/catalog.js');
 const {LocalConnections}=await import('../../dist/local-app/local-app/connections.js');
 const {createLocalHandler}=await import('../../dist/local-app/local-app/localRoute.js');
 const {ownerTransaction}=await import('../../dist/local-app/local-app/ownerTransaction.js');
 const {resolveLocalWorkerCredential}=await import('../../dist/local-app/worker/localConnection.js');
 const nativeStore=await store(),pool=createLocalDatabase(configuration().database),servers=[],responses=[],secrets=Array.from({length:3},()=>randomBytes(32).toString('hex'));
 const originalConnect=Socket.prototype.connect,originalFetch=globalThis.fetch,origins=new Set();let blockedSockets=0,blockedFetches=0,probeCalls=0,probeThrows=false;
 Socket.prototype.connect=function(...args){const a=Array.isArray(args[0])?args[0][0]:args[0];const o=typeof a==='object'?a:{port:a,host:args[1]};if(o.host!=='127.0.0.1'||!(Number(o.port)===55472||origins.has('http://127.0.0.1:'+o.port))){blockedSockets++;throw Error('T15 acceptance socket refused');}return Reflect.apply(originalConnect,this,args);};
 globalThis.fetch=(url,options)=>{if(!origins.has(new URL(url).origin)){blockedFetches++;throw Error('T15 acceptance HTTP refused');}return originalFetch(url,options);};
 const probe={mode:'simulated',async verify(input){probeCalls++;assert(secrets.includes(input.secret));assert.equal(input.endpoint,'https://api.pexels.com');event('controlledWorker',{case:'real-keychain-secret-arrived-at-simulated-provider',passed:true});if(probeThrows)throw Error('synthetic malicious diagnostic '+input.secret);return 'verified';}};
 async function serverFor(connections){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;origins.add(origin);server.on('request',createLocalHandler({pool,origin,mediaRoot:join(root,'media'),connections}));servers.push(server);return origin;}
 async function call(base,identity,command,data,key=randomUUID(),status=200){const r=await fetch(base+'/api/local/connections',{method:'POST',headers:{Origin:base,Cookie:identity.cookie,'X-CSRF-Token':identity.csrf,'Content-Type':'application/json'},body:JSON.stringify({command,data,idempotencyKey:key})});const body=await r.json();responses.push(JSON.stringify(body));event('http',{command,status:r.status,body});assert.equal(r.status,status,body.error??'unexpected HTTP status');return body;}
 let identity,base,connection;
 try{
  await assert.rejects(async()=>fetch('https://api.pexels.com'));assert.throws(()=>new Socket().connect({host:'127.0.0.1',port:55461}));
  base=await serverFor(new LocalConnections(pool,nativeStore,probe));event('acceptanceServer',{host:'127.0.0.1',origin:base,existingDServiceChanged:false});
  const owner=JSON.parse(readFileSync(join(root,'state/t13-owner.json')));
  const r=await fetch(base+'/api/local/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:owner.email,password:owner.password})});assert.equal(r.status,200);identity={cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrfToken};
  const ownerId=sql(`select id from local_identity.owners where email='${owner.email.replaceAll("'","''")}'`);
  const key=randomUUID(),input={name:'T15 real Keychain '+randomUUID().slice(0,8),provider:'pexels',adapter:'pexels_video',secret:secrets[0]};
  const made=await Promise.all(Array.from({length:8},()=>call(base,identity,'create',input,key)));connection=made[0].connection;assert.equal(new Set(made.map(x=>x.connection.id)).size,1);const v1=connection.current_version_id;
  save('http-fixture.json',{connectionId:connection.id,ownerId,versions:[v1]});
  const ref1=sql(`select secret_ref from local_identity.connection_bindings where version_id='${v1}'`);assert.equal(await nativeStore.get(ref1),secrets[0]);
  let own=ownership();own.references.push(ref1);save('ownership.json',own);
  const checked=await call(base,identity,'verify',{connectionId:connection.id});assert.equal(checked.mode,'simulated');assert.equal(checked.ready,false);assert.equal(checked.outcome,'retryable');
  const rotateKey=randomUUID(),rotated=await Promise.all(Array.from({length:6},()=>call(base,identity,'rotate',{connectionId:connection.id,provider:'pexels',adapter:'pexels_video',secret:secrets[1]},rotateKey)));const v2=rotated[0].connection.current_version_id;assert.equal(new Set(rotated.map(x=>x.connection.current_version_id)).size,1);assert.notEqual(v1,v2);
  const ref2=sql(`select secret_ref from local_identity.connection_bindings where version_id='${v2}'`);own=ownership();own.references.push(ref2);save('ownership.json',own);assert.equal(await nativeStore.get(ref1),secrets[0]);assert.equal(await nativeStore.get(ref2),secrets[1]);
  await assert.rejects(ownerTransaction(pool,ownerId,true,client=>resolveLocalWorkerCredential(client,nativeStore,{versionId:v1,accountId:sql(`select account_id from public.account_memberships where user_id='${ownerId}' limit 1`),provider:'pexels',adapter:'pexels_video'})));event('workerResolution',{case:'rotated-old-version-blocked-no-latest-fallback',passed:true});
  const password=JSON.parse(readFileSync(join(run,'recovery-private.json'))).password;
  assert(control('lock').ok);let count=probeCalls;await call(base,identity,'verify',{connectionId:connection.id});assert.equal(probeCalls,count,'Locked storage must not reach Provider');assert.equal(control('status').unlocked,false);assert(control('unlock',password).ok);
  probeThrows=true;const failure=await call(base,identity,'verify',{connectionId:connection.id});assert.equal(failure.outcome,'retryable');probeThrows=false;
  await call(base,identity,'revoke',{versionId:v2});count=probeCalls;await call(base,identity,'verify',{connectionId:connection.id},randomUUID(),503);assert.equal(probeCalls,count);
  const third=await call(base,identity,'rotate',{connectionId:connection.id,provider:'pexels',adapter:'pexels_video',secret:secrets[2]});const v3=third.connection.current_version_id;
  const ref3=sql(`select secret_ref from local_identity.connection_bindings where version_id='${v3}'`);own=ownership();own.references.push(ref3);save('ownership.json',own);
  assert(candidate('remove',ref3).ok);count=probeCalls;await call(base,identity,'verify',{connectionId:connection.id});assert.equal(probeCalls,count);await assert.rejects(nativeStore.get(ref3),{code:'missing'});
  await call(base,identity,'rebind',{versionId:v3,secret:secrets[2]});assert.equal(sql(`select secret_ref from local_identity.connection_bindings where version_id='${v3}'`),ref3);assert.equal(await nativeStore.get(ref3),secrets[2]);
  // Restore a missing DB binding as on import, only for this newly created fixture.
  sql(`delete from local_identity.connection_bindings where version_id='${v3}'`);
  await call(base,identity,'rebind',{versionId:v3,secret:secrets[2]});const ref4=sql(`select secret_ref from local_identity.connection_bindings where version_id='${v3}'`);assert.notEqual(ref3,ref4);assert.equal(await nativeStore.get(ref4),secrets[2]);own=ownership();own.references.push(ref4);save('ownership.json',own);
  await call(base,identity,'verify',{connectionId:connection.id});
  const visible=await (await fetch(base+'/api/local/connections',{headers:{Cookie:identity.cookie}})).json();responses.push(JSON.stringify(visible));assert.equal(visible.capabilities.externalReady,false);assert.equal(visible.capabilities.secrets,'keychain');assert.equal(visible.capabilities.verification,'simulated');assert(visible.versions.filter(v=>v.connection_id===connection.id).every(v=>v.status!=='verified'));
  const account=JSON.parse(readFileSync(join(root,'state/t14-http.json'))).accountId;
  await assert.rejects(ownerTransaction(pool,ownerId,true,client=>resolveLocalWorkerCredential(client,nativeStore,{versionId:v3,accountId:account,provider:'pexels',adapter:'pexels_video'})));event('workerResolution',{case:'simulated-provider-never-grants-production-qualification',passed:true});
  const catalog=await (await fetch(base+'/api/local/catalog',{headers:{Cookie:identity.cookie}})).json(),a=catalog.accounts.find(a=>a.id===account),blueprint=catalog.blueprints.find(b=>b.id===a.current_blueprint_version_id);
  const rejected=await fetch(base+'/api/local/configuration',{method:'POST',headers:{Origin:base,Cookie:identity.cookie,'X-CSRF-Token':identity.csrf,'Content-Type':'application/json'},body:JSON.stringify({command:'updateBlueprint',idempotencyKey:randomUUID(),expectedRevision:catalog.blueprintRevisions[blueprint.id],data:{accountId:account,policy:{...blueprint.policy,b_roll:{execution_path:'external',credential_ref:v3}}}})});assert.equal(rejected.status,409);
  assert.equal((await fetch(base+'/api/local/connections')).status,401);assert.equal((await fetch(base+'/api/local/connections',{method:'POST',headers:{Origin:base,Cookie:identity.cookie,'Content-Type':'application/json'},body:'{}'})).status,403);
  const backup=docker(['exec','-i',container,'pg_dump','-U','postgres','-d','loop_imported','--data-only','--schema=public','--schema=local_identity']);writeFileSync(join(run,'database-private.dump.sql'),backup,{mode:0o600});
  const surfaces=[...responses,backup,readFileSync(journal,'utf8'),readFileSync(join(root,'logs/app.log'),'utf8')];for(const secret of secrets)assert(surfaces.every(s=>!s.includes(secret)),'Synthetic secret leaked');
  save('http-fixture.json',{connectionId:connection.id,ownerId,versions:[v1,v2,v3]});
  // End this fixture revoked before its Keychain is cleaned up.
  await call(base,identity,'revoke',{versionId:v3});
  const result={at:new Date().toISOString(),realPostgres:true,realHttp:true,realKeychainStore:true,realNativeHelper:true,workerBoundary:'actual verifyLocalConnection module, same process; no full task Worker CLI',provider:'simulated, network denied',onlineProviderCalls:0,concurrentCreate8SingleConnection:true,concurrentRotate6SingleVersion:true,oldSecretPreserved:true,oldWorkerVersionBlocked:true,lockedKeychainHttpPathBlockedBeforeProvider:true,providerExceptionRedacted:true,revokedVerificationRejected:true,missingKeychainEntryRebound:true,missingDatabaseBindingRebound:true,productionWorkerStillBlocked:true,blueprintSelection409:true,anonymous401:true,csrf403:true,externalReady:false,secretAbsentFromHttpDatabaseBackupAndLogs:true,networkSelfChecks:{blockedFetches,blockedSockets},fixtureRevokedAtEnd:true,connectionId:connection.id,versions:[v1,v2,v3],passed:true};save('http-result.json',result);
 }finally{
  if(base&&identity)await fetch(base+'/api/local/logout',{method:'POST',headers:{Origin:base,Cookie:identity.cookie,'X-CSRF-Token':identity.csrf}}).catch(()=>{});
  for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await pool.end();Socket.prototype.connect=originalConnect;globalThis.fetch=originalFetch;
 }
}

async function cleanup(){
 const before=JSON.parse(readFileSync(join(run,'search-before.json')));ownership();
 const current=control('snapshot');scopedSnapshot(before,current);
 // This entire library was absent before this run. Delete it through Security,
 // without changing item ACLs (including diagnostics created by another helper).
 assert(control('delete').ok);assert(!existsSync(keychain));const after=control('snapshot');scopedSnapshot(before,after,true);save('search-cleaned.json',after);
 // Security may retain a zero-byte lock file in this newly created directory.
 // Keep that diagnostic file and the directory; do not unlink unknown files.
 if(existsSync(join(run,'recovery-private.json')))unlinkSync(join(run,'recovery-private.json'));
 chmodSync(root,Number(baseline.runtimeMode));
 save('cleanup-result.json',{at:new Date().toISOString(),dedicatedKeychainDeleted:true,onlyThisRunReferencesRemoved:true,defaultKeychainUnchanged:true,searchListExactlyRestored:true,passwordRecoveryFileRemoved:true,runtimeModeRestored:baseline.runtimeMode,existingDServiceChanged:false,passed:true});
}

try{await ({native,http,cleanup})[mode]();event('phaseComplete',{passed:true});console.log(JSON.stringify({phase:mode,passed:true,privateRun:run}));}
catch(error){event('phaseFailed',{message:error instanceof assert.AssertionError?'Assertion failed; inspect private phase evidence':error instanceof Error?error.message:'Unknown failure'});console.error(JSON.stringify({phase:mode,passed:false,privateRun:run,errorCode:error?.code??null}));process.exitCode=1;}
