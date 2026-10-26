import{keychainState}from'./keychain.mjs';
import{readFileSync,existsSync,unlinkSync}from'node:fs';import{join}from'node:path';import{projectRoot,root,readSettings}from'./environment.mjs';import{inspectRecordedService}from'../local-service-record.mjs';
const d=readSettings(),file=join(root,'app.json');if(!existsSync(file)){console.log('Daily application is not recorded as running.');}else{
 const record=JSON.parse(readFileSync(file));if(record.projectRoot!==projectRoot||record.deploymentFile!==join(root,'deployment.json')||!inspectRecordedService({pid:record.pid,port:String(d.port),commandIdentity:join(projectRoot,'node_modules/vite/bin/vite.js')},projectRoot).valid)throw Error('Daily app identity mismatch');process.kill(record.pid,'SIGTERM');let stopped=false;
 for(let i=0;i<100;i++){try{process.kill(record.pid,0);}catch(e){if(e.code==='ESRCH'){stopped=true;break;}throw e;}await new Promise(r=>setTimeout(r,100));}if(!stopped)throw Error('Daily app has not stopped; record retained');unlinkSync(file);console.log('Daily application stopped; PostgreSQL, media and evidence retained.');}

keychainState('lock');
