import { describe, expect, it, vi } from "vitest";
import { probeCodexModel, probeProviderConnection } from "./runtimeProbes";

describe("runtime probes", () => {
  it("使用当前 Codex CLI 的只读探测参数", async () => {
    const command = vi.fn().mockResolvedValue({ stdout: "READY", stderr: "" });

    await probeCodexModel("gpt-5.6-codex", command, "/tmp");

    expect(command).toHaveBeenCalledWith("codex", expect.arrayContaining(["exec", "--sandbox", "read-only"]), { timeoutMs: 30_000 });
    expect(command.mock.calls[0][1]).not.toContain("--ask-for-approval");
    expect(command.mock.calls[0][1]).not.toContain("--approve-for-me");
  });

  it("用真实 Codex 命令区分模型权限失败和网络失败", async () => {
    const permission = await probeCodexModel("gpt-5.6-codex", async () => { throw new Error("403 model access denied"); }, "/tmp");
    expect(permission).toEqual({
      connection: { available: true, detail: "已连接模型服务，但模型权限探测被拒绝。" },
      modelPermission: { available: false, status: "unavailable", detail: "模型 gpt-5.6-codex 无权访问：403 model access denied" },
    });

    const network = await probeCodexModel("gpt-5.6-codex", async () => { throw new Error("fetch failed: ETIMEDOUT"); }, "/tmp");
    expect(network.connection).toMatchObject({ available: false, status: "retryable" });
    expect(network.modelPermission).toMatchObject({ available: false, status: "retryable" });
  });

  it("把供应商 HTTP 认证失败与网络失败分开", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const credential = await probeProviderConnection("pexels", "api-key", fetcher);
    expect(credential).toEqual({
      connection: { available: true, detail: "pexels 网络已连通，但供应商拒绝了 Worker 请求。" },
      credentialValidity: { available: false, status: "unavailable", detail: "pexels 凭据被供应商拒绝：HTTP 401。" },
    });

    const network = await probeProviderConnection("pexels", "api-key", vi.fn().mockRejectedValue(new Error("fetch failed")));
    expect(network.connection).toMatchObject({ available: false, status: "retryable" });
  });
});
