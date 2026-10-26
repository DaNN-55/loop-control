import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareRuntime } from "./runtimeBuild";
const fixtureRoots: string[] = [];
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const childProcess = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ ...childProcess, default: childProcess }));

const originalArgv = process.argv;
const originalWorkerCapacity = process.env.CODEX_WORKER_CAPACITY;
const originalProjectRoot = process.env.LOOP_PROJECT_ROOT;
const originalStateDirectory = process.env.LOOP_N8N_STATE_DIR;
const originalExitCode = process.exitCode;
const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map(root=>rm(root,{recursive:true,force:true})));
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  restoreEnvironment("LOOP_N8N_STATE_DIR",originalStateDirectory);
  restoreEnvironment("CODEX_WORKER_CAPACITY", originalWorkerCapacity);
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

    expect(workflow.settings.timezone).toBe("Asia/Shanghai");
    expect(workflow.settings.saveDataSuccessExecution).toBe("none");
    expect(workflow.settings.saveDataErrorExecution).toBe("all");
    expect(workflow.nodes[0].parameters.rule.interval).toEqual([{ daysInterval: 1, field: "days", triggerAtHour: 9, triggerAtMinute: 0 }]);
  });

  it("定时扫描先领取持久任务，再用stdin传递给Worker", async () => {
    const fetchMock = claimedQueue();
    childProcess.spawn.mockImplementation((_command: string, args: string[]) => fakeChild(args.includes("--claimed-task") ? '{"status":"completed"}\n' : ""));
    await runDispatch(fetchMock);
    expect(childProcess.spawn).toHaveBeenCalledWith(process.execPath, [expect.stringContaining("codexWorkerCli.js"), "--claimed-task"], expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }));
  });

  it("任务唤醒不重新规划冻结输入，仍消费公平共享队列", async () => {
    const fetchMock = claimedQueue();
    childProcess.spawn.mockImplementation((_command: string, args: string[]) => fakeChild(args.includes("--claimed-task") ? '{"status":"completed"}\n' : ""));
    await runDispatch(fetchMock, ["--task-id", "55555555-5555-4555-8555-555555555555"]);
    expect(fetchCalls(fetchMock).some(url => url.includes("orchestrate_"))).toBe(false);
    expect(fetchMock.mock.calls.filter(([url])=>String(url).includes("claim_next_worker_task")).every(([,init])=>!JSON.parse(String(init?.body)).p_task_id)).toBe(true);
  });

  it("Episode入口限定规划范围，执行仍使用全局原子领取", async () => {
    const fetchMock = claimedQueue();
    childProcess.spawn.mockImplementation((_command: string, args: string[]) => fakeChild(args.includes("--claimed-task") ? '{"status":"completed"}\n' : ""));
    await runDispatch(fetchMock, ["--episode", "22222222-2222-4222-8222-222222222222"]);
    const calls=fetchMock.mock.calls.filter(([url])=>String(url).includes("orchestrate_provided_script_tasks_for_episode"));
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({p_episode_id:"22222222-2222-4222-8222-222222222222"});
    expect(childProcess.spawn).toHaveBeenCalledWith(process.execPath, [expect.stringContaining("codexWorkerCli.js"), "--claimed-task"], expect.anything());
  });

  it("满载领取为空时不构建或启动空跑Worker", async () => {
    const fetchMock = vi.fn(async (url: URL) => ({ok:true,json:async()=>String(url).includes("/tasks?") && !String(url).includes("available_at") ? [{id:"queued"}] : []}));
    await runDispatch(fetchMock);
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it("CLI不传显式environment时仍尊重进程中的Worker容量", async () => {
    process.env.CODEX_WORKER_CAPACITY="1";
    const fetchMock=claimedQueue();
    childProcess.spawn.mockImplementation((_command:string,args:string[])=>fakeChild(args.includes("--claimed-task")?'{"status":"completed"}\n':""));
    await runDispatch(fetchMock);
    const requests=fetchMock.mock.calls.filter(([url])=>String(url).includes("claim_next_worker_task"));
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(([,init])=>JSON.parse(String(init?.body)).p_worker_capacity===1)).toBe(true);
  });

  it("已准备的任务热路径只执行产物，不调用npm或编译器", async () => {
    const fetchMock=claimedQueue();
    childProcess.spawn.mockImplementation(()=>fakeChild('{"status":"completed"}\n'));
    await runDispatch(fetchMock);
    expect(childProcess.spawn.mock.calls.every(([command])=>command===process.execPath)).toBe(true);
  });

  it("空队列不构建或启动Worker", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [] }));
    await runDispatch(fetchMock);
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it("一次提醒轮次通过原子领取消费事件，不再按时间重扫 audit_events", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, headers:new Headers({"content-range":"*/0"}), json: async () => [] }));
    process.argv = ["node", "loopOrchestratorCli.ts", "notify"];
    process.env.LOOP_PROJECT_ROOT = await preparedFixture();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    vi.stubGlobal("fetch", fetchMock);
    await import("./loopOrchestratorCli.js");

    expect(fetchCalls(fetchMock)).toEqual([
      expect.stringContaining("/rpc/initialize_notification_delivery"),
      expect.stringContaining("/rpc/claim_notification_event"),
      expect.stringContaining("/notification_delivery_events"),
    ]);
  });
  it("部分快照失败归入快照结果，不误报为调度失败", async()=>{
    process.argv=["node","loopOrchestratorCli.ts","export"];
    const root=await preparedFixture();process.env.LOOP_PROJECT_ROOT=root;
    process.env.SUPABASE_URL="https://example.supabase.co";process.env.SUPABASE_SERVICE_ROLE_KEY="test-key";
    vi.stubGlobal("fetch",vi.fn(async()=>({ok:false,status:503})));
    await import("./loopOrchestratorCli.js");
    const outcome=JSON.parse(await readFile(join(root,"state","snapshot-result.json"),"utf8"));
    expect(outcome.passed).toBe(false);expect(outcome.detail).toContain("部分快照");
  });



});

