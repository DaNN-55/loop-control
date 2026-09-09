import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
export const serviceRecordPath = process.env.LOOP_CONTROL_SERVICE_RECORD || join(projectRoot, ".loop-control", "local-services.json");

export function writeServiceRecord(services, recordPath = serviceRecordPath) {
  if (!services.length) return removeServiceRecord(recordPath);
  mkdirSync(dirname(recordPath), { recursive: true });
  const temporaryPath = `${recordPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({ version: 1, projectRoot, services }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, recordPath);
}

export function readServiceRecord(recordPath = serviceRecordPath) {
  if (!existsSync(recordPath)) return null;
  try {
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    if (record?.version !== 1 || record.projectRoot !== projectRoot || !Array.isArray(record.services)) return null;
    const services = record.services.filter((service) => Number.isSafeInteger(service?.pid) && service.pid > 1 && /^\d+$/.test(String(service.port)) && typeof service.name === "string" && typeof service.commandIdentity === "string" && service.commandIdentity.length > 0);
    return services.length === record.services.length ? { ...record, services } : null;
  } catch {
    return null;
  }
}

export function removeServiceRecord(recordPath = serviceRecordPath) {
  rmSync(recordPath, { force: true });
}

export function removeServiceRecordIfOwned(pids, recordPath = serviceRecordPath) {
  const record = readServiceRecord(recordPath);
  const owned = new Set(pids);
  if (record && record.services.every(({ pid }) => owned.has(pid))) removeServiceRecord(recordPath);
}

export function inspectRecordedService(service, root = projectRoot) {
  if (!processExists(service.pid)) return { valid: false, reason: "process-missing" };
  const command = commandForPid(service.pid);
  const cwd = cwdForPid(service.pid);
  const ownsPort = pidListensOnPort(service.pid, service.port);
  const valid = Boolean(command.includes(service.commandIdentity) && cwd === root && ownsPort);
  return { valid, reason: valid ? "verified" : "identity-mismatch", command, cwd, ownsPort };
}

export async function stopRecordedServices({ dryRun = false, recordPath = serviceRecordPath, inspect = inspectRecordedService, signal = process.kill } = {}) {
  const record = readServiceRecord(recordPath);
  if (!record) {
    removeServiceRecord(recordPath);
    return { stopped: [], skipped: [], missing: true };
  }

  const verified = [];
  const skipped = [];
  for (const service of record.services) {
    const result = inspect(service, record.projectRoot);
    (result.valid ? verified : skipped).push({ ...service, reason: result.reason });
  }
  if (dryRun) return { stopped: verified, skipped, missing: false };

  for (const service of verified) safeSignal(signal, service.pid, "SIGTERM");
  for (let attempt = 0; attempt < 20 && verified.some(({ pid }) => processExists(pid)); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const service of verified) if (processExists(service.pid)) safeSignal(signal, service.pid, "SIGKILL");
  removeServiceRecord(recordPath);
  return { stopped: verified, skipped, missing: false };
}

function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

function commandForPid(pid) {
  return spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
}

function cwdForPid(pid) {
  const output = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" }).stdout;
  const path = output.split(/\r?\n/).find((line) => line.startsWith("n"))?.slice(1);
  try { return path ? realpathSync(path) : ""; } catch { return ""; }
}

function pidListensOnPort(pid, port) {
  const result = spawnSync("lsof", ["-nP", "-a", "-p", String(pid), `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim().split(/\s+/).includes(String(pid));
}

function safeSignal(signal, pid, name) {
  try { signal(pid, name); } catch (error) { if (error?.code !== "ESRCH") throw error; }
}
