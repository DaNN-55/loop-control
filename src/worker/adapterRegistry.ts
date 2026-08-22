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
    id: "pexels_video",
    capability: "b_roll_generation",
    provider: "pexels",
    connectionType: "pexels_api",
    requiresNetwork: true,
    configurationFields: ["per_shot_budget_cents", "total_budget_cents", "max_attempts", "max_concurrency", "provider_max_concurrency"],
    connections: [{ credentialRef: "pexels-default", environmentVariable: "PEXELS_API_KEY", label: "Pexels 默认连接" }],
  },
];

export function registeredAdaptersForCapability(capability: string): readonly AdapterRegistration[] {
  return adapterRegistry.filter((registration) => registration.capability === capability);
}

export function adapterRegistration(provider: string, adapter: string): AdapterRegistration | undefined {
  return adapterRegistry.find((registration) => registration.provider === provider && registration.id === adapter);
}