async function runDispatch(fetchMock: ReturnType<typeof vi.fn>, args: string[] = []): Promise<void> {
  process.argv = ["node", "loopOrchestratorCli.ts", "dispatch", ...args];
  const root=await preparedFixture();
  process.env.LOOP_PROJECT_ROOT = root;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  vi.stubGlobal("fetch", fetchMock);
  await import("./loopOrchestratorCli.js");
}

async function preparedFixture() {
  const root=await mkdtemp(join(tmpdir(),"loop-cli-")); fixtureRoots.push(root);
  process.env.LOOP_N8N_STATE_DIR=join(root,"state");
  for(const dir of ["src", "dist/worker/worker", "dist/orchestration/orchestration"])await mkdir(join(root,dir),{recursive:true});
  for(const name of ["package.json","package-lock.json","tsconfig.worker.json","tsconfig.orchestrator.json"])await writeFile(join(root,name),"{}");
  await prepareRuntime(root,async()=>{
    await writeFile(join(root,"dist/worker/worker/codexWorkerCli.js"),"// prepared worker");
    await writeFile(join(root,"dist/orchestration/orchestration/loopOrchestratorCli.js"),"// prepared dispatcher");
  });
  return root;
}

function fetchCalls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return (fetchMock.mock.calls as unknown as Array<[unknown]>).map(([url]) => String(url));
}

function claimedQueue() {
  let claimed=false;
  return vi.fn(async (url: URL, _init?: RequestInit) => ({ok:true,json:async()=>{
    if(String(url).includes("claim_next_worker_task")) {
      if(claimed)return []; claimed=true;return [{task_id:"55555555-5555-4555-8555-555555555555",attempt:0,lease_token:"66666666-6666-4666-8666-666666666666"}];
    }
    return String(url).includes("/tasks?") && !String(url).includes("available_at") ? [{id:"ready"}] : [];
  }}));
}

function fakeChild(stdout: string): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: { end: vi.fn(), on: vi.fn() } });
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
