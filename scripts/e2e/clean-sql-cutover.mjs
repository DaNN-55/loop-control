// Real disposable PostgreSQL cutover rehearsal: VM rename boundaries and native full restore/adoption.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {Client} from 'pg';
import {createDatabaseRuntime} from '../runtime/database-runtime.mjs';
import {loadSchemaCatalog,migrationTransaction} from '../../src/local-app/schemaMigrations.ts';
import {adaptBusinessSchema} from '../storage/schema-import.mjs';
import {savePrivate,createCandidate,databaseMeta,idleDatabase,databaseSnapshot,frozenDatabaseSnapshot,swapController} from '../runtime/clean-sql-cutover.mjs';
import {runAdoption} from '../runtime/adopt-clean-sql.mjs';
const project=resolve(new URL('../../',import.meta.url).pathname),evidence=mkdtempSync('/private/tmp/loop-cutover-rehearsal-');
const token=randomBytes(6).toString('hex'),results={};
const assert=(ok,label)=>{if(!ok)throw Error(label);results[label]=true;};
const journal=(c,source,candidate,retained,path)=>savePrivate(path,{version:1,source,candidate,retained,sourceOid:databaseMeta(c,source).oid,targetOid:databaseMeta(c,candidate).oid,phase:'verified'});
function swaps(c,prefix,dir){
 const source=prefix+'_source',candidate=prefix+'_candidate',retained=prefix+'_retained';
 c.sql(`CREATE DATABASE ${source} TEMPLATE template0`,'postgres');c.sql('CREATE TABLE probe(id integer PRIMARY KEY,value text); INSERT INTO probe VALUES(1,\'stable\')',source);
 c.sql(`CREATE DATABASE ${candidate} TEMPLATE ${source}`,'postgres');
 const path=join(dir,prefix+'.json');journal(c,source,candidate,retained,path);
 let interrupted=false;try{swapController(c,path).swap({interruptAfterSourceRename:true});}catch(e){interrupted=e.message.includes('Injected interruption');}
 assert(interrupted&&databaseMeta(c,retained)&&!databaseMeta(c,source),prefix+' interruption recorded');
 swapController(c,path).swap();assert(c.sql('SELECT value FROM probe',source)==='stable',prefix+' resumed by OID');
 let duplicate=false;try{swapController(c,path).swap();}catch{duplicate=true;}assert(duplicate,prefix+' duplicate refused');
 swapController(c,path).rollback();assert(c.sql('SELECT value FROM probe',source)==='stable'&&!databaseMeta(c,retained),prefix+' rollback preserves source');
 // Recovery can also roll back the first rename without finishing adoption.
 const again=join(dir,prefix+'-interrupted-rollback.json');journal(c,source,candidate,retained,again);
 try{swapController(c,again).swap({interruptAfterSourceRename:true});}catch{}
 swapController(c,again).rollback();assert(databaseMeta(c,source)?.datallowconn,prefix+' interrupted rollback');
 for(const name of [candidate,source])c.sql(`DROP DATABASE ${name}`,'postgres');
}
const env={...process.env,DOCKER_HOST:process.env.DOCKER_HOST??'unix:///Users/dan/.colima/loop-control/docker.sock'};
const docker=(args,input)=>execFileSync('docker',args,{env,input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:128*1024*1024});
const name='loop-cutover-'+token,image='sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929';let id,native;
try{
 id=docker(['run','--detach','--pull=never','--name',name,'--label','com.loop-control.test=cutover','--network','none','--cpus','2','--memory','1g','--pids-limit','256','--tmpfs','/var/lib/postgresql/data:rw,nosuid,nodev,mode=0700','-e','POSTGRES_HOST_AUTH_METHOD=trust',image]).trim();
 const owned=()=>{const m=JSON.parse(docker(['inspect',name]))[0];if(m.Id!==id||m.Image!==image||m.Config.Labels?.['com.loop-control.test']!=='cutover'||m.HostConfig.NetworkMode!=='none'||m.Mounts.some(x=>x.Type!=='tmpfs'))throw Error('VM ownership mismatch');};
 const vm={sql(q,db='postgres'){owned();if(!/^(postgres|rehearsal_vm_(source|candidate|retained))$/.test(db))throw Error('Foreign rehearsal database');return docker(['exec','-i',name,'psql','-XqAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],q).trim();}};
 let ready=false;for(let i=0;i<150;i++){try{if(!docker(['logs',name]).includes('PostgreSQL init process complete'))throw Error();vm.sql('SELECT 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert(ready,'VM ready');swaps(vm,'rehearsal_vm',evidence);owned();docker(['stop','--time','5',name]);docker(['rm',name]);id=undefined;
 const root=join(evidence,'native');mkdirSync(root,{mode:0o700});mkdirSync(join(root,'postgres'),{mode:0o700});mkdirSync(join(root,'postgres/socket'),{mode:0o700});
 const bin=realpathSync('/opt/homebrew/opt/postgresql@17/bin');
 execFileSync(join(bin,'initdb'),['-D',join(root,'postgres/data'),'-U','postgres','--auth=trust','--locale=en_US.UTF-8','--encoding=UTF8'],{stdio:'pipe'});
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const control=execFileSync(join(bin,'pg_controldata'),[join(root,'postgres/data')],{encoding:'utf8',env:{...process.env,LANG:'C',LC_ALL:'C'}});
 const postgres={kind:'native',binDirectory:bin,dataDirectory:join(root,'postgres/data'),socketDirectory:join(root,'postgres/socket'),systemIdentifier:control.match(/^Database system identifier:\s*(\d+)/m)[1],majorVersion:17,port,adminUser:'postgres'};
 native=createDatabaseRuntime({postgres,database:{database:'rehearsal_native_source'}},{projectRoot:project,root});native.ensureStarted();
 swaps(native,'rehearsal_native',evidence);
 native.sql('CREATE ROLE loop_app LOGIN; CREATE ROLE loop_owner; CREATE ROLE loop_worker LOGIN; CREATE ROLE loop_anonymous; GRANT loop_owner TO loop_app;','postgres');
 native.sql('CREATE DATABASE rehearsal_legacy TEMPLATE template0','postgres');native.sql("ALTER DATABASE rehearsal_legacy SET loop.restore_state='ready'",'postgres');
 const catalog=loadSchemaCatalog(project),historical=readFileSync(join(project,'db/local/identity.sql'),'utf8')+'\n'+adaptBusinessSchema(readFileSync(join(project,'db/archive/legacy-v1/c-baseline.sql'),'utf8')).sql+'\nSET search_path=public;\n'+readFileSync(join(project,'db/local/read-access.sql'),'utf8')+'\nCREATE TABLE local_identity.schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());';
 native.sql('BEGIN;'+historical+'COMMIT;','rehearsal_legacy');native.sql(migrationTransaction(catalog.legacy),'rehearsal_legacy');
 native.sql("INSERT INTO local_identity.owners(id,email) VALUES('8b8b8b8b-1111-4222-8333-444444444444','rehearsal@example.invalid'); INSERT INTO local_identity.storyboard_planning_defaults(owner_id,selection) VALUES('8b8b8b8b-1111-4222-8333-444444444444','{\"historical\":true}');",'rehearsal_legacy');
 const r=createCandidate(native,{source:'rehearsal_legacy',candidate:'rehearsal_clean',project,dumpPath:join(evidence,'synthetic.dump'),evidence});assert(r.migrations.length===6,'Native full dump restore and adoption');
 const client=new Client({host:postgres.socketDirectory,port,user:'postgres',database:'rehearsal_legacy'});await client.connect();let blocked=false;try{idleDatabase(native,'rehearsal_legacy');}catch{blocked=true;}finally{await client.end();}assert(blocked,'Native active client blocks swap');
 const path=join(evidence,'native-adoption.json');journal(native,'rehearsal_legacy','rehearsal_clean','rehearsal_retained',path);swapController(native,path).swap();assert(databaseMeta(native,'rehearsal_retained')?.datallowconn===false,'Native old database frozen');swapController(native,path).rollback();
 // Exercise the actual controller with only synthetic identities, credentials and media.
 native.sql('ALTER DATABASE rehearsal_legacy RENAME TO loop_control','postgres');
 for(const dir of ['media','OpenChatCut','cache','volume','keychain'])mkdirSync(join(root,dir),{mode:0o700});
 writeFileSync(join(root,'keychain/loop-control.keychain-db'),'synthetic-keychain',{mode:0o600});
 const media=lstatSync(join(root,'media'),{bigint:true}),binding={path:join(root,'media'),deviceId:String(media.dev),inodeId:String(media.ino),mountPath:'/'};
 const settings={runtimeRoot:root,postgres,database:{database:'loop_control',passwordRef:'synthetic-app'},workerDatabase:{database:'loop_control',passwordRef:'synthetic-worker'},automaticBackups:false,mediaRoot:binding.path,mediaRootBinding:binding,worker:{mountPath:'/',alignment:{cacheDirectory:join(root,'cache')}},openChatCut:{root:join(root,'OpenChatCut')},connections:{keychain:{synthetic:true}}};
 savePrivate(join(root,'deployment.json'),settings);savePrivate(join(root,'media-root-receipt.json'),{version:1,operation:'initialize',database:'loop_control',binding,publicationFence:true});savePrivate(join(root,'volume/restore-receipt.json'),{passed:true,database:'loop_control',mediaRoot:binding.path,publicationFence:true});
 const controllerRuntime=createDatabaseRuntime({...settings,database:{database:'loop_control'}},{projectRoot:project,root});
 const invoke=(command,arg)=>runAdoption({command,arg,settings:JSON.parse(readFileSync(join(root,'deployment.json'))),c:controllerRuntime,projectRoot:project,root});
 let run=await invoke('init');await invoke('stop',run.work);await invoke('prepare',run.work);await invoke('swap',run.work);await invoke('verify',run.work);
 await frozenDatabaseSnapshot(controllerRuntime,'loop_control',project);let raced=false;
 try{controllerRuntime.sql("INSERT INTO local_identity.owners(id,email) VALUES('8b8b8b8b-1111-4222-8333-888888888888','race@example.invalid')");}catch(e){raced=String(e.stderr).includes('not currently accepting connections');}
 assert(raced,'Writer after final rollback snapshot cannot connect');
 let auditFailed=false;
 try{await runAdoption({command:'rollback',arg:run.work,settings:JSON.parse(readFileSync(join(root,'deployment.json'))),c:{...controllerRuntime,spawnTool(){throw Error('Injected audit connection failure');}},projectRoot:project,root});}catch(e){auditFailed=e.message.includes('Injected audit connection failure');}
 assert(auditFailed&&!databaseMeta(controllerRuntime,'loop_control').datallowconn,'Failed audit restores an initially frozen target');
 await invoke('rollback',run.work);assert(databaseMeta(controllerRuntime,'loop_control').oid===run.state.sourceOid,'Controller full cycle and rollback');
 // Repeated no-swap abort is explicit; no nonexistent journal is read.
 run=await invoke('init');await invoke('rollback',run.work);assert(databaseMeta(controllerRuntime,'loop_control').datallowconn,'Controller abort before swap');
 run=await invoke('init');await invoke('stop',run.work);await invoke('prepare',run.work);await invoke('swap',run.work);
 controllerRuntime.sql("INSERT INTO local_identity.owners(id,email) VALUES('8b8b8b8b-1111-4222-8333-999999999999','new-write@example.invalid')");let wrote=false;try{await invoke('rollback',run.work);}catch(e){wrote=e.message.includes('mismatch');}assert(wrote,'Controller refuses rollback after any new target row');
 // Remove the synthetic probe only, then inject the receipt-publication interruption.
 controllerRuntime.sql("DELETE FROM local_identity.owners WHERE id='8b8b8b8b-1111-4222-8333-999999999999'");
 const statePath=join(run.work,'state.json'),state=JSON.parse(readFileSync(statePath));state.phase='publishing-receipt';savePrivate(statePath,state);writeFileSync(join(root,'deployment.json'),readFileSync(join(run.work,'original-deployment.json')),{mode:0o600});await invoke('verify',run.work);
 assert(JSON.parse(readFileSync(join(root,'deployment.json'))).restoreReceiptPath===join(run.work,'adoption-receipt.json'),'Controller recovers interrupted receipt publication');
 await invoke('mark-started',run.work);let started=false;try{await invoke('rollback',run.work);}catch(e){started=e.message.includes('Consumers may have written');}assert(started,'Controller forbids rollback after consumer marker');
 native.stop();native=undefined;
 savePrivate(join(evidence,'verification.json'),{passed:true,results});console.log(JSON.stringify({passed:true,evidence,results}));
}catch(e){writeFileSync(join(evidence,'error.txt'),String(e.stack??e),{mode:0o600});console.error(JSON.stringify({passed:false,evidence,error:e.message}));process.exitCode=1;}
finally{if(id){const m=JSON.parse(docker(['inspect',name]))[0];if(m.Id===id&&m.Config.Labels?.['com.loop-control.test']==='cutover'){docker(['stop','--time','5',name]);docker(['rm',name]);}}if(native)native.stop();}
