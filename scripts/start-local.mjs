import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function localStartupReport({ hyperframesAvailable, mediaLibraryMounted, mediaLibraryPath, n8nRunning }) {
  return [
    `HyperFrames：${hyperframesAvailable ? "正常" : "不可用"}`,
    `媒体根：${mediaLibraryMounted ? `正常（${mediaLibraryPath}）` : mediaLibraryPath ? `不可用（${mediaLibraryPath}）` : "未配置"}`,
    `n8n：${n8nRunning ? "已启动（本命令不会改动它）" : "未启动（本命令不会自动启动）"}`,
  ];
}

function commandAvailable(command, argumentsList) {
  return spawnSync(command, argumentsList, { stdio: "ignore" }).status === 0;
}

export function startupEnvironment(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
    const match = /^(MEDIA_LIBRARY_MOUNT_PATH|N8N_PORT)=(.*)$/.exec(line.trim());
    if (!match) return [];
    const [, name, rawValue] = match;
    const value = rawValue.trim().replace(/^(['"])(.*)\1$/, "$2");
    return value ? [[name, value]] : [];
  }));
}

function mediaLibraryAvailable(path) {
  try {
    if (!path || !existsSync(path) || !statSync(path).isDirectory()) return false;
    accessSync(path, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function n8nRunning(port) {
  if (!/^\d+$/.test(port)) return false;
  return spawnSync("curl", ["--fail", "--silent", "--max-time", "1", "--output", "/dev/null", `http://127.0.0.1:${port}/healthz`], { stdio: "ignore" }).status === 0;
}

function main() {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const workerEnvironmentPath = join(scriptDirectory, "..", "n8n", "worker.env.local");
  if (existsSync(workerEnvironmentPath)) Object.assign(process.env, startupEnvironment(readFileSync(workerEnvironmentPath, "utf8")));
  const mediaLibraryPath = process.env.MEDIA_LIBRARY_MOUNT_PATH?.trim() ?? "";
  const report = localStartupReport({
    hyperframesAvailable: commandAvailable("./node_modules/.bin/hyperframes", ["--version"]),
    mediaLibraryMounted: mediaLibraryAvailable(mediaLibraryPath),
    mediaLibraryPath,
    n8nRunning: n8nRunning(process.env.N8N_PORT?.trim() || "5678"),
  });
  console.log(report.join("\n"));
  if (process.argv.includes("--check")) return;
  spawn("npm", ["run", "dev:local"], { stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 1));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
