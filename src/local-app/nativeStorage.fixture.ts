import {mkdirSync,realpathSync} from 'node:fs';
import {relative,isAbsolute} from 'node:path';
import type {FixtureSchemaContext} from './fixtureSchema';

/** Only this pair of randomly named disposable DBs may cross the restore catalog boundary. */
export function nativeStorageContext(context:FixtureSchemaContext&{assertDatabase():void;dailyRuntime?:boolean;isolatedFixtureContainer?:boolean;isolatedFixtureNative?:boolean;spawnTool?:(tool:string,args:string[],options?:Record<string,unknown>)=>unknown},root:string,source:string,target:string){
 context.assertDatabase();
 const native=context.isolatedFixtureNative===true&&!!context.nativeConnection&&!!context.execTool&&!!context.spawnTool;
 if(context.dailyRuntime!==false||!native&&(context.container!=='loop-control-178-test-postgres'&&context.isolatedFixtureContainer!==true)||source===target||![source,target].every(name=>/^loop_t24_restore_[a-f0-9]{12}$/.test(name)))throw Error('Storage fixture requires isolated owned databases');
 const owned=new Set([source,target]);
 const catalog=new Set([`SELECT count(*) FROM pg_database WHERE datname='${target}'`,`SELECT count(*) FROM pg_database WHERE datname='${source}'`,...Array.from(owned).flatMap(name=>[`CREATE DATABASE ${name} TEMPLATE template0`,`DROP DATABASE ${name} WITH (FORCE)`,`ALTER DATABASE ${name} SET loop.restore_state='pending'`,`ALTER DATABASE ${name} SET loop.restore_state='ready'`]),"SELECT jsonb_object_agg(rolname,jsonb_build_object('super',rolsuper,'bypass',rolbypassrls,'createdb',rolcreatedb,'createrole',rolcreaterole)) FROM pg_roles WHERE rolname IN ('loop_app','loop_owner','loop_worker','loop_anonymous')"]);
 const docker=(args:string[],input?:string)=>{
  if(native)throw Error('Native storage fixtures do not use Docker');
  context.assertDatabase();const containerIndex=args[1]==='-i'?2:1,command=args[containerIndex+1],commandArgs=args.slice(containerIndex+2),index=commandArgs.indexOf('-d'),database=index<0?undefined:commandArgs[index+1];
  const psql=command==='psql'&&[['-XqAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],['-U','postgres','-XqAt','-d',database,'-v','ON_ERROR_STOP=1']].some(args=>JSON.stringify(commandArgs)===JSON.stringify(args));
  const decoder=command==='pg_restore'&&[[],['--data-only'],['--data-only','--no-owner','--no-privileges']].some(flags=>JSON.stringify(commandArgs)===JSON.stringify([...flags,'--file=-']));
  if(args[0]!=='exec'||args[containerIndex]!==context.container||!psql&&!decoder||database!==undefined&&!owned.has(database)&&(database!=='postgres'||!input||!catalog.has(input)))throw Error('Foreign storage fixture command');
  return context.docker(args,input);
 };
 const sql=(text:string,database=source)=>{
  if(database!=='postgres'){if(!owned.has(database))throw Error('Foreign storage fixture database');return context.sql(text,database);}
  if(!catalog.has(text))throw Error('Unapproved storage fixture catalog statement');
  return native?context.sql(text,'postgres'):docker(['exec','-i',context.container,'psql','-XqAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],text).trim();
 };
 const checkNativeTool=(tool:string,args:string[],input?:string|Buffer)=>{
  context.assertDatabase();
  const index=args.indexOf('-d'),database=index<0?undefined:args[index+1];
  if(tool==='pg_restore'){
   if(![[],['--data-only'],['--data-only','--no-owner','--no-privileges']].some(flags=>JSON.stringify(args)===JSON.stringify([...flags,'--file=-'])))throw Error('Foreign storage fixture decoder');
   return;
  }
  if(tool==='psql'){
   if(![['-XqAt','-d',database,'-v','ON_ERROR_STOP=1'],['-XqAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],['-U','postgres','-XqAt','-d',database,'-v','ON_ERROR_STOP=1']].some(form=>JSON.stringify(form)===JSON.stringify(args)))throw Error('Foreign storage fixture psql');
  }else if(tool==='pg_dump'){
   const snapshot=args.at(-1);
   if(!snapshot||!/^--snapshot=[0-9A-F]+-[0-9A-F]+-[0-9]+$/i.test(snapshot)||JSON.stringify(args)!==JSON.stringify(['-d',database,'-Fc','--schema=public','--schema=local_identity','--schema=loop_internal','--schema=extensions','--exclude-table-data=local_identity.credentials','--exclude-table-data=local_identity.sessions',snapshot]))throw Error('Foreign storage fixture dump');
  }else throw Error('Foreign storage fixture tool');
  if(database===undefined||!owned.has(database)&&(database!=='postgres'||tool!=='psql'||typeof input!=='string'||!catalog.has(input)))throw Error('Foreign storage fixture database');
 };
 const checkOptions=(options?:Record<string,unknown>)=>{if(options&&Object.keys(options).some(key=>!['maxBuffer','stdio','encoding','timeout'].includes(key)))throw Error('Foreign storage fixture tool options');};
 // Binary custom dumps and file-descriptor output must reach the actual native
 // tool unchanged; a Docker-shaped shim would corrupt or bypass this boundary.
 const execTool=native?(tool:string,args:string[],input?:string|Buffer,options?:Record<string,unknown>)=>{
  checkNativeTool(tool,args,input);checkOptions(options);return (context.execTool as (...args:any[])=>any)(tool,args,input,options);
 }:undefined;
 const spawnTool=native?(tool:string,args:string[],options?:Record<string,unknown>)=>{
  checkNativeTool(tool,args);checkOptions(options);return context.spawnTool!(tool,args,options);
 }:undefined;
 const ensurePrivateDirectory=(path:string)=>{const rel=relative(root,path);if(rel.startsWith('..')||isAbsolute(rel))throw Error('Fixture storage escape');mkdirSync(path,{recursive:true,mode:0o700});if(realpathSync(path)!==path)throw Error('Fixture storage alias');};
 return{...context,docker,sql,...(native?{execTool,spawnTool}:{}),root,projectRoot:process.cwd(),database:source,ensurePrivateDirectory};
}
