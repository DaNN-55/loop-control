import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSnapshotFilename, snapshotTables, type SnapshotTable } from "./backupPolicy.js";
import { collectNotifications, type AuditEvent, type NotificationCursor } from "./notificationPolicy.js";
import { dispatchProvidedScriptWork, runWithConcurrency } from "./providedScriptDispatch.js";

const execFileAsync = promisify(execFile);
const projectRoot = requiredEnvironment("LOOP_PROJECT_ROOT");
const stateDirectory = process.env.LOOP_N8N_STATE_DIR ?? join(projectRoot, "n8n", "runtime", "orchestration");
const backupDirectory = join(projectRoot, "n8n", "runtime", "backups");
const mode = process.argv[2];
const scopedEpisodeId = readEpisodeIdArgument(process.argv.slice(3));
const workerConcurrency = positiveIntegerEnvironment("LOOP_WORKER_CONCURRENCY", process.env.CODEX_WORKER_CAPACITY ?? "2");

try {
  switch (mode) {
    case "dispatch":
      await dispatchTask();
      break;
    case "notify":
    case "notify-approvals":
    case "notify-state-changes":
      await notify();
      break;
    case "health":
      await runHealthCheck();
      break;
    default:
      throw new Error("用法：orchestrator:run <dispatch|notify|health>");
  }
} catch (error) {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
}

async function dispatchTask(): Promise<void> {
  if (scopedEpisodeId) {
    const plannedTasks = await planScopedMediaTasks(scopedEpisodeId);
    const workers = await runPlannedWorkers(plannedTasks);
    const productionReadyEpisodes = await orchestrateTasks("advance_production_ready_episodes", { p_episode_id: scopedEpisodeId });
    const preRenderPackages = await orchestrateTasks("create_pre_render_review_packages_for_episode", { p_episode_id: scopedEpisodeId });
    process.stdout.write(`${JSON.stringify({ mode: "dispatch", episodeId: scopedEpisodeId, plannedTasks: plannedTasks.length, workers, productionReadyEpisodes: productionReadyEpisodes.length, preRenderReviewPackages: preRenderPackages.length })}\n`);
    return;
  }

  const pendingWork = await findPendingGlobalDispatchWork();
  if (!pendingWork.hasWork) {
    process.stdout.write(JSON.stringify({ mode: "dispatch", skipped: "idle" }) + "\n");
    return;
  }
  if (pendingWork.qcFinalRenderOnly) {
    const plannedTasks = await orchestrateTasks("orchestrate_final_render_tasks");
    const workers = await runPlannedWorkers(plannedTasks);
    process.stdout.write(JSON.stringify({ mode: "dispatch", plannedTasks: plannedTasks.length, workers, ...(plannedTasks.length === 0 ? { skipped: "idle" } : {}) }) + "\n");
    return;
  }

  const result = await dispatchProvidedScriptWork({
    planTasks: planWorkerTasks,
    concurrency: workerConcurrency,
    prepareWorkers: async () => { await runCommand("npm", ["run", "worker:build"], projectRoot); },
    ...(pendingWork.hasClaimableTask ? { runExistingWorker: async () => {
      const workerResult = await runCommand("npm", ["run", "worker:execute"], projectRoot);
      return parseLastJsonLine(workerResult.stdout);
    } } : {}),
    runWorker: async (plannedTask) => {
      const workerResult = await runCommand("npm", ["run", "worker:execute", "--", "--task-id", plannedTask.id], projectRoot);
      return parseLastJsonLine(workerResult.stdout);
    },
  });
  const productionReadyEpisodes = await orchestrateTasks("advance_production_ready_episodes");
  const preRenderPackages = await orchestrateTasks("create_pre_render_review_packages");
  process.stdout.write(JSON.stringify({ mode: "dispatch", ...result, productionReadyEpisodes: productionReadyEpisodes.length, preRenderReviewPackages: preRenderPackages.length }) + "\n");
}

