// Native handoff acceptance; never opens the configured/daily database or service.
import {execFileSync,spawnSync} from 'node:child_process';
import {chmodSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSchemaCatalog,freshSchemaTransaction} from '../../src/local-app/schemaMigrations.ts';

const project=realpathSync(fileURLToPath(new URL('../..',import.meta.url)));
if(realpathSync(process.cwd())!==project)throw Error('Run acceptance from the main Loop Control project');
const bin=dirname(realpathSync(resolve(process.env.LOOP_TEST_POSTGRES_BIN??'/opt/homebrew/bin','initdb')));
const root=mkdtempSync('/private/tmp/loop-handoff-');chmodSync(root,0o700);
const data=join(root,'postgres'),socket=join(root,'socket'),port=5449,database='loop_handoff_baseline';
const env={PATH:process.env.PATH,HOME:root,LANG:'C',LC_ALL:'C',TMPDIR:root};
const tool=(name,args,input)=>execFileSync(join(bin,name),args,{env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});
const sql=(db,text)=>tool('psql',['-XqAt','-h',socket,'-p',String(port),'-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],text);
const assertOwned=()=>{
 const receipt=readFileSync(join(data,'postmaster.pid'),'utf8').split('\n'),stat=lstatSync(root);
 if(realpathSync(root)!==root||!stat.isDirectory()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0||receipt[1]!==data||Number(receipt[3])!==port||receipt[4]!==socket)throw Error('Owned PostgreSQL cluster identity mismatch');
};
try{
 mkdirSync(socket,{mode:0o700});
 tool('initdb',['-D',data,'-U','postgres','-A','trust','--no-locale','-E','UTF8']);
 tool('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-k ${socket} -p ${port} -h ''`,'-w','start']);
 assertOwned();
 sql('postgres','CREATE ROLE loop_app LOGIN; CREATE ROLE loop_worker LOGIN; CREATE ROLE loop_owner NOLOGIN; CREATE ROLE loop_anonymous NOLOGIN; GRANT loop_owner TO loop_app; CREATE DATABASE '+database+' TEMPLATE template0;');
 sql(database,freshSchemaTransaction(loadSchemaCatalog(project)));
 const context=join(root,'context.mjs');
 writeFileSync(context,`import {execFileSync} from 'node:child_process'; import {lstatSync,readFileSync,realpathSync} from 'node:fs'; import {join} from 'node:path';
const {bin,data,socket,port,root,database,env}=${JSON.stringify({bin,data,socket,port,root,database,env})};
export function runtimeContext(){
 const assertDatabase=${assertOwned.toString()};
 const execTool=(name,args,input)=>{
  assertDatabase(); const databaseName=args[args.indexOf('-d')+1];
  if(!['psql','pg_dump'].includes(name)||!(databaseName===database||databaseName==='postgres'||/^loop_[a-z0-9_]+_[a-f0-9]{12}$/.test(databaseName)))throw Error('Not an isolated PG operation');
  return execFileSync(join(bin,name),['-h',socket,'-p',String(port),'-U','postgres',...args],{env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});
 };
 const sql=(text,db=database)=>{
  if(db==='postgres'&&!/^(CREATE DATABASE loop_[a-z0-9_]+_[a-f0-9]{12} TEMPLATE template0|DROP DATABASE loop_[a-z0-9_]+_[a-f0-9]{12} WITH \\(FORCE\\))$/.test(text))throw Error('Not an isolated database lifecycle query');
  return execTool('psql',['-XqAt','-d',db,'-v','ON_ERROR_STOP=1'],text).trim();
 };
 return {database,nativeConnection:{host:socket,port},assertDatabase,execTool,sql,env};
}
`);
 const child=spawnSync(process.execPath,[join(project,'node_modules/vitest/vitest.mjs'),'run','src/local-app/harnessHandoff.integration.test.ts','--maxWorkers=1',...process.argv.slice(2)],{cwd:project,env:{...env,LOOP_HANDOFF_TEST_CONTEXT:context,...Object.fromEntries(['LOOP_HANDOFF_GOLDEN_PACKAGE','LOOP_TEST_OPENCHATCUT_ROOT'].filter(name=>process.env[name]).map(name=>[name,process.env[name]]))},stdio:'inherit'});
 if(child.error)throw child.error;
 process.exitCode=child.status??1;
}catch(error){console.error(error.stderr?.toString()??error);process.exitCode=1;}
finally{
 try{assertOwned();tool('pg_ctl',['-D',data,'-m','fast','-w','stop']);}catch(error){if(error.code!=='ENOENT'){console.error(error);process.exitCode=1;throw error;}}
 if(realpathSync(root)===root&&/^\/private\/tmp\/loop-handoff-[a-zA-Z0-9]+$/.test(root))rmSync(root,{recursive:true,force:true});
}
