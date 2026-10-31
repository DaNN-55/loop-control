import {mkdirSync,realpathSync} from 'node:fs';
import {relative,isAbsolute} from 'node:path';
import type {FixtureSchemaContext} from './fixtureSchema';

/** Only this pair of randomly named disposable DBs may cross the restore catalog boundary. */
export function nativeStorageContext(context:FixtureSchemaContext&{assertDatabase():void;dailyRuntime?:boolean},root:string,source:string,target:string){
 if(context.dailyRuntime!==false||context.container!=='loop-control-178-test-postgres'||source===target||![source,target].every(name=>/^loop_t24_restore_[a-f0-9]{12}$/.test(name)))throw Error('Storage fixture requires isolated owned databases');
 const owned=new Set([source,target]);
 const catalog=new Set([`SELECT count(*) FROM pg_database WHERE datname='${target}'`,`SELECT count(*) FROM pg_database WHERE datname='${source}'`,...Array.from(owned).flatMap(name=>[`CREATE DATABASE ${name} TEMPLATE template0`,`DROP DATABASE ${name} WITH (FORCE)`,`ALTER DATABASE ${name} SET loop.restore_state='pending'`,`ALTER DATABASE ${name} SET loop.restore_state='ready'`]),"SELECT jsonb_object_agg(rolname,jsonb_build_object('super',rolsuper,'bypass',rolbypassrls,'createdb',rolcreatedb,'createrole',rolcreaterole)) FROM pg_roles WHERE rolname IN ('loop_app','loop_owner','loop_worker','loop_anonymous')"]);
 const docker=(args:string[],input?:string)=>{
  context.assertDatabase();const command=args.find(arg=>['psql','pg_dump','pg_restore'].includes(arg)),index=args.indexOf('-d'),database=index<0?undefined:args[index+1];
  if(args[0]!=='exec'||!args.includes(context.container)||!command||database!==undefined&&!owned.has(database)&&(database!=='postgres'||!input||!catalog.has(input)))throw Error('Foreign storage fixture command');
  if(database===undefined&&command!=='pg_restore')throw Error('Storage fixture database required');
  return context.docker(args,input);
 };
 const sql=(text:string,database=source)=>{
  if(database!=='postgres'){if(!owned.has(database))throw Error('Foreign storage fixture database');return context.sql(text,database);}
  if(!catalog.has(text))throw Error('Unapproved storage fixture catalog statement');
  return docker(['exec','-i',context.container,'psql','-XqAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],text).trim();
 };
 const ensurePrivateDirectory=(path:string)=>{const rel=relative(root,path);if(rel.startsWith('..')||isAbsolute(rel))throw Error('Fixture storage escape');mkdirSync(path,{recursive:true,mode:0o700});if(realpathSync(path)!==path)throw Error('Fixture storage alias');};
 return{...context,docker,sql,root,projectRoot:process.cwd(),database:source,ensurePrivateDirectory};
}