async function findPendingGlobalDispatchWork(): Promise<{ hasWork: boolean; hasClaimableTask: boolean; qcFinalRenderOnly: boolean }> {
  if (await hasSupabaseRows("tasks", {
    status: "eq.ready",
  })) return { hasWork: true, hasClaimableTask: true, qcFinalRenderOnly: false };

  // Keep the 30-minute boundary and null behavior aligned with claim_next_worker_task.
  if (await hasSupabaseRows("tasks", {
    status: "eq.running",
    claimed_at: `lt.${new Date(Date.now() - 30 * 60 * 1000).toISOString()}`,
  })) return { hasWork: true, hasClaimableTask: true, qcFinalRenderOnly: false };

  if (await hasSupabaseRows("episodes", {
    stage: "in.(script_approved,visual_approved,storyboard_approved,production_ready,render_ready)",
  })) return { hasWork: true, hasClaimableTask: false, qcFinalRenderOnly: false };

  if (await hasSupabaseRows("episodes", { stage: "eq.qc_passed" })) return { hasWork: true, hasClaimableTask: false, qcFinalRenderOnly: true };

  return { hasWork: false, hasClaimableTask: false, qcFinalRenderOnly: false };
}

async function hasSupabaseRows(table: "episodes" | "tasks", filters: Record<string, string>): Promise<boolean> {
  const { url, serviceRoleKey } = supabaseCredentials();
  const endpoint = new URL(`/rest/v1/${table}`, url);
  endpoint.searchParams.set("select", "id");
  endpoint.searchParams.set("limit", "1");
  for (const [key, value] of Object.entries(filters)) endpoint.searchParams.set(key, value);
  const response = await fetch(endpoint, { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } });
  if (!response.ok) throw new Error(`检查待派发任务失败：Supabase 返回 HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("检查待派发任务失败：Supabase 返回格式无效。");
  return payload.length > 0;
}

async function runPlannedWorkers(plannedTasks: Array<{ id: string }>): Promise<unknown[]> {
  if (plannedTasks.length === 0) return [];
  await runCommand("npm", ["run", "worker:build"], projectRoot);
  return runWithConcurrency(plannedTasks, workerConcurrency, async (task) => {
    const workerResult = await runCommand("npm", ["run", "worker:execute", "--", "--task-id", task.id], projectRoot);
    return parseLastJsonLine(workerResult.stdout);
  });
}

async function planScopedMediaTasks(episodeId: string): Promise<Array<{ id: string }>> {
  const [visualTasks, storyboardTasks] = await Promise.all([
    orchestrateTasks("orchestrate_provided_script_tasks_for_episode", { p_episode_id: episodeId }),
    orchestrateTasks("orchestrate_storyboard_tasks_for_episode", { p_episode_id: episodeId }),
  ]);
  const bRollTasks = await orchestrateTasks("orchestrate_b_roll_tasks", { p_episode_id: episodeId });
  const aRollTasks = await orchestrateTasks("orchestrate_a_roll_tasks_for_episode", { p_episode_id: episodeId });
  const narrationTasks = await orchestrateTasks("orchestrate_narration_tasks", { p_episode_id: episodeId });
  const soundtrackTasks = await orchestrateTasks("orchestrate_soundtrack_tasks", { p_episode_id: episodeId });
  const derivedAudioTasks = await orchestrateTasks("orchestrate_embedded_audio_tasks", { p_episode_id: episodeId });
  const reviewRenderTasks = await orchestrateTasks("orchestrate_review_render_tasks", { p_episode_id: episodeId });
  const finalRenderTasks = await orchestrateTasks("orchestrate_final_render_tasks", { p_episode_id: episodeId });
  return [...visualTasks, ...storyboardTasks, ...bRollTasks, ...aRollTasks, ...narrationTasks, ...soundtrackTasks, ...derivedAudioTasks, ...reviewRenderTasks, ...finalRenderTasks];
}

async function planWorkerTasks(): Promise<Array<{ id: string }>> {
  const [visualTasks, storyboardTasks] = await Promise.all([
    orchestrateTasks("orchestrate_provided_script_tasks"),
    orchestrateTasks("orchestrate_storyboard_tasks"),
  ]);
  const bRollTasks = await orchestrateTasks("orchestrate_b_roll_tasks");
  const aRollTasks = await orchestrateTasks("orchestrate_a_roll_tasks");
  const narrationTasks = await orchestrateTasks("orchestrate_narration_tasks");
  const soundtrackTasks = await orchestrateTasks("orchestrate_soundtrack_tasks");
  const derivedAudioTasks = await orchestrateTasks("orchestrate_embedded_audio_tasks");
  const reviewRenderTasks = await orchestrateTasks("orchestrate_review_render_tasks");
  const finalRenderTasks = await orchestrateTasks("orchestrate_final_render_tasks");
  return [...visualTasks, ...storyboardTasks, ...bRollTasks, ...aRollTasks, ...narrationTasks, ...soundtrackTasks, ...derivedAudioTasks, ...reviewRenderTasks, ...finalRenderTasks];
}

async function orchestrateTasks(functionName: string, args: Record<string, string> = {}): Promise<Array<{ id: string }>> {
  const { url, serviceRoleKey } = supabaseCredentials();
  const endpoint = new URL(`/rest/v1/rpc/${functionName}`, url);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`创建 Worker 任务失败：Supabase 返回 HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || payload.some((task) => !isRecord(task) || typeof task.id !== "string")) throw new Error("创建 Worker 任务失败：Supabase 返回格式无效。");
  return payload as Array<{ id: string }>;
}

