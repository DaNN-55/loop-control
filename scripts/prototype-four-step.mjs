// Throwaway launcher: reuse the daily runtime, never start another database/worker.
import { spawnSync } from 'node:child_process';
import { readDeployment } from './runtime/environment.mjs';
const result=spawnSync(process.execPath,['scripts/start.mjs'],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status??1);
const {port}=readDeployment();
console.log(`四步流程原型：http://127.0.0.1:${port}/?episode=bbea3b57-061b-4341-9ba1-3bf65d28899f&prototype=four-step-workflow&variant=A`);
console.log('A 一体编辑台 / B 脚本驱动 / C 沉浸剪辑；所有操作仅保存在页面内存。');
