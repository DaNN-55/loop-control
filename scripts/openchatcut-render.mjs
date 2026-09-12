import { existsSync, readFileSync, statSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

async function main() {
if (process.argv[2] === "--version") {
  const runtime = assertOpenChatCutRuntime({ root: process.env.OPENCHATCUT_ROOT, nodeVersion: process.version });
  console.log(`openchatcut@${runtime.version}`);
  return;
}

const specPath = process.argv[2];
if (!specPath) throw new Error("OpenChatCut render requires a JSON spec path.");

const spec = JSON.parse(await readFile(resolve(specPath), "utf8"));
const root = resolve(requiredString(spec.openchatcutRoot, "openchatcutRoot"));
const assetRoot = resolve(requiredString(spec.assetRoot, "assetRoot"));
const outputPath = resolve(requiredString(spec.outputPath, "outputPath"));
const nodePath = resolve(spec.nodePath || process.execPath);
const state = structuredClone(spec.state);
const sources = Array.isArray(spec.sources) ? spec.sources : [];

if (!isAbsolute(root) || !isAbsolute(assetRoot) || !isAbsolute(outputPath)) throw new Error("OpenChatCut paths must be absolute.");
if (!state || typeof state !== "object" || !Array.isArray(state.items)) throw new Error("OpenChatCut render state is invalid.");
assertOpenChatCutRuntime({ root, nodeVersion: process.version });

const dataDir = await mkdtemp(join(tmpdir(), "tk-openchatcut-"));
const uploadDir = join(dataDir, "media", "uploads");
await import("node:fs/promises").then(({ mkdir }) => mkdir(uploadDir, { recursive: true }));

const copied = new Map();
const logs = [];
try {
  for (const source of sources) {
    const relativePath = requiredString(source.relativePath, "source.relativePath");
    const sourcePath = resolve(assetRoot, relativePath);
    if (!isDescendant(assetRoot, sourcePath)) throw new Error(`Media source escapes the asset root: ${relativePath}`);
    const targetName = requiredSafeName(source.targetName || `${randomUUID()}${extname(relativePath)}`);
    const targetPath = join(uploadDir, targetName);
    await copyFile(sourcePath, targetPath);
    copied.set(relativePath, `/media/uploads/${targetName}`);
  }
  rewriteSources(state, copied);
  const port = await availablePort();
  const child = spawn(nodePath, openChatCutViteArguments(root, port), {
    cwd: root,
    env: openChatCutRenderEnvironment(process.env, dataDir, randomUUID()),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));
  try {
    await waitForServer(`http://127.0.0.1:${port}`, child, logs);
    const response = await fetch(`http://127.0.0.1:${port}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port}`, "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ state, format: "video", codec: "h264", name: "loop-control" }),
    });
    if (!response.ok) throw new Error(`OpenChatCut export failed (${response.status}): ${await response.text()}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error("OpenChatCut returned an empty video.");
    await writeFile(outputPath, bytes);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "close");
    }
  }
} catch (error) {
  const details = logs?.join("").trim();
  throw new Error(`${error instanceof Error ? error.message : String(error)}${details ? `\n${details.slice(-2000)}` : ""}`);
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
}

export function openChatCutViteArguments(root, port) {
  return [join(root, "node_modules/vite/bin/vite.js"), root, "--config", join(root, "config/vite.config.ts"), "--host", "127.0.0.1", `--port=${port}`];
}

export function openChatCutRenderEnvironment(environment, dataDir, profileId) {
  return {
    ...environment,
    BROWSER: "none",
    OPENCHATCUT_DATA_DIR: dataDir,
    OPENCHATCUT_DEV_PROFILE_ID: profileId,
    OPENCHATCUT_DISABLE_HARDWARE_ENCODING: environment.OPENCHATCUT_DISABLE_HARDWARE_ENCODING || "1",
  };
}

function rewriteSources(value, map) {
  if (Array.isArray(value)) {
    for (const item of value) rewriteSources(item, map);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "src" && typeof item === "string" && map.has(item)) value[key] = map.get(item);
    else rewriteSources(item, map);
  }
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`OpenChatCut ${name} is required.`);
  return value.trim();
}

export function assertOpenChatCutRuntime({ root, nodeVersion, exists = existsSync, stat = statSync, readPackage = readFileSync, run = spawnSync }) {
  const problems = [];
  const actualNodeVersion = String(nodeVersion || "");
  if (Number(actualNodeVersion.replace(/^v/, "").split(".")[0]) !== 24) problems.push(`OPENCHATCUT_NODE 必须指向 Node 24；当前为 ${actualNodeVersion || "未知版本"}。`);

  const configuredRoot = typeof root === "string" ? root.trim() : "";
  if (!configuredRoot) {
    problems.push("缺少 OPENCHATCUT_ROOT。");
  } else if (!exists(configuredRoot)) {
    problems.push(`OPENCHATCUT_ROOT 不存在：${configuredRoot}。`);
  } else {
    try {
      if (!stat(configuredRoot).isDirectory()) problems.push(`OPENCHATCUT_ROOT 不是目录：${configuredRoot}。`);
    } catch {
      problems.push(`无法读取 OPENCHATCUT_ROOT：${configuredRoot}。`);
    }
  }

  let manifest;
  let rootIsDirectory = false;
  if (configuredRoot && exists(configuredRoot)) {
    try { rootIsDirectory = stat(configuredRoot).isDirectory(); } catch { /* reported above */ }
  }
  if (configuredRoot && rootIsDirectory) {
    const packagePath = join(configuredRoot, "package.json");
    if (!exists(packagePath)) {
      problems.push(`OpenChatCut 工程缺少 package.json：${packagePath}。`);
    } else {
      try {
        manifest = JSON.parse(readPackage(packagePath, "utf8"));
        if (manifest?.name !== "openchatcut") problems.push(`OpenChatCut package.json 的 name 必须为 openchatcut；当前为 ${JSON.stringify(manifest?.name)}。`);
        if (typeof manifest?.version !== "string" || !manifest.version.trim()) problems.push("OpenChatCut package.json 缺少有效 version。");
        if (typeof manifest?.scripts?.["dev:shared"] !== "string" || !manifest.scripts["dev:shared"].trim()) problems.push("OpenChatCut package.json 缺少 scripts.dev:shared 渲染命令。");
      } catch {
        problems.push(`OpenChatCut package.json 无法解析：${packagePath}。`);
      }
    }

    const requiredPaths = [
      ["渲染 HTML 入口 index.html", join(configuredRoot, "index.html")],
      ["渲染应用入口 src/main.tsx", join(configuredRoot, "src", "main.tsx")],
      ["项目迁移入口 src/persist/projectStore.ts", join(configuredRoot, "src", "persist", "projectStore.ts")],
      ["时间线读取入口 src/editor/types.ts", join(configuredRoot, "src", "editor", "types.ts")],
      ["字幕解析器 src/captions/resolve.ts", join(configuredRoot, "src", "captions", "resolve.ts")],
      ["字幕编辑器 src/captions/manualCaptions.ts", join(configuredRoot, "src", "captions", "manualCaptions.ts")],
      ["Vite 配置 config/vite.config.ts", join(configuredRoot, "config", "vite.config.ts")],
      ["已安装的 Vite 可执行文件 node_modules/vite/bin/vite.js", join(configuredRoot, "node_modules", "vite", "bin", "vite.js")],
      ["已安装的 tsx loader node_modules/tsx/dist/loader.mjs", join(configuredRoot, "node_modules", "tsx", "dist", "loader.mjs")],
      ["已安装的 @vitejs/plugin-react 依赖", join(configuredRoot, "node_modules", "@vitejs", "plugin-react", "package.json")],
      ["已安装的 dotenv 依赖", join(configuredRoot, "node_modules", "dotenv", "package.json")],
    ];
    for (const [description, path] of requiredPaths) if (!exists(path)) problems.push(`OpenChatCut 缺少${description}：${path}。`);

    const vitePath = join(configuredRoot, "node_modules", "vite", "bin", "vite.js");
    if (exists(vitePath)) {
      const vite = run(process.execPath, [vitePath, "--version"], { cwd: configuredRoot, encoding: "utf8" });
      const output = [vite.stdout, vite.stderr].filter(Boolean).join("\n").trim();
      if (vite.error || vite.status !== 0) problems.push(`OpenChatCut Vite 依赖无法执行：${vite.error?.message || output || `退出码为 ${vite.status}`}。`);
      else if (!/^vite\//m.test(output)) problems.push("OpenChatCut Vite 依赖未返回有效版本。请重新安装该工程依赖。");
    }
  }

  if (problems.length) throw new Error(`OpenChatCut 不可用：\n- ${problems.join("\n- ")}`);
  return { root: configuredRoot, version: manifest.version };
}

function requiredSafeName(value) {
  if (!value || value.startsWith(".") || value.includes("/") || value.includes("\\")) throw new Error("OpenChatCut media filename is unsafe.");
  return value;
}

function isDescendant(rootPath, candidate) {
  const rel = relative(rootPath, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  if (!address || typeof address === "string") throw new Error("Could not allocate an OpenChatCut port.");
  return address.port;
}

async function waitForServer(base, child, logs) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`OpenChatCut server exited with ${child.exitCode}.`);
    try {
      const response = await fetch(`${base}/`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`OpenChatCut server did not start.${logs.length ? ` ${logs.join("").slice(-1000)}` : ""}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
