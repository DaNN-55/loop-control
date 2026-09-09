import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { projectRoot, readServiceRecord, removeServiceRecordIfOwned, stopRecordedServices, verifiedRecordedService, writeServiceRecord } from "./local-service-record.mjs";

const children = [];
afterEach(async () => {
  await Promise.all(children.splice(0).map(async (child) => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await waitForExit(child);
  }));
});

describe("本地服务安全停止", () => {
  it("npm stop 与兼容别名都进入安全停止脚本", () => {
    const { scripts } = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
    expect(scripts.stop).toBe("./scripts/stop-all.sh");
    expect(scripts["stop:all"]).toBe(scripts.stop);
  });

  it("只复用记录中身份匹配的服务，并在部分服务退出时保留其余记录", () => {
    const directory = mkdtempSync(join(tmpdir(), "loop-control-record-merge-"));
    const recordPath = join(directory, "services.json");
    const n8n = { name: "n8n", pid: 11111, port: "5678", commandIdentity: "n8n/bin/n8n" };
    const consoleService = { name: "控制台", pid: 22222, port: "5173", commandIdentity: "node_modules/vite/bin/vite.js" };
    writeServiceRecord([n8n, consoleService], recordPath);

    expect(verifiedRecordedService({ name: "n8n", port: "5678", commandIdentity: "n8n/bin/n8n" }, recordPath, () => ({ valid: true }))).toEqual(n8n);
    expect(verifiedRecordedService({ name: "n8n", port: "5678", commandIdentity: "foreign" }, recordPath, () => ({ valid: true }))).toBeNull();

    removeServiceRecordIfOwned([consoleService.pid], recordPath);
    expect(readServiceRecord(recordPath)?.services).toEqual([n8n]);
    rmSync(directory, { recursive: true, force: true });
  });

  it("未知进程即使占用记录端口也不会被关闭", async () => {
    const directory = mkdtempSync(join(tmpdir(), "loop-control-foreign-"));
    const recordPath = join(directory, "services.json");
    const { child, port } = await startListeningProcess(directory, "foreign-service");
    writeServiceRecord([{ name: "控制台", pid: child.pid, port, commandIdentity: "foreign-service" }], recordPath);

    const result = await stopRecordedServices({ recordPath });

    expect(result.stopped).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(processIsAlive(child.pid)).toBe(true);
    expect(existsSync(recordPath)).toBe(false);
    rmSync(directory, { recursive: true, force: true });
  });

  it("只关闭项目根目录、命令身份和监听端口都匹配的实际项目进程", async () => {
    const directory = mkdtempSync(join(tmpdir(), "loop-control-record-"));
    const recordPath = join(directory, "services.json");
    const { child, port } = await startListeningProcess(projectRoot, "loop-control-safe-stop-fixture");
    writeServiceRecord([{ name: "控制台", pid: child.pid, port, commandIdentity: "loop-control-safe-stop-fixture" }], recordPath);

    const result = await stopRecordedServices({ recordPath });

    expect(result.stopped).toHaveLength(1);
    await waitForExit(child);
    expect(processIsAlive(child.pid)).toBe(false);
    expect(existsSync(recordPath)).toBe(false);
    rmSync(directory, { recursive: true, force: true });
  });
});

async function startListeningProcess(cwd, identity) {
  const port = await availablePort();
  const child = spawn(process.execPath, ["-e", "require('node:net').createServer().listen(Number(process.argv[1]), '127.0.0.1')", String(port), identity], { cwd, stdio: "ignore" });
  children.push(child);
  await waitUntil(() => portIsListening(port));
  return { child, port: String(port) };
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function portIsListening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("测试服务未启动");
}

async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => child.once("exit", resolve));
}

function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
