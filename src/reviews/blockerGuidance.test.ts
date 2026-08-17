import { describe, expect, it } from "vitest";
import { workerBlockerGuidance } from "./blockerGuidance";

describe("Worker 阻塞项指导", () => {
  it("把资产目录工具问题翻译成可执行步骤", () => {
    const guidance = workerBlockerGuidance({
      code: "assets.allowedRoot",
      detail: "缺少任务要求的 read/write 工具，无法在 assets.allowedRoot 内创建 required artifact。",
    });

    expect(guidance.title).toBe("资产目录权限或路径配置有问题");
    expect(guidance.summary).toContain("无法在账号资产目录中创建必需产物");
    expect(guidance.resolution).toEqual(expect.arrayContaining([
      expect.stringContaining("read"),
      expect.stringContaining("asset_root"),
      expect.stringContaining("新的任务配置"),
    ]));
    expect(guidance.retryLabel).toBe("修正配置后创建新的任务");
  });

  it("把媒体供应商不可用说明为凭据或网络问题", () => {
    const guidance = workerBlockerGuidance({ code: "media_provider_unavailable", detail: "测试媒体适配器未配置。" });

    expect(guidance.title).toBe("媒体供应商暂不可用");
    expect(guidance.summary).toContain("供应商适配器、凭据或网络");
    expect(guidance.retryLabel).toBe("修正供应商配置后创建新的任务");
  });

  it("未知 code 也给出明确的人工处理路径，并保留技术原因", () => {
    const guidance = workerBlockerGuidance({ code: "unknown_blocker", detail: "内部错误" });

    expect(guidance.title).toBe("Worker 任务需要人工处理");
    expect(guidance.resolution).toHaveLength(3);
    expect(guidance.technicalDetail).toBe("内部错误");
  });
});
