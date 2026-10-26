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
  for (const dir of ["src/worker", "dist/worker/worker", "dist/orchestration/orchestration"]) await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, "src/worker/task.ts"), "export const task = 1;");
  for (const name of ["package.json", "package-lock.json", "tsconfig.worker.json", "tsconfig.orchestrator.json"]) await writeFile(join(root, name), "{}");
  let builds = 0;
  const build = async () => {
    builds++;
    await writeFile(join(root, "dist/worker/worker/codexWorkerCli.js"), "console.log('worker');");
    await writeFile(join(root, "dist/orchestration/orchestration/loopOrchestratorCli.js"), "console.log('dispatch');");
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
  await writeFile(join(root, "dist/worker/worker/codexWorkerCli.js"), "old or corrupt");
  await expect(assertPreparedRuntime(root)).rejects.toThrow(/runtime:prepare/);
  await expect(prepareRuntime(root, async () => { throw Error("compiler failed"); })).rejects.toThrow("compiler failed");
  await expect(assertPreparedRuntime(root)).rejects.toThrow(/runtime:prepare/);
});
