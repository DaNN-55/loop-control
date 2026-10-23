import { assertPreparedRuntime } from "./runtimeBuild.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSnapshotFilename, snapshotTables, type SnapshotTable } from "./backupPolicy.js";
import { consumeNotifications } from "./notificationConsumer.js";
import { notificationDelivery } from "./notificationDelivery.js";
import { recordOperation, type Operation } from "./operationsEvidence.js";
import { dispatchWorkerTasks, type DispatchScope } from "./workerDispatch.js";

const execFileAsync = promisify(execFile);
const projectRoot = requiredEnvironment("LOOP_PROJECT_ROOT");
const stateDirectory = process.env.LOOP_N8N_STATE_DIR ?? join(projectRoot, "n8n", "runtime", "orchestration");
const backupDirectory = process.env.LOOP_N8N_BACKUP_DIR ?? join(projectRoot, "n8n", "runtime", "backups");
const mode = process.argv[2];
const dispatchScope = readDispatchScope(process.argv.slice(3));
const workerConcurrency = positiveIntegerEnvironment("LOOP_WORKER_CONCURRENCY", process.env.CODEX_WORKER_CAPACITY ?? "2");

try {
  await assertPreparedRuntime(projectRoot);
  switch (mode) {
    case "dispatch":
      { const result = await dispatchWorkerTasks({ projectRoot, supabaseUrl: supabaseCredentials().url, serviceRoleKey: supabaseCredentials().serviceRoleKey, concurrency: workerConcurrency }, dispatchScope);
        await recordOperation(stateDirectory, "schedule", { passed: true, idle: result.workers.length === 0, detail: result.workers.length ? `派发轮次完成，执行 ${result.workers.length} 项。` : "调度检查完成，无可领取任务。" });
        process.stdout.write(`${JSON.stringify({ mode: "dispatch", ...result })}\n`); }
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
  const operation: Operation | undefined = mode?.startsWith("notify") ? "notification" : ({ dispatch: "schedule", health: "health", export: "snapshot" } as Record<string, Operation>)[mode];
  if (operation) await recordOperation(stateDirectory, operation, { passed: false, detail: operation === "notification" ? "提醒读取/投递失败或结果未知；请核对控制台队列和本机记录。" : `${operation === "health" ? "健康检查" : operation === "snapshot" ? "部分快照" : operation === "backup" ? "完整备份" : "调度"}失败，请检查本机日志。` }).catch(() => undefined);
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
}

async function notify(): Promise<void> {
  const delivery = notificationDelivery(supabaseCredentials(), stateDirectory);
  const result = await consumeNotifications(delivery, notification => showNotification(notification.title, notification.body));
  const unresolved = await delivery.unresolved();
  await recordOperation(stateDirectory, "notification", { passed: unresolved === 0, idle: result.notifications === 0, detail: unresolved ? `有 ${unresolved} 条提醒正在投递或结果未知；不会自动重复投递，请核对控制台队列。` : result.notifications ? `已被桌面通知接口接受 ${result.notifications} 条新事件；不代表 Owner 已读。` : "无新事件；首次运行只建立位置，不回放历史。" });
  if (unresolved) process.exitCode = 1;
  process.stdout.write(JSON.stringify({ mode: "notify", ...result }) + "\n");
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
  await recordOperation(stateDirectory, "health", { passed, detail: passed ? "独立健康检查通过。" : "独立健康检查失败，请查看检查输出。" });
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
  await recordOperation(stateDirectory, "snapshot", { passed: true, detail: "REST 部分快照已导出；best_effort，不是完整可恢复备份。" });
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

function readDispatchScope(args: string[]): DispatchScope {
  if (!args.length) return {};
  if (args.length !== 2 || !["--episode", "--task-id"].includes(args[0]) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args[1])) throw new Error("用法：orchestrator:run dispatch [--episode <UUID>|--task-id <UUID>]");
  return args[0] === "--episode" ? { episodeId: args[1].toLowerCase() } : { taskId: args[1].toLowerCase() };
}
