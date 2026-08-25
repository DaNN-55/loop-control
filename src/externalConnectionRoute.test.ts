// @vitest-environment node

import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  probeProviderConnection: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("./worker/runtimeProbes", () => ({ probeProviderConnection: mocks.probeProviderConnection }));

import { serveExternalConnectionTest } from "../vite.config";

describe("外部连接测试路由", () => {
  afterEach(() => vi.clearAllMocks());

  it("只返回非秘密验证结果", async () => {
    const secret = "pexels-secret-value";
    const connection = { adapter: "pexels_video", created_at: "2026-08-25T00:00:00.000Z", created_by: "owner-1", current_version_id: "22222222-2222-4222-8222-222222222222", id: "11111111-1111-4111-8111-111111111111", last_verification_detail: null, last_verified_at: null, name: "主 Pexels", provider: "pexels", status: "unverified" };
    const ownerQuery = { eq: vi.fn(() => ownerQuery), maybeSingle: vi.fn().mockResolvedValue({ data: connection, error: null }), select: vi.fn(() => ownerQuery) };
    const ownerClient = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null }) }, from: vi.fn(() => ownerQuery) };
    const serviceClient = { rpc: vi.fn((name: string) => name === "resolve_external_connection_secret" ? Promise.resolve({ data: secret, error: null }) : Promise.resolve({ data: { ...connection, status: "invalid", last_verification_detail: "凭据被拒绝：[已隐藏]" }, error: null })) };
    mocks.createClient.mockImplementation((_url: string, key: string) => key === "service-key" ? serviceClient : ownerClient);
    mocks.probeProviderConnection.mockResolvedValue({ connection: { available: true, detail: "网络已连通" }, credentialValidity: { available: false, status: "unavailable", detail: `凭据 ${secret} 被拒绝。` } });

    const request = Readable.from([JSON.stringify({ connectionId: connection.id })]) as never;
    Object.assign(request, { headers: { authorization: "Bearer owner-token" }, method: "POST", url: "/_external-connection-test" });
    const response = { body: "", headers: new Map<string, string>(), statusCode: 0, end(value?: string) { this.body = value ?? ""; }, setHeader(name: string, value: string) { this.headers.set(name, value); } };
    await serveExternalConnectionTest("https://supabase.test", "publishable", "service-key")(request, response as never);
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(secret);
    expect(response.body).toContain("invalid");
    expect(serviceClient.rpc).toHaveBeenCalledWith("resolve_external_connection_secret", { p_connection_id: connection.current_version_id });
    expect(serviceClient.rpc).toHaveBeenCalledWith("record_external_connection_verification", expect.objectContaining({ p_status: "invalid" }));
  });
});
