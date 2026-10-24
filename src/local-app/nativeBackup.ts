import {spawn} from 'node:child_process';
import {join} from 'node:path';
export function nativeBackup(projectRoot:string,database:string,mediaRoot:string,backupRoot:string){return async(jobId:string,signal:AbortSignal)=>new Promise<{passed:boolean;detail:string}>((resolve,reject)=>{
 if(signal.aborted){reject(Error('备份已取消。'));return;}
 const child=spawn(process.execPath,[join(projectRoot,'scripts/local/backup.mjs')],{cwd:projectRoot,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR},detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});let output='',overflow=false,timer:ReturnType<typeof setTimeout>|undefined;
 const kill=(signal:NodeJS.Signals)=>{if(child.pid)try{process.kill(process.platform==='win32'?child.pid:-child.pid,signal);}catch{/* Exited. */}};
 const stop=()=>{if(timer)return;kill('SIGTERM');timer=setTimeout(()=>kill('SIGKILL'),2000);timer.unref?.();};signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
 child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({projectRoot,database,mediaRoot,backupRoot,jobId}));child.stdout.on('data',b=>{output+=b;if(output.length>8192){overflow=true;stop();}});child.stderr.on('data',()=>{});child.on('error',reject);child.on('close',code=>{signal.removeEventListener('abort',stop);if(timer)clearTimeout(timer);try{if(code!==0||overflow)throw Error();const r=JSON.parse(output);if(r.passed!==true||typeof r.detail!=='string'||r.detail.length>1000)throw Error();resolve({passed:true,detail:r.detail});}catch{reject(Error('本地完整备份未完成。'));}});
});}
