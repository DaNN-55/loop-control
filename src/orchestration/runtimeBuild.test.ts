// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { assertPreparedRuntime, prepareRuntime } from "./runtimeBuild";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it("准备后可执行，源码变化或产物损坏必须重新准备", async () => {
  const root = await mkdtemp(join(tmpdir(), "loop-runtime-")); roots.push(root);
  for (const dir of ["src/worker", "dist/worker/local-app", "dist/local-app/local-app"]) await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, "src/worker/task.ts"), "export const task = 1;");
  for (const name of ["package.json", "package-lock.json"]) await writeFile(join(root, name), "{}");
  for (const name of ["tsconfig.worker.json", "tsconfig.local-app.json"]) await writeFile(join(root,name),JSON.stringify({include:["src/worker/task.ts"]}));
  let builds = 0;
  const build = async () => {
    builds++;
    await writeFile(join(root, "dist/worker/local-app/localWorkerCli.js"), "console.log('worker');");
    await writeFile(join(root, "dist/local-app/local-app/localRoute.js"), "console.log('dispatch');");
  };
  await expect(assertPreparedRuntime(root)).rejects.toThrow(/runtime:prepare/);
  await prepareRuntime(root, build);
  await expect(assertPreparedRuntime(root)).resolves.toBeUndefined();
  await prepareRuntime(root, build);
  expect(builds).toBe(1);
  await writeFile(join(root, "src/worker/task.ts"), "export const task = 2;");
  await expect(assertPreparedRuntime(root)).rejects.toThrow(/runtime:prepare/);
  await prepareRuntime(root, build);
  expect(builds).toBe(2);
  await writeFile(join(root, "dist/worker/local-app/localWorkerCli.js"), "old or corrupt");
  await expect(assertPreparedRuntime(root)).rejects.toThrow(/runtime:prepare/);
  await expect(prepareRuntime(root, async () => { throw Error("compiler failed"); })).rejects.toThrow("compiler failed");
  await expect(assertPreparedRuntime(root)).rejects.toThrow(/runtime:prepare/);
},15000);

it("前端独立改动不使 Worker 过期，Worker 引用的共享依赖变化仍需重建", async () => {
  const root = await mkdtemp(join(tmpdir(), "loop-runtime-scope-")); roots.push(root);
  for (const dir of ["src/worker", "src/ui", "src/lib", "dist/worker/local-app", "dist/local-app/local-app"]) await mkdir(join(root, dir), {recursive:true});
  await writeFile(join(root,"src/worker/task.ts"),"import {value} from '../lib/shared'; export const task = value;");
  await writeFile(join(root,"src/lib/shared.ts"),"export const value = 1;");
  await writeFile(join(root,"src/ui/App.tsx"),"export const App = 'old UI';");
  for(const name of ["package.json","package-lock.json"]) await writeFile(join(root,name),"{}");
  for(const name of ["tsconfig.worker.json","tsconfig.local-app.json"]) await writeFile(join(root,name),JSON.stringify({include:["src/worker/task.ts"]}));
  const build=async()=>{await writeFile(join(root,"dist/worker/local-app/localWorkerCli.js"),"worker");await writeFile(join(root,"dist/local-app/local-app/localRoute.js"),"orchestrator");};
  await prepareRuntime(root,build);
  await writeFile(join(root,"src/ui/App.tsx"),"export const App = 'updated UI';");
  await expect(assertPreparedRuntime(root)).resolves.toBeUndefined();
  await writeFile(join(root,"src/lib/shared.ts"),"export const value = 2;");
  await expect(assertPreparedRuntime(root)).rejects.toThrow(/runtime:prepare/);
});
