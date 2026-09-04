export const executionPathKeys = ["external", "local", "manual"] as const;

export type ExecutionPath = typeof executionPathKeys[number];

export interface AdapterRegistration {
  id: string;
  capability: string;
  endpoint?: string;
  provider: string;
  connectionType: string;
  requiresNetwork: boolean;
  workerAvailable?: boolean;
  configurationFields: readonly string[];
  modelCatalog?: readonly string[];
  presetCatalog?: readonly string[];
  voiceCatalog?: Readonly<Record<string, readonly string[]>>;
  connections: ReadonlyArray<{
    credentialRef: string;
    environmentVariable: string;
    label: string;
  }>;
}

export interface LocalAdapterRegistration {
  id: string;
  capability: string;
  provider: string;
  workerAvailable: boolean;
  modelCatalog: readonly string[];
  presetCatalog: readonly string[];
  voiceCatalog?: Readonly<Record<string, readonly string[]>>;
}

export type LocalAdapterReadiness = Readonly<Record<string, boolean>>;

export const mediaCapabilityKeys = ["static_visual", "a_roll", "b_roll", "narration", "soundtrack"] as const;

export type MediaCapabilityKey = typeof mediaCapabilityKeys[number];

export type MediaCapabilityConfigurationField = "max_attempts" | "max_concurrency" | "provider_max_concurrency" | "voice" | "voice_speaking_rate";

export interface MediaCapability {
  capability: string;
  compactLabel: string;
  configurationFields: readonly MediaCapabilityConfigurationField[];
  defaultConfiguration: { model: string; promptVersion: string };
  description: string;
  label: string;
  registeredAdapter?: Omit<AdapterRegistration, "capability">;
  requiresRegisteredAdapter: boolean;
  unregisteredAdapter?: { provider: string; adapter: string };
  workerAvailable: boolean;
}

const mediaCapabilities: Record<MediaCapabilityKey, MediaCapability> = {
  static_visual: {
    capability: "static_visual_generation",
    compactLabel: "静态视觉",
    configurationFields: ["max_attempts"],
    defaultConfiguration: { model: "image-model-v1", promptVersion: "static-visual-v1" },
    description: "生成或准备静态视觉资产。启用后需声明实际可用的图片生成 Adapter。",
    label: "静态视觉 / 图片生成",
    registeredAdapter: { id: "openai_images", provider: "openai", connectionType: "openai_api", requiresNetwork: true, configurationFields: ["model", "credential_ref", "max_attempts"], modelCatalog: ["gpt-image-1"], presetCatalog: ["static-visual-v1"], connections: [] },
    requiresRegisteredAdapter: true,
    workerAvailable: true,
  },
  a_roll: {
    capability: "a_roll_generation",
    compactLabel: "A-roll",
    configurationFields: ["max_attempts"],
    defaultConfiguration: { model: "video-generation-v1", promptVersion: "a-roll-v1" },
    description: "生成需要实际出镜或演示的视频镜头；当前 Worker 尚未接入可执行的 A-roll Adapter。",
    label: "A-roll",
    requiresRegisteredAdapter: false,
    unregisteredAdapter: { provider: "codex", adapter: "codex" },
    workerAvailable: false,
  },
  b_roll: {
    capability: "b_roll_generation",
    compactLabel: "B-roll",
    configurationFields: ["max_attempts", "max_concurrency", "provider_max_concurrency"],
    defaultConfiguration: { model: "pexels-video-v1", promptVersion: "b-roll-v1" },
    description: "按分镜检索或生成补充画面。当前 Worker 仍会检查是否注册了兼容的 B-roll Adapter。",
    label: "B-roll",
    registeredAdapter: { id: "pexels_video", provider: "pexels", connectionType: "pexels_api", requiresNetwork: true, configurationFields: ["max_attempts", "max_concurrency", "provider_max_concurrency"], modelCatalog: ["pexels-video-v1"], presetCatalog: ["b-roll-v1"], connections: [] },
    requiresRegisteredAdapter: true,
    workerAvailable: true,
  },
  narration: {
    capability: "narration_generation",
    compactLabel: "旁白",
    configurationFields: ["max_attempts", "voice", "voice_speaking_rate"],
    defaultConfiguration: { model: "standard", promptVersion: "narration-v1" },
    description: "根据分镜中的旁白文本生成叙述音频，需要声音和语速参数。",
    label: "旁白",
    registeredAdapter: { id: "google_tts", provider: "google_tts", connectionType: "google_tts_api", requiresNetwork: true, configurationFields: ["credential_ref", "voice", "max_attempts"], modelCatalog: ["standard"], presetCatalog: ["narration-v1"], voiceCatalog: { "en-US": ["en-US-Standard-A", "en-US-Standard-B", "en-US-Standard-C", "en-US-Standard-D"], "zh-CN": ["cmn-CN-Standard-A", "cmn-CN-Standard-B", "cmn-CN-Standard-C", "cmn-CN-Standard-D", "cmn-CN-standard-cm"], "vi-VN": ["vi-VN-Standard-A", "vi-VN-Standard-B", "vi-VN-Standard-C", "vi-VN-Standard-D"] }, connections: [] },
    requiresRegisteredAdapter: true,
    workerAvailable: true,
  },
  soundtrack: {
    capability: "soundtrack_generation",
    compactLabel: "配乐 / 音效",
    configurationFields: ["max_attempts"],
    defaultConfiguration: { model: "freesound-preview-v1", promptVersion: "soundtrack-v1" },
    description: "根据分镜中的 BGM / SFX cue 检索配乐或音效，需要已配置的 Freesound 连接。",
    label: "配乐 / 音效",
    registeredAdapter: { id: "freesound_preview", endpoint: "https://freesound.org/apiv2", provider: "freesound", connectionType: "freesound_api", requiresNetwork: true, configurationFields: ["credential_ref", "max_attempts"], modelCatalog: ["freesound-preview-v1"], presetCatalog: ["soundtrack-v1"], connections: [] },
    requiresRegisteredAdapter: true,
    workerAvailable: true,
  },
};

