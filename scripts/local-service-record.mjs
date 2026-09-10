import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
export const serviceRecordPath = process.env.LOOP_CONTROL_SERVICE_RECORD || join(projectRoot, ".loop-control", "local-services.json");
const projectServiceDefinitions = [
  { commandIdentity: join(projectRoot, "n8n", "node24", "node_modules", "n8n", "bin", "n8n"), name: "n8n" },
  { commandIdentity: join(projectRoot, "node_modules", "vite", "bin", "vite.js"), name: "控制台" },
];

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
  if (!record) return;
  const owned = new Set(pids);
  const remaining = record.services.filter(({ pid }) => !owned.has(pid));
  if (remaining.length) writeServiceRecord(remaining, recordPath);
  else removeServiceRecord(recordPath);
}

export function verifiedRecordedService({ name, port, commandIdentity }, recordPath = serviceRecordPath, inspect = inspectRecordedService) {
  const record = readServiceRecord(recordPath);
  const service = record?.services.find((candidate) => candidate.name === name && candidate.port === String(port) && candidate.commandIdentity === commandIdentity);
  return service && inspect(service, record.projectRoot).valid ? service : null;
}

export function inspectRecordedService(service, root = projectRoot) {
  if (!processExists(service.pid)) return { valid: false, reason: "process-missing" };
  const command = commandForPid(service.pid);
  const cwd = cwdForPid(service.pid);
  const ownsPort = pidListensOnPort(service.pid, service.port);
  const valid = Boolean(command.includes(service.commandIdentity) && cwd === root && ownsPort);
  return { valid, reason: valid ? "verified" : "identity-mismatch", command, cwd, ownsPort };
}

export function discoverProjectServices({ definitions = projectServiceDefinitions, listeningPortsForPid: readPorts = listeningPortsForPid, processes = runningProcesses(), workingDirectoryForPid = cwdForPid } = {}) {
  return processes.flatMap(({ command, pid }) => {
    const definition = definitions.find(({ commandIdentity }) => command.includes(commandIdentity));
    if (!definition || workingDirectoryForPid(pid) !== projectRoot) return [];
    const ports = readPorts(pid);
    return [{ ...definition, pid, port: ports.join(",") || "未知", ports, reason: "discovered-project-process" }];
  });
}

export async function stopRecordedServices(options = {}) {
  const { dryRun = false, recordPath = serviceRecordPath, inspect = inspectRecordedService, signal = process.kill } = options;
  const discover = options.discover ?? (recordPath === serviceRecordPath ? discoverProjectServices : () => []);
  const record = readServiceRecord(recordPath);
  const verified = [];
  const skipped = [];
  for (const service of record?.services ?? []) {
    const result = inspect(service, record.projectRoot);
    (result.valid ? verified : skipped).push({ ...service, reason: result.reason });
  }
  for (const service of discover()) if (!verified.some(({ pid }) => pid === service.pid)) verified.push(service);
  const verifiedPids = new Set(verified.map(({ pid }) => pid));
  const safelySkipped = skipped.filter(({ pid }) => !verifiedPids.has(pid));
  if (dryRun) return { stopped: verified, skipped: safelySkipped, missing: !record };

  for (const service of verified) safeSignal(signal, service.pid, "SIGTERM");
  for (let attempt = 0; attempt < 20 && verified.some(({ pid }) => processExists(pid)); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const service of verified) if (processExists(service.pid)) safeSignal(signal, service.pid, "SIGKILL");
  removeServiceRecord(recordPath);
  return { stopped: verified, skipped: safelySkipped, missing: !record };
}

function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

function commandForPid(pid) {
  const result = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
  return result.status === 0 && typeof result.stdout === "string" ? result.stdout.trim() : "";
}

function cwdForPid(pid) {
  const result = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
  const output = result.status === 0 && typeof result.stdout === "string" ? result.stdout : "";
  const path = output.split(/\r?\n/).find((line) => line.startsWith("n"))?.slice(1);
  try { return path ? realpathSync(path) : ""; } catch { return ""; }
}

function runningProcesses() {
  const result = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  if (result.status !== 0 || typeof result.stdout !== "string") return [];
  return result.stdout.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    return match ? [{ command: match[2], pid: Number(match[1]) }] : [];
  });
}

function listeningPortsForPid(pid) {
  const result = spawnSync("lsof", ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-Fn"], { encoding: "utf8" });
  if (result.status !== 0 || typeof result.stdout !== "string") return [];
  return [...new Set(result.stdout.split(/\r?\n/).flatMap((line) => {
    const match = /^n.*:(\d+)$/.exec(line);
    return match ? [match[1]] : [];
  }))].sort((left, right) => Number(left) - Number(right));
}

function pidListensOnPort(pid, port) {
  const result = spawnSync("lsof", ["-nP", "-a", "-p", String(pid), `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  return result.status === 0 && typeof result.stdout === "string" && result.stdout.trim().split(/\s+/).includes(String(pid));
}

function safeSignal(signal, pid, name) {
  try { signal(pid, name); } catch (error) { if (error?.code !== "ESRCH") throw error; }
}
