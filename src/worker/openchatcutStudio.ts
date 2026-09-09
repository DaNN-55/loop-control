import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createTcpServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { WorkerTaskPackage } from "./contracts.js";
import { activeOpenChatCutState, buildOpenChatCutProject, type OpenChatCutProject } from "./openchatcutProject.js";

type ReviewRender = NonNullable<WorkerTaskPackage["reviewRender"]>;
type Composition = Record<string, unknown>;

export interface OpenChatCutStudioSnapshot {
  relativePath: string;
  sha256: string;
  fileSize: number;
  composition?: Composition;
  projectId: string;
}

interface Session {
  episodeId: string;
  projectId: string;
  baseUrl: string;
  dataDir: string;
  workspace: OpenChatCutStudioSnapshot;
  reverseSources: Map<string, string>;
  child: ChildProcess;
}

interface OpenChatCutRuntimeConfig {
  nodePath?: string;
  root?: string;
}

const sessions = new Map<string, Session>();

export async function openOpenChatCutStudio(assetRoot: string, episodeId: string, render: ReviewRender, runtimeConfig: OpenChatCutRuntimeConfig = {}): Promise<{ studioUrl: string; workspace: OpenChatCutStudioSnapshot }> {
  const existing = sessions.get(episodeId);
  if (existing) return { studioUrl: `${existing.baseUrl}/#/editor/${existing.projectId}`, workspace: existing.workspace };
  const root = resolve(assetRoot);
  const projectId = `loop-control-${episodeId}`;
  const project = buildOpenChatCutProject(render, projectId);
  const dataDir = await mkdtemp(join(tmpdir(), "loop-control-openchatcut-studio-"));
  const uploadDir = join(dataDir, "media", "uploads");
  await mkdir(uploadDir, { recursive: true });
  const reverseSources = new Map<string, string>();
  const sourcePaths = [...new Set(render.members.map((member) => member.relativePath))];
  const copiedProject = structuredClone(project);
  for (const sourceRelativePath of sourcePaths) {
    const source = resolve(root, sourceRelativePath);
    if (!isDescendant(root, source)) throw new Error("OpenChatCut 素材路径超出生产单资产根。");
    const targetName = `${createHash("sha256").update(sourceRelativePath).digest("hex").slice(0, 20)}${extname(sourceRelativePath).toLowerCase()}`;
    await copyFile(source, join(uploadDir, targetName));
    reverseSources.set(`/media/uploads/${targetName}`, sourceRelativePath);
  }
  rewriteSources(copiedProject, new Map([...reverseSources].map(([remote, original]) => [original, remote])));
  const legacyStore = { version: 1, entries: { projects: [{ id: projectId, name: `生产单 ${episodeId}`, updatedAt: Date.now() }], [`project:${projectId}`]: copiedProject } };
  await writeFile(join(dataDir, "project-store-v1.json"), JSON.stringify(legacyStore, null, 2) + "\n");
  const nodePath = runtimeConfig.nodePath?.trim() || process.env.OPENCHATCUT_NODE || process.execPath;
  if (Number(nodeVersion(nodePath)) !== 24) throw new Error("OpenChatCut 需要 Node 24，请配置 OPENCHATCUT_NODE。");
  const openchatcutRoot = runtimeConfig.root?.trim() || process.env.OPENCHATCUT_ROOT?.trim();
  if (!openchatcutRoot) throw new Error("未配置 OPENCHATCUT_ROOT，无法打开 OpenChatCut 编辑器。");
  const port = await availablePort();
  const child = spawn(nodePath, [join(openchatcutRoot, "node_modules/vite/bin/vite.js"), openchatcutRoot, "--config", join(openchatcutRoot, "config/vite.config.ts"), "--host", "127.0.0.1", `--port=${port}`], {
    cwd: openchatcutRoot,
    env: { ...process.env, OPENCHATCUT_ROOT: openchatcutRoot, OPENCHATCUT_DATA_DIR: dataDir, OPENCHATCUT_DEV_PROFILE_ID: randomUUID(), OPENCHATCUT_DISABLE_HARDWARE_ENCODING: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));
  try {
    await waitForServer(`http://127.0.0.1:${port}`, child, logs);
    const relativePath = `episodes/${episodeId}/openchatcut-work/${randomUUID()}/project.json`;
    const workspacePath = resolve(root, relativePath);
    await mkdir(dirname(workspacePath), { recursive: true });
    const workspaceContent = Buffer.from(JSON.stringify(project, null, 2) + "\n");
    await writeFile(workspacePath, workspaceContent);
    const workspace = { relativePath, sha256: createHash("sha256").update(workspaceContent).digest("hex"), fileSize: workspaceContent.byteLength, composition: render.adjustments as unknown as Composition, projectId };
    const session = { episodeId, projectId, baseUrl: `http://127.0.0.1:${port}`, dataDir, workspace, reverseSources, child } satisfies Session;
    sessions.set(episodeId, session);
    child.once("close", () => { sessions.delete(episodeId); void rm(dataDir, { recursive: true, force: true }); });
    return { studioUrl: `${session.baseUrl}/#/editor/${projectId}`, workspace };
  } catch (error) {
    child.kill("SIGTERM");
    await rm(dataDir, { recursive: true, force: true });
    throw new Error(`${error instanceof Error ? error.message : String(error)}${logs.length ? `\n${logs.join("").slice(-1000)}` : ""}`);
  }
}

export async function freezeOpenChatCutStudio(assetRoot: string, episodeId: string, expectedWorkspaceRelativePath: string): Promise<OpenChatCutStudioSnapshot> {
  const session = sessions.get(episodeId);
  if (!session) throw new Error("OpenChatCut 编辑器会话已失效，请重新打开生产单预览。");
  if (session.workspace.relativePath !== expectedWorkspaceRelativePath) throw new Error("OpenChatCut 工作版本与当前编辑器会话不一致，请重新打开后再生成。");
  const response = await fetch(`${session.baseUrl}/api/project-store/entry?key=${encodeURIComponent(`project:${session.projectId}`)}`, { headers: { "Sec-Fetch-Site": "none" } });
  if (!response.ok) throw new Error(`无法读取 OpenChatCut 项目（HTTP ${response.status}）。`);
  const payload = await response.json() as { found?: boolean; value?: unknown };
  if (!payload.found || !payload.value || typeof payload.value !== "object" || Array.isArray(payload.value)) throw new Error("OpenChatCut 项目内容无效。");
  const project = structuredClone(payload.value) as OpenChatCutProject;
  rewriteSources(project, session.reverseSources);
  const relativePath = `episodes/${episodeId}/openchatcut-frozen/${randomUUID()}/project.json`;
  const path = resolve(assetRoot, relativePath);
  if (!isDescendant(resolve(assetRoot), path)) throw new Error("OpenChatCut 冻结工程路径无效。");
  await mkdir(dirname(path), { recursive: true });
  const content = Buffer.from(JSON.stringify(project, null, 2) + "\n");
  await writeFile(path, content);
  return { relativePath, sha256: createHash("sha256").update(content).digest("hex"), fileSize: content.byteLength, composition: session.workspace.composition, projectId: session.projectId };
}

export function openChatCutStateFromProject(project: OpenChatCutProject): Record<string, unknown> {
  return activeOpenChatCutState(project);
}

function rewriteSources(value: unknown, map: Map<string, string>): void {
  if (Array.isArray(value)) { value.forEach((item) => rewriteSources(item, map)); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "src" && typeof item === "string" && map.has(item)) (value as Record<string, unknown>)[key] = map.get(item);
    else rewriteSources(item, map);
  }
}

function isDescendant(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

function nodeVersion(nodePath: string): number {
  return nodePath === process.execPath ? Number(process.versions.node.split(".")[0]) : 24;
}

async function availablePort(): Promise<number> {
  const server = await new Promise<Server>((resolveServer, reject) => { const server = createTcpServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => resolveServer(server)); });
  const address = server.address();
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  if (!address || typeof address === "string") throw new Error("无法分配 OpenChatCut 端口。");
  return address.port;
}

async function waitForServer(base: string, child: ChildProcess, logs: string[]): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`OpenChatCut 服务退出：${child.exitCode}。`);
    try { if ((await fetch(`${base}/`, { signal: AbortSignal.timeout(1_000) })).ok) return; } catch { /* still starting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`OpenChatCut 服务启动超时。${logs.length ? logs.join("").slice(-1000) : ""}`);
}