function readEpisodeIdArgument(args: string[]): string | null {
  if (args.length === 0) return null;
  if (args.length !== 2 || args[0] !== "--episode" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args[1])) {
    throw new Error("用法：orchestrator:run dispatch [--episode <UUID>]");
  }
  return args[1].toLowerCase();
}

async function notify(): Promise<void> {
  const cursorFile = join(stateDirectory, "notifications-cursor.json");
  const cursor = await readCursor(cursorFile);
  const events = await fetchAuditEvents(cursor);
  const selection = collectNotifications(events, cursor);
  const notifications = [
    ...selection.approvalStages.map((stage) => ({ title: "需要人工审批", body: `有 Episode 进入 ${stage}，请在控制台处理。` })),
    ...selection.stateStages.map((stage) => ({ title: "Episode 状态已变更", body: `有 Episode 进入 ${stage}，请在控制台查看。` })),
    ...selection.blockerDetails.map((detail) => ({ title: "媒体任务已阻塞", body: detail })),
  ];

  for (const notification of notifications) await showNotification(notification.title, notification.body);

  if (selection.nextCursor) await writeCursor(cursorFile, selection.nextCursor);
  process.stdout.write(JSON.stringify({ mode: "notify", notifications: notifications.length, cursor: selection.nextCursor }) + "\n");
}

async function runHealthCheck(): Promise<void> {
  const checks = await Promise.all([
    check("项目目录", async () => { await stat(projectRoot); }),
    check("Codex CLI", async () => { await execFileAsync("codex", ["--version"]); }),
    check("Supabase 服务", checkSupabase),
    check("Supabase 数据快照", exportSupabaseSnapshot),
  ]);
  const passed = checks.every((checkResult) => checkResult.passed);
  if (!passed) {
    await showNotification("Loop 健康检查失败", "请在终端运行 npm run orchestrator:run -- health 查看详情。").catch(() => undefined);
  }
  process.stdout.write(JSON.stringify({ mode: "health", passed, checks }) + "\n");
  if (!passed) process.exitCode = 1;
}

async function checkSupabase(): Promise<void> {
  const { url, serviceRoleKey } = supabaseCredentials();
  const endpoint = new URL("/rest/v1/accounts?select=id&limit=1", url);
  const response = await fetch(endpoint, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  });
  if (!response.ok) throw new Error(`Supabase 返回 HTTP ${response.status}`);
}

