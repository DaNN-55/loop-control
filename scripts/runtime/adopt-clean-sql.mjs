// Bounded one-off daily controller. Usage: init | stop/prepare/swap/verify/mark-started/rollback <private work directory>.
import {readFileSync,writeFileSync,existsSync,lstatSync,realpathSync,copyFileSync,chmodSync,unlinkSync,statfsSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {projectRoot as dailyProjectRoot,root as dailyRoot,readSettings,runtimeContext} from './environment.mjs';
import {readMediaRootAuthorization,mediaRootPendingPath} from './media-root.mjs';
import {readPreparedRuntimeRelease,assertPreparedRuntime,assertRuntimeRelease} from '../../src/orchestration/runtimeBuild.ts';
import {loadSchemaCatalog,verifySchemaLedger} from '../../src/local-app/schemaMigrations.ts';
import {inspectRecordedService} from '../local-service-record.mjs';
import {savePrivate,savePrivateBytes,databaseMeta,idleDatabase,databaseSnapshot,frozenDatabaseSnapshot,assertRestored,assertAdopted,createCandidate,swapController} from './clean-sql-cutover.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex'),check=(ok,message)=>{if(!ok)throw Error(message);};
export async function runAdoption({command,arg,settings,c,projectRoot,root}){
const source='loop_control',deploymentPath=join(root,'deployment.json'),appPath=join(root,'app.json');
check(c.kind==='native'&&settings.database.database===source&&settings.workerDatabase.database===source&&settings.postgres.port===c.nativeConnection.port&&settings.automaticBackups===false,'Daily adoption identity/configuration mismatch');
c.assertDatabase();readMediaRootAuthorization(settings);check(!existsSync(mediaRootPendingPath(settings)),'Media publication is pending');
const head=()=>execFileSync('git',['rev-parse','HEAD'],{cwd:projectRoot,encoding:'utf8'}).trim();
const catalogPin=()=>{const a=loadSchemaCatalog(projectRoot);return hash(JSON.stringify([a.baseline,a.upgrade,...a.current].map(f=>[f.version,f.sha256])));};
const toolsPin=()=>{const files=execFileSync('git',['ls-files','src','scripts','db','package.json','package-lock.json','tsconfig*.json'],{cwd:projectRoot,encoding:'utf8'}).trim().split('\n');files.push('scripts/runtime/adopt-clean-sql.mjs','scripts/runtime/clean-sql-cutover.mjs','scripts/e2e/clean-sql-cutover.mjs','docs/verification/clean-sql-preflight-20261112/catalog-fingerprint.sql');return hash(JSON.stringify([...new Set(files)].sort().map(f=>[f,hash(readFileSync(join(projectRoot,f)))])));};
const bindings=()=>{
 const files=[deploymentPath,settings.restoreReceiptPath??join(root,'volume/restore-receipt.json'),join(root,'media-root-receipt.json'),join(root,'keychain/loop-control.keychain-db')];
 const paths=[settings.mediaRoot,settings.openChatCut.root,settings.worker.alignment.cacheDirectory];
 return {files:Object.fromEntries(files.map(p=>[p,hash(readFileSync(p))])),paths:Object.fromEntries(paths.map(p=>{const s=lstatSync(p,{bigint:true});check(!s.isSymbolicLink()&&realpathSync(p)===p,'Aliased runtime/media path');return[p,{device:String(s.dev),inode:String(s.ino)}];})),references:{database:settings.database.passwordRef,worker:settings.workerDatabase.passwordRef,keychain:settings.connections.keychain,mediaRootBinding:settings.mediaRootBinding}};
};
const preflight=()=>{
 const status=JSON.parse(c.sql(`BEGIN READ ONLY; SELECT jsonb_build_object('accounts',(SELECT count(*) FROM public.accounts),'episodes',(SELECT count(*) FROM public.episodes),'tasks',(SELECT count(*) FROM public.tasks),'publications',(SELECT count(*) FROM local_identity.native_output_publications),'dispatch',(SELECT count(*) FROM local_identity.provider_dispatch_facts),'reservations',(SELECT count(*) FROM public.paid_generation_reservations),'narrationSubmissions',(SELECT count(*) FROM local_identity.workspace_narration_submissions),'visualSubmissions',(SELECT count(*) FROM local_identity.workspace_visual_submissions),'workspaces',(SELECT count(*) FROM local_identity.production_workspaces),'assetLocks',(SELECT count(*) FROM public.asset_locks),'deletionIntents',(SELECT count(*) FROM local_identity.episode_deletion_intents),'directoryMigrations',(SELECT count(*) FROM local_identity.account_directory_migrations WHERE status NOT IN('completed','rolled_back')),'mediaMigrations',(SELECT count(*) FROM local_identity.media_root_migrations WHERE status NOT IN('completed','rolled_back')),'automationRunning',(SELECT count(*) FROM local_identity.automation_jobs WHERE status='running'),'size',pg_database_size(current_database()));COMMIT;`));
 for(const [key,value] of Object.entries(status))if(key!=='size')check(value===0,'One-off adoption requires empty production/idle storage: '+key);
 check(!execFileSync('/bin/ps',['-axo','command='],{encoding:'utf8'}).split('\n').some(line=>line.includes(projectRoot)&&/localWorkerCli|openchatcut.*server|studio.*5175/.test(line)),'Active production child process');
 const space=statfsSync(root);check(space.bavail*space.bsize>Math.max(status.size*10,1024**3),'Insufficient adoption free space');return status;
};
let work,state;
if(command==='init'){
 check(!arg,'init takes no directory');await assertPreparedRuntime(projectRoot);const release=await readPreparedRuntimeRelease(projectRoot);
 const token=randomBytes(6).toString('hex');work=join(root,'clean-sql-adoption-'+token);mkdirSync(work,{mode:0o700});
 const meta=databaseMeta(c,source),before=preflight(),record=existsSync(appPath)?JSON.parse(readFileSync(appPath)):null;
 if(record){check(inspectRecordedService({pid:record.pid,port:String(settings.port),commandIdentity:join(projectRoot,'node_modules/vite/bin/vite.js')},projectRoot).valid,'Running app identity mismatch');await assertRuntimeRelease(projectRoot,record.runtimeRelease);}
 const ledger=JSON.parse(c.sql('SELECT jsonb_object_agg(version,sha256) FROM local_identity.schema_migrations'));
 check(verifySchemaLedger(ledger,loadSchemaCatalog(projectRoot))==='legacy-v1'&&Object.keys(ledger).length===162,'Unexpected daily source generation');
 state={version:1,projectRoot,cluster:settings.postgres.systemIdentifier,head:head(),catalog:catalogPin(),tools:toolsPin(),source,sourceOid:meta.oid,candidate:'loop_control_candidate_'+token,retained:'loop_control_legacy_'+token,phase:'initialized',deploymentSha256:hash(readFileSync(deploymentPath)),bindings:bindings(),running:record,release,before,at:new Date().toISOString()};
 copyFileSync(deploymentPath,join(work,'original-deployment.json'));chmodSync(join(work,'original-deployment.json'),0o600);
 copyFileSync(settings.restoreReceiptPath??join(root,'volume/restore-receipt.json'),join(work,'original-restore-receipt.json'));chmodSync(join(work,'original-restore-receipt.json'),0o600);
 savePrivate(join(work,'state.json'),state);console.log(JSON.stringify({phase:state.phase,work,sourceOid:state.sourceOid,release:release.id}));
}else{
 check(typeof arg==='string'&&new RegExp('^'+root.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/clean-sql-adoption-[a-f0-9]{12}$').test(arg),'Invalid adoption work directory');work=arg;
 const stat=lstatSync(work);check(stat.isDirectory()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0&&realpathSync(work)===work,'Unsafe adoption directory');
 state=JSON.parse(readFileSync(join(work,'state.json')));
 check(state.version===1&&state.projectRoot===projectRoot&&state.cluster===settings.postgres.systemIdentifier&&state.head===head()&&state.catalog===catalogPin()&&state.tools===toolsPin(),'Adoption pins changed');
 check([state.deploymentSha256,state.targetDeploymentSha256].filter(Boolean).includes(hash(readFileSync(deploymentPath))),'Deployment changed');
 await assertRuntimeRelease(projectRoot,state.release);
 const save=phase=>{state.phase=phase;savePrivate(join(work,'state.json'),state);};
 const stopped=()=>{check(!existsSync(appPath),'Daily app record must be absent');};
 const verify=()=>{
  const meta=databaseMeta(c,source);check(meta?.oid===state.targetOid,'Adopted database OID mismatch');
  const before=JSON.parse(readFileSync(join(work,'source-snapshot.json'))),after=databaseSnapshot(c,source,projectRoot);assertAdopted(before,after,projectRoot);
  check(databaseMeta(c,state.retained)?.oid===state.sourceOid&&!databaseMeta(c,state.retained).datallowconn,'Retained source is not frozen');
  return after;
 };
 if(command==='stop'){
  check(state.phase==='initialized','Stop phase mismatch');preflight();
  if(existsSync(appPath)){
   const record=JSON.parse(readFileSync(appPath));check(isDeepStrictEqual(record,state.running)&&inspectRecordedService({pid:record.pid,port:String(settings.port),commandIdentity:join(projectRoot,'node_modules/vite/bin/vite.js')},projectRoot).valid,'App changed before stop');
   process.kill(record.pid,'SIGTERM');let exited=false;for(let n=0;n<150;n++){try{process.kill(record.pid,0);}catch(e){if(e.code==='ESRCH'){exited=true;break;}throw e;}await new Promise(r=>setTimeout(r,100));}check(exited,'App did not stop');unlinkSync(appPath);
  }
  idleDatabase(c,source);preflight();check(isDeepStrictEqual(bindings(),state.bindings),'Bindings changed before stop');save('stopped');
 }else if(command==='prepare'){
  stopped();check(state.phase==='stopped'&&databaseMeta(c,source)?.oid===state.sourceOid,'Prepare phase/OID mismatch');idleDatabase(c,source);preflight();
  const result=createCandidate(c,{source,candidate:state.candidate,project:projectRoot,dumpPath:join(work,'full-daily.dump'),evidence:work});
  state.targetOid=result.target.oid;state.changes=result.changes;state.dumpSha256=result.dumpSha256;state.migrations=result.migrations;
  check(isDeepStrictEqual(bindings(),state.bindings),'Bindings changed during candidate preparation');
  savePrivate(join(work,'swap.json'),{version:1,source,candidate:state.candidate,retained:state.retained,sourceOid:state.sourceOid,targetOid:state.targetOid,phase:'verified'});save('candidate-verified');
 }else if(command==='swap'){
  stopped();check(['candidate-verified','swapping'].includes(state.phase),'Swap phase mismatch');
  if(state.phase==='candidate-verified'){
   preflight();idleDatabase(c,source);idleDatabase(c,state.candidate);assertRestored(JSON.parse(readFileSync(join(work,'source-snapshot.json'))),databaseSnapshot(c,source,projectRoot));
   assertRestored(JSON.parse(readFileSync(join(work,'adopted-snapshot.json'))),databaseSnapshot(c,state.candidate,projectRoot));
  }
  save('swapping');const controller=swapController(c,join(work,'swap.json'));if(controller.state.phase!=='complete')controller.swap();const after=verify();
  check(isDeepStrictEqual(bindings(),state.bindings),'Media/Keychain/configuration binding changed');
  const receiptPath=join(work,'adoption-receipt.json');savePrivate(receiptPath,{version:1,operation:'schema-adoption',passed:true,database:source,databaseOid:state.targetOid,sourceOid:state.sourceOid,retainedDatabase:state.retained,cluster:state.cluster,mediaRoot:settings.mediaRoot,binding:settings.mediaRootBinding,publicationFence:true,allBusinessAndControlRowsPreserved:true,sequenceStatePreserved:true,rolesAndCredentialsPreserved:true,legacyLedgerPreserved:true,ledgerCount:Object.keys(after.ledger).length,migrations:state.migrations,dumpSha256:state.dumpSha256,head:state.head,runtimeRelease:state.release,at:new Date().toISOString()});
  const target={...settings,restoreReceiptPath:receiptPath,restoreReceiptMediaRoot:settings.mediaRoot};state.targetDeploymentSha256=hash(JSON.stringify(target,null,2)+'\n');savePrivate(join(work,'target-deployment.json'),target);save('publishing-receipt');savePrivate(deploymentPath,target);save('adopted');
 }else if(command==='verify'){
  stopped();check(['adopted','publishing-receipt'].includes(state.phase),'Verify phase mismatch');verify();check(JSON.parse(readFileSync(join(work,'adoption-receipt.json'))).passed,'Adoption receipt missing');if(state.phase==='publishing-receipt'){const bytes=readFileSync(join(work,'target-deployment.json'));check(hash(bytes)===state.targetDeploymentSha256,'Target deployment proof changed');savePrivateBytes(deploymentPath,bytes);}save('verified-before-start');
 }else if(command==='mark-started'||command==='start'){
  stopped();check(state.phase==='verified-before-start','Start phase mismatch');verify();const swap=JSON.parse(readFileSync(join(work,'swap.json')));swap.phase='consumers-started';savePrivate(join(work,'swap.json'),swap);save('consumers-started');
  if(command==='start'){
   execFileSync(process.execPath,[join(projectRoot,'scripts/runtime/start.mjs')],{cwd:projectRoot,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG,LOOP_EXPECTED_RUNTIME_RELEASE:state.release.id},stdio:'pipe'});
   check(JSON.parse(readFileSync(appPath)).runtimeRelease.id===state.release.id,'Started runtime differs from adopted pin');
  }
 }else if(command==='rollback'){
  stopped();check(!['consumers-started','validated'].includes(state.phase),'Consumers may have written; automatic rollback is prohibited');
  if(existsSync(join(work,'swap.json'))){
   const target=JSON.parse(c.sql(`SELECT json_build_object('name',datname,'allowed',datallowconn) FROM pg_database WHERE oid=${Number(state.targetOid)}`,'postgres'));
   check(target&&[source,state.candidate].includes(target.name),'Rollback target identity changed');idleDatabase(c,target.name);
   // Open the audit connection first, freeze admission inside that same connection,
   // then fingerprint and leave the target frozen through the name rollback.
   if(!target.allowed)c.sql(`ALTER DATABASE "${target.name}" ALLOW_CONNECTIONS true`,'postgres');
   try{assertRestored(JSON.parse(readFileSync(join(work,'adopted-snapshot.json'))),await frozenDatabaseSnapshot(c,target.name,projectRoot));}
   catch(error){c.sql(`ALTER DATABASE "${target.name}" ALLOW_CONNECTIONS ${target.allowed?'true':'false'}`,'postgres');throw error;}
   swapController(c,join(work,'swap.json')).rollback();
  }
  savePrivateBytes(deploymentPath,readFileSync(join(work,'original-deployment.json')));save('rolled-back');
 }else throw Error('Unknown adoption command');
 console.log(JSON.stringify({phase:state.phase,work,sourceOid:state.sourceOid,targetOid:state.targetOid,changes:state.changes}));
}

return {work,state};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const [command,arg,...extra]=process.argv.slice(2);check(extra.length===0,'Unexpected arguments');const settings=readSettings();check(settings.postgres.port===54330,'Daily native port changed');await runAdoption({command,arg,settings,c:runtimeContext(settings),projectRoot:dailyProjectRoot,root:dailyRoot});}
