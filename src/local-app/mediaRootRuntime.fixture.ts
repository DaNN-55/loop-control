import {once} from 'node:events';
import {createServer} from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
export async function mediaRootDatabaseTransport(f:{database:string}){
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();
 const bridges=new Set<ReturnType<typeof spawn>>();
 const server=createServer(socket=>{
 let startup=Buffer.alloc(0);socket.setTimeout(5000,()=>socket.destroy());socket.on('error',()=>{});
 const receive=(chunk:Buffer)=>{startup=Buffer.concat([startup,chunk]);if(startup.length>8192){socket.destroy();return;}if(startup.length<8)return;const length=startup.readInt32BE(0),protocol=startup.readInt32BE(4);if(length===8&&(protocol===80877103||protocol===80877104)){socket.write('N');startup=startup.subarray(8);return;}if(length<9||length>8192){socket.destroy();return;}if(startup.length<length)return;
 const fields=startup.subarray(8,length).toString('utf8').split('\0'),parameters:Record<string,string>={};for(let i=0;i<fields.length-1&&fields[i];i+=2){if(parameters[fields[i]]!==undefined||!['user','database','application_name','client_encoding'].includes(fields[i])){socket.destroy();return;}parameters[fields[i]]=fields[i+1];}
 if(protocol!==196608||!['loop_app','loop_worker'].includes(parameters.user)||parameters.database!==f.database){socket.destroy();return;}socket.off('data',receive);socket.setTimeout(0);
 const bridge=spawn('docker',['exec','-i',context.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die;my $sel=IO::Select->new(\\*STDIN,$s);while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die unless $w;substr($b,0,$w,'');}}}"],{env:context.env,stdio:['pipe','pipe','ignore']});
 bridges.add(bridge);bridge.once('exit',()=>{bridges.delete(bridge);socket.destroy();});bridge.stdin.on('error',()=>{});bridge.stdin.write(startup);socket.pipe(bridge.stdin);bridge.stdout.pipe(socket);socket.once('close',()=>bridge.kill());
 };socket.on('data',receive);
 });
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const database={host:'127.0.0.1',port:(server.address() as {port:number}).port,user:'loop_worker',database:f.database,password:'synthetic-unused-unix-trust'};
 return{database,close:async()=>{for(const child of bridges)child.kill();await new Promise<void>(done=>server.close(()=>done()));}};
}

