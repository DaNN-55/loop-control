import { describe, expect, it } from "vitest";
import { adapterRegistration, availableExecutionPathsForCapability, externalAdapterForMediaCapability, localAdapterRegistrationsForCapability, mediaCapabilityForKey, mediaCapabilityKeys, readyLocalAdapterRegistrations, registeredAdaptersForCapability, type LocalAdapterRegistration } from "./adapterRegistry";

describe("adapter registry", () => {
  it("集中五项可选生产能力的标识与展示事实", () => {
    expect(mediaCapabilityKeys.map((key) => [key, mediaCapabilityForKey(key).capability])).toEqual([
      ["static_visual", "static_visual_generation"],
      ["a_roll", "a_roll_generation"],
      ["b_roll", "b_roll_generation"],
      ["narration", "narration_generation"],
      ["soundtrack", "soundtrack_generation"],
    ]);
    expect(mediaCapabilityForKey("a_roll")).toMatchObject({ label: "A-roll", requiresRegisteredAdapter: false });
    expect(mediaCapabilityForKey("b_roll")).toMatchObject({ configurationFields: ["max_attempts", "max_concurrency", "provider_max_concurrency"], requiresRegisteredAdapter: true, registeredAdapter: { id: "pexels_video" } });
  });

  it("为分镜规划登记 Codex Adapter 与 Harness 配置契约", () => {
    expect(registeredAdaptersForCapability("storyboard_planning")).toEqual([
      expect.objectContaining({ id: "codex", provider: "codex", connectionType: "none", requiresNetwork: false, configurationFields: ["model", "prompt_harness"] }),
    ]);
    expect(adapterRegistration("codex", "codex")?.capability).toBe("storyboard_planning");
  });

  it("查询 B-roll 目录时分开返回 Pexels 与本地 HyperFrames 卡片执行契约", () => {
    expect(registeredAdaptersForCapability("b_roll_generation")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "pexels_video",
        provider: "pexels",
        connectionType: "pexels_api",
        requiresNetwork: true,
        configurationFields: ["max_attempts", "max_concurrency", "provider_max_concurrency"],
      }),
    ]));
    expect(localAdapterRegistrationsForCapability("b_roll_generation")).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "hyperframes_card_video", provider: "hyperframes" }),
    ]));
    expect(adapterRegistration("pexels", "pexels_video")?.connections).toEqual([]);
  });

  it("A-roll 的本地卡片视频不需要外部连接", () => {
    expect(localAdapterRegistrationsForCapability("a_roll_generation")).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "hyperframes_card_video", provider: "hyperframes", modelCatalog: ["hyperframes@0.7.109"], presetCatalog: ["card-video-v1"] }),
    ]));
  });

  it("为静态视觉登记 OpenAI Images 与非秘密连接", () => {
    expect(adapterRegistration("openai", "openai_images")).toMatchObject({
      capability: "static_visual_generation",
      connectionType: "openai_api",
      requiresNetwork: true,
      connections: [],
    });
    expect(adapterRegistration("cloudflare", "workers_ai_images")).toMatchObject({
      capability: "static_visual_generation",
      connectionType: "cloudflare_workers_ai_api",
      modelCatalog: ["@cf/black-forest-labs/flux-1-schnell"],
    });
  });

  it("只把已登记的联网 Adapter 视为外部媒体能力", () => {
    expect(externalAdapterForMediaCapability("static_visual", "openai", "openai_images")).toBeTruthy();
    expect(externalAdapterForMediaCapability("static_visual", "cloudflare", "workers_ai_images")).toBeTruthy();
    expect(externalAdapterForMediaCapability("a_roll", "codex", "codex")).toBeUndefined();
  });

  it("为旁白、配乐与内部派生音频登记实际执行路径", () => {
    expect(adapterRegistration("google_tts", "google_tts")).toMatchObject({
      capability: "narration_generation",
      connectionType: "google_tts_api",
      requiresNetwork: true,
      connections: [],
    });
    expect(adapterRegistration("freesound", "freesound_preview")).toMatchObject({
      capability: "soundtrack_generation",
      connectionType: "freesound_api",
      endpoint: "https://freesound.org/apiv2",
      requiresNetwork: true,
      connections: [],
    });
    expect(adapterRegistration("ffmpeg", "ffmpeg_extract_audio")).toMatchObject({
      capability: "embedded_audio_extraction",
      connectionType: "internal",
      requiresNetwork: false,
      connections: [],
    });
  });

  it("只把已登记的本地 Adapter 暴露为本地执行路径", () => {
    expect(availableExecutionPathsForCapability("a_roll_generation")).toEqual(["manual"]);
    expect(localAdapterRegistrationsForCapability("a_roll_generation")).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "hyperframes_card_video", provider: "hyperframes" }),
    ]));
    expect(adapterRegistration("openai", "openai_images")).toMatchObject({ modelCatalog: ["gpt-image-1"], presetCatalog: ["static-visual-v1"] });
    expect(adapterRegistration("google_tts", "google_tts")?.voiceCatalog?.["zh-CN"]).toContain("cmn-CN-Standard-A");
  });

  it("只有注册、Worker 可用且当前探测通过的本地 Adapter 才可选", () => {
    const registrations: LocalAdapterRegistration[] = [
      { id: "ready", capability: "a_roll_generation", provider: "local", workerAvailable: true, modelCatalog: ["m"], presetCatalog: ["p"] },
      { id: "not-ready", capability: "a_roll_generation", provider: "local", workerAvailable: true, modelCatalog: ["m"], presetCatalog: ["p"] },
      { id: "not-deployed", capability: "a_roll_generation", provider: "local", workerAvailable: false, modelCatalog: ["m"], presetCatalog: ["p"] },
    ];

    expect(readyLocalAdapterRegistrations(registrations, { "local:ready": true }).map((registration) => registration.id)).toEqual(["ready"]);
    expect(readyLocalAdapterRegistrations(registrations).map((registration) => registration.id)).toEqual([]);
    expect(availableExecutionPathsForCapability("a_roll_generation")).toEqual(["manual"]);
  });
});
