import { describe, expect, it } from "vitest";
import { adapterRegistration, mediaCapabilityForKey, mediaCapabilityKeys, registeredAdaptersForCapability } from "./adapterRegistry";

describe("adapter registry", () => {
  it("集中五项可选生产能力的标识与展示事实", () => {
    expect(mediaCapabilityKeys.map((key) => [key, mediaCapabilityForKey(key).capability])).toEqual([
      ["static_visual", "static_visual_generation"],
      ["a_roll", "a_roll_generation"],
      ["b_roll", "b_roll_generation"],
      ["narration", "narration_generation"],
      ["soundtrack", "soundtrack_generation"],
    ]);
    expect(mediaCapabilityForKey("a_roll")).toMatchObject({ requiresRegisteredAdapter: false, label: "A-roll" });
    expect(mediaCapabilityForKey("b_roll")).toMatchObject({ configurationFields: ["max_attempts", "max_concurrency", "provider_max_concurrency"], requiresRegisteredAdapter: true, registeredAdapter: { id: "pexels_video" } });
  });

  it("为分镜规划登记 Codex Adapter 与 Harness 配置契约", () => {
    expect(registeredAdaptersForCapability("storyboard_planning")).toEqual([
      expect.objectContaining({ id: "codex", provider: "codex", connectionType: "none", requiresNetwork: false, configurationFields: ["model", "prompt_harness"] }),
    ]);
    expect(adapterRegistration("codex", "codex")?.capability).toBe("storyboard_planning");
  });

  it("查询 B-roll 目录时返回 Pexels 执行与连接契约", () => {
    expect(registeredAdaptersForCapability("b_roll_generation")).toEqual([
      expect.objectContaining({
        id: "pexels_video",
        provider: "pexels",
        connectionType: "pexels_api",
        requiresNetwork: true,
        configurationFields: ["max_attempts", "max_concurrency", "provider_max_concurrency"],
      }),
    ]);
    expect(adapterRegistration("pexels", "pexels_video")?.connections).toEqual([]);
  });

  it("为静态视觉登记 OpenAI Images 与非秘密连接", () => {
    expect(adapterRegistration("openai", "openai_images")).toMatchObject({
      capability: "static_visual_generation",
      connectionType: "openai_api",
      requiresNetwork: true,
      connections: [{ credentialRef: "openai-default", environmentVariable: "OPENAI_API_KEY" }],
    });
  });

  it("为旁白、配乐与内部派生音频登记实际执行路径", () => {
    expect(adapterRegistration("google_tts", "google_tts")).toMatchObject({
      capability: "narration_generation",
      connectionType: "google_tts_api",
      requiresNetwork: true,
      connections: [{ credentialRef: "google-tts-default", environmentVariable: "GOOGLE_TTS_API_KEY" }],
    });
    expect(adapterRegistration("freesound", "freesound_preview")).toMatchObject({
      capability: "soundtrack_generation",
      connectionType: "freesound_api",
      requiresNetwork: true,
      connections: [{ credentialRef: "freesound-default", environmentVariable: "FREESOUND_API_KEY" }],
    });
    expect(adapterRegistration("ffmpeg", "ffmpeg_extract_audio")).toMatchObject({
      capability: "embedded_audio_extraction",
      connectionType: "internal",
      requiresNetwork: false,
      connections: [],
    });
  });
});
