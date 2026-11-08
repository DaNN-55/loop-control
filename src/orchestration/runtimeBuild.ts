import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

type Fingerprints = Record<string, string>;
export interface RuntimeRelease {id:string;root:string}
export class RuntimePreparationError extends Error {
 readonly code: "runtime_not_prepared"|"runtime_source_changed"|"runtime_release_invalid"|"runtime_preparing";
 constructor(code: RuntimePreparationError["code"]) {super(runtimeErrorMessages[code]);this.code=code;}
}
export const runtimeErrorMessages={runtime_not_prepared:"运行程序尚未准备，请运行 npm run runtime:prepare 后重启本机服务。",runtime_source_changed:"开发源码或编译产物已变化，请运行 npm run runtime:prepare；正在运行的固定版本不受影响。",runtime_release_invalid:"当前运行版本不完整或校验失败，已停止执行；请运行 npm run runtime:prepare 后重启本机服务。",runtime_preparing:"新运行版本正在准备，请等待当前准备完成后重试。"};
interface RuntimeManifest {version:4;publicationId:string;projectRoot:string;nodeMajor:string;sources:Fingerprints;outputs:Fingerprints;release:RuntimeRelease}
const manifestName = "dist/runtime-manifest.json";
const requiredOutputs = ["dist/worker/local-app/localWorkerCli.js", "dist/local-app/local-app/localRoute.js"];

async function files(root: string, directory: string): Promise<string[]> {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  if(entries.some(entry=>entry.isSymbolicLink()))throw Error("Runtime alias");
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(root, `${directory}/${entry.name}`) : [`${directory}/${entry.name}`]))).flat();
}

async function fingerprints(root: string, paths: string[]): Promise<Fingerprints> {
  return Object.fromEntries(await Promise.all(paths.sort().map(async path => [path, createHash("sha256").update(await readFile(join(root, path))).digest("hex")])));
}

async function sources(root: string) {
  // Discover dependencies only when explicitly preparing a runtime. Routine
  // readiness checks hash the recorded set without loading the compiler.
  const { default: ts } = await import("typescript");
  const paths = new Set(["package.json", "package-lock.json", "tsconfig.worker.json", "tsconfig.local-app.json"]);
  for (const name of ["tsconfig.worker.json", "tsconfig.local-app.json"]) {
    const config = ts.readConfigFile(join(root, name), ts.sys.readFile);
    if (config.error) throw Error(`Cannot read ${name}`);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    if (parsed.errors.length) throw Error(`Invalid ${name}`);
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    for (const file of program.getSourceFiles()) {
      const path = relative(root, file.fileName).replaceAll("\\", "/");
      if (path.startsWith("src/")) paths.add(path);
    }
  }
  try{await lstat(join(root,"scripts/runtime/codex.mjs"));paths.add("scripts/runtime/codex.mjs");}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  return fingerprints(root, [...paths]);
}

async function outputs(root: string) {
  const paths = [...await files(root, "dist/worker"), ...await files(root, "dist/local-app")];
  if (requiredOutputs.some(path => !paths.includes(path))) throw Error("Missing runtime entrypoint");
  try{
    await lstat(join(root,"scripts/runtime/codex.mjs"));
    for(const module of ["codexPrompt","workerResultSchema"]){
      if(!paths.includes(`dist/worker/worker/${module}.js`))throw Error(`Missing Codex executor module: ${module}`);
    }
    paths.push("scripts/runtime/codex.mjs");
  }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  return fingerprints(root, paths);
}

