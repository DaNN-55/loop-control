// Real application process over the existing isolated database transport.
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {mediaRootDatabaseTransport} from './mediaRootRuntime.fixture';
import type {storyE2eFixture} from './storyE2e.fixture';

export async function storyProcess(f:Awaited<ReturnType<typeof storyE2eFixture>>){
 const transport=await mediaRootDatabaseTransport(f),runtimeRoot=join(f.root,'story-runtime');
 let child:ChildProcess|undefined;
 const stop=async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}child=undefined;};
 try{
  const stateDirectory=join(runtimeRoot,'state'),cacheDirectory=join(runtimeRoot,'alignment-cache');
  await mkdir(stateDirectory,{recursive:true});await mkdir(cacheDirectory);
  const configFile=join(runtimeRoot,'deployment.json');
  const settings={storageOwnerId:f.owner,runtimeRoot,projectRoot:process.cwd(),home:process.env.HOME,stateDirectory,mediaRoot:f.root,backupRoot:join(runtimeRoot,'backups'),automaticBackups:false,controlledNotifications:true,
   database:{...transport.database,user:'loop_app'},workerDatabase:transport.database,openChatCut:{root:process.env.LOOP_TEST_OPENCHATCUT_ROOT},
   worker:{mountPath:f.volume.mountPath,minimumFreeBytes:0,visualCommand:[process.execPath,'--version'],alignment:{python:'/usr/bin/true',cacheDirectory,runnerSha256:createHash('sha256').update(await readFile('scripts/whisperx-align.py')).digest('hex')},concurrency:1,actualCostCents:0}};
  await writeFile(configFile,JSON.stringify(settings),{mode:0o600});
  const launch=async(fault:'none'|'copy-published'|'create-mkdir'='none')=>{
   await stop();
   const script=`import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';import{createServer}from'node:http';import{once}from'node:events';
if(process.argv[2]==='copy-published'){const link=fs.promises.link;fs.promises.link=async(...args)=>{const result=await link(...args);if(String(args[0]).includes('.migration-'))process.kill(process.pid,'SIGKILL');return result;};}
if(process.argv[2]==='create-mkdir'){const mkdir=fs.promises.mkdir;fs.promises.mkdir=async(...args)=>{const result=await mkdir(...args);if(String(args[0]).includes('/雨伞故事中断--'))process.kill(process.pid,'SIGKILL');return result;};}
syncBuiltinESMExports();const{createNativeApplication}=await import(${JSON.stringify(join(process.cwd(),'scripts/runtime/application.mjs'))});
const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));d.deploymentFile=process.argv[1];let app;const server=createServer((q,r)=>app.handler(q,r));server.listen(0,'127.0.0.1');await once(server,'listening');d.port=server.address().port;app=await createNativeApplication(d);console.log(JSON.stringify({origin:'http://127.0.0.1:'+d.port,pid:process.pid}));process.on('SIGTERM',async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await app.close();process.exit(0);});`;
   child=spawn(process.execPath,['--input-type=module','-e',script,configFile,fault],{env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR},stdio:['ignore','pipe','pipe']});
   return new Promise<{origin:string;pid:number}>((resolve,reject)=>{
    let stdout='',stderr='';const timer=setTimeout(()=>{child?.kill('SIGKILL');reject(Error('Story application launch timed out: '+stderr));},30000);
    child!.stdout!.on('data',b=>{stdout+=b;const line=stdout.split('\n').find(s=>s.startsWith('{"origin"'));if(line){clearTimeout(timer);resolve(JSON.parse(line));}});
    child!.stderr!.on('data',b=>stderr+=b);child!.once('error',reject);child!.once('exit',code=>{clearTimeout(timer);reject(Error('Story application exited '+code+': '+stderr));});
   });
  };
  return{launch,stop,close:async()=>{await stop();await transport.close();}};
 }catch(error){await stop();await transport.close();throw error;}
}
