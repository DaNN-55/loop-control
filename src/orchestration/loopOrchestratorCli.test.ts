import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const childProcess = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ ...childProcess, default: childProcess }));

const originalArgv = process.argv;
const originalProjectRoot = process.env.LOOP_PROJECT_ROOT;
const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

afterEach(() => {
  process.argv = originalArgv;
  restoreEnvironment("LOOP_PROJECT_ROOT", originalProjectRoot);
  restoreEnvironment("SUPABASE_URL", originalSupabaseUrl);
  restoreEnvironment("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey);
  childProcess.spawn.mockReset();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("定向生产单调度", () => {
  it("提醒工作流复用一次事件扫描，而不是各自定时读取 audit_events", () => {
    const approvalWorkflow = JSON.parse(readFileSync(resolve("n8n/workflows/approval-notifications.json"), "utf8"));
    const stateWorkflow = JSON.parse(readFileSync(resolve("n8n/workflows/state-change-notifications.json"), "utf8"));

    expect(approvalWorkflow.nodes.filter((node: { type: string }) => node.type === "n8n-nodes-base.scheduleTrigger")).toHaveLength(1);
    expect(stateWorkflow.nodes.filter((node: { type: string }) => node.type === "n8n-nodes-base.scheduleTrigger")).toHaveLength(0);
    expect(approvalWorkflow.nodes.some((node: { type: string }) => node.type === "n8n-nodes-base.executeWorkflow")).toBe(true);
    expect(stateWorkflow.nodes.some((node: { type: string }) => node.type === "n8n-nodes-base.executeWorkflowTrigger")).toBe(true);
    expect(stateWorkflow.nodes.some((node: { parameters?: { command?: string } }) => node.parameters?.command?.endsWith(" notify"))).toBe(true);
    expect(approvalWorkflow.nodes.find((node: { type: string }) => node.type === "n8n-nodes-base.executeWorkflow")?.parameters.workflowInputs).toEqual({ mappingMode: "defineBelow", value: {} });
    expect(stateWorkflow.nodes.find((node: { type: string }) => node.type === "n8n-nodes-base.executeWorkflowTrigger")?.parameters.inputSource).toBe("passthrough");
  });

  it("派发和提醒使用保守默认值，并在导入时读取本机间隔配置", () => {
    const dispatchWorkflow = JSON.parse(readFileSync(resolve("n8n/workflows/task-dispatch.json"), "utf8"));
    const approvalWorkflow = JSON.parse(readFileSync(resolve("n8n/workflows/approval-notifications.json"), "utf8"));
    const preparer = readFileSync(resolve("n8n/prepare-workflows.mjs"), "utf8");

    expect(dispatchWorkflow.nodes[0].parameters.rule.interval[0].minutesInterval).toBe(15);
    expect(approvalWorkflow.nodes[0].parameters.rule.interval[0].minutesInterval).toBe(30);
    expect(preparer).toContain("LOOP_DISPATCH_INTERVAL_MINUTES");
    expect(preparer).toContain("LOOP_NOTIFICATION_INTERVAL_MINUTES");
  });

  it("每日健康检查每天 09:00 只运行一次", () => {
    const workflow = JSON.parse(readFileSync(resolve("n8n/workflows/daily-health-check.json"), "utf8"));

    expect(workflow.nodes[0].parameters.rule.interval).toEqual([{ daysInterval: 1, field: "days", triggerAtHour: 9, triggerAtMinute: 0 }]);
  });

  it("定时扫描会消费规划器未新建的持久 ready 任务", async () => {
    const task = { id: "55555555-5555-4555-8555-555555555555" };
    const fetchMock = vi.fn(async (url: URL) => ({ ok: true, json: async () => String(url).includes("/tasks?") ? [task] : [] }));
    childProcess.spawn.mockImplementation((_command: string, args: string[]) => fakeChild(args.includes("--task-id") ? '{"status":"idle"}\n' : ""));
    await runDispatch(fetchMock);
    expect(childProcess.spawn).toHaveBeenCalledWith(process.execPath, [expect.stringContaining("codexWorkerCli.js"), "--task-id", task.id], expect.anything());
  });

  it("单任务入口只消费指定持久任务，不重新规划冻结输入", async () => {
    const task = { id: "55555555-5555-4555-8555-555555555555" };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [task] }));
    childProcess.spawn.mockImplementation((_command: string, args: string[]) => fakeChild(args.includes("--task-id") ? '{"status":"idle"}\n' : ""));
    await runDispatch(fetchMock, ["--task-id", task.id]);
    expect(fetchCalls(fetchMock).some(url => url.includes("orchestrate_"))).toBe(false);
    expect(childProcess.spawn).toHaveBeenCalledWith(process.execPath, [expect.stringContaining("codexWorkerCli.js"), "--task-id", task.id], expect.anything());
  });

  it("Episode入口会消费已存在的任务，即使规划器返回空", async () => {
    const task = { id: "55555555-5555-4555-8555-555555555555" };
    const fetchMock = vi.fn(async (url: URL) => ({ ok: true, json: async () => String(url).includes("/tasks?") ? [task] : [] }));
    childProcess.spawn.mockImplementation((_command: string, args: string[]) => fakeChild(args.includes("--task-id") ? '{"status":"idle"}\n' : ""));
    await runDispatch(fetchMock, ["--episode", "22222222-2222-4222-8222-222222222222"]);
    expect(fetchCalls(fetchMock)).toContainEqual(expect.stringContaining("episode_id=eq.22222222"));
    expect(childProcess.spawn).toHaveBeenCalledWith(process.execPath, [expect.stringContaining("codexWorkerCli.js"), "--task-id", task.id], expect.anything());
  });

  it("空队列不构建或启动Worker", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [] }));
    await runDispatch(fetchMock);
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it("一次提醒轮次只读取一次增量 audit_events", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [] }));
    process.argv = ["node", "loopOrchestratorCli.ts", "notify"];
    process.env.LOOP_PROJECT_ROOT = "/tmp/loop";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    vi.stubGlobal("fetch", fetchMock);
    await import("./loopOrchestratorCli.js");

    expect(fetchCalls(fetchMock)).toEqual([expect.stringContaining("/rest/v1/audit_events")]);
  });


});

async function runDispatch(fetchMock: ReturnType<typeof vi.fn>, args: string[] = []): Promise<void> {
  process.argv = ["node", "loopOrchestratorCli.ts", "dispatch", ...args];
  process.env.LOOP_PROJECT_ROOT = "/tmp/loop";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  vi.stubGlobal("fetch", fetchMock);
  await import("./loopOrchestratorCli.js");
}

function fetchCalls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return (fetchMock.mock.calls as unknown as Array<[unknown]>).map(([url]) => String(url));
}

function fakeChild(stdout: string): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  queueMicrotask(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    child.emit("close", 0);
  });
  return child;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
