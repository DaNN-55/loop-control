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

import { runtimePreflightForPolicy, serveEpisodePreflight } from "../vite.config";

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

describe("Episode 修复 preflight 路由", () => {
  afterEach(() => vi.clearAllMocks());

  it("创建生产单前不要求预先存在 episodes 目录", async () => {
    const originalMountPath = process.env.MEDIA_LIBRARY_MOUNT_PATH;
    const originalMinimumFreeBytes = process.env.MEDIA_LIBRARY_MIN_FREE_BYTES;
    process.env.MEDIA_LIBRARY_MOUNT_PATH = "/Volumes/media";
    process.env.MEDIA_LIBRARY_MIN_FREE_BYTES = "0";
    mocks.runtimeCapabilitiesFromBlueprintPolicy.mockReturnValue([]);
    mocks.verifyMediaLibrary.mockResolvedValue({ availableBytes: 1, mountPath: "/Volumes/media" });
    mocks.createRuntimePreflight.mockReturnValue({ checks: [], version: "worker-preflight/v1" });

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
      expect(mocks.runtimeCapabilitiesFromBlueprintPolicy).toHaveBeenCalledWith(proposedPolicy, { b_roll: { provider: "series-provider" } });
      expect(mocks.createRuntimePreflight).toHaveBeenCalledWith([], expect.objectContaining({ assetRoot: expect.objectContaining({ available: false }) }));
      expect(await response.json()).toEqual({ preflight: report });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
