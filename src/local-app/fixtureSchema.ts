import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {Duplex} from 'node:stream';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Pool} from 'pg';
export interface FixtureSchemaContext {database:string;container:string;env:NodeJS.ProcessEnv;docker(args:string[],input?:string):string;sql(text:string,database?:string):string}
interface Migration {version:string;body:string;sha256:string}
const migrationName=/^[0-9]{3}-[a-z0-9-]+\.sql$/;

/** Validates the entire applied ledger before selecting requested forwards. */
export function planFixtureMigrations(applied:Record<string,string>,available:Migration[],requested:string[]):Migration[]{
 const files=new Map(available.map(file=>[file.version,file]));
 for(const[version,sha256]of Object.entries(applied))if(!migrationName.test(version)||!files.has(version)||files.get(version)!.sha256!==sha256)throw Error('Applied fixture migration changed: '+version);
 const names=[...new Set(requested.map(path=>{if(!/^db\/local\/[0-9]{3}-[a-z0-9-]+\.sql$/.test(path))throw Error('Invalid fixture migration path');return path.slice('db/local/'.length);} ))].sort();
 return names.flatMap(version=>{const file=files.get(version);if(!file)throw Error('Missing fixture migration: '+version);return Object.hasOwn(applied,version)?[]:[file];});
}

/** Schema and the technical ledger share one exported read-only snapshot. No business data are copied. */
export async function copyFixtureSchema(context:FixtureSchemaContext,targetDatabase:string,migrations:string[],projectRoot=process.cwd()){
 if(targetDatabase===context.database||!/^loop_[a-z0-9_]+_[a-f0-9]{12}(?:_[a-z]+)?$/.test(targetDatabase))throw Error('Fixture target must be a new random database');
 const occupied=context.sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_'",targetDatabase);
 if(occupied!=='0')throw Error('Fixture target is not empty');
 const available=await Promise.all((await readdir(join(projectRoot,'db/local'))).filter(name=>migrationName.test(name)).map(async version=>{const body=await readFile(join(projectRoot,'db/local',version),'utf8');return{version,body,sha256:createHash('sha256').update(body).digest('hex')};}));
 const bridge=spawn('docker',['exec','-i',context.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die;my $sel=IO::Select->new(\\*STDIN,$s);while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die unless $w;substr($b,0,$w,'');}}}"],{env:context.env,stdio:['pipe','pipe','pipe']});
 const socket=Duplex.from({readable:bridge.stdout!,writable:bridge.stdin!});
 const pool=new Pool({database:context.database,user:'postgres',max:1,connectionTimeoutMillis:5000,stream:()=>Object.assign(socket,{connect(){queueMicrotask(()=>socket.emit('connect'));return socket;},setNoDelay(){return socket;},setKeepAlive(){return socket;}})} as ConstructorParameters<typeof Pool>[0]);
 try{
  const c=await pool.connect();
  try{
   await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const snapshot=(await c.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot as string;
   const applied=Object.fromEntries((await c.query('SELECT version,sha256 FROM local_identity.schema_migrations ORDER BY version')).rows.map(row=>[row.version,row.sha256])) as Record<string,string>;
   const pending=planFixtureMigrations(applied,available,migrations);
   const schema=context.docker(['exec',context.container,'pg_dump','-U','postgres','-d',context.database,'--schema-only','--snapshot='+snapshot]);
   context.sql(schema,targetDatabase);
   const ledger=JSON.stringify(Object.entries(applied).map(([version,sha256])=>({version,sha256}))).replaceAll("'","''");
   context.sql(`INSERT INTO local_identity.schema_migrations(version,sha256) SELECT version,sha256 FROM jsonb_to_recordset('${ledger}'::jsonb) AS v(version text,sha256 text)`,targetDatabase);
   for(const migration of pending)context.sql(`BEGIN;\n${migration.body}\nINSERT INTO local_identity.schema_migrations(version,sha256) VALUES('${migration.version}','${migration.sha256}');\nCOMMIT;`,targetDatabase);
   await c.query('ROLLBACK');
  }finally{c.release();}
 }finally{await pool.end();bridge.kill();}
}
