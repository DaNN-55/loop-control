import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {openSync,closeSync} from 'node:fs';
import {root,projectRoot,verifiedSource} from './environment.mjs';
import {cleanEnvironment} from '../isolation/environment.mjs';
const env=cleanEnvironment(verifiedSource());
const commands=[['node_modules/typescript/bin/tsc','-b','--pretty','false'],['node_modules/typescript/bin/tsc','-p','tsconfig.local-app.json'],['node_modules/vitest/vitest.mjs','run','--exclude','n8n/import-workflows.test.mjs','--exclude','**/*.integration.test.ts','--exclude','**/.loop-control/**'],['--test','n8n/import-workflows.test.mjs']];
const stage=process.argv[2]??'t13';if(!/^t[0-9]{2}$/.test(stage))throw Error('Pass a ticket stage such as t13');
const path=join(root,`logs/${stage}-checks.txt`);const fd=openSync(path,'w',0o600);
try{for(const args of commands){const result=spawnSync(process.execPath,args,{cwd:projectRoot,env,stdio:['ignore',fd,fd]});if(result.status!==0){console.log(JSON.stringify({passed:false,command:args[0],log:path}));process.exitCode=1;break;}}}finally{closeSync(fd);}
if(!process.exitCode)console.log(JSON.stringify({passed:true,log:path}));
