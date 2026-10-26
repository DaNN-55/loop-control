import { fileURLToPath } from 'node:url';
import { assertPreparedRuntime } from '../src/orchestration/runtimeBuild.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const mode=process.argv[2];
if(!['worker','orchestrator'].includes(mode))throw Error('Use worker or orchestrator');
await assertPreparedRuntime(root);
process.argv.splice(2,1);
await import(new URL(mode==='worker'?'../dist/worker/worker/codexWorkerCli.js':'../dist/orchestration/orchestration/loopOrchestratorCli.js',import.meta.url));
