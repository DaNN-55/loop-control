// PostgreSQL maintenance port. Native clusters never pass through Docker or load application secrets.
import {execFileSync,spawn} from 'node:child_process';
import {existsSync,lstatSync,readFileSync,realpathSync,openSync,closeSync,constants} from 'node:fs';
import {isAbsolute,join} from 'node:path';

const tools=new Set(['psql','pg_dump','pg_restore']);
const databaseName=name=>{if(!/^[a-z_][a-z0-9_]*$/.test(name??''))throw Error('Invalid database');return name;};
const quoteArgument=value=>"'"+value.replaceAll("'","'\\''")+"'";
export function validateNativePostgres(p,root){
 if(p?.kind!=='native'||p.majorVersion!==17||!Number.isInteger(p.port)||p.port<1024||p.port>65535||!/^[1-9][0-9]{9,19}$/.test(p.systemIdentifier??'')||!/^[a-z_][a-z0-9_]*$/.test(p.adminUser??'')||typeof p.binDirectory!=='string'||!isAbsolute(p.binDirectory)||p.dataDirectory!==join(root,'postgres/data')||p.socketDirectory!==join(root,'postgres/socket'))throw Error('Native PostgreSQL configuration mismatch');
 return p;
}
const defaultOperations={execFileSync,spawn,existsSync,lstatSync,readFileSync,realpathSync,openSync,closeSync};
export function createDatabaseRuntime(deployment,{projectRoot,root,ensurePrivateDirectory,operations={}}){
 const op={...defaultOperations,...operations},p=deployment.postgres,kind=p.kind??'container';
 const env={PATH:process.env.PATH,HOME:deployment.home??process.env.HOME,TMPDIR:process.env.TMPDIR,LANG:'C',LC_ALL:'C',PGPASSFILE:'/dev/null'};
 const exec=(file,args,input,options={})=>op.execFileSync(file,args,{env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe'],...options});
 let assertDatabase,execTool,spawnTool,ensureStarted,stop;
 if(kind==='native'){
  validateNativePostgres(p,root);
  const privateDirectory=path=>{const s=op.lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o077)!==0||op.realpathSync(path)!==path)throw Error('Native PostgreSQL directory must be canonical, private and owned');};
  const binary=tool=>join(p.binDirectory,tool);
  const assertFiles=()=>{
   privateDirectory(root);privateDirectory(join(root,'postgres'));privateDirectory(p.dataDirectory);privateDirectory(p.socketDirectory);
   const bin=op.lstatSync(p.binDirectory);if(!bin.isDirectory()||op.realpathSync(p.binDirectory)!==p.binDirectory||!([0,process.getuid?.()].includes(bin.uid))||(bin.mode&0o022)!==0)throw Error('Native PostgreSQL binary directory identity mismatch');
   for(const tool of ['postgres','pg_ctl','pg_controldata',...tools]){const path=binary(tool),s=op.lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||op.realpathSync(path)!==path||!([0,process.getuid?.()].includes(s.uid))||(s.mode&0o022)!==0||(s.mode&0o111)===0)throw Error('Native PostgreSQL binary identity mismatch');if(!new RegExp(`\\(PostgreSQL\\) ${p.majorVersion}\\.`).test(exec(path,['--version'])))throw Error('Native PostgreSQL binary major version mismatch');}
   if(String(op.readFileSync(join(p.dataDirectory,'PG_VERSION'),'utf8')).trim()!==String(p.majorVersion))throw Error('Native PostgreSQL data major version mismatch');
   const control=exec(binary('pg_controldata'),[p.dataDirectory]);if(control.match(/^Database system identifier:\s*(\d+)\s*$/m)?.[1]!==p.systemIdentifier)throw Error('Native PostgreSQL system identifier mismatch');
  };
  const connection=['-h',p.socketDirectory,'-p',String(p.port),'-U',p.adminUser,'--no-password'];
  const rawTool=(tool,args,input,options)=>{if(!tools.has(tool))throw Error('Unsupported PostgreSQL tool');return exec(binary(tool),[...connection,...args],input,options);};
  assertDatabase=()=>{
   assertFiles();const pidFile=join(p.dataDirectory,'postmaster.pid'),s=op.lstatSync(pidFile);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o077)!==0)throw Error('Native PostgreSQL process record is not private and owned');
   const record=String(op.readFileSync(pidFile,'utf8')).split('\n'),pid=Number(record[0]);
   if(!Number.isSafeInteger(pid)||pid<=1||record[1]!==p.dataDirectory||Number(record[3])!==p.port||record[4]!==p.socketDirectory||record[5]!=='127.0.0.1'||record[7]?.trim()!=='ready')throw Error('Native PostgreSQL process record identity mismatch');
   if(Number(exec('/bin/ps',['-p',String(pid),'-o','uid=']).trim())!==process.getuid?.()||op.realpathSync(exec('/bin/ps',['-ww','-p',String(pid),'-o','comm=']).trim())!==binary('postgres'))throw Error('Native PostgreSQL process owner or binary mismatch');
   exec(binary('pg_ctl'),['-D',p.dataDirectory,'status']);
   const listeners=exec('/usr/sbin/lsof',['-nP','-a','-p',String(pid),'-iTCP','-sTCP:LISTEN','-Fn']).split('\n').filter(line=>line.startsWith('n'));
   if(listeners.length!==1||listeners[0]!==`n127.0.0.1:${p.port}`)throw Error('Native PostgreSQL must listen on its dedicated loopback port only');
   const identity=JSON.parse(rawTool('psql',['-XqAt','-d','postgres','-v','ON_ERROR_STOP=1'],"SELECT json_build_object('systemIdentifier',system_identifier::text,'dataDirectory',current_setting('data_directory'),'port',current_setting('port')::int,'listenAddresses',current_setting('listen_addresses'),'majorVersion',current_setting('server_version_num')::int / 10000,'role',session_user) FROM pg_control_system();"));
   if(identity.systemIdentifier!==p.systemIdentifier||identity.dataDirectory!==p.dataDirectory||identity.port!==p.port||identity.listenAddresses!=='127.0.0.1'||identity.majorVersion!==p.majorVersion||identity.role!==p.adminUser)throw Error('Native PostgreSQL live database identity mismatch');
  };
  execTool=(tool,args,input,options)=>{assertDatabase();return rawTool(tool,args,input,options);};
  spawnTool=(tool,args,options={})=>{assertDatabase();if(!tools.has(tool))throw Error('Unsupported PostgreSQL tool');return op.spawn(binary(tool),[...connection,...args],{env,stdio:['pipe','pipe','pipe'],...options});};
  ensureStarted=()=>{
   assertFiles();if(op.existsSync(join(p.dataDirectory,'postmaster.pid'))){assertDatabase();return;}
   try{const listeners=exec('/usr/sbin/lsof',['-nP',`-iTCP:${p.port}`,'-sTCP:LISTEN','-Fn']);if(listeners.trim())throw Error('Native PostgreSQL port is already occupied');}catch(error){if(error.status!==1||String(error.stdout??'').trim()||String(error.stderr??'').trim())throw error;}
   const log=join(root,'postgres/server-private.log');if(op.existsSync(log)){const s=op.lstatSync(log);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==process.getuid?.()||(s.mode&0o077)!==0)throw Error('Unsafe native PostgreSQL log');}
   op.closeSync(op.openSync(log,constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW,0o600));
   exec(binary('pg_ctl'),['-D',p.dataDirectory,'-l',log,'-w','-t','30','-o',`-p ${p.port} -h 127.0.0.1 -k ${quoteArgument(p.socketDirectory)} -c unix_socket_permissions=0700`,'start'],undefined,{timeout:45000});assertDatabase();
  };
  stop=()=>{assertFiles();if(!op.existsSync(join(p.dataDirectory,'postmaster.pid')))return;assertDatabase();if(rawTool('psql',['-XqAt','-d','postgres','-v','ON_ERROR_STOP=1'],"SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid();").trim()!=='0')throw Error('Native PostgreSQL still has client connections; not stopped');exec(binary('pg_ctl'),['-D',p.dataDirectory,'-m','smart','-w','-t','30','stop'],undefined,{timeout:45000});};
 }else if(kind==='container'){
  env.DOCKER_HOST='unix://'+join(env.HOME,'.colima/loop-control/docker.sock');
  const docker=(args,input,options)=>exec('docker',args,input,options);
  assertDatabase=()=>{const c=JSON.parse(docker(['inspect',p.container]))[0];if(c.Config.Image!==p.image||c.Config.Labels?.['com.loop-control.project']!==projectRoot||c.Config.Labels?.['com.loop-control.runtime']!=='local-daily')throw Error('Daily PostgreSQL container identity mismatch');};
  execTool=(tool,args,input,options)=>{assertDatabase();if(!tools.has(tool))throw Error('Unsupported PostgreSQL tool');return docker(['exec','-i',p.container,tool,...(tool==='pg_restore'?[]:['-U','postgres']),...args],input,options);};
  spawnTool=(tool,args,options={})=>{assertDatabase();if(!tools.has(tool))throw Error('Unsupported PostgreSQL tool');return op.spawn('docker',['exec','-i',p.container,tool,...(tool==='pg_restore'?[]:['-U','postgres']),...args],{env,stdio:['pipe','pipe','pipe'],...options});};
  return{kind,container:p.container,env,docker,assertDatabase,execTool,spawnTool,sql:(text,database=deployment.database.database)=>execTool('psql',['-XqAt','-d',databaseName(database),'-v','ON_ERROR_STOP=1'],text).trim()};
 }else throw Error('Unknown PostgreSQL runtime kind');
 return{kind,nativeConnection:{host:p.socketDirectory,port:p.port},env,assertDatabase,execTool,spawnTool,ensureStarted,stop,sql:(text,database=deployment.database.database)=>execTool('psql',['-XqAt','-d',databaseName(database),'-v','ON_ERROR_STOP=1'],text).trim()};
}

// Older isolated container fixtures can retain their existing identity guard.
// A native context must expose the explicit tool port; it never uses this adapter.
export function databaseOperations(runtime){
 if(runtime.execTool&&runtime.spawnTool)return runtime;
 if(runtime.kind==='native'||runtime.deployment?.postgres?.kind==='native')throw Error('Native PostgreSQL tool port missing');
 const execTool=(tool,args,input,options)=>{runtime.assertDatabase();if(!tools.has(tool))throw Error('Unsupported PostgreSQL tool');const command=['exec','-i',runtime.container,tool,...(tool==='pg_restore'?[]:['-U','postgres']),...args];return options?execFileSync('docker',command,{env:runtime.env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe'],...options}):runtime.docker(command,input);};
 return{execTool,spawnTool:(tool,args,options={})=>{runtime.assertDatabase();if(!tools.has(tool))throw Error('Unsupported PostgreSQL tool');return spawn('docker',['exec','-i',runtime.container,tool,...(tool==='pg_restore'?[]:['-U','postgres']),...args],{env:runtime.env,stdio:['pipe','pipe','pipe'],...options});}};
}
