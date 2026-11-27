// Self-contained T12 acceptance: disposable source, SDK and native PostgreSQL.
// This runner never imports the daily deployment reader or accesses its secrets.
import {spawn,execFileSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdtemp,mkdir,cp,symlink,readFile,readdir,writeFile,realpath,rm,chmod,lstat} from 'node:fs/promises';
import {join,dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {loadSchemaCatalog,freshSchemaTransaction} from '../../src/local-app/schemaMigrations.ts';

const project=await realpath(fileURLToPath(new URL('../../',import.meta.url)));
process.umask(0o077);
let scenario='all',output;
for(let i=2;i<process.argv.length;i++){
 const option=process.argv[i],value=process.argv[++i];
 if(option==='--scenario'&&['all','series','unassigned'].includes(value))scenario=value;
 else if(option==='--output'&&value)output=resolve(value);
 else throw Error('Usage: node scripts/e2e/t12.mjs [--scenario all|series|unassigned] [--output directory]');
}
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(4).toString('hex');
const root=await mkdtemp('/private/tmp/loop-t12-e2e-');await chmod(root,0o700);
const source=join(root,'source'),sdkCopy=join(root,'OpenChatCut'),temporary=join(root,'tmp');
const evidence=join(output??join(project,'.scratch','t12-e2e'),runId);
await mkdir(evidence,{recursive:true,mode:0o700});await chmod(evidence,0o700);
await mkdir(source);await mkdir(temporary,{mode:0o700});
const pgpass=join(root,'empty-pgpass');await writeFile(pgpass,'',{mode:0o600});
// macOS PostgreSQL can initialize locale services with extra threads and abort
// startup when no locale is set. Scope a known-valid C fallback to this run.
const localeFallback=!process.env.LANG,locale=localeFallback?{LANG:'C',LC_ALL:'C'}:{LANG:process.env.LANG};
const browserSocket=join(root,'browser');await mkdir(browserSocket,{mode:0o700});
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:temporary,...locale,PGPASSFILE:pgpass,AGENT_BROWSER_SOCKET_DIR:browserSocket};
const session='t12-'+randomBytes(8).toString('hex');
let active,processGroup,clusterStarted=false,clusterStartAttempted=false,bin,data,socket,port=5432,interrupted=false;
const cleanup={clusterStopped:false,ownedClusterAbsent:false,clusterStatusChecked:false,postgresLogPreserved:false,partialStartProcessFound:false,browserSessionsVerified:false,closedSessions:[],sourceRemoved:false,temporaryRootRemoved:false,privateBrowserInputsRemoved:false,ownedMountCleanupVerified:false,detachedOwnedImages:[],cleanupErrors:[]};
console.log('T12 evidence: '+evidence);

