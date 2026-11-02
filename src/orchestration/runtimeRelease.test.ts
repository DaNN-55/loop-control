// @vitest-environment node
import {it,expect,afterEach} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareRuntime,assertPreparedRuntime,readPreparedRuntimeRelease,assertRuntimeRelease} from './runtimeBuild';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'loop-release-'));roots.push(root);for(const p of ['src','dist/worker/local-app','dist/local-app/local-app'])await mkdir(join(root,p),{recursive:true});await writeFile(join(root,'src/task.ts'),'export const version=1;');for(const n of ['package.json','package-lock.json'])await writeFile(join(root,n),'{}');for(const n of ['tsconfig.worker.json','tsconfig.local-app.json'])await writeFile(join(root,n),JSON.stringify({include:['src/task.ts']}));return{root,build:async(version:string)=>{await writeFile(join(root,'dist/worker/local-app/localWorkerCli.js'),version);await writeFile(join(root,'dist/local-app/local-app/localRoute.js'),version);}};}
it('a running version survives source edits, another prepare and failed compilation; new starts select the new version',async()=>{const f=await fixture();await prepareRuntime(f.root,()=>f.build('version-one'));const first=await readPreparedRuntimeRelease(f.root);await writeFile(join(f.root,'src/task.ts'),'export const version=2;');await expect(assertPreparedRuntime(f.root)).rejects.toThrow();await expect(assertRuntimeRelease(f.root,first)).resolves.toBeUndefined();await prepareRuntime(f.root,()=>f.build('version-two'));const second=await readPreparedRuntimeRelease(f.root);expect(second.id).not.toBe(first.id);expect(await readFile(join(first.root,'dist/worker/local-app/localWorkerCli.js'),'utf8')).toBe('version-one');await expect(assertRuntimeRelease(f.root,first)).resolves.toBeUndefined();await writeFile(join(f.root,'src/task.ts'),'export const version=3;');await expect(prepareRuntime(f.root,async()=>{throw Error('compiler failed');})).rejects.toThrow('compiler failed');expect(await readPreparedRuntimeRelease(f.root)).toEqual(second);await expect(assertRuntimeRelease(f.root,first)).resolves.toBeUndefined();},15000);

it('damaged published code stays refused while explicit preparation creates a fresh valid version',async()=>{const f=await fixture();await prepareRuntime(f.root,()=>f.build('original'));const first=await readPreparedRuntimeRelease(f.root);await writeFile(join(first.root,'dist/worker/local-app/localWorkerCli.js'),'tampered');await expect(assertRuntimeRelease(f.root,first)).rejects.toMatchObject({code:'runtime_release_invalid'});await prepareRuntime(f.root,()=>f.build('original'));const repaired=await readPreparedRuntimeRelease(f.root);expect(repaired.id).not.toBe(first.id);await expect(assertRuntimeRelease(f.root,repaired)).resolves.toBeUndefined();await expect(assertRuntimeRelease(f.root,first)).rejects.toThrow();});

it('rejects altered release metadata and an aliased release path without trusting the current pointer',async()=>{
 const f=await fixture();await prepareRuntime(f.root,()=>f.build('original'));const release=await readPreparedRuntimeRelease(f.root),path=join(release.root,'dist/runtime-manifest.json'),raw=await readFile(path,'utf8');
 for(const change of [{nodeMajor:'0'},{projectRoot:'/another-project'},{publicationId:'changed'}]){await writeFile(path,JSON.stringify({...JSON.parse(raw),...change}));await expect(assertRuntimeRelease(f.root,release)).rejects.toMatchObject({code:'runtime_release_invalid'});}
 await writeFile(path,raw);
 await expect(assertRuntimeRelease(f.root,{...release,root:release.root+'/../'+release.id})).rejects.toMatchObject({code:'runtime_release_invalid'});
 await expect(assertRuntimeRelease(f.root,release)).resolves.toBeUndefined();
},15000);
