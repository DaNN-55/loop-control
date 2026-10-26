// Owner-authorized T15 Pexels acceptance; private UI input, hard two-request cap.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync,existsSync,mkdirSync,chmodSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {root,projectRoot,configuration,assertDatabase,sql,docker,container} from './environment.mjs';
import {createLocalDatabase} from '../../dist/local-app/local-app/catalog.js';
import {LocalConnections} from '../../dist/local-app/local-app/connections.js';
import {configuredKeychainStore} from '../../dist/local-app/local-app/keychainStore.js';
import {createPexelsLiveProbe} from '../../dist/local-app/local-app/pexelsLiveProbe.js';
import {createLocalHandler} from '../../dist/local-app/local-app/localRoute.js';
import {ConfigurationError,executeConfiguration} from '../../dist/local-app/local-app/configurationCommands.js';
import {establishSession,lookupSession,revokeSession} from '../../dist/local-app/local-app/sessions.js';
import {ownerTransaction} from '../../dist/local-app/local-app/ownerTransaction.js';
import {resolveLocalWorkerCredential} from '../../dist/local-app/worker/localConnection.js';

const run=join(root,'state/t15-pexels-live-20261024'),port=55178,origin=`http://127.0.0.1:${port}`,keychain=join(root,'keychain/t15-synthetic.keychain-db');
const baseline=JSON.parse(readFileSync(join(run,'baseline.json'))),mode=process.argv[2];
const sha=b=>createHash('sha256').update(b).digest('hex');
const load=name=>JSON.parse(readFileSync(join(run,name),'utf8'));
const save=(name,value)=>{writeFileSync(join(run,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});chmodSync(join(run,name),0o600);};
const secrets=new Set();
function safe(text){assert([...secrets].every(s=>!text.includes(s)),'Secret detected; refuse output');return text;}
function event(name,value={}){appendFileSync(join(run,'events.jsonl'),safe(JSON.stringify({at:new Date().toISOString(),name,...value}))+'\n',{mode:0o600});}
function control(operation,password){
 const r=spawnSync(join(root,'native/t15-test-control'),[],{input:JSON.stringify({operation,...(password===undefined?{}:{password})}),env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:10000});
 assert.equal(r.stderr,'');assert.equal(r.status,0,'Dedicated Keychain control refused; stop');return JSON.parse(r.stdout);
}
function compareSearch(before,after,deleted=false){assert.equal(after.defaultPath,before.defaultPath);assert.equal(after.defaultStatus,before.defaultStatus);assert.deepEqual(after.paths.filter(p=>p!==keychain),before.paths);if(deleted)assert.deepEqual(after.paths,before.paths);}
const realStore=()=>configuredKeychainStore({approved:true,runtimeRoot:root,helperSha256:baseline.helperSha256});
async function prepare(){
 assert(!existsSync(keychain)&&!existsSync(join(run,'ownership.json')),'Existing keychain/attempt; inspect instead of overwriting');assertDatabase();
 assert.equal(sha(readFileSync(join(root,'native/keychain-helper'))),baseline.helperSha256);
 const before=control('snapshot');save('search-before.json',before);chmodSync(root,0o700);mkdirSync(join(root,'keychain'),{recursive:true,mode:0o700});chmodSync(join(root,'keychain'),0o700);
 const password=randomBytes(32).toString('hex');save('recovery-private.json',{password});control('create',password);chmodSync(keychain,0o600);
 save('ownership.json',{path:keychain,createdByThisRun:true,run});const after=control('snapshot');compareSearch(before,after);save('search-created.json',after);
 const pool=createLocalDatabase(configuration().database);let token;
 try{
  const owner=loadOwner();token=await establishSession(pool,owner.email,owner.password);assert(token);const session=await lookupSession(pool,token);assert(session);
  const seed=randomUUID(),asset=join(root,'media','t15-pexels-'+seed);mkdirSync(asset,{mode:0o700});
  const policy={positioning:'T15 Pexels isolated acceptance',asset_root:asset,approval_gates:['script','visual','storyboard','qc']};
  const account=await executeConfiguration(pool,session,{command:'createAccount',idempotencyKey:randomUUID(),data:{name:'T15 Pexels live acceptance',slug:'t15-pexels-'+seed,timezone:'Asia/Shanghai',policy}},join(root,'media'));
  save('fixture.json',{accountId:account.id,blueprintId:account.current_blueprint_version_id,ownerId:session.id,assetRoot:asset,connectionName:'T15 Pexels live '+seed.slice(0,8)});
  event('prepared',{accountId:account.id,providerRequests:0});
 }finally{if(token)await revokeSession(pool,token);await pool.end();}
}
function loadOwner(){return JSON.parse(readFileSync(join(root,'state/t13-owner.json'),'utf8'));}

