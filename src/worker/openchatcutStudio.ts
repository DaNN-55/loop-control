import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createTcpServer, type Server } from "node:net";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { WorkerTaskPackage } from "./contracts.js";
import { activeOpenChatCutState, buildOpenChatCutProject, type OpenChatCutProject } from "./openchatcutProject.js";
import { verifyOpenChatCutProject } from "./openchatcutProjectReader.js";

type ReviewRender = NonNullable<WorkerTaskPackage["reviewRender"]>;
type Composition = Record<string, unknown>;

export interface OpenChatCutStudioSnapshot {
  relativePath: string;
  sha256: string;
  fileSize: number;
  composition?: Composition;
  projectId: string;
}

export interface OpenChatCutReplacementWarning {
  code: "openchatcut_workspace_replacement";
  modifiedScopes: string[];
  studioHasChanges: boolean;
}

export interface OpenChatCutStudioOpenResult {
  studioUrl?: string;
  workspace: OpenChatCutStudioSnapshot;
  replacementWarning?: OpenChatCutReplacementWarning;
}

interface WorkspaceMetadata {
  baseProjectSha256: string;
  inputFingerprint: string;
  projectId: string;
  reverseSources: Record<string, string>;
}

interface Session {
  episodeId: string;
  projectId: string;
  baseUrl: string;
  dataDir: string;
  workspace: OpenChatCutStudioSnapshot;
  reverseSources: Map<string, string>;
  child: ChildProcess;
  render: ReviewRender;
  runtimeConfig: OpenChatCutRuntimeConfig;
  baseProject: OpenChatCutProject;
  inputFingerprint: string;
}

interface OpenChatCutRuntimeConfig {
  nodePath?: string;
  root?: string;
}

const sessions = new Map<string, Session>();

export async function closeOpenChatCutStudio(episodeId: string): Promise<void> {
  const session = sessions.get(episodeId);
  if (!session) return;
  sessions.delete(episodeId);
  if (session.child.exitCode === null) {
    const closed = new Promise<void>((resolveClose) => session.child.once("close", () => resolveClose()));
    session.child.kill("SIGTERM");
    await Promise.race([closed, new Promise<void>((resolveWait) => setTimeout(resolveWait, 2_000))]);
  }
}

