import{keychainState}from'./keychain.mjs';
import{readFileSync,existsSync,unlinkSync}from'node:fs';import{join}from'node:path';import{projectRoot,root,readSettings}from'./environment.mjs';import{inspectRecordedService}from'../local-service-record.mjs';
try{
const d=readSettings(),file=join(root,'app.json');let result='本地服务未运行。';if(existsSync(file)){
 const record=JSON.parse(readFileSync(file));if(record.projectRoot!==projectRoot||record.deploymentFile!==join(root,'deployment.json')||!inspectRecordedService({pid:record.pid,port:String(d.port),commandIdentity:join(projectRoot,'node_modules/vite/bin/vite.js')},projectRoot).valid)throw Error('无法确认本地服务状态，未执行停止。');process.kill(record.pid,'SIGTERM');let stopped=false;
 for(let i=0;i<100;i++){try{process.kill(record.pid,0);}catch(e){if(e.code==='ESRCH'){stopped=true;break;}throw e;}await new Promise(r=>setTimeout(r,100));}if(!stopped)throw Error('本地服务尚未停止，请稍后重试。');unlinkSync(file);result='本地服务已停止。';}

keychainState('lock');
console.log(result);
}catch(error){
 const message=error instanceof Error?error.message:'';
 console.error(['无法确认本地服务状态，未执行停止。','本地服务尚未停止，请稍后重试。'].includes(message)?message:'停止本地服务失败，请稍后重试。');
 process.exitCode=1;
}
