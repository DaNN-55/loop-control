// Actual production Worker child with a fresh loop_worker connection. The local
// TCP transport forwards only to the isolated database via existing Unix trust;
// it never changes cluster roles, daily credentials or deployment configuration.
import {createServer,connect} from 'node:net';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import type {ClaimedTaskRow} from '../orchestration/workerDispatch';
export async function runWorkspaceDeliveryProcess(f:{database:string;root:string},task:ClaimedTaskRow,workerConfig:Record<string,unknown>={}){
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 const bridges=new Set<ReturnType<typeof spawn>>();
 const server=createServer(socket=>{
 let startup=Buffer.alloc(0);socket.setTimeout(5000,()=>socket.destroy());socket.on('error',()=>{});
 const receive=(chunk:Buffer)=>{startup=Buffer.concat([startup,chunk]);if(startup.length>8192){socket.destroy();return;}if(startup.length<8)return;const length=startup.readInt32BE(0),protocol=startup.readInt32BE(4);if(length===8&&(protocol===80877103||protocol===80877104)){socket.write('N');startup=startup.subarray(8);return;}if(length<9||length>8192){socket.destroy();return;}if(startup.length<length)return;
 const fields=startup.subarray(8,length).toString('utf8').split('\0'),parameters:Record<string,string>={};for(let i=0;i<fields.length-1&&fields[i];i+=2){if(parameters[fields[i]]!==undefined||!['user','database','application_name','client_encoding'].includes(fields[i])){socket.destroy();return;}parameters[fields[i]]=fields[i+1];}
 if(protocol!==196608||parameters.user!=='loop_worker'||parameters.database!==f.database){socket.destroy();return;}socket.off('data',receive);socket.setTimeout(0);
 const bridge=spawn('docker',['exec','-i',context.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die;my $sel=IO::Select->new(\\*STDIN,$s);while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die unless $w;substr($b,0,$w,'');}}}"],{env:context.env,stdio:['pipe','pipe','ignore']});
 bridges.add(bridge);bridge.once('exit',()=>{bridges.delete(bridge);socket.destroy();});bridge.stdin.on('error',()=>{});bridge.stdin.write(startup);socket.pipe(bridge.stdin);bridge.stdout.pipe(socket);socket.once('close',()=>bridge.kill());
 };socket.on('data',receive);
 });
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const database={host:'127.0.0.1',port:(server.address() as {port:number}).port,user:'loop_worker',database:f.database,password:'synthetic-unused-unix-trust'};
 try{
 for(const [user,name] of [['postgres',f.database],['loop_worker','not_'+f.database]])await new Promise<void>((resolve,reject)=>{const probe=connect(database.port,'127.0.0.1');const fields=Buffer.from(`user\0${user}\0database\0${name}\0\0`),packet=Buffer.alloc(8+fields.length);packet.writeInt32BE(packet.length);packet.writeInt32BE(196608,4);fields.copy(packet,8);probe.once('connect',()=>probe.end(packet));probe.once('data',()=>{probe.destroy();reject(Error('Isolated Worker transport accepted a foreign startup.'));});probe.once('error',reject);probe.once('close',()=>resolve());});
 return await new Promise<any>((resolve,reject)=>{
 const child=spawn(process.execPath,[join(process.cwd(),'dist/worker/local-app/localWorkerCli.js')],{cwd:process.cwd(),env:process.env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGKILL'),60000);timer.unref();
 child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({task,config:{projectRoot:process.cwd(),database,applicationDatabase:{host:database.host,port:database.port,database:database.database},mediaRoot:f.root,mountPath:f.root,minimumFreeBytes:0,visualCommand:[],actualCostCents:0,...workerConfig}}));
 child.stdout.on('data',b=>stdout+=String(b));child.stderr.on('data',b=>stderr+=String(b));child.once('error',reject);child.once('close',code=>{clearTimeout(timer);if(code!==0)return reject(Error(`Worker child exited ${code}: ${stderr.slice(0,4000)}`));try{resolve(JSON.parse(stdout.trim().split('\n').at(-1)!));}catch{reject(Error('Worker returned no persisted result.'));}});
 });}finally{for(const child of bridges)child.kill();await new Promise<void>(done=>server.close(()=>done()));}
}
