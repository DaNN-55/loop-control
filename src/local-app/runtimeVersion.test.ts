// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as runtimeBuild from '../orchestration/runtimeBuild';
const {prepareRuntime}=runtimeBuild;
const readPreparedRuntimeRelease=(runtimeBuild as typeof runtimeBuild & {readPreparedRuntimeRelease?:(root:string)=>Promise<{id:string;root:string}>}).readPreparedRuntimeRelease;
const pinned=it.skipIf(!readPreparedRuntimeRelease);
import {createRuntimeVersionReader} from './runtimeVersion';
const roots:string[]=[];
afterEach(async()=>{vi.useRealTimers();await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'loop-version-observation-'));roots.push(root);
 for(const dir of ['src','dist/worker/local-app','dist/local-app/local-app'])await mkdir(join(root,dir),{recursive:true});
 await writeFile(join(root,'src/task.ts'),'export const value=1;');for(const name of ['package.json','package-lock.json'])await writeFile(join(root,name),'{}');
 for(const name of ['tsconfig.worker.json','tsconfig.local-app.json'])await writeFile(join(root,name),JSON.stringify({include:['src/task.ts']}));
 const build=async()=>{for(const name of ['dist/worker/local-app/localWorkerCli.js','dist/local-app/local-app/localRoute.js'])await writeFile(join(root,name),'export const value=1;');};
 await prepareRuntime(root,build);const release=await readPreparedRuntimeRelease!(root);
 return{root,release,build,read:createRuntimeVersionReader({projectRoot:root,runtimeRelease:release,workerRelease:()=>release.id})};
}
pinned('reports the actual pinned identities and startup time from verified release files',async()=>{
 const f=await fixture(),before=Date.now(),value=await f.read();expect(value).toMatchObject({state:'current',backendReleaseId:f.release.id,workerReleaseId:f.release.id,preparedReleaseId:f.release.id});expect(Date.parse(value.startedAt)).toBeLessThanOrEqual(before);expect(Date.parse(value.checkedAt)).toBeGreaterThanOrEqual(before);
});
pinned('development edits are pending updates while the pinned version remains valid',async()=>{
 const f=await fixture();await writeFile(join(f.root,'src/task.ts'),'export const value=2;');expect(await f.read()).toMatchObject({state:'source_changed',backendReleaseId:f.release.id});
});
pinned('preparing another release never relabels the running backend and worker',async()=>{
 const f=await fixture();await writeFile(join(f.root,'src/task.ts'),'export const value=2;');await prepareRuntime(f.root,f.build);const prepared=await readPreparedRuntimeRelease!(f.root);expect(prepared.id).not.toBe(f.release.id);
 expect(await f.read()).toMatchObject({state:'restart_required',backendReleaseId:f.release.id,workerReleaseId:f.release.id,preparedReleaseId:prepared.id});
 const restarted=createRuntimeVersionReader({projectRoot:f.root,runtimeRelease:prepared,workerRelease:()=>prepared.id});expect((await restarted()).state).toBe('current');
});
pinned('damaged running files override pending development changes and do not expose internal paths',async()=>{
 const f=await fixture();await writeFile(join(f.root,'src/task.ts'),'changed');await writeFile(join(f.release.root,'dist/worker/local-app/localWorkerCli.js'),'corrupt');const value=await f.read();expect(value.state).toBe('running_invalid');expect(JSON.stringify(value)).not.toContain(f.root);
});
pinned('a worker pinned to another release is a mismatch even with a healthy prepared version',async()=>{
 const f=await fixture();const read=createRuntimeVersionReader({projectRoot:f.root,runtimeRelease:f.release,workerRelease:()=> 'b'.repeat(64)});expect((await read()).state).toBe('mismatch');
});
pinned('does not guess a legacy process identity from the currently prepared manifest',async()=>{
 const f=await fixture();expect(await createRuntimeVersionReader({projectRoot:f.root})()).toMatchObject({state:'unknown',backendReleaseId:null,workerReleaseId:null,preparedReleaseId:f.release.id});
});
pinned('preparation in progress and missing prepared pointers preserve the running identity',async()=>{
 const f=await fixture();await mkdir(join(f.root,'dist/runtime-preparing'));expect((await f.read()).state).toBe('preparing');
 await rm(join(f.root,'dist/runtime-preparing'),{recursive:true});await rm(join(f.root,'dist/runtime-manifest.json'));const read=createRuntimeVersionReader({projectRoot:f.root,runtimeRelease:f.release,workerRelease:()=>f.release.id});expect(await read()).toMatchObject({state:'not_prepared',backendReleaseId:f.release.id});
});
pinned('coalesces concurrent checks and refreshes bounded cached observations without background timers',async()=>{
 const f=await fixture();const [a,b]=await Promise.all([f.read(),f.read()]);expect(a).toBe(b);await writeFile(join(f.root,'src/task.ts'),'changed');expect(await f.read()).toBe(a);
 vi.useFakeTimers();vi.setSystemTime(Date.now()+10001);const next=await f.read();expect(next.state).toBe('source_changed');expect(next.startedAt).toBe(a.startedAt);expect(next.checkedAt).not.toBe(a.checkedAt);
});

pinned('a damaged newly prepared release is distinct from damaged running files',async()=>{
 const f=await fixture();await writeFile(join(f.root,'src/task.ts'),'export const value=2;');await prepareRuntime(f.root,f.build);const next=await readPreparedRuntimeRelease!(f.root);await writeFile(join(next.root,'dist/worker/local-app/localWorkerCli.js'),'corrupt next release');
 expect(await f.read()).toMatchObject({state:'prepared_invalid',backendReleaseId:f.release.id,workerReleaseId:f.release.id});
});

it.skipIf(!!readPreparedRuntimeRelease)('legacy runtime APIs remain unverified instead of borrowing the prepared version',async()=>{
 expect(await createRuntimeVersionReader({projectRoot:'/unprepared-legacy-runtime'})()).toMatchObject({state:'unknown',backendReleaseId:null,workerReleaseId:null,preparedReleaseId:null});
});
