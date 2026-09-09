import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliVersion = "2.114.0";

export function localMigrationVersions(migrationsDirectory = resolve("supabase/migrations")) {
  const versions = new Set();
  for (const filename of readdirSync(migrationsDirectory)) {
    const match = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(filename);
    if (!match) throw new Error(`迁移文件名不符合 <UTC 时间戳>_<名称>.sql：${filename}`);
    if (versions.has(match[1])) throw new Error(`迁移版本重复：${match[1]}`);
    versions.add(match[1]);
  }
  return [...versions].sort();
}

export function migrationVersionsFromCliOutput(source) {
  const local = new Set();
  const remote = new Set();
  try {
    collectJsonMigrationVersions(JSON.parse(source), local, remote);
  } catch {
    for (const line of source.split(/\r?\n/)) {
      const columns = line.split(/[|│]/);
      const localVersion = columns[0]?.match(/\b\d{14}\b/)?.[0];
      const remoteVersion = columns[1]?.match(/\b\d{14}\b/)?.[0];
      if (localVersion) local.add(localVersion);
      if (remoteVersion) remote.add(remoteVersion);
    }
  }
  return { local: [...local].sort(), remote: [...remote].sort() };
}

export function compareMigrationVersions(local, remote) {
  const localOnly = local.filter((version) => !remote.includes(version));
  const remoteOnly = remote.filter((version) => !local.includes(version));
  if (localOnly.length === 0 && remoteOnly.length === 0) {
    return { state: "consistent", detail: `本地与远程迁移历史一致（${local.length} 个版本）。`, local, remote };
  }
  const differences = [
    localOnly.length ? `仅本地 ${localOnly.length} 个（${localOnly.slice(0, 3).join(", ")}）` : "",
    remoteOnly.length ? `仅远程 ${remoteOnly.length} 个（${remoteOnly.slice(0, 3).join(", ")}）` : "",
  ].filter(Boolean).join("；");
  return { state: "inconsistent", detail: `Supabase 迁移历史不一致：${differences}。`, local, remote };
}

export function readMigrationStatus({ projectRef = projectRefFromEnvFile(), run = spawnSync } = {}) {
  try {
    const local = localMigrationVersions();
    if (!projectRef) return { state: "unknown", detail: "无法确认 Supabase 迁移：未配置项目引用。", local, remote: [] };
    const result = run("npx", migrationListArguments(projectRef), { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 60_000 });
    if (result.error || result.status !== 0) {
      const reason = sanitizedError(result.error?.message || result.stderr || `Supabase CLI 退出码 ${result.status ?? "unknown"}`);
      return { state: "unknown", detail: migrationFailureDetail(reason), local, remote: [] };
    }
    const versions = migrationVersionsFromCliOutput(result.stdout || "");
    if (versions.local.length === 0 && local.length > 0) return { state: "unknown", detail: "无法确认 Supabase 迁移：CLI 未返回可解析的迁移列表。", local, remote: versions.remote };
    return compareMigrationVersions(local, versions.remote);
  } catch (error) {
    return { state: "unknown", detail: `无法确认 Supabase 迁移：${sanitizedError(error instanceof Error ? error.message : String(error))}`, local: [], remote: [] };
  }
}

function migrationFailureDetail(reason) {
  if (/failed to connect|connection (?:refused|terminated)|timed?\s*out|执行超时/i.test(reason)) {
    return "远程数据库连接失败，暂时无法确认本地迁移是否已同步。请稍后刷新重试。";
  }
  if (/unauthorized|forbidden|authentication|password|login/i.test(reason)) {
    return "迁移检查未通过远程数据库身份验证，暂时无法确认是否同步。请检查 Supabase CLI 登录状态。";
  }
  return "迁移检查暂时失败，无法确认本地与远程迁移是否一致。请稍后刷新重试。";
}

function collectJsonMigrationVersions(value, local, remote) {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonMigrationVersions(item, local, remote);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, candidate] of Object.entries(value)) {
    if (/^local$/i.test(key) && typeof candidate === "string" && /^\d{14}$/.test(candidate)) local.add(candidate);
    else if (/^remote$/i.test(key) && typeof candidate === "string" && /^\d{14}$/.test(candidate)) remote.add(candidate);
    else collectJsonMigrationVersions(candidate, local, remote);
  }
}

function migrationListArguments(projectRef) {
  return ["--yes", `--package=supabase@${cliVersion}`, `--package=${cliBinaryPackage()}@${cliVersion}`, "--", "supabase", "migration", "list", "--project-ref", projectRef, "--output", "json"];
}

function cliBinaryPackage() {
  const cliPackage = {
    "darwin-arm64": "@supabase/cli-darwin-arm64",
    "darwin-x64": "@supabase/cli-darwin-x64",
    "linux-arm64": "@supabase/cli-linux-arm64",
    "linux-x64": "@supabase/cli-linux-x64",
    "win32-arm64": "@supabase/cli-windows-arm64",
    "win32-x64": "@supabase/cli-windows-x64",
  }[`${process.platform}-${process.arch}`];
  if (!cliPackage) throw new Error(`当前平台没有对应的 Supabase CLI 二进制：${process.platform}-${process.arch}`);
  return cliPackage;
}

function projectRefFromEnvFile() {
  const envPath = resolve(".env.local");
  if (!existsSync(envPath)) return null;
  const url = readFileSync(envPath, "utf8").match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1]?.trim();
  return url?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i)?.[1] ?? null;
}

function runDbPush(projectRef, dryRun) {
  const args = ["--yes", `--package=supabase@${cliVersion}`, `--package=${cliBinaryPackage()}@${cliVersion}`, "--", "supabase", "db", "push", "--project-ref", projectRef, "--skip-vault"];
  if (dryRun) args.push("--dry-run");
  const result = spawnSync("npx", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function sanitizedError(source) {
  return String(source)
    .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/\bbearer\s+\S+/gi, "Bearer [已隐藏]")
    .replace(/(authorization|bearer|token|password|secret|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[已隐藏]")
    .replace(/:\/\/[^\s/@:]+:[^\s/@]+@/g, "://[已隐藏]@")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function main() {
  const deploy = process.argv.includes("--deploy");
  if (process.argv.includes("--help")) {
    console.log("Usage: node scripts/supabase-migrations.mjs [--deploy|--status-json]");
    console.log("Without flags, validates migration history only. --status-json performs a read-only three-state comparison. --deploy validates before and after deployment.");
    return;
  }
  if (process.argv.includes("--status-json")) {
    console.log(JSON.stringify(readMigrationStatus()));
    return;
  }
  localMigrationVersions();
  const projectRef = process.env.SUPABASE_PROJECT_REF ?? projectRefFromEnvFile();
  if (!projectRef) throw new Error("缺少 SUPABASE_PROJECT_REF；请设置该环境变量，或在 .env.local 中配置 VITE_SUPABASE_URL。");
  runDbPush(projectRef, true);
  if (!deploy) {
    console.log("Supabase 迁移历史预检通过；未执行部署。");
    return;
  }
  runDbPush(projectRef, false);
  runDbPush(projectRef, true);
  console.log("Supabase 迁移已部署，且部署后预检通过。");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
