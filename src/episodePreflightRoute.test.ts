// @vitest-environment node

import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createRuntimePreflight: vi.fn(),
  inspectPreflight: vi.fn(),
  runtimeCommandInvocation: vi.fn(() => ({ command: process.execPath, argumentsList: ["--version"] })),
  verifyMediaLibrary: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("./worker/mediaLibrary", () => ({ verifyMediaLibrary: mocks.verifyMediaLibrary }));
vi.mock("./worker/runtimePreflight", () => ({
  createRuntimePreflight: mocks.createRuntimePreflight,
}));
vi.mock("./worker/runtimeEvidence", () => ({
  runtimeCommandArguments: vi.fn(() => ["--version"]),
  runtimeCommandInvocation: mocks.runtimeCommandInvocation,
}));
vi.mock("./worker/runtimeProbes", () => ({ probeCodexModel: vi.fn(), probeProviderConnection: vi.fn() }));

import { createLocalControlPlaneMiddleware, runtimePreflightForPolicy, type LocalControlPlaneDependencies } from "./local-control-plane/testing";

const accountId = "11111111-1111-4111-8111-111111111111";
const episodeId = "22222222-2222-4222-8222-222222222222";
const blueprintVersionId = "33333333-3333-4333-8333-333333333333";
const seriesVersionId = "44444444-4444-4444-8444-444444444444";
const proposedPolicy = { asset_root: "/Volumes/repair", executors: { script_writing: { provider: "codex", model: "repair-model", prompt_version: "repair-v1" } } };

function queryResult(data: unknown) {
  const query = {
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    select: vi.fn(() => query),
  };
  return query;
}

function mockSupabaseClient() {
  const records: Record<string, unknown> = {
    account_memberships: { role: "owner" },
    accounts: { current_blueprint_version_id: blueprintVersionId },
    account_blueprint_versions: { is_active: true, policy: { asset_root: "/Volumes/database" } },
    episodes: { account_id: accountId, series_version_id: seriesVersionId },
    series_versions: { rules: { b_roll: { provider: "series-provider" } } },
  };
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null }) },
    from: vi.fn((table: string) => queryResult(records[table])),
  };
  mocks.createClient.mockReturnValue(client);
  return client;
}

function createControlPlaneServer(dependencies: LocalControlPlaneDependencies = {}) {
  const middleware = createLocalControlPlaneMiddleware({ supabaseUrl: "https://supabase.test", supabasePublishableKey: "publishable" }, dependencies);
  return createServer((request, response) => middleware(request, response, (error) => {
    response.statusCode = 500;
    response.end(error?.message ?? "Unhandled local control plane request");
  }));
}

