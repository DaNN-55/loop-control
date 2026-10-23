import { assertPreparedRuntime } from "./runtimeBuild.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSnapshotFilename, snapshotTables, type SnapshotTable } from "./backupPolicy.js";
import { collectNotifications, type AuditEvent, type NotificationCursor } from "./notificationPolicy.js";
import { dispatchWorkerTasks, type DispatchScope } from "./workerDispatch.js";

const execFileAsync = promisify(execFile);
const projectRoot = requiredEnvironment("LOOP_PROJECT_ROOT");
const stateDirectory = process.env.LOOP_N8N_STATE_DIR ?? join(projectRoot, "n8n", "runtime", "orchestration");
const backupDirectory = join(projectRoot, "n8n", "runtime", "backups");
const mode = process.argv[2];
const dispatchScope = readDispatchScope(process.argv.slice(3));
const workerConcurrency = positiveIntegerEnvironment("LOOP_WORKER_CONCURRENCY", process.env.CODEX_WORKER_CAPACITY ?? "2");

try {
  await assertPreparedRuntime(projectRoot);
  switch (mode) {
    case "dispatch":
      process.stdout.write(`${JSON.stringify({ mode: "dispatch", ...await dispatchWorkerTasks({ projectRoot, supabaseUrl: supabaseCredentials().url, serviceRoleKey: supabaseCredentials().serviceRoleKey, concurrency: workerConcurrency }, dispatchScope) })}\n`);
      break;
    case "notify":
    case "notify-approvals":
    case "notify-state-changes":
      await notify();
      break;
    case "export":
      await exportSupabaseSnapshot();
      break;
    case "health":
      await runHealthCheck();
      break;
    default:
      throw new Error("用法：orchestrator:run <dispatch|notify|health|export>");
  }
} catch (error) {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
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
  process.stdout.write(JSON.stringify({ mode: "export", passed: true, consistency: "best_effort", restorableBackup: false, snapshotPath, tables: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])) }) + "\n");
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

function readDispatchScope(args: string[]): DispatchScope {
  if (!args.length) return {};
  if (args.length !== 2 || !["--episode", "--task-id"].includes(args[0]) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args[1])) throw new Error("用法：orchestrator:run dispatch [--episode <UUID>|--task-id <UUID>]");
  return args[0] === "--episode" ? { episodeId: args[1].toLowerCase() } : { taskId: args[1].toLowerCase() };
}
