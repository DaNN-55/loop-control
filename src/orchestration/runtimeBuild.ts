import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Fingerprints = Record<string, string>;
const manifestName = "dist/runtime-manifest.json";
const requiredOutputs = ["dist/worker/worker/codexWorkerCli.js", "dist/orchestration/orchestration/loopOrchestratorCli.js"];

async function files(root: string, directory: string): Promise<string[]> {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(root, `${directory}/${entry.name}`) : [`${directory}/${entry.name}`]))).flat();
}

async function fingerprints(root: string, paths: string[]): Promise<Fingerprints> {
  return Object.fromEntries(await Promise.all(paths.sort().map(async path => [path, createHash("sha256").update(await readFile(join(root, path))).digest("hex")])));
}

async function sources(root: string) {
  const code = (await files(root, "src")).filter(path => /\.(ts|tsx|json)$/.test(path) && !/\.(test|integration\.test)\./.test(path));
  return fingerprints(root, [...code, "package.json", "package-lock.json", "tsconfig.worker.json", "tsconfig.orchestrator.json"]);
}

async function outputs(root: string) {
  const paths = [...await files(root, "dist/worker"), ...await files(root, "dist/orchestration")];
  if (requiredOutputs.some(path => !paths.includes(path))) throw Error("Missing runtime entrypoint");
  return fingerprints(root, paths);
}

export async function assertPreparedRuntime(root: string): Promise<void> {
  try {
    const manifest = JSON.parse(await readFile(join(root, manifestName), "utf8"));
    if (manifest.version !== 1 || manifest.projectRoot !== await realpath(root) || manifest.nodeMajor !== process.versions.node.split(".")[0]
      || JSON.stringify(manifest.sources) !== JSON.stringify(await sources(root))
      || JSON.stringify(manifest.outputs) !== JSON.stringify(await outputs(root))) throw Error("Stale runtime");
  } catch {
    throw Error("Worker/编排程序未准备、已过期或产物损坏；请先运行 npm run runtime:prepare 并重启服务。");
  }
}

export async function prepareRuntime(root: string, build: () => Promise<void>): Promise<void> {
  try { await assertPreparedRuntime(root); return; } catch { /* Explicit preparation may rebuild. */ }
  await mkdir(join(root, "dist"), { recursive: true });
  const lock = join(root, "dist/runtime-preparing");
  try { await mkdir(lock); } catch { throw Error("运行程序正在准备或上次准备中断；请检查 dist/runtime-preparing 后重新运行 runtime:prepare。"); }
  try {
    await rm(join(root, manifestName), { force: true });
    const before = await sources(root);
    await build();
    if (JSON.stringify(before) !== JSON.stringify(await sources(root))) throw Error("准备期间源码变化；请重新运行 runtime:prepare。");
    const manifest = { version: 1, projectRoot: await realpath(root), nodeMajor: process.versions.node.split(".")[0], sources: before, outputs: await outputs(root) };
    await writeFile(join(root, `${manifestName}.next`), JSON.stringify(manifest) + "\n");
    await rename(join(root, `${manifestName}.next`), join(root, manifestName));
  } finally { await rm(lock, { recursive: true }); }
}
