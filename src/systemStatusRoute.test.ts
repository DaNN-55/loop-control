// @vitest-environment node
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), execFile: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("node:child_process", async (original) => ({ ...await original<typeof import("node:child_process")>(), execFile: mocks.execFile }));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, readFileSync: (...args: Parameters<typeof actual.readFileSync>) => String(args[0]).endsWith("n8n/worker.env.local") ? 'OPENCHATCUT_ROOT="/isolated/media tools/OpenChatCut"\nOPENCHATCUT_NODE=/isolated/node24\n' : actual.readFileSync(...args) };
});
vi.mock("node:sqlite", () => ({ DatabaseSync: class { constructor() { throw new Error("No test execution database"); } } }));
vi.mock("./observability/systemStatusEvidence", async (original) => ({
  ...await original<typeof import("./observability/systemStatusEvidence")>(),
  ExpiringProbeCache: class { read(_key: string, fallback: unknown) { return fallback; } },
}));

import { serveSystemStatus } from "./local-control-plane/routes/handlers";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("直接启动控制台时，状态探测把当前 Worker 配置的根目录传给 OpenChatCut 子进程", async () => {
  vi.stubEnv("OPENCHATCUT_ROOT", "");
  vi.stubEnv("OPENCHATCUT_NODE", "");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  const memberships = { select: () => memberships, eq: () => memberships, limit: async () => ({ data: [{ account_id: "account" }], error: null }) };
  const blueprints = { select: () => blueprints, eq: () => blueprints, is: async () => ({ data: [], error: null }) };
  mocks.createClient.mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) }, from: (table: string) => table === "account_memberships" ? memberships : blueprints });
  mocks.execFile.mockImplementation((command: string, args: string[], optionsOrCallback: unknown, callback?: (error: Error | null, result?: unknown) => void) => {
    const done = (typeof optionsOrCallback === "function" ? optionsOrCallback : callback) as NonNullable<typeof callback>;
    const options = typeof optionsOrCallback === "object" && optionsOrCallback ? optionsOrCallback as { env?: NodeJS.ProcessEnv } : {};
    const isOpenChatCut = args.includes("scripts/openchatcut-render.mjs");
    if (isOpenChatCut && options.env?.OPENCHATCUT_ROOT !== "/isolated/media tools/OpenChatCut") done(new Error("缺少 OPENCHATCUT_ROOT。"));
    else done(null, { stdout: isOpenChatCut ? "openchatcut@0.2.14\n" : `${command} version\n`, stderr: "" });
  });
  let body = "";
  const response = { setHeader: vi.fn(), end: (value: string) => { body = value; }, statusCode: 0 };
  await serveSystemStatus("https://supabase.test", "publishable")({ method: "GET", headers: { authorization: "Bearer owner-token" } } as IncomingMessage, response as unknown as ServerResponse);
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(body).dependencies).toContainEqual({ name: "OpenChatCut", state: "healthy", detail: "openchatcut@0.2.14" });
  expect(process.env.OPENCHATCUT_ROOT).toBe("");
});
