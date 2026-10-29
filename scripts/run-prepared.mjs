import {fileURLToPath} from 'node:url';
import {assertPreparedRuntime} from '../src/orchestration/runtimeBuild.ts';
if(process.argv[2]!=='worker')throw Error('Use worker; scheduling is managed by npm start.');
await assertPreparedRuntime(fileURLToPath(new URL('../',import.meta.url)));
process.argv.splice(2,1);
await import('../dist/worker/local-app/localWorkerCli.js');