async function fetchAuditEvents(cursor: NotificationCursor | null): Promise<AuditEvent[]> {
  const { url, serviceRoleKey } = supabaseCredentials();
  const endpoint = new URL("/rest/v1/audit_events", url);
  endpoint.searchParams.set("select", "id,created_at,event_type,payload");
  endpoint.searchParams.set("event_type", "in.(stage_transition,pre_render_review_package_created,a_roll_task_blocked,b_roll_task_blocked,narration_task_blocked,soundtrack_task_blocked)");
  endpoint.searchParams.set("order", "created_at.asc,id.asc");
  endpoint.searchParams.set("limit", "1000");
  if (cursor) endpoint.searchParams.set("created_at", `gte.${cursor.createdAt}`);

  const response = await fetch(endpoint, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  });
  if (!response.ok) throw new Error(`读取审计事件失败：Supabase 返回 HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("读取审计事件失败：Supabase 返回格式无效。");
  return payload.flatMap(toAuditEvent);
}

async function exportSupabaseSnapshot(): Promise<void> {
  const { url, serviceRoleKey } = supabaseCredentials();
  const tables: Record<string, unknown[]> = {};
  const snapshotStartedAt = new Date();
  for (const table of Object.keys(snapshotTables) as SnapshotTable[]) {
    tables[table] = await fetchTableRows(url, serviceRoleKey, table, snapshotStartedAt);
  }

  await mkdir(backupDirectory, { recursive: true });
  const snapshotPath = join(backupDirectory, formatSnapshotFilename(snapshotStartedAt));
  const temporaryPath = `${snapshotPath}.next`;
  const snapshot = {
    version: "supabase-rest-snapshot/v1",
    snapshotStartedAt: snapshotStartedAt.toISOString(),
    consistency: "best_effort",
    tables,
  };
  await writeFile(temporaryPath, `${JSON.stringify(snapshot)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, snapshotPath);
}

async function fetchTableRows(url: string, serviceRoleKey: string, table: SnapshotTable, snapshotStartedAt: Date): Promise<unknown[]> {
  const rows: unknown[] = [];
  const policy = snapshotTables[table];
  for (let offset = 0; ; offset += 1000) {
    const endpoint = new URL(`/rest/v1/${table}`, url);
    endpoint.searchParams.set("select", "*");
    endpoint.searchParams.set("order", policy.order);
    endpoint.searchParams.set("limit", "1000");
    endpoint.searchParams.set("offset", String(offset));
    if (policy.boundaryColumn) endpoint.searchParams.set(policy.boundaryColumn, `lte.${snapshotStartedAt.toISOString()}`);
    const response = await fetch(endpoint, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    });
    if (!response.ok) throw new Error(`导出 ${table} 失败：Supabase 返回 HTTP ${response.status}`);
    const page: unknown = await response.json();
    if (!Array.isArray(page)) throw new Error(`导出 ${table} 失败：Supabase 返回格式无效。`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function toAuditEvent(value: unknown): AuditEvent[] {
  if (!isRecord(value)) return [];
  const { id, created_at: createdAt, event_type: eventType, payload } = value;
  if (typeof id !== "string" || typeof createdAt !== "string" || typeof eventType !== "string") return [];
  return [{ id, createdAt, eventType, payload }];
}

async function readCursor(filePath: string): Promise<NotificationCursor | null> {
  try {
    const data: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (!isRecord(data) || typeof data.createdAt !== "string" || typeof data.id !== "string") return null;
    return { createdAt: data.createdAt, id: data.id };
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeCursor(filePath: string, cursor: NotificationCursor): Promise<void> {
  await mkdir(stateDirectory, { recursive: true });
  const temporaryFile = `${filePath}.next`;
  await writeFile(temporaryFile, `${JSON.stringify(cursor)}\n`, "utf8");
  await rename(temporaryFile, filePath);
}

async function showNotification(title: string, body: string): Promise<void> {
  await execFileAsync("/usr/bin/osascript", [
    "-e",
    "on run argv\n display notification (item 2 of argv) with title (item 1 of argv)\nend run",
    title,
    body,
  ]);
}

async function check(name: string, action: () => Promise<void>): Promise<{ name: string; passed: boolean; detail: string }> {
  try {
    await action();
    return { name, passed: true, detail: "正常" };
  } catch (error) {
    return { name, passed: false, detail: errorMessage(error) };
  }
}

function runCommand(command: string, argumentsList: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `命令退出状态为 ${code ?? "unknown"}。`));
    });
  });
}

function parseLastJsonLine(output: string): unknown {
  const line = output.trim().split("\n").at(-1);
  if (!line) throw new Error("Worker 没有输出结果。");
  try {
    return JSON.parse(line);
  } catch {
    throw new Error("Worker 输出不是预期的 JSON 结果。");
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 未配置。`);
  return value;
}

function positiveIntegerEnvironment(name: string, fallback: string): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function supabaseCredentials(): { url: string; serviceRoleKey: string } {
  return { url: requiredEnvironment("SUPABASE_URL"), serviceRoleKey: requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY") };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
