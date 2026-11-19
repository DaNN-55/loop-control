import {spawn} from 'node:child_process';
import {join} from 'node:path';

/** Prepare program files after startup; no editor, database, project or provider call. */
export function scheduleStudioWarmup({root,node,projectRoot,environment,delayMs=2000}){
 let child,killTimer,closed=false;
 const timer=setTimeout(()=>{
  if(closed)return;
  child=spawn(node,[join(projectRoot,'scripts/openchatcut-prewarm.mjs')],{
   env:{...environment,OPENCHATCUT_ROOT:root},stdio:['ignore','ignore','pipe'],
  });
  // Program preparation is optional. Opening an editor retains its normal fallback.
  let detail='';child.stderr.on('data',chunk=>{detail=(detail+String(chunk)).slice(-1000);});
  child.on('error',error=>console.warn('Studio 程序预备跳过：'+error.message));
  child.on('exit',code=>{clearTimeout(killTimer);if(!closed&&code)console.warn('Studio 程序预备跳过：'+detail.trim());});
 },delayMs);
 timer.unref();
 return {close(){closed=true;clearTimeout(timer);if(child&&child.exitCode===null){child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),2000);killTimer.unref();}}};
}