const adapterRegistry: readonly AdapterRegistration[] = [
  {
    id: "codex",
    capability: "storyboard_planning",
    provider: "codex",
    connectionType: "none",
    requiresNetwork: false,
    configurationFields: ["model", "prompt_harness"],
    connections: [],
  },
  ...mediaCapabilityKeys.flatMap((key) => {
    const capability = mediaCapabilities[key];
    return capability.registeredAdapter ? [{ ...capability.registeredAdapter, capability: capability.capability }] : [];
  }),
  {
    id: "volcengine_tts",
    capability: "narration_generation",
    endpoint: "https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse",
    provider: "volcengine_tts",
    connectionType: "volcengine_tts_api",
    requiresNetwork: true,
    configurationFields: ["credential_ref", "voice", "max_attempts"],
    modelCatalog: ["seed-tts-2.0"],
    presetCatalog: ["narration-v1"],
    voiceCatalog: {
      "zh-CN": [
        "zh_female_vv_uranus_bigtts",
        "zh_male_dayi_saturn_bigtts",
        "zh_female_mizai_saturn_bigtts",
        "zh_female_jitangnv_saturn_bigtts",
        "zh_female_meilinvyou_saturn_bigtts",
        "zh_female_santongyongns_saturn_bigtts",
        "zh_male_ruyayichen_saturn_bigtts",
        "ICL_zh_female_keainvsheng_tob",
        "ICL_zh_female_tiaopigongzhu_tob",
      ],
      "en-US": ["zh_female_vv_uranus_bigtts"],
      "ja-JP": ["zh_female_vv_uranus_bigtts"],
      "es-ES": ["zh_female_vv_uranus_bigtts"],
    },
    connections: [],
  },
  {
    id: "workers_ai_images",
    capability: "static_visual_generation",
    endpoint: "https://api.cloudflare.com/client/v4",
    provider: "cloudflare",
    connectionType: "cloudflare_workers_ai_api",
    requiresNetwork: true,
    configurationFields: ["model", "credential_ref", "max_attempts"],
    modelCatalog: ["@cf/black-forest-labs/flux-1-schnell"],
    presetCatalog: ["static-visual-v1"],
    connections: [],
  },
  {
    id: "ffmpeg_extract_audio",
    capability: "embedded_audio_extraction",
    provider: "ffmpeg",
    connectionType: "internal",
    requiresNetwork: false,
    configurationFields: [],
    connections: [],
  },
  {
    id: "ffmpeg_trim_video",
    capability: "shot_clip_preparation",
    provider: "ffmpeg",
    connectionType: "internal",
    requiresNetwork: false,
    configurationFields: [],
    connections: [],
  },
];

