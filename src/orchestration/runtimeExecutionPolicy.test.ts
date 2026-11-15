// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assertRuntimeRelease,readPreparedRuntimeRelease,prepareRuntime} from './runtimeBuild';
const roots:string[]=[],sha=(value:string)=>createHash('sha256').update(value).digest('hex');
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

/** A valid frozen v4 wire fixture, independent of the current publisher. */
async function legacyRelease(options:{reverseOutputOrder?:boolean;legacyEntry?:boolean;contract?:'production-workspace/v1'}={}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'loop-retired-runtime-')));roots.push(root);const marker=join(root,'executed');
 const sourceText:Record<string,string>={'package.json':'{}','package-lock.json':'{}','tsconfig.worker.json':JSON.stringify({include:['src/task.ts']}),'tsconfig.local-app.json':JSON.stringify({include:['src/task.ts']}),'src/task.ts':'export const value=1;'};
 const worker=`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'legacy');\n`,outputText:Record<string,string>={'dist/worker/local-app/localWorkerCli.js':worker,'dist/local-app/local-app/localRoute.js':'export const route=1;\n'};
 if(options.legacyEntry)outputText['scripts/runtime/codex.mjs']="throw Error('An archived entry must never execute');\n";
 const fingerprints=(values:Record<string,string>)=>Object.fromEntries(Object.keys(values).sort().map(path=>[path,sha(values[path])]));
 const ordered=fingerprints(outputText),outputHashes=options.reverseOutputOrder?Object.fromEntries(Object.entries(ordered).reverse()):ordered;
 const identity={publicationId:'00000000-0000-4000-8000-000000000001',projectRoot:root,nodeMajor:process.versions.node.split('.')[0],sources:fingerprints(sourceText),outputs:outputHashes,...(options.contract?{version:5,executionContract:options.contract}:{})},id=sha(JSON.stringify(identity)),release={id,root:join(root,'.loop-control/runtime-releases',id)},manifest={version:4,...identity,release};
 for(const [path,text]of Object.entries({...sourceText,...outputText})){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),text);}
 for(const [path,text]of Object.entries(outputText)){await mkdir(dirname(join(release.root,path)),{recursive:true});await writeFile(join(release.root,path),text);}
 const original=JSON.stringify(manifest)+'\n';await writeFile(join(release.root,'dist/runtime-manifest.json'),original);await writeFile(join(release.root,'package.json'),JSON.stringify({type:'module'})+'\n');await writeFile(join(root,'dist/runtime-manifest.json'),original);
 await mkdir(join(root,'scripts'),{recursive:true});await mkdir(join(root,'src/orchestration'),{recursive:true});
 await writeFile(join(root,'scripts/run-prepared.mjs'),await readFile(new URL('../../scripts/run-prepared.mjs',import.meta.url)));
 await writeFile(join(root,'src/orchestration/runtimeBuild.ts'),await readFile(new URL('./runtimeBuild.ts',import.meta.url)));
 return{root,release,marker,original,worker};
}
it('explicitly refuses a valid frozen v4 release without changing its bytes or guessing that integrity implies current execution',async()=>{
 const f=await legacyRelease();await expect(assertRuntimeRelease(f.root,f.release)).rejects.toMatchObject({code:'runtime_release_retired'});await expect(readPreparedRuntimeRelease(f.root)).rejects.toMatchObject({code:'runtime_release_retired'});
 expect(await readFile(join(f.release.root,'dist/runtime-manifest.json'),'utf8')).toBe(f.original);expect(await readFile(join(f.release.root,'dist/worker/local-app/localWorkerCli.js'),'utf8')).toBe(f.worker);await expect(access(f.marker)).rejects.toMatchObject({code:'ENOENT'});
});
it('the actual prepared CLI refuses the archived Worker before its module can execute',async()=>{
 const f=await legacyRelease();const result=await promisify(execFile)(process.execPath,[join(f.root,'scripts/run-prepared.mjs'),'worker'],{timeout:10000}).then(value=>({code:0,...value}),error=>({code:error.code,stdout:error.stdout,stderr:error.stderr}));
 expect(result.code).toBe(1);expect(result.stderr).toContain('runtime_release_retired');await expect(access(f.marker)).rejects.toMatchObject({code:'ENOENT'});
});
it('explicit preparation publishes a supported new protocol and leaves the original archive intact',async()=>{
 const f=await legacyRelease({legacyEntry:true});let builds=0;await prepareRuntime(f.root,async()=>{builds++;await writeFile(join(f.root,'dist/worker/local-app/localWorkerCli.js'),`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(f.marker)},'current');\n`);});
 expect(builds).toBe(1);const next=await readPreparedRuntimeRelease(f.root);expect(next.id).not.toBe(f.release.id);expect(JSON.parse(await readFile(join(f.root,'dist/runtime-manifest.json'),'utf8'))).toMatchObject({version:5,executionContract:'production-workspace/v2'});expect(await readFile(join(f.release.root,'dist/runtime-manifest.json'),'utf8')).toBe(f.original);
 await expect(assertRuntimeRelease(f.root,next)).resolves.toBeUndefined();await expect(access(join(next.root,'scripts/runtime/codex.mjs'))).rejects.toMatchObject({code:'ENOENT'});await expect(assertRuntimeRelease(f.root,f.release)).rejects.toMatchObject({code:'runtime_release_retired'});await promisify(execFile)(process.execPath,[join(f.root,'scripts/run-prepared.mjs'),'worker'],{timeout:10000});expect(await readFile(f.marker,'utf8')).toBe('current');
},15000);
it('a damaged archive remains an integrity failure instead of being relabelled a healthy retired package',async()=>{
 const f=await legacyRelease();await writeFile(join(f.release.root,'dist/worker/local-app/localWorkerCli.js'),'damaged');await expect(assertRuntimeRelease(f.root,f.release)).rejects.toMatchObject({code:'runtime_release_invalid'});
});
it('cannot relabel old bytes as the current protocol while retaining the old identity',async()=>{
 const f=await legacyRelease(),manifest={...JSON.parse(f.original),version:5,executionContract:'production-workspace/v2'};
 await writeFile(join(f.release.root,'dist/runtime-manifest.json'),JSON.stringify(manifest)+'\n');await expect(assertRuntimeRelease(f.root,f.release)).rejects.toMatchObject({code:'runtime_release_invalid'});await expect(access(f.marker)).rejects.toMatchObject({code:'ENOENT'});
});

