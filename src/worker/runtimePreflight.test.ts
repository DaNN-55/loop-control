import { describe, expect, it } from "vitest";
import { mediaCapabilityForKey, mediaCapabilityKeys } from "./adapterRegistry";
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
        credential_ref: "google-tts-default",
        allowed_tools: ["read", "write"],
        executor: { provider: "google_tts", adapter: "google_tts", model: "standard", prompt_version: "narration-v1" },
      },
    });

    expect(capabilities.map((capability) => capability.capability)).toEqual([
      "visual_planning",
      "storyboard_planning",
      "review_rendering",
      "final_rendering",
      "narration_generation",
    ]);
    expect(capabilities.at(-1)).toMatchObject({ credentialRef: "google-tts-default", credential: "GOOGLE_TTS_API_KEY" });
  });

  it("分镜必须冻结已注册的 Codex Adapter 与 Prompt Harness", () => {
    const blocked = runtimeCapabilitiesFromBlueprintPolicy({
      allowed_tools: ["read", "write"],
      executors: { storyboard_planning: { provider: "codex", model: "gpt-5.6-luna", prompt_version: "storyboard-planning-v1" } },
    }).find((capability) => capability.capability === "storyboard_planning");
    const configured = runtimeCapabilitiesFromBlueprintPolicy({
      allowed_tools: ["read", "write"],
      executors: { storyboard_planning: { provider: "codex", adapter: "codex", harness_id: "harness-1", model: "gpt-5.6-luna", prompt_version: "storyboard-planning-v2" } },
    }).find((capability) => capability.capability === "storyboard_planning");

    expect(createRuntimePreflight([blocked!]).checks).toContainEqual(expect.objectContaining({ capability: "storyboard_planning", check: "blueprint_configuration", status: "blocked", action: "edit_blueprint" }));
    expect(configured).toMatchObject({ adapter: "codex", promptHarnessId: "harness-1" });
    expect(createRuntimePreflight([configured!]).checks).toContainEqual(expect.objectContaining({ capability: "storyboard_planning", check: "capability_registration", status: "passed" }));
  });

  it("视觉准备与分镜共用 Adapter 和 Prompt Harness 要求", () => {
    const visual = runtimeCapabilitiesFromBlueprintPolicy({
      allowed_tools: ["read", "write"],
      executors: { visual_planning: { provider: "codex", model: "gpt-5.6-luna", prompt_version: "storyboard-planning-v1" } },
    }).find((capability) => capability.capability === "visual_planning");

    expect(createRuntimePreflight([visual!]).checks).toContainEqual(expect.objectContaining({ capability: "visual_planning", check: "blueprint_configuration", status: "blocked", action: "edit_blueprint" }));
  });

  it("用注册目录解析 Pexels 的非秘密连接引用", () => {
    const [capability] = runtimeCapabilitiesFromBlueprintPolicy({
      b_roll: {
        credential_ref: "pexels-default",
        executor: { provider: "pexels", adapter: "pexels_video", model: "pexels-video-v1", prompt_version: "b-roll-v1" },
        allowed_tools: ["read", "write"],
      },
    }).filter((candidate) => candidate.capability === "b_roll_generation");

    expect(capability).toMatchObject({ adapter: "pexels_video", credentialRef: "pexels-default", credential: "PEXELS_API_KEY" });
  });

  it("把未写 credential_ref 的 Pexels 蓝图标记为配置缺失", () => {
    const [capability] = runtimeCapabilitiesFromBlueprintPolicy({
      b_roll: {
        executor: { provider: "pexels", adapter: "pexels_video", model: "pexels-video-v1", prompt_version: "b-roll-v1" },
        allowed_tools: ["read", "write"],
      },
    }).filter((candidate) => candidate.capability === "b_roll_generation");

    expect(capability).not.toHaveProperty("credentialRef");
    expect(capability).not.toHaveProperty("credential");
    expect(createRuntimePreflight([capability]).checks).toContainEqual(expect.objectContaining({ check: "blueprint_configuration", status: "blocked", action: "edit_blueprint" }));
  });

  it("把未写连接引用的旁白和配乐标记为蓝图配置缺失", () => {
    const capabilities = runtimeCapabilitiesFromBlueprintPolicy({
      narration: { executor: { provider: "google_tts", adapter: "google_tts", model: "standard", prompt_version: "narration-v1" }, allowed_tools: ["read", "write"] },
      soundtrack: { executor: { provider: "freesound", adapter: "freesound_preview", model: "freesound-preview-v1", prompt_version: "soundtrack-v1" }, allowed_tools: ["read", "write"] },
    });

    expect(createRuntimePreflight(capabilities).checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "narration_generation", check: "blueprint_configuration", status: "blocked" }),
      expect.objectContaining({ capability: "soundtrack_generation", check: "blueprint_configuration", status: "blocked" }),
    ]));
  });

  it("把真实运行态失败映射为结构化环境阻塞", () => {
    const result = createRuntimePreflight([
      {
        capability: "narration_generation",
        provider: "google_tts",
        adapter: "google_tts",
        credentialRef: "google-tts-default",
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

    expect(result.version).toBe("worker-preflight/v2");
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

  it("保留真实模型权限和网络探测的独立结果", () => {
    const result = createRuntimePreflight([{
      capability: "script_writing",
      provider: "codex",
      model: "gpt-5.6-codex",
      promptVersion: "script-v1",
      allowedTools: ["read", "write"],
    }], {
      modelPermissions: { "gpt-5.6-codex": { available: false, status: "unavailable", detail: "模型账户无权访问。" } },
      connections: { codex: { available: false, status: "retryable", detail: "模型服务连接超时。" } },
    });

    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ check: "model_permission", status: "unavailable", action: "contact_environment_admin" }),
      expect.objectContaining({ check: "network_connectivity", status: "retryable", action: "retry" }),
    ]));
  });

  it("区分凭据存在和凭据有效性", () => {
    const result = createRuntimePreflight([{
      capability: "narration_generation",
      provider: "google_tts",
      adapter: "google_tts",
      credentialRef: "google-tts-default",
      model: "standard",
      promptVersion: "narration-v1",
      allowedTools: ["read", "write"],
      credential: "GOOGLE_TTS_API_KEY",
    }], {
      credentials: { GOOGLE_TTS_API_KEY: true },
      credentialValidity: { GOOGLE_TTS_API_KEY: { available: false, detail: "Google TTS 拒绝凭据。" } },
    });

    expect(result.checks).toContainEqual(expect.objectContaining({ check: "credential_presence", status: "passed" }));
    expect(result.checks).toContainEqual(expect.objectContaining({ check: "credential_validity", status: "unavailable", action: "contact_environment_admin" }));
  });

  it("将已启用的五项生产能力纳入预检，并把空草稿标为可编辑阻塞", () => {
    const capabilities = runtimeCapabilitiesFromBlueprintPolicy({
      static_visual: {},
      a_roll: {},
      b_roll: {},
      narration: {},
      soundtrack: {},
    });

    expect(capabilities.map((capability) => capability.capability)).toEqual(expect.arrayContaining(mediaCapabilityKeys.map((key) => mediaCapabilityForKey(key).capability)));
    expect(createRuntimePreflight(capabilities).checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "static_visual_generation", check: "blueprint_configuration", status: "blocked", action: "edit_blueprint", scope: "blueprint" }),
      expect.objectContaining({ capability: "a_roll_generation", check: "blueprint_configuration", status: "blocked", action: "edit_blueprint", scope: "blueprint" }),
    ]));
  });

  it("不会把 Codex 的规划 Adapter 误当成可执行的 A-roll Adapter", () => {
    const capabilities = runtimeCapabilitiesFromBlueprintPolicy({
      allowed_tools: ["read", "write"],
      a_roll: { executor: { provider: "codex", adapter: "codex", model: "video-generation-v1", prompt_version: "a-roll-v1" } },
    });

    expect(createRuntimePreflight(capabilities).checks).toContainEqual(expect.objectContaining({ capability: "a_roll_generation", check: "capability_registration", status: "unavailable" }));
  });

  it("蓝图关闭时不被系列旧媒体规则重新启用", () => {
    const capabilities = runtimeCapabilitiesFromBlueprintPolicy({}, {
      b_roll: { executor: { provider: "pexels", adapter: "pexels_video", model: "series-model", prompt_version: "series-v1" } },
      narration: { executor: { provider: "google_tts", adapter: "google_tts", model: "series-model", prompt_version: "series-v1" } },
    });

    expect(capabilities.some((capability) => capability.capability === "b_roll_generation" || capability.capability === "narration_generation")).toBe(false);
  });

  it("忽略系列中的 B-roll 执行覆盖", () => {
    const [capability] = runtimeCapabilitiesFromBlueprintPolicy({
      b_roll: {
        credential_ref: "pexels-default",
        executor: { provider: "pexels", adapter: "pexels_video", model: "pexels-video-v1", prompt_version: "b-roll-v1" },
        allowed_tools: ["read", "write"],
      },
    }, {
      b_roll: {
        credential_ref: "other-connection",
        executor: { provider: "other", adapter: "other", model: "other", prompt_version: "other" },
      },
    }).filter((candidate) => candidate.capability === "b_roll_generation");

    expect(capability).toMatchObject({ provider: "pexels", adapter: "pexels_video", credentialRef: "pexels-default" });
  });

  it("媒体适配器不要求向蓝图工具白名单暴露 network", () => {
    const result = createRuntimePreflight([{
      capability: "b_roll_generation",
      provider: "pexels",
      adapter: "pexels_video",
      credentialRef: "pexels-default",
      model: "pexels-video-v1",
      promptVersion: "b-roll-v1",
      allowedTools: ["read", "write"],
    }]);

    expect(result.checks).toContainEqual(expect.objectContaining({ capability: "b_roll_generation", check: "tool_permission", status: "passed" }));
  });

  it("Freesound 使用 Worker 网络探测而非蓝图 network 工具", () => {
    const result = createRuntimePreflight([{
      capability: "soundtrack_generation",
      provider: "freesound",
      adapter: "freesound_preview",
      credentialRef: "freesound-default",
      model: "freesound-preview-v1",
      promptVersion: "soundtrack-v1",
      allowedTools: ["read", "write"],
    }]);

    expect(result.checks).toContainEqual(expect.objectContaining({ capability: "soundtrack_generation", check: "tool_permission", status: "passed" }));
  });

  it("Freesound 不会绕过账号冻结的工具白名单", () => {
    const [capability] = runtimeCapabilitiesFromBlueprintPolicy({
      soundtrack: {
        credential_ref: "freesound-default",
        executor: { provider: "freesound", adapter: "freesound_preview", model: "freesound-preview-v1", prompt_version: "soundtrack-v1" },
        allowed_tools: ["read"],
      },
    }).filter((candidate) => candidate.capability === "soundtrack_generation");

    expect(createRuntimePreflight([capability]).checks).toContainEqual(expect.objectContaining({ capability: "soundtrack_generation", check: "tool_permission", status: "blocked", action: "edit_blueprint" }));
  });

  it("不把未注册的 provider 当作可用运行路径", () => {
    const result = createRuntimePreflight([{ capability: "b_roll_generation", provider: "unknown", adapter: "unknown", model: "model", promptVersion: "v1", allowedTools: ["read", "write"] }]);

    expect(result.checks).toContainEqual(expect.objectContaining({ check: "capability_registration", status: "unavailable", action: "contact_environment_admin" }));
  });
});