const run=(command,args,log,extra={})=>new Promise((done,reject)=>{
 if(interrupted){reject(Error('T12 interrupted'));return;}
 const stream=createWriteStream(log,{mode:0o600});
 active=spawn(command,args,{cwd:source,env:{...env,...extra},stdio:['ignore','pipe','pipe'],detached:true});processGroup=active.pid;
 active.stdout.pipe(stream,{end:false});active.stderr.pipe(stream,{end:false});
 active.once('error',error=>{stream.end();active=undefined;reject(error);});
 active.once('close',(code,signal)=>{stream.end(()=>{active=undefined;done({code,signal});});});
});
const killOwnedGroup=signal=>{if(processGroup)try{process.kill(-processGroup,signal);}catch(error){if(error.code!=='ESRCH')throw error;}};
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{interrupted=true;killOwnedGroup('SIGTERM');});
const tools=new Set(['psql','pg_dump','pg_restore']);
const nativeTool=(tool,args,input,options={})=>{
 if(!tools.has(tool))throw Error('Unsupported isolated database tool');
 return execFileSync(join(bin,tool),['-h',socket,'-p',String(port),'-U','postgres',...args],{env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe'],...options});
};
async function findPostgres(){
 const candidates=[process.env.LOOP_TEST_POSTGRES_BIN,'/opt/homebrew/opt/postgresql@17/bin','/usr/local/opt/postgresql@17/bin'].filter(Boolean);
 try{candidates.push(execFileSync('pg_config',['--bindir'],{env,encoding:'utf8'}).trim());}catch{}
 for(const candidate of candidates)try{const path=await realpath(candidate),version=execFileSync(join(path,'postgres'),['--version'],{env,encoding:'utf8'});if(/\(PostgreSQL\) 17\./.test(version))return path;}catch{}
 throw Error('PostgreSQL 17 is required; set LOOP_TEST_POSTGRES_BIN to its existing bin directory.');
}
async function removePrivateInputs(path){
 for(const entry of await readdir(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.isDirectory())await removePrivateInputs(file);else if(entry.name==='browser.json')await rm(file,{force:true});}
}
async function closeOwnedBrowserSessions(){
 const owned=[];
 for(const kind of ['series','unassigned']){
  const file=join(evidence,kind,'browser.json');let invitation;
  try{
   const stat=await lstat(file);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.size>64*1024)throw Error('Unsafe T12 browser invitation: '+kind);
   invitation=JSON.parse(await readFile(file,'utf8'));
  }catch(error){if(error.code==='ENOENT')continue;throw error;}
  const suffix=typeof invitation.runId==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(invitation.runId)?invitation.runId.slice(0,8):undefined;
  if(invitation.version!=='t12-handshake/v1'||invitation.kind!==kind||!suffix||invitation.session!==session+'-'+kind+'-'+suffix||invitation.evidence!==join(evidence,kind))throw Error('Unverified T12 browser session ownership: '+kind);
  owned.push(invitation.session);
 }
 // The fixture uses per-case sessions, never the base runner identifier. A
 // missing invitation means no fallback browser operation is authorized.
 for(const ownedSession of owned){
  execFileSync('agent-browser',['--session',ownedSession,'close'],{env,stdio:'pipe',timeout:15000});cleanup.closedSessions.push(ownedSession);
 }
 cleanup.browserSessionsVerified=true;
}
async function detachOwnedImages(){
 if(process.platform!=='darwin'){cleanup.ownedMountCleanupVerified=true;return;}
 const plist=execFileSync('hdiutil',['info','-plist'],{env,maxBuffer:8*1024*1024});
 const inventory=JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-','--','-'],{env,input:plist,encoding:'utf8'}));
 for(const image of inventory.images??[]){
  const path=image['image-path'];if(typeof path!=='string'||!path.startsWith(root+'/'))continue;
  for(const entity of image['system-entities']??[]){
   const mount=entity['mount-point'];if(!mount)continue;
   execFileSync('hdiutil',['detach',mount],{env,stdio:'pipe',timeout:30000});cleanup.detachedOwnedImages.push(path);
   const parent=dirname(mount);if(/^\/private\/tmp\/loop-t06-mount-[A-Za-z0-9]+$/.test(parent)&&mount===join(parent,'mounted'))await rm(parent,{recursive:true,force:true});
  }
 }
 cleanup.ownedMountCleanupVerified=true;
}
async function preservePostgresLog(){
 const log=join(root,'postgres.log');
 try{const stat=await lstat(log);if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid())throw Error('Unexpected owned PostgreSQL log');await cp(log,join(evidence,'postgres.log'));cleanup.postgresLogPreserved=true;}catch(error){if(error.code!=='ENOENT')throw error;}
}
async function stopOwnedPostgres(){
 if(!clusterStartAttempted){cleanup.ownedClusterAbsent=true;return;}
 if(data!==join(root,'postgres')||!/^[A-Za-z0-9-]+$/.test(relative('/private/tmp',root))||!relative('/private/tmp',root).startsWith('loop-t12-e2e-'))throw Error('Owned PostgreSQL data path mismatch');
 for(const path of [root,data,socket]){const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0||await realpath(path)!==path)throw Error('Owned PostgreSQL directory identity mismatch');}
 let pid;
 try{
  const file=join(data,'postmaster.pid'),stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.size>4096)throw Error('Owned PostgreSQL process receipt is unsafe');
  const lines=(await readFile(file,'utf8')).split('\n');pid=Number(lines[0]);
  if(!Number.isSafeInteger(pid)||pid<=1||lines[1]!==data||Number(lines[3])!==port||lines[4]!==socket)throw Error('Owned PostgreSQL process receipt mismatch');
 }catch(error){if(error.code!=='ENOENT')throw error;}
 const status=()=>{try{execFileSync(join(bin,'pg_ctl'),['-D',data,'status'],{env,stdio:'pipe'});return true;}catch(error){if(error.status===3)return false;throw error;}};
 cleanup.clusterStatusChecked=true;
 if(status()){
  if(!pid)throw Error('Running owned PostgreSQL has no valid process receipt');
  const uid=Number(execFileSync('/bin/ps',['-p',String(pid),'-o','uid='],{env,encoding:'utf8'}).trim());
  const binary=execFileSync('/bin/ps',['-ww','-p',String(pid),'-o','comm='],{env,encoding:'utf8'}).trim();
  const args=execFileSync('/bin/ps',['-ww','-p',String(pid),'-o','args='],{env,encoding:'utf8'}).trim().split(/\s+/);
  if(uid!==process.getuid()||await realpath(binary)!==join(bin,'postgres')||args[args.indexOf('-D')+1]!==data)throw Error('Refusing to stop an unverified PostgreSQL process');
  cleanup.partialStartProcessFound=!clusterStarted;
  execFileSync(join(bin,'pg_ctl'),['-D',data,'-m','fast','-w','stop'],{env,stdio:'pipe',timeout:15000});cleanup.clusterStopped=true;
 }
 if(status())throw Error('Owned PostgreSQL still running after cleanup');
 cleanup.ownedClusterAbsent=true;
}

