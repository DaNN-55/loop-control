import {fileURLToPath} from 'node:url';
import {readPreparedRuntimeRelease} from '../src/orchestration/runtimeBuild.ts';
if(process.argv[2]!=='worker')throw Error('Use worker; scheduling is managed by npm start.');
const runtimeRelease=await readPreparedRuntimeRelease(fileURLToPath(new URL('../',import.meta.url)));
process.argv.splice(2,1);
const {pathToFileURL}=await import('node:url');await import(pathToFileURL(runtimeRelease.root+'/dist/worker/local-app/localWorkerCli.js').href);
