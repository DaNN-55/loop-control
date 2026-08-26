import { describe, expect, it } from "vitest";
import { localStartupReport, startupEnvironment } from "./start-local.mjs";

describe("本地启动检查", () => {
  it("检查 HyperFrames 与媒体根，并明确 n8n 未自动启动", () => {
    expect(localStartupReport({ hyperframesAvailable: true, mediaLibraryMounted: true, mediaLibraryPath: "/Volumes/Media", n8nRunning: false })).toEqual([
      "HyperFrames：正常",
      "媒体根：正常（/Volumes/Media）",
      "n8n：未启动（本命令不会自动启动）",
    ]);
  });

  it("只读取启动检查所需的非秘密变量", () => {
    expect(startupEnvironment("MEDIA_LIBRARY_MOUNT_PATH='/Volumes/Media'\nN8N_PORT=5678\nSUPABASE_SERVICE_ROLE_KEY=secret\nPEXELS_API_KEY=secret")).toEqual({
      MEDIA_LIBRARY_MOUNT_PATH: "/Volumes/Media",
      N8N_PORT: "5678",
    });
  });
});