export async function openOpenChatCutStudio(assetRoot: string, episodeId: string, render: ReviewRender, runtimeConfig: OpenChatCutRuntimeConfig = {}, options: { replaceWorkspace?: boolean } = {}): Promise<OpenChatCutStudioOpenResult> {
  const existing = sessions.get(episodeId);
  const root = resolve(assetRoot);
  const projectId = `loop-control-${episodeId}`;
  const project = buildOpenChatCutProject(render, projectId);
  if (render.confirmationMode === "shot_preparation") await verifyOpenChatCutProject(render, project, runtimeConfig);
  const inputFingerprint = reviewRenderInputFingerprint(render, project);
  if (existing) {
    if (existing.inputFingerprint === inputFingerprint) {
      existing.workspace = await persistCurrentWorkspace(root, existing);
      return { studioUrl: `${existing.baseUrl}/#/editor/${existing.projectId}`, workspace: existing.workspace };
    }
    const current = await currentSessionProject(existing);
    const warning = replacementWarning(existing.baseProject, current);
    existing.workspace = await persistProject(root, existing.workspace.relativePath, current, existing.workspace.composition, existing.projectId);
    if (!options.replaceWorkspace) return { workspace: existing.workspace, replacementWarning: warning };
    await closeOpenChatCutStudio(episodeId);
  }
  const workRoot = join(root, "episodes", episodeId, "openchatcut-work", "current");
  const dataDir = join(workRoot, "runtime");
  const workspaceRelativePath = `episodes/${episodeId}/openchatcut-work/current/project.json`;
  const metadataPath = join(workRoot, "workspace.json");
  const storedMetadata = await readWorkspaceMetadata(metadataPath);
  const storedProject = await readStoredProject(join(dataDir, "project-store-v1.json"), projectId);
  if (storedMetadata && storedProject && storedMetadata.inputFingerprint !== inputFingerprint && !options.replaceWorkspace) {
    const restoredProject = structuredClone(storedProject);
    rewriteSources(restoredProject, new Map(Object.entries(storedMetadata.reverseSources)));
    const workspace = await persistProject(root, workspaceRelativePath, restoredProject, render.adjustments as unknown as Composition, projectId);
    const storedBaseline = await readProject(join(workRoot, "generated-project.json"));
    return { workspace, replacementWarning: replacementWarning(storedBaseline ?? restoredProject, restoredProject) };
  }
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
  if (!storedProject || storedMetadata?.inputFingerprint !== inputFingerprint || options.replaceWorkspace) {
    const legacyStore = { version: 1, entries: { projects: [{ id: projectId, name: `生产单 ${episodeId}`, updatedAt: Date.now() }], [`project:${projectId}`]: copiedProject } };
    await writeStoredProject(dataDir, projectId, copiedProject, legacyStore);
    await writeFile(join(workRoot, "generated-project.json"), JSON.stringify(project, null, 2) + "\n");
    const metadata: WorkspaceMetadata = { baseProjectSha256: projectSha256(project), inputFingerprint, projectId, reverseSources: Object.fromEntries(reverseSources) };
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
  }
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
    const activeStoredProject = await readStoredProject(join(dataDir, "project-store-v1.json"), projectId) ?? copiedProject;
    const activeProject = structuredClone(activeStoredProject);
    rewriteSources(activeProject, reverseSources);
    const workspace = await persistProject(root, workspaceRelativePath, activeProject, render.adjustments as unknown as Composition, projectId);
    const session = { episodeId, projectId, baseUrl: `http://127.0.0.1:${port}`, dataDir, workspace, reverseSources, child, render, runtimeConfig, baseProject: project, inputFingerprint } satisfies Session;
    sessions.set(episodeId, session);
    child.once("close", () => { if (sessions.get(episodeId)?.child === child) sessions.delete(episodeId); });
    return { studioUrl: `${session.baseUrl}/#/editor/${projectId}`, workspace };
  } catch (error) {
    child.kill("SIGTERM");
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
  session.workspace = await persistProject(resolve(assetRoot), session.workspace.relativePath, project, session.workspace.composition, session.projectId);
  if (session.render.confirmationMode === "shot_preparation") await verifyOpenChatCutProject(session.render, project, session.runtimeConfig, { requireConfirmedText: false, allowStudioEdits: true });
  const relativePath = `episodes/${episodeId}/openchatcut-frozen/${randomUUID()}/project.json`;
  const path = resolve(assetRoot, relativePath);
  if (!isDescendant(resolve(assetRoot), path)) throw new Error("OpenChatCut 冻结工程路径无效。");
  await mkdir(dirname(path), { recursive: true });
  const content = Buffer.from(JSON.stringify(project, null, 2) + "\n");
  await writeFile(path, content);
  return { relativePath, sha256: createHash("sha256").update(content).digest("hex"), fileSize: content.byteLength, composition: session.workspace.composition, projectId: session.projectId };
}

export function openChatCutModifiedScopes(baseProject: OpenChatCutProject, currentProject: OpenChatCutProject): string[] {
  const base = projectSections(baseProject);
  const current = projectSections(currentProject);
  const scopes: string[] = [];
  if (JSON.stringify(base.video) !== JSON.stringify(current.video)) scopes.push("视频层与片段");
  if (JSON.stringify(base.captions) !== JSON.stringify(current.captions)) scopes.push("字幕");
  if (JSON.stringify(base.audio) !== JSON.stringify(current.audio)) scopes.push("音量与音轨");
  if (JSON.stringify(base.rhythm) !== JSON.stringify(current.rhythm)) scopes.push("转场与节奏");
  if (JSON.stringify(base.other) !== JSON.stringify(current.other)) scopes.push("其他工程设置");
  return scopes;
}

function projectSections(project: OpenChatCutProject) {
  const timeline = project.timelines[0];
  const items = timeline?.items ?? [];
  const tracks = timeline?.tracks ?? {};
  return {
    video: items.filter((item) => item.kind === "video").map(({ fadeInFrames: _fadeIn, fadeOutFrames: _fadeOut, startFrame: _start, durationInFrames: _duration, ...item }) => item),
    captions: { hidden: timeline?.captionsHidden, items: items.filter((item) => item.kind === "text"), tracks: Object.fromEntries(Object.entries(tracks).filter(([, track]) => track.kind === "caption")) },
    audio: { items: items.filter((item) => item.kind === "audio"), tracks: Object.fromEntries(Object.entries(tracks).filter(([, track]) => track.kind === "audio")) },
    rhythm: { fps: timeline?.fps, transitions: timeline?.transitions, timings: items.filter((item) => item.kind === "video").map((item) => ({ id: item.id, startFrame: item.startFrame, durationInFrames: item.durationInFrames, fadeInFrames: item.fadeInFrames, fadeOutFrames: item.fadeOutFrames })) },
    other: { activeTimelineId: project.activeTimelineId, fit: timeline?.fit, height: timeline?.height, trackOrder: timeline?.trackOrder, width: timeline?.width },
  };
}

