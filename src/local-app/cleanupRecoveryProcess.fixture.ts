import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {csrfFor} from './sessions';
type Fixture={database:string;root:string;token:string};
export async function cleanupRecoveryProcess(f:Fixture,crash?:'link-before-unlink'|'before-finalize'|'after-first-finalize'|'fail-finalize'){
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE!);const context=runtimeContext();context.assertDatabase();if(context.dailyRuntime!==false)throw Error('Owned isolated cluster required');
 const child=spawn(join(process.cwd(),'node_modules/.bin/vite-node'),['--config','src/local-app/episodeDeletionProcess.config.mjs','src/local-app/episodeDeletionProcess.fixture.ts'],{cwd:process.cwd(),env:process.env,stdio:['pipe','pipe','pipe']});let errors='';child.stderr!.on('data',bytes=>{errors=(errors+bytes).slice(-4000);});
 const lines=createInterface({input:child.stdout!});child.stdin!.end(JSON.stringify({database:f.database,root:f.root,crash})+'\n');
 let ready:{origin:string;pid:number};try{ready=await Promise.race([once(lines,'line',{signal:AbortSignal.timeout(15000)}).then(([line])=>JSON.parse(String(line))),once(child,'exit').then(()=>{throw Error(errors||'Recovery fixture exited before readiness');})]);}catch(error){child.kill('SIGTERM');throw error;}finally{lines.close();}
 return{child,...ready,
  async post(command:string,data:Record<string,unknown>,key=randomUUID()){
   const response=await fetch(ready.origin+'/api/local/episode-lifecycle',{method:'POST',headers:{Origin:ready.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:key,data})});return{status:response.status,body:await response.json()};
  },
  async close(){if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill('SIGTERM');await ended;}}
 };
}
