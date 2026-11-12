import {loadSchemaCatalog} from './schemaMigrations.js';
import {spawn} from 'node:child_process';
import {Duplex} from 'node:stream';
import {Pool} from 'pg';
export interface FixtureSchemaContext {database:string;container:string;env:NodeJS.ProcessEnv;docker(args:string[],input?:string):string;sql(text:string,database?:string):string;nativeConnection?:{host:string;port:number};execTool?:(tool:string,args:string[],input?:string)=>string}
interface Migration {version:string;body:string;sha256:string}
const migrationName=/^[0-9]{3}-[a-z0-9-]+\.sql$/;

/** Validates the entire applied ledger before selecting requested forwards. */
export function planFixtureMigrations(applied:Record<string,string>,available:Migration[],requested:string[]):Migration[]{
 const files=new Map(available.map(file=>[file.version,file]));
 for(const[version,sha256]of Object.entries(applied))if(!(migrationName.test(version)||version==='clean-v2.sql')||!files.has(version)||files.get(version)!.sha256!==sha256)throw Error('Applied fixture migration changed: '+version);
 const names=[...new Set(requested.map(path=>{if(!/^db\/(?:local|archive\/legacy-v1)\/[0-9]{3}-[a-z0-9-]+\.sql$/.test(path))throw Error('Invalid fixture migration path');return path.slice(path.lastIndexOf('/')+1);} ))].sort();
 return names.flatMap(version=>{const file=files.get(version);if(!file)throw Error('Missing fixture migration: '+version);return Object.hasOwn(applied,version)||(Object.hasOwn(applied,'clean-v2.sql')&&available.findIndex(f=>f.version===version)<available.findIndex(f=>f.version==='clean-v2.sql'))?[]:[file];});
}

/** Schema and the technical ledger share one exported read-only snapshot. No business data are copied. */
export async function copyFixtureSchema(context:FixtureSchemaContext,targetDatabase:string,migrations:string[],projectRoot=process.cwd()){
 if(targetDatabase===context.database||!/^loop_[a-z0-9_]+_[a-f0-9]{12}(?:_[a-z]+)?$/.test(targetDatabase))throw Error('Fixture target must be a new random database');
 const occupied=context.sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_'",targetDatabase);
 if(occupied!=='0')throw Error('Fixture target is not empty');
 const catalog=loadSchemaCatalog(projectRoot),available=[...catalog.legacy,catalog.baseline,...catalog.current];
 const bridge=context.nativeConnection?undefined:spawn('docker',['exec','-i',context.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die;my $sel=IO::Select->new(\\*STDIN,$s);while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die unless $w;substr($b,0,$w,'');}}}"],{env:context.env,stdio:['pipe','pipe','pipe']});
 const socket=bridge?Duplex.from({readable:bridge.stdout!,writable:bridge.stdin!}):undefined;
 const pool=new Pool({database:context.database,user:'postgres',max:1,connectionTimeoutMillis:5000,...(context.nativeConnection??{stream:()=>Object.assign(socket!,{connect(){queueMicrotask(()=>socket!.emit('connect'));return socket;},setNoDelay(){return socket;},setKeepAlive(){return socket;}})})} as ConstructorParameters<typeof Pool>[0]);
 try{
  const c=await pool.connect();
  try{
   await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const snapshot=(await c.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot as string;
   const applied=Object.fromEntries((await c.query('SELECT version,sha256 FROM local_identity.schema_migrations ORDER BY version')).rows.map(row=>[row.version,row.sha256])) as Record<string,string>;
   const pending=planFixtureMigrations(applied,available,migrations);
   const dumpArgs=['-U','postgres','-d',context.database,'--schema-only','--snapshot='+snapshot];
   const schema=context.nativeConnection?context.execTool!('pg_dump',dumpArgs):context.docker(['exec',context.container,'pg_dump',...dumpArgs]);
   context.sql(schema,targetDatabase);
   const ledger=JSON.stringify(Object.entries(applied).map(([version,sha256])=>({version,sha256}))).replaceAll("'","''");
   context.sql(`INSERT INTO local_identity.schema_migrations(version,sha256) SELECT version,sha256 FROM jsonb_to_recordset('${ledger}'::jsonb) AS v(version text,sha256 text)`,targetDatabase);
   for(const migration of pending)context.sql(`BEGIN;\n${migration.body}\nINSERT INTO local_identity.schema_migrations(version,sha256) VALUES('${migration.version}','${migration.sha256}');\nCOMMIT;`,targetDatabase);
   await c.query('ROLLBACK');
  }finally{c.release();}
 }finally{await pool.end();bridge?.kill();}
}