const releaseIdentity=(m:Pick<RuntimeManifest,'publicationId'|'projectRoot'|'nodeMajor'|'sources'|'outputs'>)=>createHash('sha256').update(JSON.stringify({publicationId:m.publicationId,projectRoot:m.projectRoot,nodeMajor:m.nodeMajor,sources:m.sources,outputs:m.outputs})).digest('hex');
export async function assertRuntimeRelease(projectRoot:string,release:RuntimeRelease):Promise<void>{
 try{
  const canonical=await realpath(projectRoot),expected=join(canonical,'.loop-control/runtime-releases',release.id);
  if(!/^[a-f0-9]{64}$/.test(release.id)||release.root!==expected||await realpath(expected)!==expected||(await lstat(expected)).isSymbolicLink())throw Error();
  const m=JSON.parse(await readFile(join(expected,manifestName),'utf8')) as RuntimeManifest;
  if(m.version!==4||m.projectRoot!==canonical||m.nodeMajor!==process.versions.node.split('.')[0]||m.release.id!==release.id||m.release.root!==expected||releaseIdentity(m)!==release.id)throw Error();
  if(JSON.stringify(m.outputs)!==JSON.stringify(await outputs(expected)))throw Error();
  if(await readFile(join(expected,'package.json'),'utf8')!==JSON.stringify({type:'module'})+'\n')throw Error();
 }catch{throw new RuntimePreparationError('runtime_release_invalid');}
}
export async function readPreparedRuntimeRelease(root:string):Promise<RuntimeRelease>{
 let manifest:RuntimeManifest;try{manifest=JSON.parse(await readFile(join(root,manifestName),'utf8'));if(manifest.version!==4)throw Error();}catch{throw new RuntimePreparationError('runtime_not_prepared');}
 await assertRuntimeRelease(root,manifest.release);return manifest.release;
}
export async function assertPreparedRuntime(root:string):Promise<void>{
 const release=await readPreparedRuntimeRelease(root),m=JSON.parse(await readFile(join(root,manifestName),'utf8')) as RuntimeManifest;
 try{if(JSON.stringify(m.sources)!==JSON.stringify(await fingerprints(root,Object.keys(m.sources)))||JSON.stringify(m.outputs)!==JSON.stringify(await outputs(root)))throw Error();}catch{throw new RuntimePreparationError('runtime_source_changed');}
 await assertRuntimeRelease(root,release);
}
export async function prepareRuntime(root:string,build:()=>Promise<void>):Promise<void>{
 try{await assertPreparedRuntime(root);return;}catch{/* Explicit preparation may rebuild. */}
 await mkdir(join(root,'dist'),{recursive:true});const lock=join(root,'dist/runtime-preparing');
 try{await mkdir(lock);}catch{throw new RuntimePreparationError('runtime_preparing');}
 let staging:string|undefined;
 try{
  const before=await sources(root);await build();
  if(JSON.stringify(before)!==JSON.stringify(await sources(root)))throw new RuntimePreparationError('runtime_source_changed');
  const base={publicationId:randomUUID(),projectRoot:await realpath(root),nodeMajor:process.versions.node.split('.')[0],sources:before,outputs:await outputs(root)},id=releaseIdentity(base),release={id,root:join(await realpath(root),'.loop-control/runtime-releases',id)};
  const manifest:RuntimeManifest={version:4,...base,release};
  try{await assertRuntimeRelease(root,release);}catch{
   // Publish only a complete new directory. Never replace an existing version:
   // a running process can still own it, including when it is damaged.
   try{await lstat(release.root);throw new RuntimePreparationError('runtime_release_invalid');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   staging=release.root+'.preparing';await mkdir(join(staging,'dist'),{recursive:true,mode:0o700});
   for(const name of ['worker','local-app'])await cp(join(root,'dist',name),join(staging,'dist',name),{recursive:true});
   if(base.outputs['scripts/runtime/codex.mjs']){await mkdir(join(staging,'scripts/runtime'),{recursive:true});await cp(join(root,'scripts/runtime/codex.mjs'),join(staging,'scripts/runtime/codex.mjs'));}
   await writeFile(join(staging,'package.json'),JSON.stringify({type:'module'})+'\n');
   await writeFile(join(staging,manifestName),JSON.stringify(manifest)+'\n');
   if(JSON.stringify(base.outputs)!==JSON.stringify(await outputs(staging)))throw new RuntimePreparationError('runtime_source_changed');
   await rename(staging,release.root);staging=undefined;
  }
  await assertRuntimeRelease(root,release);
  await writeFile(join(root,manifestName+'.next'),JSON.stringify(manifest)+'\n');await rename(join(root,manifestName+'.next'),join(root,manifestName));
 }finally{if(staging)await rm(staging,{recursive:true,force:true});await rm(lock,{recursive:true});}
}
