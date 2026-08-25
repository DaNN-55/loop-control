export interface AdapterRegistration {
  id: string;
  capability: string;
  provider: string;
  connectionType: string;
  requiresNetwork: boolean;
  configurationFields: readonly string[];
  connections: ReadonlyArray<{
    credentialRef: string;
    environmentVariable: string;
    label: string;
  }>;
}

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
    registeredAdapter: { id: "openai_images", provider: "openai", connectionType: "openai_api", requiresNetwork: true, configurationFields: ["model", "credential_ref", "max_attempts"], connections: [] },
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
    registeredAdapter: { id: "pexels_video", provider: "pexels", connectionType: "pexels_api", requiresNetwork: true, configurationFields: ["max_attempts", "max_concurrency", "provider_max_concurrency"], connections: [] },
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
    registeredAdapter: { id: "google_tts", provider: "google_tts", connectionType: "google_tts_api", requiresNetwork: true, configurationFields: ["credential_ref", "voice", "max_attempts"], connections: [] },
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
    registeredAdapter: { id: "freesound_preview", provider: "freesound", connectionType: "freesound_api", requiresNetwork: true, configurationFields: ["credential_ref", "max_attempts"], connections: [] },
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
    id: "ffmpeg_extract_audio",
    capability: "embedded_audio_extraction",
    provider: "ffmpeg",
    connectionType: "internal",
    requiresNetwork: false,
    configurationFields: [],
    connections: [],
  },
];

export function registeredAdaptersForCapability(capability: string): readonly AdapterRegistration[] {
  return adapterRegistry.filter((registration) => registration.capability === capability);
}

export function adapterRegistration(provider: string, adapter: string): AdapterRegistration | undefined {
  return adapterRegistry.find((registration) => registration.provider === provider && registration.id === adapter);
}

export function isOwnerManagedConnection(provider: string, adapter: string): boolean {
  return (provider === "pexels" && adapter === "pexels_video") || (provider === "freesound" && adapter === "freesound_preview") || (provider === "openai" && adapter === "openai_images") || (provider === "google_tts" && adapter === "google_tts");
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
