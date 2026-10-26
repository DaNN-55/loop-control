import { fileURLToPath } from 'node:url';
import { assertPreparedRuntime } from '../src/orchestration/runtimeBuild.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const mode=process.argv[2];
if(!['worker','orchestrator','legacy-worker','legacy-orchestrator'].includes(mode))throw Error('Use worker, orchestrator, legacy-worker or legacy-orchestrator');
if(mode==='orchestrator')throw Error('本地编排由应用常驻服务管理；请使用 npm start。旧运行方式需显式 legacy:orchestrator。');
await assertPreparedRuntime(root);
process.argv.splice(2,1);
await import(new URL(mode==='worker'?'../dist/worker/local-app/localWorkerCli.js':mode==='legacy-worker'?'../dist/worker/worker/codexWorkerCli.js':'../dist/orchestration/orchestration/loopOrchestratorCli.js',import.meta.url));
