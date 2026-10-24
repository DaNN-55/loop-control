import {assertMediaReady,type NativeMediaConfiguration} from './mediaWorker.js';
import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import type {PoolConfig} from 'pg';
import {createWorkerDatabase,nativeWorkerPort,assertNativeWorkerDatabase,assertWorkerDatabaseBinding} from './workerDatabase.js';
import {ConfigurationError} from './configurationCommands.js';
import {startWorkerScheduler} from '../orchestration/workerScheduler.js';
import {assertPreparedRuntime} from '../orchestration/runtimeBuild.js';
import type {ClaimedTaskRow} from '../orchestration/workerDispatch.js';
import{assertNarrationReady,type NativeNarrationConfiguration}from'./narrationWorker.js';
export interface NativeWorkerConfiguration {
 projectRoot:string;database:PoolConfig;mediaRoot:string;mountPath:string;minimumFreeBytes:number;
 applicationDatabase:Pick<PoolConfig,'host'|'port'|'database'>;
 visualCommand:string[];environment:NodeJS.ProcessEnv;concurrency:number;
 actualCostCents:number;
 narration?:NativeNarrationConfiguration;
 media?:NativeMediaConfiguration;
 record?:(event:{name:string;taskId:string;pid?:number;step?:string})=>void;
}
export async function startNativeWorkerService(config:NativeWorkerConfiguration){
 assertWorkerDatabaseBinding(config.database,config.applicationDatabase);
 const pool=createWorkerDatabase(config.database),port=nativeWorkerPort(pool),controller=new AbortController();
 const ready=async()=>{
  await assertPreparedRuntime(config.projectRoot);
  await access(join(config.projectRoot,'dist/worker/local-app/localWorkerCli.js'));
  if(!Number.isSafeInteger(config.actualCostCents)||config.actualCostCents<0)throw Error('Worker成本配置无效。');
  if(!config.visualCommand.length)throw Error('本地视觉执行器未配置。');await access(config.visualCommand[0],constants.X_OK);
  try{await assertNativeWorkerDatabase(pool,config.database.database!,Boolean(config.narration),Boolean(config.media));}catch{throw new ConfigurationError(503,'Worker数据库连接或身份检查失败，请检查本机Worker配置。');}
 };
 await ready().catch(async e=>{await pool.end();throw e;});
 const database={async plan(scope:Parameters<typeof port.plan>[0]){await ready();return port.plan(scope);},async rpc(name:string,args:Record<string,unknown>){if(name==='claim_next_worker_task')await ready();return port.rpc(name,args);}};
 async function execute(task:ClaimedTaskRow){
  await ready();
  return new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[join(config.projectRoot,'dist/worker/local-app/localWorkerCli.js')],{cwd:config.projectRoot,env:config.environment,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
   config.record?.({name:'worker-started',taskId:task.task_id,pid:child.pid});
   let output='',overflow=false;let killTimer:ReturnType<typeof setTimeout>|undefined;
   const kill=(signal:NodeJS.Signals)=>{if(child.pid)try{process.kill(process.platform==='win32'?child.pid:-child.pid,signal);}catch{/* Exited. */}};
   const stop=()=>{kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),2000);killTimer.unref();};controller.signal.addEventListener('abort',stop,{once:true});
   if(controller.signal.aborted)stop();
   const {projectRoot,database,mediaRoot,mountPath,minimumFreeBytes,visualCommand,actualCostCents,narration,media}=config;
   const applicationDatabase={host:config.applicationDatabase.host,port:config.applicationDatabase.port,database:config.applicationDatabase.database};
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({task,config:{projectRoot,database,applicationDatabase,mediaRoot,mountPath,minimumFreeBytes,visualCommand,actualCostCents,narration,media}}));
   child.stdout.on('data',b=>{output+=String(b);if(Buffer.byteLength(output)>65536){overflow=true;stop();}});
   child.stderr.on('data',()=>{}); // Raw process/database diagnostics never become a response channel.
   child.once('error',reject);child.once('close',code=>{controller.signal.removeEventListener('abort',stop);if(killTimer)clearTimeout(killTimer);try{if(code!==0||overflow)throw Error();for(const line of output.trim().split('\n')){const value=JSON.parse(line);if(value.event==='progress')config.record?.({name:'worker-progress',taskId:task.task_id,step:String(value.step)});}resolve(JSON.parse(output.trim().split('\n').at(-1)!));}catch{reject(Error('本地Worker执行未完成。'));}});
  });
 }
 const scheduler=await startWorkerScheduler({projectRoot:config.projectRoot,database,environment:config.environment,concurrency:config.concurrency,signal:controller.signal},{prepare:ready,execute});
 let stopping:Promise<void>|undefined;
 return {ready,mediaReady:async(policy:Record<string,unknown>)=>{await ready();await assertMediaReady(config.media,policy,config.environment);},narrationReady:async()=>{await ready();await assertNarrationReady(config.narration);},wake:(episodeId:string)=>scheduler.wake({episodeId}),status:scheduler.status,stop(){return stopping??= (async()=>{controller.abort();await scheduler.stop();await pool.end();})();}};
}
