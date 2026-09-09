import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertOpenChatCutAvailable, consoleUrlForPort, localStartupReport, n8nUrlForPort, resolveLocalServicePort } from "./start-local.mjs";
import { stopRecordedServices, writeServiceRecord } from "./local-service-record.mjs";

const fixtures = [];
const children = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once("exit", resolve));
  }
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("STARTUP-03D 生命周期验收", () => {
  it("只暴露 npm start 作为正式启动入口", () => {
    const { scripts } = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    expect(scripts.start).toBe("node scripts/start-local.mjs");
    expect(scripts["start:local"]).toBeUndefined();
    expect(scripts["start:all"]).toBeUndefined();
  });

  it("n8n 子路径保留尾部斜杠，避免静态资源和健康地址拼接错误", () => {
    const source = readFileSync(join(process.cwd(), "n8n", "start-local.sh"), "utf8");
    expect(source).toContain('export N8N_PATH="/loop-control-n8n/"');
  });

  it("空闲端口启动与被占用时自动换用隔离端口", async () => {
    const { port: occupied, server } = await listeningPort();
    const preferred = await freePort();
    await expect(resolveLocalServicePort({
      preferredPort: String(preferred),
      projectHealthy: async () => false,
      portAvailable: async (port) => Number(port) !== occupied,
      findAvailablePort: async (port) => port,
    })).resolves.toEqual({ port: String(preferred), reused: false });
    await expect(resolveLocalServicePort({
      preferredPort: String(occupied),
      projectHealthy: async () => false,
      portAvailable: async () => false,
      findAvailablePort: async (port) => port,
    })).resolves.toEqual({ port: String(occupied + 1), reused: false });
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("启动失败后清理过期 n8n 记录，不发送信号给已经退出的 PID", async () => {
    const directory = mkdtempSync(join(tmpdir(), "loop-control-lifecycle-"));
    fixtures.push(directory);
    const child = spawn(process.execPath, ["-e", "process.exit(23)"], { cwd: process.cwd(), stdio: "ignore" });
    children.push(child);
    await new Promise((resolve) => child.once("exit", resolve));
    const recordPath = join(directory, "services.json");
    writeServiceRecord([{ name: "n8n", pid: child.pid, port: "5678", commandIdentity: "n8n/bin/n8n" }], recordPath);
    const result = await stopRecordedServices({ recordPath });
    expect(result.stopped).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(existsSync(recordPath)).toBe(false);
  });

  it("媒体库未挂载仍报告启动成功，并输出实际控制台与 n8n 地址", () => {
    const report = localStartupReport({
      consoleUrl: consoleUrlForPort("6137"),
      n8nUrl: n8nUrlForPort("6178"),
      mediaLibraryMounted: false,
      mediaLibraryPath: "/Volumes/not-mounted",
      openChatCutAvailable: true,
    });
    expect(report).toContain("Loop Control 已启动");
    expect(report).toContain("控制台：http://127.0.0.1:6137/");
    expect(report).toContain("n8n：http://127.0.0.1:6178/loop-control-n8n/");
    expect(report).toContain("媒体库：不可用");
  });

  it("OpenChatCut 配置错误给出可定位原因", () => {
    expect(() => assertOpenChatCutAvailable("/definitely-missing-node-24")).toThrow("OPENCHATCUT_NODE 不存在");
  });
});

function listeningPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ port, server });
    });
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
