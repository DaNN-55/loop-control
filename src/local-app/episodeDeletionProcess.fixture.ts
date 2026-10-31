// Disposable Owner HTTP process used to prove recovery after losing all process memory.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {Duplex} from 'node:stream';
import {createInterface} from 'node:readline';
import {Pool} from 'pg';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const input=createInterface({input:process.stdin});
const [line]=await once(input,'line');input.close();
const configuration=JSON.parse(line as string) as {database:string;root:string;crash?:'before-finalize'|'after-first-finalize'|'link-before-unlink'};
if(!/^loop_(?:studio_153|t24_restore)_[a-f0-9]{12}$/.test(configuration.database)||!process.env.LOOP_TEST_CONTEXT_MODULE)throw Error('Owned isolated fixture required');
const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE),context=runtimeContext();context.assertDatabase();
if(configuration.crash){const unlink=fs.promises.unlink;fs.promises.unlink=async path=>{
 const staged=String(path).endsWith('.loop-control-deletion');
 if(configuration.crash==='before-finalize'&&staged||configuration.crash==='link-before-unlink'&&!staged&&String(path).startsWith(configuration.root+'/account/'))process.kill(process.pid,'SIGKILL');
 await unlink(path);if(configuration.crash==='after-first-finalize'&&staged)process.kill(process.pid,'SIGKILL');
};syncBuiltinESMExports();}
const {createLocalHandler}=await import('./localRoute');
const children=new Set<ReturnType<typeof spawn>>();
const pool=new Pool({database:configuration.database,user:'loop_app',max:4,connectionTimeoutMillis:5000,stream:()=>{
 const child=spawn('docker',['exec','-i',context.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die;my $sel=IO::Select->new(\\*STDIN,$s);while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die unless $w;substr($b,0,$w,'');}}}"],{env:context.env,stdio:['pipe','pipe','pipe']});children.add(child);child.once('exit',()=>children.delete(child));
 const stream=Duplex.from({readable:child.stdout!,writable:child.stdin!});return Object.assign(stream,{connect(){queueMicrotask(()=>stream.emit('connect'));return stream;},setNoDelay(){return stream;},setKeepAlive(){return stream;},ref(){return stream;},unref(){return stream;}});
}} as ConstructorParameters<typeof Pool>[0]);
let handler:ReturnType<typeof createLocalHandler>;
const server=createServer((request,response)=>handler(request,response));server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
handler=createLocalHandler({pool,origin,mediaRoot:configuration.root});
process.stdout.write(JSON.stringify({origin,pid:process.pid})+'\n');
process.once('SIGTERM',()=>{server.closeAllConnections();server.close(async()=>{await pool.end();for(const child of children)child.kill();process.exit(0);});});