let passed=false,tests,result,errorMessage;
try{
 if(process.platform!=='darwin')throw Error('T12 mountpoint acceptance requires the existing macOS hdiutil fixture.');
 for(const entry of ['src','scripts','db','public','index.html','package.json','package-lock.json','vite.config.ts',...(await readdir(project)).filter(name=>/^tsconfig.*\.json$/.test(name))])await cp(join(project,entry),join(source,entry),{recursive:true});
 for(const entry of ['docs/production-tests/rizhao-jinshan-20261028/scripts','docs/verification/clean-sql-preflight-20261112/catalog-fingerprint.sql','docs/runtime/runtime-support.json']){await mkdir(dirname(join(source,entry)),{recursive:true});await cp(join(project,entry),join(source,entry),{recursive:true});}
 await symlink(join(project,'node_modules'),join(source,'node_modules'),'dir');
 for(const name of (await readdir(source)).filter(name=>/^tsconfig.*\.json$/.test(name))){const file=join(source,name),config=JSON.parse(await readFile(file,'utf8'));if(config.compilerOptions?.tsBuildInfoFile){config.compilerOptions.tsBuildInfoFile=join(root,name+'.tsbuildinfo');await writeFile(file,JSON.stringify(config,null,2));}}
 const sdk=await realpath(process.env.LOOP_TEST_OPENCHATCUT_ROOT??join(project,'.loop-control/local/OpenChatCut'));
 await cp(sdk,sdkCopy,{recursive:true,filter:path=>!path.slice(sdk.length).split('/').some(part=>['node_modules','.git','.data','dist','.vite','data'].includes(part)||part==='.env'||part.startsWith('.env.'))});await symlink(join(sdk,'node_modules'),join(sdkCopy,'node_modules'),'dir');
 const manifest={};async function fingerprint(directory){for(const entry of await readdir(directory,{withFileTypes:true})){if(entry.name==='node_modules')continue;const path=join(directory,entry.name);if(entry.isDirectory())await fingerprint(path);else if(entry.isFile())manifest[relative(source,path)]=createHash('sha256').update(await readFile(path)).digest('hex');}}
 await fingerprint(source);await writeFile(join(evidence,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
 console.log('T12: preparing the isolated runtime');
 const build=await run('npm',['run','runtime:prepare'],join(evidence,'build.log'));if(build.code!==0||interrupted)throw Error('Isolated runtime preparation failed; see build.log');
 bin=await findPostgres();data=join(root,'postgres');socket=join(root,'socket');await mkdir(socket,{mode:0o700});
 execFileSync(join(bin,'initdb'),['-D',data,'-U','postgres','-A','trust','--no-locale','-E','UTF8'],{env,stdio:'pipe'});
 clusterStartAttempted=true;
 execFileSync(join(bin,'pg_ctl'),['-D',data,'-l',join(root,'postgres.log'),'-o',`-k ${socket} -p ${port} -h ''`,'-w','start'],{env,stdio:'pipe'});clusterStarted=true;
 nativeTool('psql',['-XqAt','-d','postgres','-v','ON_ERROR_STOP=1'],'CREATE ROLE loop_app LOGIN;CREATE ROLE loop_worker LOGIN;CREATE ROLE loop_owner NOLOGIN;CREATE ROLE loop_anonymous NOLOGIN;GRANT loop_owner TO loop_app;CREATE DATABASE loop_t12_baseline TEMPLATE template0;');
 nativeTool('psql',['-XqAt','-d','loop_t12_baseline','-v','ON_ERROR_STOP=1'],freshSchemaTransaction(loadSchemaCatalog(source)));
 const context=join(root,'runtime-context.mjs');
 await writeFile(context,`import{execFileSync,spawn}from'node:child_process';import{readFileSync,lstatSync,realpathSync}from'node:fs';
const bin=${JSON.stringify(bin)},data=${JSON.stringify(data)},socket=${JSON.stringify(socket)},root=${JSON.stringify(root)},port=${port},env=${JSON.stringify(env)};
export function runtimeContext(){
 const assertDatabase=()=>{const s=lstatSync(root),pid=readFileSync(data+'/postmaster.pid','utf8').split('\\n');if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)!==0||realpathSync(root)!==root||pid[1]!==data||pid[4]!==socket||Number(pid[3])!==port)throw Error('Owned native cluster identity mismatch');execFileSync(bin+'/pg_ctl',['-D',data,'status'],{env,stdio:'pipe'});};
 const permitted=name=>name==='loop_t12_baseline'||/^loop_[a-z0-9_]+_[a-f0-9]{12}(?:_[a-z]+)?$/.test(name);
 const execTool=(tool,args,input,options={})=>{assertDatabase();if(!['psql','pg_dump','pg_restore'].includes(tool))throw Error('Unsupported isolated tool');const i=args.indexOf('-d');if(i>=0&&!permitted(args[i+1])&&args[i+1]!=='postgres')throw Error('Foreign isolated database');return execFileSync(bin+'/'+tool,['-h',socket,'-p',String(port),'-U','postgres',...args],{env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe'],...options});};
 const sql=(q,db='loop_t12_baseline')=>{if(db==='postgres'){if(!/^(CREATE DATABASE loop_[a-z0-9_]+ TEMPLATE template0|DROP DATABASE loop_[a-z0-9_]+ WITH\\s*\\(FORCE\\)|ALTER DATABASE loop_[a-z0-9_]+ SET loop\\.restore_state='(?:pending|ready)'|SELECT count\\(\\*\\) FROM pg_database WHERE datname='loop_[a-z0-9_]+')\\s*;?$/i.test(q.trim())&&q!==${JSON.stringify("SELECT jsonb_object_agg(rolname,jsonb_build_object('super',rolsuper,'bypass',rolbypassrls,'createdb',rolcreatedb,'createrole',rolcreaterole)) FROM pg_roles WHERE rolname IN ('loop_app','loop_owner','loop_worker','loop_anonymous')")})throw Error('Unapproved isolated catalog statement');}else if(!permitted(db))throw Error('Foreign isolated database');return execTool('psql',['-XqAt','-d',db,'-v','ON_ERROR_STOP=1'],q).trim();};
 const spawnTool=(tool,args,options={})=>{assertDatabase();if(tool!=='psql'||!permitted(args[args.indexOf('-d')+1]))throw Error('Foreign isolated streaming database');return spawn(bin+'/'+tool,['-h',socket,'-p',String(port),'-U','postgres',...args],{env,stdio:['pipe','pipe','pipe'],...options});};
 return{database:'loop_t12_baseline',dailyRuntime:false,isolatedFixtureNative:true,nativeConnection:{host:socket,port},env,assertDatabase,execTool,spawnTool,sql};
}
`,{mode:0o600});
 console.log('T12: running '+scenario+' against isolated PostgreSQL 17');
 const name=scenario==='all'?'formal page creates a (?:series|unassigned) order':'formal page creates a '+scenario+' order';
 result=await run(process.execPath,[join(project,'node_modules/vitest/vitest.mjs'),'run','src/local-app/episodeCreation.browser.integration.test.ts','--maxWorkers=1','--fileParallelism=false','--reporter=default','--reporter=json','--outputFile='+join(evidence,'vitest.json'),'-t',name],join(evidence,'tests.log'),{LOOP_T12_BROWSER:'1',LOOP_T12_EVIDENCE:evidence,LOOP_T12_SESSION:session,LOOP_TEST_CONTEXT_MODULE:context,LOOP_TEST_OPENCHATCUT_ROOT:sdkCopy,OPENCHATCUT_ROOT:sdkCopy});
 const report=JSON.parse(await readFile(join(evidence,'vitest.json'),'utf8'));tests={total:report.numTotalTests,passed:report.numPassedTests,failed:report.numFailedTests,pending:report.numPendingTests};
 const expected=scenario==='all'?2:1;passed=!interrupted&&result.code===0&&tests.passed===expected&&tests.failed===0;
 if(!passed)errorMessage='T12 scenarios did not all pass; see tests.log and vitest.json';
}catch(error){errorMessage=error instanceof Error?error.stack:String(error);await writeFile(join(evidence,'runner-error.txt'),errorMessage+'\n',{mode:0o600});}
finally{
 for(const action of [
  async()=>{killOwnedGroup('SIGTERM');await new Promise(resolve=>setTimeout(resolve,300));killOwnedGroup('SIGKILL');},
  closeOwnedBrowserSessions,
  detachOwnedImages,
  preservePostgresLog,
  stopOwnedPostgres,
  preservePostgresLog,
  async()=>{if(!cleanup.browserSessionsVerified)throw Error('Browser session ownership or closure is unconfirmed; private inputs retained');await removePrivateInputs(evidence);cleanup.privateBrowserInputsRemoved=true;},
  async()=>{if(!cleanup.browserSessionsVerified||!cleanup.ownedClusterAbsent||!cleanup.ownedMountCleanupVerified)throw Error('Owned browser, database or mount cleanup has not completed; recovery files retained');if(relative('/private/tmp',root).startsWith('loop-t12-e2e-')&&await realpath(root)===root){await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});cleanup.sourceRemoved=true;cleanup.temporaryRootRemoved=true;}else throw Error('Owned cleanup path mismatch');},
 ])try{await action();}catch(error){cleanup.cleanupErrors.push(error instanceof Error?error.message:String(error));}
 if(cleanup.cleanupErrors.length)passed=false;
 const record={passed,scenario,tests,interrupted,...(errorMessage?{error:errorMessage}:{}),execution:result,cleanup,evidence,...(cleanup.temporaryRootRemoved?{}:{recoveryRoot:root}),locale:{LANG:env.LANG??null,LC_ALL:env.LC_ALL??null,fallback:localeFallback},paidProviderCalls:0,dailyDeploymentAccessed:false,sourceSnapshotIsolated:true,sdkSourceCopy:true};
 await writeFile(join(evidence,'run.json'),JSON.stringify(record,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({passed,scenario,tests,evidence,cleanupErrors:cleanup.cleanupErrors}));
}
process.exitCode=passed?0:1;
