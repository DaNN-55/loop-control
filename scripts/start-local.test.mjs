import { describe, expect, it, vi } from "vitest";
import { assertOpenChatCutAvailable, assertPublicEnvironment, assertSupabaseConnection, consoleHealthUrl, localStartupReport, missingRequiredWorkflowIds, n8nHealthUrl, n8nHealthy, recordedProjectServiceHealthy, resolveLocalServicePort, resolveStartupPorts, startupEnvironment } from "./start-local.mjs";

describe("本地启动", () => {
  it("只读取非秘密运行变量，并拒绝把 Worker 密钥放进前端环境", () => {
    expect(startupEnvironment("MEDIA_LIBRARY_MOUNT_PATH='/Volumes/Media'\nN8N_PORT=5678\nN8N_RUNNERS_BROKER_PORT=5679\nOPENCHATCUT_ROOT='/opt/OpenChatCut'\nOPENCHATCUT_NODE='/opt/node24'\nSUPABASE_SERVICE_ROLE_KEY=secret")).toEqual({ MEDIA_LIBRARY_MOUNT_PATH: "/Volumes/Media", N8N_PORT: "5678", N8N_RUNNERS_BROKER_PORT: "5679", OPENCHATCUT_ROOT: "/opt/OpenChatCut", OPENCHATCUT_NODE: "/opt/node24" });
    expect(() => assertPublicEnvironment("VITE_SUPABASE_URL=https://example.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=public\nSUPABASE_SERVICE_ROLE_KEY=secret")).toThrow("Worker 密钥");
    expect(() => assertPublicEnvironment("VITE_SUPABASE_URL=https://example.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=public\nVITE_SUPABASE_SERVICE_ROLE_KEY=secret")).toThrow("Worker 密钥");
  });

  it("启动完成后只输出实际入口和关键依赖结论", () => {
    expect(localStartupReport({ mediaLibraryMounted: true, mediaLibraryPath: "/Volumes/Media", n8nUrl: "http://127.0.0.1:5678/", openChatCutAvailable: true })).toEqual(["Loop Control 已启动", "运行时：Loop Control、OpenChatCut、n8n 统一使用 Homebrew Node 24。", "控制台：http://127.0.0.1:5173/", "n8n：http://127.0.0.1:5678/", "  任务派发工作流已启用", "  审核提醒工作流已启用", "  状态变更提醒工作流已启用", "  每日健康检查工作流已启用", "Supabase：API 可达，前端公开配置有效；数据权限在登录后由会话/RLS 验证", "OpenChatCut：可用", "媒体库：已挂载（/Volumes/Media）"]);
    expect(localStartupReport({ mediaLibraryMounted: false, mediaLibraryPath: "/Volumes/Missing", n8nUrl: "http://127.0.0.1:5678/", openChatCutAvailable: true })).toContain("媒体库：不可用");
  });

  it("默认端口由本项目健康标识占用时复用", async () => {
    const projectHealthy = vi.fn().mockResolvedValue(true);
    const portAvailable = vi.fn();
    await expect(resolveLocalServicePort({ preferredPort: "5173", projectHealthy, portAvailable })).resolves.toEqual({ port: "5173", reused: true });
    expect(portAvailable).not.toHaveBeenCalled();
    expect(consoleHealthUrl("5173")).toBe("http://127.0.0.1:5173/loop-control-health.txt");
    expect(n8nHealthUrl("5678")).toBe("http://127.0.0.1:5678/healthz");
  });

  it("默认端口被其他进程占用时改用空闲端口", async () => {
    const projectHealthy = vi.fn().mockResolvedValue(false);
    const portAvailable = vi.fn().mockResolvedValue(false);
    const findAvailablePort = vi.fn().mockResolvedValue(5174);
    await expect(resolveLocalServicePort({ preferredPort: "5173", projectHealthy, portAvailable, findAvailablePort })).resolves.toEqual({ port: "5174", reused: false });
    expect(findAvailablePort).toHaveBeenCalledWith(5174);
  });

  it("只把有本项目服务记录且健康响应正确的 n8n 视为可复用实例", async () => {
    const healthCheck = vi.fn().mockResolvedValue(true);
    await expect(recordedProjectServiceHealthy({ name: "n8n", port: "5678", commandIdentity: "n8n/bin/n8n", healthCheck, findRecordedService: vi.fn().mockReturnValue(null) })).resolves.toBe(false);
    expect(healthCheck).not.toHaveBeenCalled();
    await expect(recordedProjectServiceHealthy({ name: "n8n", port: "5678", commandIdentity: "n8n/bin/n8n", healthCheck, findRecordedService: vi.fn().mockReturnValue({ pid: 123 }) })).resolves.toBe(true);
    await expect(n8nHealthy("http://example.test/healthz", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200, headers: { "content-type": "application/json" } })))).resolves.toBe(true);
    await expect(n8nHealthy("http://example.test/healthz", vi.fn().mockResolvedValue(new Response("<html>n8n editor</html>", { status: 200, headers: { "content-type": "text/html" } })))).resolves.toBe(false);
  });

  it("为第二个服务排除第一个服务已经选择的端口", async () => {
    const findAvailablePort = vi.fn().mockResolvedValueOnce(5174).mockResolvedValueOnce(5175);
    await expect(resolveLocalServicePort({ preferredPort: "5173", projectHealthy: vi.fn(), portAvailable: vi.fn(), findAvailablePort, excludedPorts: ["5173", "5174"] })).resolves.toEqual({ port: "5175", reused: false });
    expect(findAvailablePort).toHaveBeenNthCalledWith(1, 5174);
    expect(findAvailablePort).toHaveBeenNthCalledWith(2, 5175);
  });

  it("控制台和 n8n 的备用端口都避开 n8n Task Broker 端口", async () => {
    const findAvailablePort = vi.fn(async (port) => port);
    await expect(resolveStartupPorts({
      requestedConsolePort: "5173",
      requestedN8nPort: "5678",
      taskBrokerPort: "5679",
      consoleProjectHealthy: vi.fn().mockResolvedValue(false),
      n8nProjectHealthy: vi.fn().mockResolvedValue(false),
      portAvailable: vi.fn().mockResolvedValue(false),
      findAvailablePort,
    })).resolves.toEqual({
      consolePort: { port: "5174", reused: false },
      n8nPort: { port: "5680", reused: false },
    });
    expect(findAvailablePort).toHaveBeenCalledWith(5679);
    expect(findAvailablePort).toHaveBeenCalledWith(5680);
  });

  it("只把运行实例中启用的四条必需工作流当作启动前提", () => {
    expect(missingRequiredWorkflowIds("Cy50xRCgT2cj4WT4\nfFvOzmKS4OAMTcjd\nBxXyfBbkS49QMTEv\nBhEqokY531BBg64d\n")).toEqual([]);
    expect(missingRequiredWorkflowIds("Cy50xRCgT2cj4WT4\nunrelated-active-workflow\n")).toEqual(["fFvOzmKS4OAMTcjd", "BxXyfBbkS49QMTEv", "BhEqokY531BBg64d"]);
  });

  it("只用公开配置探测 Supabase 连接，并说明错误原因", async () => {
    const environment = "VITE_SUPABASE_URL=https://example.supabase.co/\nVITE_SUPABASE_PUBLISHABLE_KEY=public";
    const request = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(assertSupabaseConnection(environment, request)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith("https://example.supabase.co/auth/v1/settings", expect.objectContaining({ headers: { apikey: "public" } }));
    await expect(assertSupabaseConnection(environment, vi.fn().mockResolvedValue(new Response("", { status: 401 })))).rejects.toThrow("公开配置验证失败（HTTP 401）");
  });

  it("保留 OpenChatCut 真实校验的具体缺项，而非归并为通用可用状态", () => {
    const run = vi.fn().mockReturnValue({ status: 1, stderr: "OpenChatCut 不可用：\n- 缺少渲染 HTML 入口 index.html。", stdout: "" });
    expect(() => assertOpenChatCutAvailable(process.execPath, run)).toThrow("缺少渲染 HTML 入口 index.html");
    expect(run).toHaveBeenCalledWith(process.execPath, expect.arrayContaining(["--version"]), expect.objectContaining({ encoding: "utf8" }));
  });
});
