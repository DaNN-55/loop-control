import {readFileSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {projectRoot} from './environment.mjs';
import {inspectRecordedService} from '../local-service-record.mjs';
const {readDeployment}=await import('./deployment.mjs');const d=readDeployment(),appPort=d.port;
const path=d.recordPath;
if(existsSync(path)){
 const r=JSON.parse(readFileSync(path));
 const valid=()=>inspectRecordedService({pid:r.pid,port:String(appPort),commandIdentity:join(projectRoot,'node_modules/vite/bin/vite.js')},projectRoot).valid;
 if(r.projectRoot!==projectRoot||r.port!==appPort||!valid())throw Error('Native app identity mismatch; refusing to signal');
 process.kill(r.pid,'SIGTERM');
 for(let i=0;i<80&&valid();i++)await new Promise(r=>setTimeout(r,100));
 if(valid())throw Error('Native app did not exit');unlinkSync(path);
 console.log('Stopped only recorded D app');
}
