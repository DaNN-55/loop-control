import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { removeServiceRecordIfOwned, writeServiceRecord } from "./local-service-record.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const consoleHealthPath = "/loop-control-health.txt";
const consoleHealthMarker = "loop-control-console-v1";
const n8nBasePath = "/loop-control-n8n";
const requiredWorkflows = [
  { id: "Cy50xRCgT2cj4WT4", label: "任务派发" },
  { id: "fFvOzmKS4OAMTcjd", label: "审核提醒" },
  { id: "BxXyfBbkS49QMTEv", label: "状态变更提醒" },
  { id: "BhEqokY531BBg64d", label: "每日健康检查" },
];
const requiredWorkflowIds = requiredWorkflows.map(({ id }) => id);
const startupRuntime = "运行时：Loop Control、OpenChatCut、n8n 统一使用 Homebrew Node 24。";

export function startupEnvironment(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
    const match = /^(MEDIA_LIBRARY_MOUNT_PATH|N8N_PORT|OPENCHATCUT_ROOT|OPENCHATCUT_NODE)=(.*)$/.exec(line.trim());
    return match ? [[match[1], match[2].trim().replace(/^(['"])(.*)\1$/, "$2")]] : [];
  }));
}

export function localStartupReport({ consoleUrl = consoleUrlForPort("5173"), mediaLibraryMounted, mediaLibraryPath, n8nUrl, openChatCutAvailable }) {
  return ["Loop Control 已启动", startupRuntime, `控制台：${consoleUrl}`, `n8n：${n8nUrl}`, ...requiredWorkflows.map(({ label }) => `  ${label}工作流已启用`), "Supabase：API 可达，前端公开配置有效；数据权限在登录后由会话/RLS 验证", `OpenChatCut：${openChatCutAvailable ? "可用" : "不可用"}`, `媒体库：${mediaLibraryMounted ? `已挂载（${mediaLibraryPath}）` : "不可用"}`];
}

export function consoleUrlForPort(port) { return `http://127.0.0.1:${port}/`; }
export function n8nUrlForPort(port) { return `http://127.0.0.1:${port}${n8nBasePath}/`; }
export function consoleHealthUrl(port) { return `${consoleUrlForPort(port).replace(/\/$/, "")}${consoleHealthPath}`; }
export function n8nHealthUrl(port) { return `${n8nUrlForPort(port)}healthz`; }

export async function resolveLocalServicePort({ preferredPort, projectHealthy, portAvailable = canListen, findAvailablePort = findOpenPort }) {
  if (await projectHealthy(preferredPort)) return { port: String(preferredPort), reused: true };
  if (await portAvailable(preferredPort)) return { port: String(preferredPort), reused: false };
  return { port: String(await findAvailablePort(Number(preferredPort) + 1)), reused: false };
}

export function assertPublicEnvironment(source) {
  if (/^(?:SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_(?:SERVICE_ROLE_KEY|SECRET_KEY))=/m.test(source)) throw new Error(".env.local 只能保存 VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY；Worker 密钥请放在 n8n/worker.env.local。");
  for (const name of ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]) if (!new RegExp(`^${name}=.+$`, "m").test(source)) throw new Error(`.env.local 缺少 ${name}。`);
}

export async function assertSupabaseConnection(source, request = fetch) {
  assertPublicEnvironment(source);
  const url = requiredEnvironmentValue(source, "VITE_SUPABASE_URL");
  const key = requiredEnvironmentValue(source, "VITE_SUPABASE_PUBLISHABLE_KEY");
  try { new URL(url); } catch { throw new Error("VITE_SUPABASE_URL 必须是有效 URL。") }
  let response;
  try {
    response = await request(`${url.replace(/\/$/, "")}/auth/v1/settings`, { headers: { apikey: key }, signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new Error("Supabase API 不可达。请检查网络、VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY。");
  }
  if (!response.ok) throw new Error(`Supabase 公开配置验证失败（HTTP ${response.status}）。请检查 VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY。`);
}

async function main() {
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error(`Loop Control 需要 Node 24，当前为 ${process.version}。`);
  const publicEnvironmentPath = join(projectRoot, ".env.local");
  if (!existsSync(publicEnvironmentPath)) throw new Error("缺少 .env.local。");
  const publicEnvironment = readFileSync(publicEnvironmentPath, "utf8");
  await assertSupabaseConnection(publicEnvironment);
  const workerEnvironmentPath = join(projectRoot, "n8n", "worker.env.local");
  if (existsSync(workerEnvironmentPath)) Object.assign(process.env, startupEnvironment(readFileSync(workerEnvironmentPath, "utf8")));

  const requestedConsolePort = process.env.VITE_PORT || "5173";
  const requestedN8nPort = process.env.N8N_PORT || "5678";
  const consolePort = await resolveLocalServicePort({ preferredPort: requestedConsolePort, projectHealthy: (port) => responseContains(consoleHealthUrl(port), consoleHealthMarker) });
  const n8nPort = await resolveLocalServicePort({ preferredPort: requestedN8nPort, projectHealthy: (port) => httpAvailable(n8nHealthUrl(port)) });
  const consoleUrl = consoleUrlForPort(consolePort.port);
  const n8nUrl = n8nUrlForPort(n8nPort.port);
  const openChatCutAvailable = assertOpenChatCutAvailable(process.env.OPENCHATCUT_NODE);
  assertActiveWorkflows();

  const children = [];
  try {
    const n8n = n8nPort.reused ? null : startService(join(projectRoot, "n8n", "start-local.sh"), [], "n8n", { env: { ...process.env, N8N_PORT: n8nPort.port }, port: n8nPort.port, commandIdentity: "n8n/bin/n8n" });
    const consoleService = !(await httpAvailable(consoleUrl)) ? startService(process.execPath, [join(projectRoot, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", new URL(consoleUrl).port, "--strictPort"], "控制台", { port: consolePort.port, commandIdentity: join("node_modules", "vite", "bin", "vite.js") }) : null;
    if (n8n) children.push(n8n);
    if (consoleService) children.push(consoleService);
    if (children.length) writeServiceRecord(children.map(({ child, commandIdentity, name, port }) => ({ name, pid: child.pid, port, commandIdentity })));
    await Promise.all([waitForHttp(consoleHealthUrl(consolePort.port), "控制台", consoleService, (url) => responseContains(url, consoleHealthMarker)), waitForHttp(n8nHealthUrl(n8nPort.port), "n8n", n8n)]);

    const mediaLibraryPath = process.env.MEDIA_LIBRARY_MOUNT_PATH?.trim() || "";
    console.log("\n" + localStartupReport({ consoleUrl, mediaLibraryMounted: mediaLibraryAvailable(mediaLibraryPath), mediaLibraryPath, n8nUrl, openChatCutAvailable }).join("\n") + "\n");
    spawn("open", [consoleUrl], { detached: true, stdio: "ignore" }).unref();
    const stop = () => children.forEach(({ child }) => child.kill("SIGTERM"));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    if (children.length) await Promise.race(children.map(({ child }) => new Promise((resolve) => child.once("exit", resolve))));
  } finally {
    children.forEach(({ child }) => child.kill("SIGTERM"));
    removeServiceRecordIfOwned(children.map(({ child }) => child.pid));
  }
}

export function assertOpenChatCutAvailable(nodePath, run = spawnSync) {
  const configuredNode = typeof nodePath === "string" ? nodePath.trim() : "";
  if (!configuredNode) throw new Error("OpenChatCut 不可用：缺少 OPENCHATCUT_NODE（必须指向 Node 24）。");
  if (!existsSync(configuredNode)) throw new Error(`OpenChatCut 不可用：OPENCHATCUT_NODE 不存在：${configuredNode}。`);
  const result = run(configuredNode, [join(projectRoot, "scripts", "openchatcut-render.mjs"), "--version"], { cwd: projectRoot, encoding: "utf8" });
  if (result.error) throw new Error(`OpenChatCut 不可用：无法执行 OPENCHATCUT_NODE（${configuredNode}）：${result.error.message}`);
  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`OpenChatCut 不可用：${details || `OPENCHATCUT_NODE 退出码为 ${result.status}。`}`);
  }
  return true;
}
function mediaLibraryAvailable(path) { try { if (!path || !statSync(path).isDirectory()) return false; accessSync(path, constants.R_OK | constants.W_OK); return true; } catch { return false; } }
function requiredEnvironmentValue(source, name) { return new RegExp(`^${name}=(.+)$`, "m").exec(source)?.[1].trim().replace(/^(['"])(.*)\1$/, "$2") || ""; }

function startService(command, args, name, { env = process.env, port, commandIdentity = command } = {}) {
  const logs = [];
  const child = spawn(command, args, { cwd: projectRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  let startupError;
  child.once("error", (error) => { startupError = error; });
  return { child, commandIdentity, logs, name, port, startupError: () => startupError };
}

export function missingRequiredWorkflowIds(activeWorkflowIds) {
  const active = new Set(activeWorkflowIds.trim().split(/\s+/).filter(Boolean));
  return requiredWorkflowIds.filter((workflowId) => !active.has(workflowId));
}

function assertActiveWorkflows() {
  const database = join(projectRoot, "n8n", "runtime", ".n8n", "database.sqlite");
  const ids = requiredWorkflowIds.map((workflowId) => `'${workflowId}'`).join(", ");
  const result = spawnSync("sqlite3", [database, `select id from workflow_entity where active = 1 and id in (${ids});`], { encoding: "utf8" });
  const missing = result.status === 0 ? missingRequiredWorkflowIds(result.stdout) : requiredWorkflowIds;
  if (missing.length) throw new Error(`n8n 必需工作流尚未在本机实例启用：${missing.join(", ")}。请运行 n8n/import-workflows.sh。`);
}

async function httpAvailable(url) { try { return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } }
async function responseContains(url, expected) { try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); return response.ok && (await response.text()).trim() === expected; } catch { return false; } }
async function canListen(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port: Number(port), exclusive: true }, () => server.close(() => resolve(true)));
  });
}
async function findOpenPort(startPort) {
  for (let port = startPort; port <= 65535; port += 1) if (await canListen(port)) return port;
  throw new Error("未找到可用本机端口。");
}
async function waitForHttp(url, name, service, available = httpAvailable) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await available(url)) return;
    if (service && (service.child.exitCode !== null || service.startupError())) throw new Error(`${name} 启动失败。${service.logs.join("").trim().slice(-1000) || service.startupError()?.message || "请检查该服务的本机安装和端口占用。"}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${name} 未能在 15 秒内启动。请检查端口占用和服务日志。`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