describe("Episode 修复 preflight 路由", () => {
  beforeEach(() => {
    mocks.inspectPreflight.mockResolvedValue({ passed: true, issues: [], report: { checks: [], version: "worker-preflight/v2" } });
    mocks.createRuntimePreflight.mockReturnValue({ inspect: mocks.inspectPreflight });
  });
  afterEach(() => vi.clearAllMocks());

  it("蓝图预检只向运行前置条件模块提交业务 subject", async () => {
    const report = { checks: [], version: "worker-preflight/v2" };
    mocks.inspectPreflight.mockResolvedValue({ passed: true, issues: [], report });

    await expect(runtimePreflightForPolicy({}, null)).resolves.toEqual(report);

    expect(mocks.inspectPreflight).toHaveBeenCalledWith(expect.objectContaining({ kind: "account_blueprint", policy: {}, target: "new_episode" }));
  });

  it("创建生产单前不要求预先存在 episodes 目录", async () => {
    const originalMountPath = process.env.MEDIA_LIBRARY_MOUNT_PATH;
    const originalMinimumFreeBytes = process.env.MEDIA_LIBRARY_MIN_FREE_BYTES;
    process.env.MEDIA_LIBRARY_MOUNT_PATH = "/Volumes/media";
    process.env.MEDIA_LIBRARY_MIN_FREE_BYTES = "0";
    mocks.verifyMediaLibrary.mockResolvedValue({ availableBytes: 1, mountPath: "/Volumes/media" });
    mocks.createRuntimePreflight.mockImplementation((adapter) => ({
      inspect: async (subject: unknown) => {
        await adapter.collect({ subject, demands: [{ kind: "media_library", key: "worker_runtime" }] });
        return { passed: true, issues: [], report: { checks: [], version: "worker-preflight/v2" } };
      },
    }));

    try {
      await runtimePreflightForPolicy({ asset_root: "/Volumes/media/account" }, null);
      expect(mocks.verifyMediaLibrary).toHaveBeenCalledWith(expect.objectContaining({ requireEpisodesDirectory: false }));
    } finally {
      if (originalMountPath === undefined) delete process.env.MEDIA_LIBRARY_MOUNT_PATH;
      else process.env.MEDIA_LIBRARY_MOUNT_PATH = originalMountPath;
      if (originalMinimumFreeBytes === undefined) delete process.env.MEDIA_LIBRARY_MIN_FREE_BYTES;
      else process.env.MEDIA_LIBRARY_MIN_FREE_BYTES = originalMinimumFreeBytes;
      mocks.verifyMediaLibrary.mockReset();
    }
  });

  it("使用提交中的修复策略、Episode 的系列快照，并执行资产目录检查", async () => {
    mockSupabaseClient();
    const report = { version: "worker-preflight/v2", checks: [] };
    mocks.inspectPreflight.mockResolvedValue({ passed: true, issues: [], report });
    const server = createControlPlaneServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("测试服务器未监听端口。");

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/_episode-preflight`, {
        body: JSON.stringify({ accountId, blueprintVersionId, episodeId, policy: proposedPolicy, seriesVersionId: null }),
        headers: { Authorization: "Bearer owner-token", "Content-Type": "application/json" },
        method: "POST",
      });

      expect(response.status).toBe(200);
      expect(mocks.inspectPreflight).toHaveBeenCalledWith(expect.objectContaining({ policy: proposedPolicy, seriesRules: { b_roll: { provider: "series-provider" } }, requiredMediaCapabilities: [], target: "existing_episode" }));
      expect(await response.json()).toEqual({ preflight: report });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

describe("持久任务派发状态", () => {
  afterEach(() => vi.clearAllMocks());

  it("重复提交返回可查询的排队状态，执行器退出不能改写持久状态", async () => {
    const taskId = "55555555-5555-4555-8555-555555555555";
    const client = mockSupabaseClient();
    client.from.mockImplementation((table: string) => queryResult(table === "tasks" ? { id: taskId, status: "ready", created_at: "2026-10-23T10:00:00Z" } : table === "episodes" ? { account_id: accountId } : { role: "owner" }));
    const server = createControlPlaneServer({ dispatchTask: () => "started" });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("测试服务器未监听端口。");
    const url = `http://127.0.0.1:${address.port}/_episode-dispatch?episode=${episodeId}&task=${taskId}`;
    try {
      for (let i = 0; i < 2; i++) {
        const response = await fetch(url, { method: "POST", headers: { Authorization: "Bearer owner-token", Origin: new URL(url).origin } });
        expect(response.status).toBe(202);
        expect(await response.json()).toEqual(expect.objectContaining({ status: "queued", taskId, taskStatus: "ready", statusUrl: `/_episode-dispatch?episode=${episodeId}&task=${taskId}` }));
      }
      const status = await fetch(url, { headers: { Authorization: "Bearer owner-token" } });
      expect(await status.json()).toEqual(expect.objectContaining({ status: "queued", taskStatus: "ready" }));
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it.each([
    ["foreign origin", "owner", "ready", 403],
    ["missing origin", "owner", "ready", 403],
    ["forged host and origin", "owner", "ready", 403],
    ["viewer", "viewer", "ready", 403],
    ["completed duplicate", "owner", "completed", 200],
    ["launch failure", "owner", "ready", 500],
  ])("%s 不启动额外执行", async (scenario, role, taskStatus, expectedStatus) => {
    const taskId = "55555555-5555-4555-8555-555555555555";
    const client = mockSupabaseClient();
    client.from.mockImplementation((table: string) => queryResult(table === "tasks" ? { id: taskId, status: taskStatus, created_at: "2026-10-23T10:00:00Z" } : table === "episodes" ? { account_id: accountId } : role === "owner" ? { role } : null));
    const dispatch = vi.fn(() => { if (scenario === "launch failure") throw Error("Worker 配置不完整"); return "started" as const; });
    const server = createControlPlaneServer({ dispatchTask: dispatch });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("测试服务器未监听端口。");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/_episode-dispatch?episode=${episodeId}&task=${taskId}`, { method: "POST", headers: { Authorization: "Bearer owner-token", ...(scenario === "missing origin" ? {} : scenario === "foreign origin" ? { Origin: "https://other.test" } : scenario === "forged host and origin" ? { Origin: "http://other.test", Host: "other.test" } : { Origin: `http://127.0.0.1:${address.port}` }) } });
      expect(response.status).toBe(expectedStatus);
      if (scenario !== "launch failure") expect(dispatch).not.toHaveBeenCalled();
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it.each([
    ["ready", "queued"], ["running", "starting"], ["completed", "succeeded"], ["blocked", "failed"],
  ])("重建 HTTP 服务后仍可查询 %s 任务", async (taskStatus, status) => {
    const taskId = "55555555-5555-4555-8555-555555555555";
    const client = mockSupabaseClient();
    client.from.mockImplementation((table: string) => queryResult(table === "tasks" ? { id: taskId, status: taskStatus, created_at: "2026-10-23T10:00:00Z", completed_at: taskStatus === "completed" ? "2026-10-23T10:01:00Z" : null } : table === "episodes" ? { account_id: accountId } : { role: "owner" }));
    const server = createControlPlaneServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("测试服务器未监听端口。");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/_episode-dispatch?episode=${episodeId}&task=${taskId}`, { headers: { Authorization: "Bearer owner-token" } });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expect.objectContaining({ taskId, taskStatus, status }));
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