export async function nativeMediaRootFixture(options:{existingData?:boolean;newInstall?:boolean;migrations?:string[]}={}){
 const {embeddedStudioFixture}=await import('./embeddedStudio.fixture');
 const {workspaceAudioVolume}=await import('./workspaceAudioVolume.fixture');
 const {mkdir,writeFile,rm,readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
 const {join}=await import('node:path');const {spawn}=await import('node:child_process');
 const volume=await workspaceAudioVolume(),f=await embeddedStudioFixture({testRootParent:volume.mountPath,migrations:['db/local/111-global-media-root.sql',...(options.migrations??[])]});
 const transport=await mediaRootDatabaseTransport(f);let child:ReturnType<typeof spawn>|undefined;
 const runtimeRoot=join(f.root,'runtime'),source=options.existingData?f.root:join(f.root,'source'),target=join(volume.mountPath,'chosen-library');
 const configFile=join(runtimeRoot,'deployment.json');
 const launch=async(crashAt?:'episode-after-mkdir'|'episode-after-commit'|'adoption-copy-write'|'adoption-pause-copy-write'|'adoption-space')=>{
  const script=`import {readFile} from 'node:fs/promises';import {createServer} from 'node:http';import {once} from 'node:events';import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';if(process.argv[2]==='adoption-space'){const statfs=fs.promises.statfs;fs.promises.statfs=async(...args)=>{const actual=await statfs(...args);return{...actual,bavail:typeof actual.bavail==='bigint'?0n:0};};}if(process.argv[2]==='episode-after-mkdir'){const mkdir=fs.promises.mkdir;fs.promises.mkdir=async(...args)=>{const result=await mkdir(...args);if(String(args[0]).includes('/crash-after-mkdir--'))process.kill(process.pid,'SIGKILL');return result;};}if(process.argv[2]==='episode-after-commit'){const unlink=fs.promises.unlink;fs.promises.unlink=async path=>{if(String(path).includes('/crash-after-commit--')&&String(path).endsWith('/.loop-control-creation.json'))process.kill(process.pid,'SIGKILL');return unlink(path);};}if(['adoption-copy-write','adoption-pause-copy-write'].includes(process.argv[2])){const open=fs.promises.open;let intercepted=false;fs.promises.open=async(...args)=>{const handle=await open(...args);if(String(args[0]).includes('.migration-')){const write=handle.write.bind(handle);handle.write=async(...bytes)=>{if(!intercepted){intercepted=true;if(process.argv[2]==='adoption-copy-write')process.kill(process.pid,'SIGKILL');const config=process.argv[1],stateDir=config.slice(0,config.lastIndexOf('/'));await fs.promises.writeFile(stateDir+'/adoption-copy-paused.json',JSON.stringify({pid:process.pid,path:String(args[0])}));for(;;){try{await fs.promises.access(stateDir+'/adoption-copy-resume');break;}catch{}await new Promise(r=>setTimeout(r,20));}}return write(...bytes);};}return handle;};}syncBuiltinESMExports();const {createNativeApplication}=await import(${JSON.stringify(join(process.cwd(),'scripts/runtime/application.mjs'))});const d=JSON.parse(await readFile(process.argv[1],'utf8'));d.deploymentFile=process.argv[1];let app;const server=createServer((q,r)=>app.handler(q,r));server.listen(0,'127.0.0.1');await once(server,'listening');d.port=server.address().port;app=await createNativeApplication(d);console.log(JSON.stringify({origin:'http://127.0.0.1:'+d.port,pid:process.pid}));process.on('SIGTERM',async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await app.close();process.exit(0);});`;
  child=spawn(process.execPath,['--input-type=module','-e',script,configFile,crashAt??'none'],{env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR},stdio:['ignore','pipe','pipe']});
  return await new Promise<{origin:string;pid:number}>((resolve,reject)=>{let output='',errors='';const timer=setTimeout(()=>{child!.kill('SIGKILL');reject(Error('Native launch timed out: '+errors));},30000);child!.stdout!.on('data',b=>{output+=String(b);const line=output.split('\n').find(s=>s.startsWith('{"origin"'));if(line){clearTimeout(timer);resolve(JSON.parse(line));}});child!.stderr!.on('data',b=>errors+=String(b));child!.once('exit',code=>{clearTimeout(timer);reject(Error('Native launch '+code+': '+errors));});});
 };
 const closeFolderWindows=async()=>{if(process.platform==='darwin')await promisify(execFile)('/usr/bin/osascript',['-e','on run argv\nset ownedRoot to item 1 of argv\ntell application "Finder"\nrepeat with w in (get windows)\ntry\nset p to POSIX path of (target of w as alias)\nif p starts with (ownedRoot & "/") or p is (ownedRoot & "/") then close w\nend try\nend repeat\nend tell\nend run','--',volume.mountPath],{timeout:5000}).catch(()=>{});};
 const stop=async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill();await done;}child=undefined;};
 try{
  if(!options.existingData){await f.c.query('TRUNCATE public.accounts CASCADE');await f.c.query('DELETE FROM local_identity.media_root_binding');}if(options.newInstall)await f.c.query('DELETE FROM local_identity.import_record');await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,1) ON CONFLICT(singleton) DO UPDATE SET capacity=1');if(!options.existingData)await rm(f.assetRoot,{recursive:true});
  for(const p of [runtimeRoot,source,target,join(runtimeRoot,'state')])await mkdir(p,{mode:0o700,recursive:true});
  const cacheDirectory=join(source,'whisperx-models');await mkdir(cacheDirectory,{mode:0o700});await writeFile(join(cacheDirectory,'retained.txt'),'Retained platform cache fixture');
  const database={...transport.database,user:'loop_app'};
  const initial={storageOwnerId:f.owner,runtimeRoot,projectRoot:process.cwd(),home:process.env.HOME,stateDirectory:join(runtimeRoot,'state'),mediaRoot:source,backupRoot:join(runtimeRoot,'backups'),automaticBackups:false,controlledNotifications:true,database,workerDatabase:transport.database,worker:{mountPath:volume.mountPath,minimumFreeBytes:0,visualCommand:['/usr/bin/true'],alignment:{python:'/usr/bin/true',cacheDirectory,runnerSha256:createHash('sha256').update(await readFile(join(process.cwd(),'scripts/whisperx-align.py'))).digest('hex')},concurrency:1,actualCostCents:0}};
  await writeFile(configFile,JSON.stringify(initial),{mode:0o600});
  return{f,volume,runtimeRoot,source,target,configFile,launch,stop,crash:async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;}child=undefined;},close:async()=>{await stop();await closeFolderWindows();await transport.close();await f.close();await volume.close();}};
 }catch(error){await stop();await transport.close();await f.close();await volume.close();throw error;}
}
