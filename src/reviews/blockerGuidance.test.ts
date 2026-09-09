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
      expect.stringContaining("创建新的任务配置"),
    ]));
    expect(guidance.retryLabel).toBe("修正本机目录后重建任务");
    expect(guidance.primaryAction).toBeUndefined();
    expect(guidance.location).toBe("账号蓝图 → 本地资产与审批");
  });

  it("把媒体供应商不可用说明为凭据或网络问题", () => {
    const guidance = workerBlockerGuidance({ code: "media_provider_unavailable", detail: "测试媒体适配器未配置。" });

    expect(guidance.title).toBe("媒体供应商暂不可用");
    expect(guidance.summary).toContain("供应商适配器、凭据或网络");
    expect(guidance.retryLabel).toBe("供应商恢复后重建任务");
    expect(guidance.primaryAction).toBeUndefined();
    expect(guidance.location).toBe("Worker 运行环境 / 供应商凭据");
  });

  it("把可通过蓝图修正的专用媒体配置指向媒体适配器区域", () => {
    const guidance = workerBlockerGuidance({ code: "a_roll_executor_invalid", detail: "A-roll 配置缺少 adapter。" });

    expect(guidance.title).toBe("媒体适配器配置不完整");
    expect(guidance.primaryAction).toBe("blueprint");
    expect(guidance.location).toBe("当前生产单 → 专用媒体配置");
  });

  it("按结构化可修复目标指向媒体配置，不读取错误文案", () => {
    const guidance = workerBlockerGuidance({ action: "edit_blueprint", capability: "b_roll_generation", code: "blueprint_configuration", detail: "需要更新配置。" });

    expect(guidance.title).toBe("媒体适配器配置不完整");
    expect(guidance.primaryAction).toBe("blueprint");
  });

  it("不会把执行重试耗尽误导为配置修复", () => {
    const guidance = workerBlockerGuidance({ code: "a_roll_retries_exhausted", detail: "模型不支持当前账户。" });

    expect(guidance.primaryAction).toBeUndefined();
    expect(guidance.title).toBe("媒体任务执行已重试耗尽");
  });

  it("把确实尚未注册的媒体能力保留为系统阻塞", () => {
    const guidance = workerBlockerGuidance({ code: "a_roll_executor_unavailable", detail: "尚未注册可生成并验证视频输出的 A-roll 适配器。" });

    expect(guidance.title).toBe("当前媒体能力暂不可用");
    expect(guidance.summary).toContain("尚未注册可用的媒体适配器");
    expect(guidance.primaryAction).toBeUndefined();
    expect(guidance.location).toBe("系统能力 / Worker 适配器");
  });

  it("不会把专用媒体供应商不可用误导为配置修复", () => {
    const guidance = workerBlockerGuidance({ code: "a_roll_provider_unavailable", detail: "供应商凭据不可用。" });

    expect(guidance.primaryAction).toBeUndefined();
    expect(guidance.title).toBe("当前媒体能力暂不可用");
  });

  it("把 B-roll 供应商配置不匹配指向蓝图媒体适配器", () => {
    const guidance = workerBlockerGuidance({ code: "b_roll_executor_unavailable", detail: "当前仅注册 Pexels 视频适配器；配置必须精确声明 pexels/pexels_video/pexels-video-v1。" });

    expect(guidance.title).toBe("媒体适配器配置不完整");
    expect(guidance.primaryAction).toBe("blueprint");
    expect(guidance.location).toBe("当前生产单 → 专用媒体配置");
  });

  it("尊重结构化 preflight 的重试动作", () => {
    const guidance = workerBlockerGuidance({ code: "network_request", check: "network_connectivity", detail: "供应商连接暂时失败。", action: "retry" });

    expect(guidance.title).toBe("网络连接暂时失败");
    expect(guidance.retryLabel).toBe("网络恢复后重试当前任务");
    expect(guidance.primaryAction).toBeUndefined();
  });

  it.each([
    ["capability_registration", "Worker 能力未注册"],
    ["credential_presence", "Worker 凭据缺失"],
    ["credential_validity", "Worker 凭据无效"],
    ["model_permission", "模型权限不可用"],
    ["asset_root", "资产目录不可用"],
  ] as const)("按结构化检查码显示 %s", (check, title) => {
    expect(workerBlockerGuidance({ code: check, check, detail: "机器检查详情", action: "contact_environment_admin" }).title).toBe(title);
  });

  it("不把网络导致的模型探测未完成误报为权限已拒绝", () => {
    expect(workerBlockerGuidance({ code: "model_permission", check: "model_permission", detail: "模型权限探测未完成：网络超时。", status: "retryable", action: "retry" }).title).toBe("模型权限探测暂时失败");
  });

  it("不会把审核快照字幕契约错误误报为缺少前置产物", () => {
    const guidance = workerBlockerGuidance({ code: "task_package_invalid", detail: "确认快照缺少字幕文本。" });

    expect(guidance.title).toBe("Worker 字幕校验版本不一致");
    expect(guidance.location).toBe("Worker 运行环境 / 版本更新");
  });

  it("未知 code 也给出明确的人工处理路径，并保留技术原因", () => {
    const guidance = workerBlockerGuidance({ code: "unknown_blocker", detail: "内部错误" });

    expect(guidance.title).toBe("Worker 任务需要人工处理");
    expect(guidance.resolution).toHaveLength(3);
    expect(guidance.technicalDetail).toBe("内部错误");
    expect(guidance.location).toBe("技术详情 / Worker 运行环境");
  });
});
