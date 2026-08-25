// @vitest-environment node

import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createRuntimePreflight: vi.fn(),
  runtimeCapabilitiesFromBlueprintPolicy: vi.fn(),
  verifyMediaLibrary: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("./worker/mediaLibrary", () => ({ verifyMediaLibrary: mocks.verifyMediaLibrary }));
vi.mock("./worker/runtimePreflight", () => ({
  createRuntimePreflight: mocks.createRuntimePreflight,
  runtimeCapabilitiesFromBlueprintPolicy: mocks.runtimeCapabilitiesFromBlueprintPolicy,
  runtimeCommandArguments: vi.fn(() => ["--version"]),
}));
vi.mock("./worker/runtimeProbes", () => ({ probeCodexModel: vi.fn(), probeProviderConnection: vi.fn() }));

import { requiredMediaCapabilitiesFromTasks, serveEpisodePreflight } from "../vite.config";

const accountId = "11111111-1111-4111-8111-111111111111";
const episodeId = "22222222-2222-4222-8222-222222222222";
const blueprintVersionId = "33333333-3333-4333-8333-333333333333";
const seriesVersionId = "44444444-4444-4444-8444-444444444444";
const proposedPolicy = { asset_root: "/Volumes/repair", executors: { script_writing: { provider: "codex", model: "repair-model", prompt_version: "repair-v1" } } };

function queryResult(data: unknown) {
  const query = {
    eq: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    select: vi.fn(() => query),
    then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve(resolve({ data, error: null })),
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
    tasks: [],
  };
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null }) },
    from: vi.fn((table: string) => queryResult(records[table])),
  };
  mocks.createClient.mockReturnValue(client);
  return client;
}

describe("Episode 修复 preflight 路由", () => {
  afterEach(() => vi.clearAllMocks());

  it("使用提交中的修复策略、Episode 的系列快照，并执行资产目录检查", async () => {
    mockSupabaseClient();
    const report = { version: "worker-preflight/v1", checks: [] };
    mocks.runtimeCapabilitiesFromBlueprintPolicy.mockReturnValue([]);
    mocks.createRuntimePreflight.mockReturnValue(report);
    const server = createServer(serveEpisodePreflight("https://supabase.test", "publishable"));
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
      expect(mocks.runtimeCapabilitiesFromBlueprintPolicy).toHaveBeenCalledWith(proposedPolicy, { b_roll: { provider: "series-provider" } }, []);
      expect(mocks.createRuntimePreflight).toHaveBeenCalledWith([], expect.objectContaining({ assetRoot: expect.objectContaining({ available: false }) }));
      expect(await response.json()).toEqual({ preflight: report });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("只为未完成的真实外部媒体任务推导连接能力", () => {
    expect(requiredMediaCapabilitiesFromTasks([
      { task_type: "generate_b_roll", provider: "pexels", status: "blocked" },
      { task_type: "generate_soundtrack", provider: "manual_upload", status: "completed" },
      { task_type: "prepare_visual_brief", provider: "codex", status: "ready", input_snapshot: { visual_assets: { image_generation: { provider: "openai" } } } },
      { task_type: "prepare_visual_brief", provider: "codex", status: "ready", input_snapshot: { visual_assets: { image_generation: { provider: "manual_upload" } } } },
      { task_type: "generate_narration", provider: "google_tts", status: "completed" },
    ])).toEqual(["b_roll_generation", "static_visual_generation"]);
  });
});
