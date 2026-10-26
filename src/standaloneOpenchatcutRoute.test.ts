// @vitest-environment node
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), open: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("./worker/openchatcutStudio", async (original) => ({ ...await original<typeof import("./worker/openchatcutStudio")>(), openStandaloneOpenChatCutStudio: mocks.open }));
import { serveOpenStandaloneOpenChatCut } from "./local-control-plane/routes/handlers";

afterEach(() => vi.clearAllMocks());

async function request(method: string, authorization?: string) {
  let contents = "";
  const response = { statusCode: 0, setHeader: vi.fn(), end: (value = "") => { contents = value; } };
  await serveOpenStandaloneOpenChatCut("https://supabase.test", "publishable")({ method, headers: { authorization } } as IncomingMessage, response as unknown as ServerResponse);
  return { status: response.statusCode, contents };
}

it("独立剪辑入口在未登录或方法错误时不启动服务", async () => {
  expect((await request("GET")).status).toBe(405);
  expect((await request("POST")).status).toBe(401);
  expect(mocks.open).not.toHaveBeenCalled();
});

it.each([false, true])("仅 Owner 可打开按身份隔离的持久工作区：Owner=%s", async (isOwner) => {
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const query = { select: () => query, eq: vi.fn(() => query), limit: async () => ({ data: isOwner ? [{ account_id: "account" }] : [], error: null }) };
  mocks.createClient.mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: ownerId } }, error: null }) }, from: vi.fn(() => query) });
  mocks.open.mockResolvedValue({ studioUrl: "http://127.0.0.1:54001/" });
  const result = await request("POST", "Bearer owner-token");
  expect(result.status).toBe(isOwner ? 201 : 403);
  expect(query.eq).toHaveBeenCalledWith("role", "owner");
  if (isOwner) {
    expect(mocks.open).toHaveBeenCalledWith(resolve(".loop-control", "openchatcut", "standalone", ownerId), expect.any(Object));
    expect(JSON.parse(result.contents)).toEqual({ studioUrl: "http://127.0.0.1:54001/" });
  } else expect(mocks.open).not.toHaveBeenCalled();
});
