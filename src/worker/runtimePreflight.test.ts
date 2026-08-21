import { describe, expect, it } from "vitest";
import { createRuntimePreflight, runtimeCapabilitiesFromBlueprintPolicy } from "./runtimePreflight";

describe("runtime preflight", () => {
  it("从蓝图读取核心能力和已启用媒体能力", () => {
    const capabilities = runtimeCapabilitiesFromBlueprintPolicy({
      allowed_tools: ["read", "write"],
      executors: {
        script_writing: { provider: "codex", model: "model-1", prompt_version: "script-v1" },
        visual_planning: { provider: "codex", model: "model-1", prompt_version: "visual-v1" },
        storyboard_planning: { provider: "codex", model: "model-1", prompt_version: "storyboard-v1" },
      },
      narration: {
        allowed_tools: ["read", "write"],
        executor: { provider: "google_tts", adapter: "google_tts", model: "standard", prompt_version: "narration-v1" },
      },
    });

    expect(capabilities.map((capability) => capability.capability)).toEqual([
      "script_writing",
      "visual_planning",
      "storyboard_planning",
      "review_rendering",
      "final_rendering",
      "narration_generation",
    ]);
    expect(capabilities.at(-1)).toMatchObject({ credential: "GOOGLE_TTS_API_KEY" });
  });

  it("把真实运行态失败映射为结构化环境阻塞", () => {
    const result = createRuntimePreflight([
      {
        capability: "narration_generation",
        provider: "google_tts",
        adapter: "google_tts",
        model: "standard",
        promptVersion: "narration-v1",
        allowedTools: ["network", "write"],
        credential: "GOOGLE_TTS_API_KEY",
        command: "codex",
      },
    ], {
      credentials: { GOOGLE_TTS_API_KEY: false },
      commands: { codex: { available: false, detail: "codex 无法调用。" } },
      mediaLibrary: { available: false, detail: "媒体库未挂载。" },
    });

    expect(result.version).toBe("worker-preflight/v1");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ check: "capability_registration", status: "passed" }),
      expect.objectContaining({ check: "credential_presence", status: "unavailable", action: "contact_environment_admin" }),
      expect.objectContaining({ check: "command_availability", status: "unavailable", action: "contact_environment_admin" }),
      expect.objectContaining({ check: "media_library", status: "unavailable", action: "contact_environment_admin" }),
    ]));
  });

  it("把资产目录不可访问映射为独立的资产目录阻塞", () => {
    const result = createRuntimePreflight([], { assetRoot: { available: false, detail: "媒体库账号目录不可访问。" } });

    expect(result.checks).toContainEqual(expect.objectContaining({ capability: "worker_runtime", check: "asset_root", status: "unavailable", action: "contact_environment_admin" }));
  });

  it("忽略当前不可用的 A-roll 旧规则", () => {
    const capabilities = runtimeCapabilitiesFromBlueprintPolicy({
      a_roll: { executor: { provider: "codex", adapter: "codex", model: "blueprint-model", prompt_version: "blueprint-v1" }, allowed_tools: ["read", "write"] },
    }, {
      a_roll: { executor: { provider: "codex", adapter: "codex", model: "series-model", prompt_version: "series-v1" }, allowed_tools: ["read", "write"] },
    });

    expect(capabilities.some((capability) => capability.capability === "a_roll_generation")).toBe(false);
  });

  it("蓝图关闭时不被系列旧媒体规则重新启用", () => {
    const capabilities = runtimeCapabilitiesFromBlueprintPolicy({}, {
      b_roll: { executor: { provider: "pexels", adapter: "pexels_video", model: "series-model", prompt_version: "series-v1" } },
      narration: { executor: { provider: "google_tts", adapter: "google_tts", model: "series-model", prompt_version: "series-v1" } },
    });

    expect(capabilities.some((capability) => capability.capability === "b_roll_generation" || capability.capability === "narration_generation")).toBe(false);
  });

  it("媒体适配器不要求向蓝图工具白名单暴露 network", () => {
    const result = createRuntimePreflight([{
      capability: "b_roll_generation",
      provider: "pexels",
      adapter: "pexels_video",
      model: "pexels-video-v1",
      promptVersion: "b-roll-v1",
      allowedTools: ["read", "write"],
    }]);

    expect(result.checks).toContainEqual(expect.objectContaining({ capability: "b_roll_generation", check: "tool_permission", status: "passed" }));
  });

  it("不把未注册的 provider 当作可用运行路径", () => {
    const result = createRuntimePreflight([{ capability: "b_roll_generation", provider: "unknown", adapter: "unknown", model: "model", promptVersion: "v1", allowedTools: ["read", "write"] }]);

    expect(result.checks).toContainEqual(expect.objectContaining({ check: "capability_registration", status: "unavailable", action: "contact_environment_admin" }));
  });
});
