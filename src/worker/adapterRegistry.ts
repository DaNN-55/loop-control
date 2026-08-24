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
  {
    id: "openai_images",
    capability: "static_visual_generation",
    provider: "openai",
    connectionType: "openai_api",
    requiresNetwork: true,
    configurationFields: ["model", "credential_ref", "max_attempts"],
    connections: [{ credentialRef: "openai-default", environmentVariable: "OPENAI_API_KEY", label: "OpenAI 默认连接" }],
  },
  {
    id: "pexels_video",
    capability: "b_roll_generation",
    provider: "pexels",
    connectionType: "pexels_api",
    requiresNetwork: true,
    configurationFields: ["max_attempts", "max_concurrency", "provider_max_concurrency"],
    connections: [{ credentialRef: "pexels-default", environmentVariable: "PEXELS_API_KEY", label: "Pexels 默认连接" }],
  },
  {
    id: "google_tts",
    capability: "narration_generation",
    provider: "google_tts",
    connectionType: "google_tts_api",
    requiresNetwork: true,
    configurationFields: ["credential_ref", "voice", "max_attempts"],
    connections: [{ credentialRef: "google-tts-default", environmentVariable: "GOOGLE_TTS_API_KEY", label: "Google TTS 默认连接" }],
  },
  {
    id: "freesound_preview",
    capability: "soundtrack_generation",
    provider: "freesound",
    connectionType: "freesound_api",
    requiresNetwork: true,
    configurationFields: ["credential_ref", "max_attempts"],
    connections: [{ credentialRef: "freesound-default", environmentVariable: "FREESOUND_API_KEY", label: "Freesound 默认连接" }],
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
];

export function registeredAdaptersForCapability(capability: string): readonly AdapterRegistration[] {
  return adapterRegistry.filter((registration) => registration.capability === capability);
}

export function adapterRegistration(provider: string, adapter: string): AdapterRegistration | undefined {
  return adapterRegistry.find((registration) => registration.provider === provider && registration.id === adapter);
}