const localAdapterRegistry: readonly LocalAdapterRegistration[] = [
  { id: "hyperframes_card_video", capability: "a_roll_generation", provider: "hyperframes", workerAvailable: true, modelCatalog: ["hyperframes@0.7.109"], presetCatalog: ["card-video-v1"] },
  { id: "hyperframes_card_video", capability: "b_roll_generation", provider: "hyperframes", workerAvailable: true, modelCatalog: ["hyperframes@0.7.109"], presetCatalog: ["card-video-v1"] },
];

export function registeredAdaptersForCapability(capability: string): readonly AdapterRegistration[] {
  return adapterRegistry.filter((registration) => registration.capability === capability);
}

export function localAdapterRegistrationsForCapability(capability: string): readonly LocalAdapterRegistration[] {
  return localAdapterRegistry.filter((registration) => registration.capability === capability);
}

export function localAdapterReadinessKey(provider: string, adapter: string): string {
  return `${provider}:${adapter}`;
}

export function localAdapterProviderForCapability(capability: string, adapter: string): string | undefined {
  const matches = localAdapterRegistrationsForCapability(capability).filter((registration) => registration.id === adapter);
  return matches.length === 1 ? matches[0].provider : undefined;
}

export function readyLocalAdapterRegistrations(registrations: readonly LocalAdapterRegistration[], readiness: LocalAdapterReadiness = {}): readonly LocalAdapterRegistration[] {
  return registrations.filter((registration) => readiness[localAdapterReadinessKey(registration.provider, registration.id)] === true && registration.workerAvailable);
}

export function availableExecutionPathsForCapability(capability: string, readiness: LocalAdapterReadiness = {}): readonly ExecutionPath[] {
  return [
    ...(registeredAdaptersForCapability(capability).some((registration) => registration.requiresNetwork) ? ["external" as const] : []),
    ...(readyLocalAdapterRegistrations(localAdapterRegistrationsForCapability(capability), readiness).length ? ["local" as const] : []),
    "manual",
  ];
}

export function adapterRegistration(provider: string, adapter: string): AdapterRegistration | undefined {
  return adapterRegistry.find((registration) => registration.provider === provider && registration.id === adapter);
}

export function isOwnerManagedConnection(provider: string, adapter: string): boolean {
  return (provider === "pexels" && adapter === "pexels_video") || (provider === "freesound" && adapter === "freesound_preview") || (provider === "openai" && adapter === "openai_images") || (provider === "cloudflare" && adapter === "workers_ai_images") || (provider === "google_tts" && adapter === "google_tts") || (provider === "volcengine_tts" && adapter === "volcengine_tts");
}

export function externalAdapterForMediaCapability(key: MediaCapabilityKey, provider: string, adapter: string): AdapterRegistration | undefined {
  const registration = adapterRegistration(provider, adapter);
  return registration?.capability === mediaCapabilities[key].capability && registration.requiresNetwork ? registration : undefined;
}

export function mediaCapabilityForKey(key: MediaCapabilityKey): MediaCapability {
  return mediaCapabilities[key];
}

export function mediaCapabilityForCapability(capability: string): MediaCapability | undefined {
  return mediaCapabilityKeys.map(mediaCapabilityForKey).find((candidate) => candidate.capability === capability);
}

export function mediaCapabilityKeyForCapability(capability: string): MediaCapabilityKey | undefined {
  return mediaCapabilityKeys.find((key) => mediaCapabilities[key].capability === capability);
}
