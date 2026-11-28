// Start only disposable Loop Control data and a separate DSH Web overlay.
import {execFileSync,spawn} from 'node:child_process';
import {chmodSync,cpSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {loadSchemaCatalog,freshSchemaTransaction} from '../../src/local-app/schemaMigrations.ts';

const project=realpathSync(fileURLToPath(new URL('../..',import.meta.url)));
if(realpathSync(process.cwd())!==project)throw Error('Start the isolated preview from the main Loop Control project.');
const required=name=>{if(!process.env[name])throw Error(`Set ${name} before launching the isolated preview.`);return realpathSync(process.env[name]);};
const plugin=required('LOOP_NATIVE_PREVIEW_PLUGIN'),assets=required('LOOP_NATIVE_PREVIEW_ASSETS'),sourceSdk=required('LOOP_NATIVE_PREVIEW_OPENCHATCUT');
const {DSH_NODE_EXECUTABLE:electron,DSH_INSTALL_DIR:install}=process.env;
if(!electron||!install)throw Error('Use the DSH runtime environment or set DSH_NODE_EXECUTABLE and DSH_INSTALL_DIR.');
if(JSON.parse(readFileSync(join(plugin,'package.json'),'utf8')).name!=='@local/team-loop-control')throw Error('Incorrect Loop Control plugin package.');
for(const file of ['loop-control-native.js','loop-control-native.css'])if(!lstatSync(join(assets,file)).isFile())throw Error(`Missing native build: ${file}`);
const bin=dirname(realpathSync(resolve(process.env.LOOP_TEST_POSTGRES_BIN??'/opt/homebrew/bin','initdb')));
const root=mkdtempSync('/private/tmp/loop-native-');chmodSync(root,0o700);
const data=join(root,'pg'),socket=join(root,'db'),port=5449,database='loop_native_baseline';
const sdk=join(root,'OpenChatCut'),dshHome=join(root,'dsh'),home=join(root,'home');
const env={PATH:process.env.PATH,HOME:home,LANG:'C',LC_ALL:'C',TMPDIR:root};
const tool=(name,args,input)=>execFileSync(join(bin,name),args,{env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});
const sql=(db,text)=>tool('psql',['-XqAt','-h',socket,'-p',String(port),'-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],text);
const assertOwned=()=>{
 const receipt=readFileSync(join(data,'postmaster.pid'),'utf8').split('\n'),stat=lstatSync(root);
 if(realpathSync(root)!==root||!stat.isDirectory()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0||receipt[1]!==data||Number(receipt[3])!==port||receipt[4]!==socket)throw Error('Owned PostgreSQL cluster identity mismatch');
};
let backend,web,stopping=false,pgStarted=false;
const stop=()=>{stopping=true;};
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
const readJson=path=>{try{return JSON.parse(readFileSync(path,'utf8'));}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;return null;}};
const waitFor=async(fn,deadline,child)=>{
 for(let n=0;!stopping&&n<deadline;n+=150){const value=fn();if(value)return value;if(child?.exitCode!==null||child?.signalCode)throw Error('Isolated process stopped before readiness.');await delay(150);}
 throw Error('Isolated preview readiness timed out.');
};
const childClose=async(child,signal)=>{
 if(child&&child.exitCode===null&&child.signalCode===null){const closed=new Promise(done=>child.once('close',done));child.kill(signal);await Promise.race([closed,delay(8000).then(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');})]);await closed;}
};
try{
 console.log(`Isolated preview run: ${root}`);
 mkdirSync(home,{mode:0o700});mkdirSync(socket,{mode:0o700});
 cpSync(sourceSdk,sdk,{recursive:true,filter:path=>!path.slice(sourceSdk.length).split('/').some(part=>['node_modules','.git','.data','dist','.vite','data'].includes(part))});
 if(!lstatSync(join(sourceSdk,'node_modules')).isDirectory())throw Error('OpenChatCut dependency directory is required.');
 symlinkSync(join(sourceSdk,'node_modules'),join(sdk,'node_modules'),'dir');
 tool('initdb',['-D',data,'-U','postgres','-A','trust','--no-locale','-E','UTF8']);
 tool('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-k ${socket} -p ${port} -h ''`,'-w','start']);pgStarted=true;assertOwned();
 sql('postgres','CREATE ROLE loop_app LOGIN; CREATE ROLE loop_worker LOGIN; CREATE ROLE loop_owner NOLOGIN; CREATE ROLE loop_anonymous NOLOGIN; GRANT loop_owner TO loop_app; CREATE DATABASE '+database+' TEMPLATE template0;');
 sql(database,freshSchemaTransaction(loadSchemaCatalog(project)));
 const context=join(root,'context.mjs');
 writeFileSync(context,`import {execFileSync} from 'node:child_process';import {lstatSync,readFileSync,realpathSync} from 'node:fs';import {join} from 'node:path';
 const {bin,data,socket,port,root,database,env}=${JSON.stringify({bin,data,socket,port,root,database,env})};
 export function runtimeContext(){
  const assertDatabase=${assertOwned.toString()};
  const execTool=(name,args,input)=>{
   assertDatabase();const db=args[args.indexOf('-d')+1];
   if(!['psql','pg_dump'].includes(name)||!(db===database||db==='postgres'||/^loop_[a-z0-9_]+_[a-f0-9]{12}$/.test(db)))throw Error('Not an isolated PG operation');
   return execFileSync(join(bin,name),['-h',socket,'-p',String(port),'-U','postgres',...args],{env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});
  };
  const sql=(text,db=database)=>{
   if(db==='postgres'&&!/^(CREATE DATABASE loop_[a-z0-9_]+_[a-f0-9]{12} TEMPLATE template0|DROP DATABASE loop_[a-z0-9_]+_[a-f0-9]{12} WITH \\(FORCE\\))$/.test(text))throw Error('Not an isolated database lifecycle query');
   return execTool('psql',['-XqAt','-d',db,'-v','ON_ERROR_STOP=1'],text).trim();
  };
  return {database,nativeConnection:{host:socket,port},assertDatabase,execTool,sql,env};
 }\n`,{mode:0o600});
 backend=spawn(process.execPath,[join(project,'node_modules/vitest/vitest.mjs'),'run','src/local-app/harnessNativePreview.integration.test.ts','--maxWorkers=1'],{cwd:project,env:{...env,LOOP_NATIVE_PREVIEW_CONTEXT:context,LOOP_NATIVE_PREVIEW_ROOT:root,LOOP_NATIVE_PREVIEW_SDK:sdk,OPENCHATCUT_ROOT:sdk},stdio:'inherit'});
 const fixture=await waitFor(()=>readJson(join(root,'ready.json')),90_000,backend);
 if(fixture.directory!==join(root,'rpc'))throw Error('Preview fixture returned unexpected RPC directory.');
 const modules=join(dshHome,'profiles/web/node_modules/@local');mkdirSync(modules,{recursive:true,mode:0o700});
 symlinkSync(plugin,join(modules,'team-loop-control'),'dir');
 const overlay=join(root,'web-overlay.yml');
 writeFileSync(overlay,`- insert:\n    - id: team-loop-control-preview\n      name: '@local/team-loop-control'\n      config:\n        productionDir: ${JSON.stringify(fixture.directory)}\n        productionAssetsDir: ${JSON.stringify(assets)}\n`,{mode:0o600});
 let ready=null,stdout='';
 web=spawn(electron,[join(install,'lib/bin.js'),'--profile','web','--patch',overlay,'--host','::1','--port','0','--no-open'],{cwd:project,env:{...env,DSH_HOME:dshHome,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','pipe']});
 const redact=text=>text.replace(/(https?:\/\/[^\s?#]+)[?#][^\s]+/g,'$1');
 web.stderr.on('data',bytes=>process.stderr.write(redact(String(bytes))));
 web.stdout.on('data',bytes=>{
  stdout+=String(bytes);
  for(let newline=stdout.indexOf('\n');newline!==-1;newline=stdout.indexOf('\n')){
   const line=stdout.slice(0,newline);stdout=stdout.slice(newline+1);
   const match=/^dsh web:\s+(http:\/\/\[::1\]:\d+\/\S*)/.exec(line.replace(/\x1b\[[0-9;]*m/g,''));
   if(match)ready=match[1];else process.stdout.write(redact(line)+'\n');
  }
 });
 const tokenized=await waitFor(()=>ready,45_000,web),origin=new URL(tokenized).origin;
 if(!/^[0-9]+$/.test(new URL(tokenized).port)||!new URL(tokenized).search)throw Error('Expected isolated loopback launch URL with a process token.');
 writeFileSync(join(root,'launch-url'),tokenized+'\n',{mode:0o600,flag:'wx'});
 console.log(`Isolated DSH Native Preview: ${origin}/ (use private launch-url file; expires within 60 minutes)`);
 console.log(`Example order: ${fixture.title} (${fixture.episode})`);
 while(!stopping&&web.exitCode===null&&web.signalCode===null&&backend.exitCode===null&&backend.signalCode===null&&!readJson(join(root,'stop.json')))await delay(250);
 if(!stopping&&backend.exitCode!==0&&backend.exitCode!==null)throw Error('Isolated Loop Control fixture did not complete.');
 if(!stopping&&web.exitCode!==0&&web.exitCode!==null)throw Error('Isolated Web preview stopped with an error.');
}catch(error){console.error(error.stderr?.toString()??error);process.exitCode=1;}
finally{
 await childClose(web,'SIGTERM');
 if(backend&&backend.exitCode===null&&backend.signalCode===null){
  writeFileSync(join(root,'stop'),'stop\n',{mode:0o600});
  const closed=new Promise(done=>backend.once('close',done));
  await Promise.race([closed,delay(6000).then(()=>childClose(backend,'SIGTERM'))]);
 }
 if(pgStarted){assertOwned();tool('pg_ctl',['-D',data,'-m','fast','-w','stop']);}
 if(realpathSync(root)===root&&/^\/private\/tmp\/loop-native-[a-zA-Z0-9]+$/.test(root))rmSync(root,{recursive:true,force:true});
}