async function serve(){
 assertDatabase();assert(existsSync(keychain));const own=load('ownership.json');assert(own.createdByThisRun&&own.path===keychain&&own.run===run);
 const pool=createLocalDatabase(configuration().database),native=realStore();let fixture=load('fixture.json');
 // Only this run's own references; never enumerate another keychain or secret.
 const refs=fixture.connectionId?await ownerTransaction(pool,fixture.ownerId,true,async c=>(await c.query('SELECT b.secret_ref FROM local_identity.connection_bindings b JOIN public.list_external_connection_versions($1) v ON v.id=b.version_id WHERE b.owner_id=$2',[fixture.connectionId,fixture.ownerId])).rows):[];
 for(const row of refs)secrets.add(await native.get(row.secret_ref));
 const store={mode:'keychain',async putImmutable(ref,secret){secrets.add(secret);await native.putImmutable(ref,secret);event('keychain-write',{reference:ref});},async get(ref){const value=await native.get(ref);secrets.add(value);return value;}};
 function reserveRequest(){
  let fd;try{fd=openSync(join(run,'budget.lock'),'wx',0o600);}catch{return false;}
  try{
   const b=load('network-budget.json');assert(b.max===2&&Number.isInteger(b.used)&&b.used>=0&&b.used<=2);
   if(b.halted||b.phaseSpent||!['positive','negative'].includes(b.phase)||b.used>=2){event('network-blocked',{phase:b.phase,used:b.used,reason:b.phase==='fault'?'injected-local-network-policy':'budget-or-phase-closed'});return false;}
   b.used++;b.phaseSpent=true;save('network-budget.json',b);event('provider-request-reserved',{number:b.used,phase:b.phase,method:'GET',url:'https://api.pexels.com/v1/videos/search?query=nature&per_page=1'});return true;
  }finally{closeSync(fd);unlinkSync(join(run,'budget.lock'));}
 }
 const probe=createPexelsLiveProbe({reserveRequest,record(result){
  event('provider-result',result);
  if(result.code==='network_blocked'||result.code==='unsupported')return;
  const b=load('network-budget.json');const expected=b.phase==='positive'?'verified':'invalid';
  if(result.outcome!==expected)b.halted=true;
  b.phase='hold';save('network-budget.json',b);
 }});
 const connections=new LocalConnections(pool,store,probe),read=connections.read.bind(connections),command=connections.command.bind(connections);
 connections.read=async ownerId=>{const d=await read(ownerId);return {...d,connections:d.connections.filter(c=>c.id===fixture.connectionId),versions:d.versions.filter(v=>v.connection_id===fixture.connectionId),pending:d.pending.filter(p=>p.metadata.name===fixture.connectionName||p.metadata.connectionId===fixture.connectionId)};};
 connections.command=async(session,body)=>{
  const {command:name,data}=body;
  if(session.id!==fixture.ownerId)throw new ConfigurationError(403,'仅本次隔离Owner可验收。');
  if(name==='create'){
   if(data?.provider!=='pexels'||data?.adapter!=='pexels_video'||data?.name!==fixture.connectionName||fixture.connectionId)throw new ConfigurationError(409,'仅允许本次新建Pexels测试连接。');
  }else if(data?.connectionId){if(data.connectionId!==fixture.connectionId)throw new ConfigurationError(404,'仅允许本次测试连接。');}
  else if(data?.versionId){const allowed=await ownerTransaction(pool,session.id,true,async c=>(await c.query('SELECT 1 FROM public.list_external_connection_versions($1) WHERE id=$2',[fixture.connectionId,data.versionId])).rowCount>0);if(!allowed)throw new ConfigurationError(404,'仅允许本次测试版本。');}
  const result=await command(session,body);
  if(name==='create'||name==='rotate'){fixture={...fixture,connectionId:result.connection.id,currentVersionId:result.connection.current_version_id,...(!fixture.firstVersionId?{firstVersionId:result.connection.current_version_id}:{})};save('fixture.json',fixture);}
  event('connection-command',{command:name,versionId:result.versionId??result.connection?.current_version_id,outcome:result.outcome,ready:result.ready});return result;
 };
 const handler=createLocalHandler({origin,pool,mediaRoot:join(root,'media'),connections});
 const vite=await createServer({configFile:false,root:projectRoot,plugins:[react(),{name:'t15-pexels-live',configureServer(server){server.middlewares.use((req,res,next)=>{
  if(!req.url?.startsWith('/api/')&&!req.url?.startsWith('/_'))return next();
  const end=res.end.bind(res);res.end=function(chunk,...args){
   if(chunk){let text=Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk);
    if(req.url==='/api/local/catalog'&&res.statusCode===200){const d=JSON.parse(text);d.accounts=d.accounts.filter(a=>a.id===fixture.accountId);d.blueprints=d.blueprints.filter(b=>b.account_id===fixture.accountId);d.episodes=[];d.series=[];d.seriesVersions=[];d.promptVersions=d.promptVersions.filter(p=>p.account_id===fixture.accountId);text=JSON.stringify(d);}
    if(req.method==='POST')event('http-command',{path:req.url,status:res.statusCode});
    safe(text);return end(text,...args);
   }return end(chunk,...args);
  };void handler(req,res);
 });}}],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},server:{host:'127.0.0.1',port,strictPort:true,fs:{strict:true,deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.loop-control/**','**/n8n/worker.env*']},watch:{ignored:['**/.loop-control/**']}}});
 await vite.listen();save('runtime.json',{pid:process.pid,port,origin,projectRoot,command:'scripts/local/pexels-live-acceptance.mjs serve'});event('listening',{origin,scope:'only new test account and connection; real database rows filtered, not mocked'});
 let auditRunning=false;
 process.on('SIGUSR2',async()=>{
  if(auditRunning)return;auditRunning=true;
  try{
   fixture=load('fixture.json');
   const detail=await ownerTransaction(pool,fixture.ownerId,true,async c=>{
    const versions=(await c.query('SELECT v.id,v.version,v.revoked_at,v.is_current,q.qualified,p.mode,p.outcome FROM public.list_external_connection_versions($1) v LEFT JOIN local_identity.connection_qualifications q ON q.version_id=v.id LEFT JOIN LATERAL(SELECT mode,outcome FROM local_identity.connection_probe_evidence WHERE version_id=v.id ORDER BY created_at DESC LIMIT 1)p ON true ORDER BY v.version',[fixture.connectionId])).rows;
    const policy=(await c.query('SELECT policy FROM public.account_blueprint_versions WHERE id=$1',[fixture.blueprintId])).rows[0].policy;
    let workerExactVersionResolvable=false;
    try{const value=await resolveLocalWorkerCredential(c,store,{accountId:fixture.accountId,versionId:fixture.firstVersionId,provider:'pexels',adapter:'pexels_video'});workerExactVersionResolvable=secrets.has(value);}catch{/* Expected after rotation/revocation. */}
    return {versions,policy,workerExactVersionResolvable};
   });
   const dump=docker(['exec','-i',container,'pg_dump','-U','postgres','-d','loop_imported','--data-only','--schema=public','--schema=local_identity']);safe(dump);safe(readFileSync(join(run,'events.jsonl'),'utf8'));safe(readFileSync(join(run,'server.log'),'utf8'));
   writeFileSync(join(run,`database-private-${Date.now()}.sql`),dump,{mode:0o600});
   const result={at:new Date().toISOString(),...detail,budget:load('network-budget.json'),secretAbsentFromDatabaseDumpAndLogs:true,actualKeyKnownOnlyInKeychainAndProcessMemory:true};
   save('audit-latest.json',result);save(`audit-${Date.now()}.json`,result);event('audit-complete',{versions:detail.versions.length,workerExactVersionResolvable:detail.workerExactVersionResolvable});
  }catch{event('audit-failed',{code:'audit_assertion_or_database_failure'});}finally{auditRunning=false;}
 });
 process.on('SIGTERM',async()=>{await vite.close();await pool.end();event('server-stopped');process.exit(0);});
}

async function cleanupKeychain(){
 const own=load('ownership.json');assert(own.createdByThisRun&&own.path===keychain&&own.run===run);assert(existsSync(keychain));
 const before=load('search-before.json');compareSearch(before,control('snapshot'));control('delete');assert(!existsSync(keychain));const after=control('snapshot');compareSearch(before,after,true);save('search-cleaned.json',after);unlinkSync(join(run,'recovery-private.json'));chmodSync(root,Number(baseline.runtimeMode));save('keychain-cleanup.json',{dedicatedKeychainDeleted:true,searchListExactlyRestored:true,defaultKeychainUnchanged:true,testPasswordRemoved:true,runtimeModeRestored:baseline.runtimeMode});
}
try{assert(['prepare','serve','cleanup-keychain'].includes(mode),'Use explicit prepare, serve or cleanup-keychain');await ({prepare,serve,'cleanup-keychain':cleanupKeychain})[mode]();if(mode!=='serve')console.log(JSON.stringify({phase:mode,passed:true}));}
catch(error){event('failure',{phase:mode,code:error?.code??'acceptance_failure'});console.error(JSON.stringify({phase:mode,passed:false,code:error?.code??'acceptance_failure'}));process.exitCode=1;}
