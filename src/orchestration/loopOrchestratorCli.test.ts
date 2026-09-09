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

  it("会为指定生产单安排核心、A-roll、声轨与人工视频派生音频任务", () => {
    const source = readFileSync(resolve("src/orchestration/loopOrchestratorCli.ts"), "utf8");
    const scopedPlanner = source.slice(source.indexOf("async function planScopedMediaTasks"), source.indexOf("async function planWorkerTasks"));

    expect(scopedPlanner).toContain('orchestrateTasks("orchestrate_provided_script_tasks_for_episode", { p_episode_id: episodeId })');
    expect(scopedPlanner).toContain('orchestrateTasks("orchestrate_storyboard_tasks_for_episode", { p_episode_id: episodeId })');
    expect(scopedPlanner).toContain('orchestrateTasks("orchestrate_a_roll_tasks_for_episode", { p_episode_id: episodeId })');
    expect(scopedPlanner).toContain('orchestrateTasks("orchestrate_soundtrack_tasks", { p_episode_id: episodeId })');
    expect(scopedPlanner).toContain('orchestrateTasks("orchestrate_embedded_audio_tasks", { p_episode_id: episodeId })');
  });

  it("全局调度会创建 A-roll 与声轨任务", () => {
    const source = readFileSync(resolve("src/orchestration/loopOrchestratorCli.ts"), "utf8");
    const workerPlanner = source.slice(source.indexOf("async function planWorkerTasks"), source.indexOf("async function orchestrateTasks"));

    expect(workerPlanner).toContain('orchestrateTasks("orchestrate_a_roll_tasks")');
    expect(workerPlanner).toContain('orchestrateTasks("orchestrate_soundtrack_tasks")');
  });

  it("每轮只编译一次 Worker，并按受限并发执行所有已规划任务", () => {
    const source = readFileSync(resolve("src/orchestration/loopOrchestratorCli.ts"), "utf8");

    expect(source).toContain('const workerConcurrency = positiveIntegerEnvironment("LOOP_WORKER_CONCURRENCY", process.env.CODEX_WORKER_CAPACITY ?? "2")');
    expect(source).toContain('await runCommand("npm", ["run", "worker:build"], projectRoot)');
    expect(source).toContain('runWithConcurrency(plannedTasks, workerConcurrency');
    expect(source).toContain('"worker:execute", "--", "--task-id", task.id');
  });

  it("空闲轮次只做轻量探针，不编排或构建 Worker", () => {
    const source = readFileSync(resolve("src/orchestration/loopOrchestratorCli.ts"), "utf8");

    expect(source).toContain('const pendingWork = await findPendingGlobalDispatchWork()');
    expect(source).toContain('skipped: "idle"');
    expect(source).toContain('endpoint.searchParams.set("select", "id")');
    expect(source).toContain('endpoint.searchParams.set("limit", "1")');
    expect(source).toContain('claimed_at: `lt.${new Date(Date.now() - 30 * 60 * 1000).toISOString()}`');
    expect(source).toContain('stage: "in.(script_approved,visual_approved,storyboard_approved,production_ready,render_ready)"');
    expect(source).toContain('orchestrateTasks("orchestrate_final_render_tasks")');
  });

  it("空闲 CLI 轮次不会编排或构建 Worker", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [] }));
    await runDispatch(fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchCalls(fetchMock).some((url) => url.includes("/rpc/"))).toBe(false);
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

  it.each([
    ["ready 任务", [{ id: "ready-task" }]],
    ["超时租约", [], [{ id: "expired-task" }]],
  ])("%s 不会被 CLI 跳过", async (_name, ...probeResponses: unknown[][]) => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => probeResponses.shift() ?? [] }));
    childProcess.spawn.mockImplementation((_command: string, args: string[]) => fakeChild(args.includes("worker:execute") ? '{"status":"idle"}\n' : ""));
    await runDispatch(fetchMock);

    expect(fetchCalls(fetchMock).some((url) => url.includes("/rpc/orchestrate_provided_script_tasks"))).toBe(true);
    expect(childProcess.spawn).toHaveBeenCalledWith("npm", ["run", "worker:build"], expect.anything());
    expect(childProcess.spawn).toHaveBeenCalledWith("npm", ["run", "worker:execute"], expect.anything());
  });

  it("已有最终渲染任务的 qc_passed 生产单只检查最终渲染", async () => {
    const responses = [[], [], [], [{ id: "qc-passed" }], []];
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => responses.shift() ?? [] }));
    await runDispatch(fetchMock);

    expect(fetchCalls(fetchMock).filter((url) => url.includes("/rpc/"))).toEqual(["https://example.supabase.co/rest/v1/rpc/orchestrate_final_render_tasks"]);
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });
});

async function runDispatch(fetchMock: ReturnType<typeof vi.fn>): Promise<void> {
  process.argv = ["node", "loopOrchestratorCli.ts", "dispatch"];
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
