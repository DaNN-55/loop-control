// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// This file owns the old-API environment. The modern tests run with real APIs
// in their own module scope, so both generations are exercised on every run.
vi.mock('../orchestration/runtimeBuild',async importOriginal=>({
 ...await importOriginal<typeof import('../orchestration/runtimeBuild')>(),
 assertRuntimeRelease:undefined,
 readPreparedRuntimeRelease:undefined,
}));
import {createRuntimeVersionReader} from './runtimeVersion';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

it('legacy runtime APIs remain unverified instead of borrowing a real prepared version',async()=>{
 const actual=await vi.importActual<typeof import('../orchestration/runtimeBuild')>('../orchestration/runtimeBuild');
 const root=await mkdtemp(join(tmpdir(),'loop-legacy-version-'));roots.push(root);
 for(const dir of ['src','dist/worker/local-app','dist/local-app/local-app'])await mkdir(join(root,dir),{recursive:true});
 await writeFile(join(root,'src/task.ts'),'export const value=1;');
 for(const name of ['package.json','package-lock.json'])await writeFile(join(root,name),'{}');
 for(const name of ['tsconfig.worker.json','tsconfig.local-app.json'])await writeFile(join(root,name),JSON.stringify({include:['src/task.ts']}));
 await actual.prepareRuntime(root,async()=>{
  for(const name of ['dist/worker/local-app/localWorkerCli.js','dist/local-app/local-app/localRoute.js'])await writeFile(join(root,name),'export const value=1;');
 });
 const release=await actual.readPreparedRuntimeRelease(root);
 await expect(actual.assertRuntimeRelease(root,release)).resolves.toBeUndefined();
 const status=await createRuntimeVersionReader({projectRoot:root,runtimeRelease:release,workerRelease:()=>release.id})();
 expect(status).toMatchObject({state:'unknown',backendReleaseId:null,workerReleaseId:null,preparedReleaseId:null});
 expect(JSON.stringify(status)).not.toContain(release.id);
});
