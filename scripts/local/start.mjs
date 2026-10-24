import {spawn,execFileSync} from 'node:child_process';
import {existsSync,readFileSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {once} from 'node:events';
import {root,projectRoot,appPort,env,configuration,writePrivateFile} from './environment.mjs';
import {inspectRecordedService} from '../local-service-record.mjs';
import {openPrivateFile} from '../isolation/environment.mjs';
configuration();
const offlineGuard=process.argv.includes('--offline-test');
const path=join(root,'state/app.json'),identity=join(projectRoot,'node_modules/vite/bin/vite.js');
const valid=r=>inspectRecordedService({pid:r.pid,port:String(appPort),commandIdentity:identity},projectRoot).valid;
if(existsSync(path)){if(!valid(JSON.parse(readFileSync(path)))||Boolean(JSON.parse(readFileSync(path)).offlineGuard)!==offlineGuard)throw Error('Native app service identity mismatch');console.log('Native app already running');}
else{
 execFileSync(process.execPath,[join(projectRoot,'scripts/prepare-runtime.mjs')],{cwd:projectRoot,env,stdio:'pipe'});
 execFileSync(process.execPath,[join(projectRoot,'node_modules/typescript/bin/tsc'),'-p','tsconfig.local-app.json'],{cwd:projectRoot,env,stdio:'pipe'});
 const log=openPrivateFile(join(root,'logs/app.log'),{append:true});
 const child=spawn(process.execPath,[...(offlineGuard?['--import',join(projectRoot,'scripts/local/offline-guard.mjs')]:[]),identity,'--config','scripts/local/vite.config.mjs'],{cwd:projectRoot,env:{...env,HOME:join(root,'home')},detached:true,stdio:['ignore',log,log]});await once(child,'spawn');closeSync(log);
 const r={pid:child.pid,port:appPort,projectRoot,offlineGuard};
 for(let i=0;i<100;i++){if(valid(r)){writePrivateFile(path,JSON.stringify(r)+'\n',{exclusive:true});child.unref();break;}if(child.exitCode!==null)throw Error('Native app failed; inspect private app log');await new Promise(r=>setTimeout(r,100));}
 if(!valid(r)){child.kill();throw Error('Native app did not listen');}
 console.log(JSON.stringify({appPort,started:true}));
}
