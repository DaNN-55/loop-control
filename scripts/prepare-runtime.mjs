import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareRuntime } from '../src/orchestration/runtimeBuild.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
await prepareRuntime(root,async()=>{
  for(const script of ['worker:build','orchestrator:build'])await new Promise((resolve,reject)=>{
    const child=spawn('npm',['run',script],{cwd:root,env:process.env,stdio:'inherit'});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`${script} failed (${code})`)));
  });
});
console.log('Worker/编排程序已准备并通过源码与产物完整性检查。');