it('matches output paths and hashes independently of a frozen archive map insertion order',async()=>{
 const f=await legacyRelease({reverseOutputOrder:true});await expect(assertRuntimeRelease(f.root,f.release)).rejects.toMatchObject({code:'runtime_release_retired'});expect(await readFile(join(f.release.root,'dist/runtime-manifest.json'),'utf8')).toBe(f.original);
});

it('validates the original optional v4 entry as archived bytes without adding it to the current execution contract',async()=>{
 const f=await legacyRelease({legacyEntry:true});await expect(assertRuntimeRelease(f.root,f.release)).rejects.toMatchObject({code:'runtime_release_retired'});
 await writeFile(join(f.release.root,'scripts/runtime/codex.mjs'),'damaged archived entry');await expect(assertRuntimeRelease(f.root,f.release)).rejects.toMatchObject({code:'runtime_release_invalid'});
});
it('the actual application factory rejects an archived package before reading database configuration',async()=>{
 const f=await legacyRelease(),{createNativeApplication}=await import(new URL('../../scripts/runtime/application.mjs',import.meta.url).href);
 const input={projectRoot:f.root,runtimeRelease:f.release,get database(){throw Error('Retired application must not inspect database configuration');}};
 await expect(createNativeApplication(input)).rejects.toMatchObject({code:'runtime_release_retired'});await expect(access(f.marker)).rejects.toMatchObject({code:'ENOENT'});
});

it('retires a valid v5 first-generation contract before Worker or application execution and preserves its bytes',async()=>{
 const f=await legacyRelease({contract:'production-workspace/v1'});
 await expect(assertRuntimeRelease(f.root,f.release)).rejects.toMatchObject({code:'runtime_release_retired'});
 const result=await promisify(execFile)(process.execPath,[join(f.root,'scripts/run-prepared.mjs'),'worker'],{timeout:10000}).then(value=>({code:0,...value}),error=>({code:error.code,stdout:error.stdout,stderr:error.stderr}));
 expect(result.code).toBe(1);expect(result.stderr).toContain('runtime_release_retired');await expect(access(f.marker)).rejects.toMatchObject({code:'ENOENT'});
 const {createNativeApplication}=await import(new URL('../../scripts/runtime/application.mjs',import.meta.url).href);
 await expect(createNativeApplication({projectRoot:f.root,runtimeRelease:f.release,get database(){throw Error('Retired application must not inspect database configuration');}})).rejects.toMatchObject({code:'runtime_release_retired'});
 expect(await readFile(join(f.release.root,'dist/runtime-manifest.json'),'utf8')).toBe(f.original);
});