function replacementWarning(baseProject: OpenChatCutProject, currentProject: OpenChatCutProject): OpenChatCutReplacementWarning {
  const modifiedScopes = openChatCutModifiedScopes(baseProject, currentProject);
  return { code: "openchatcut_workspace_replacement", modifiedScopes, studioHasChanges: modifiedScopes.length > 0 };
}

function reviewRenderInputFingerprint(render: ReviewRender, project: OpenChatCutProject): string {
  return createHash("sha256").update(JSON.stringify({ project, members: render.members.map((member) => ({ memberKey: member.memberKey, relativePath: member.relativePath, sha256: member.sha256 })), confirmedShots: render.confirmedShots?.map((shot) => ({ shotId: shot.shotId, inputFingerprint: shot.inputFingerprint })) ?? [] })).digest("hex");
}

function projectSha256(project: OpenChatCutProject): string { return createHash("sha256").update(JSON.stringify(project)).digest("hex"); }

async function currentSessionProject(session: Session): Promise<OpenChatCutProject> {
  const response = await fetch(`${session.baseUrl}/api/project-store/entry?key=${encodeURIComponent(`project:${session.projectId}`)}`, { headers: { "Sec-Fetch-Site": "none" } });
  if (!response.ok) throw new Error(`无法读取 OpenChatCut 项目（HTTP ${response.status}）。`);
  const payload = await response.json() as { found?: boolean; value?: unknown };
  if (!payload.found || !payload.value || typeof payload.value !== "object" || Array.isArray(payload.value)) throw new Error("OpenChatCut 项目内容无效。");
  const project = structuredClone(payload.value) as OpenChatCutProject;
  rewriteSources(project, session.reverseSources);
  return project;
}

async function persistCurrentWorkspace(root: string, session: Session): Promise<OpenChatCutStudioSnapshot> {
  return persistProject(root, session.workspace.relativePath, await currentSessionProject(session), session.workspace.composition, session.projectId);
}

async function persistProject(root: string, relativePath: string, project: OpenChatCutProject, composition: Composition | undefined, projectId: string): Promise<OpenChatCutStudioSnapshot> {
  const path = resolve(root, relativePath);
  if (!isDescendant(root, path)) throw new Error("OpenChatCut 工作版本路径无效。");
  await mkdir(dirname(path), { recursive: true });
  const content = Buffer.from(JSON.stringify(project, null, 2) + "\n");
  await writeFile(path, content);
  return { relativePath, sha256: createHash("sha256").update(content).digest("hex"), fileSize: content.byteLength, composition, projectId };
}

async function readWorkspaceMetadata(path: string): Promise<WorkspaceMetadata | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as WorkspaceMetadata; }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; throw error; }
}

async function readStoredProject(path: string, projectId: string): Promise<OpenChatCutProject | null> {
  try {
    const store = JSON.parse(await readFile(path, "utf8")) as { entries?: Record<string, unknown> };
    const project = store.entries?.[`project:${projectId}`];
    return project && typeof project === "object" && !Array.isArray(project) ? project as OpenChatCutProject : null;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    try {
      const project = JSON.parse(await readFile(join(dirname(path), "project-store-v1", `${encodeURIComponent(`project:${projectId}`)}.json`), "utf8")) as unknown;
      return project && typeof project === "object" && !Array.isArray(project) ? project as OpenChatCutProject : null;
    } catch (directoryError) { if (directoryError instanceof Error && "code" in directoryError && directoryError.code === "ENOENT") return null; throw directoryError; }
  }
}

async function writeStoredProject(dataDir: string, projectId: string, project: OpenChatCutProject, legacyStore: unknown): Promise<void> {
  const directoryStore = join(dataDir, "project-store-v1");
  try {
    await readFile(join(directoryStore, ".ready"));
    await writeFile(join(directoryStore, `${encodeURIComponent(`project:${projectId}`)}.json`), JSON.stringify(project) + "\n");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    await writeFile(join(dataDir, "project-store-v1.json"), JSON.stringify(legacyStore, null, 2) + "\n");
  }
}

async function readProject(path: string): Promise<OpenChatCutProject | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as OpenChatCutProject; }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; throw error; }
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
