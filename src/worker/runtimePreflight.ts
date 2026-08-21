import type { WorkerPreflightCheck, WorkerPreflightResult, WorkerPreflightStatus, WorkerTaskPackage } from "./contracts.js";

export interface RuntimeCapability {
  capability: string;
  provider: string;
  adapter?: string;
  model?: string;
  promptVersion?: string;
  allowedTools?: unknown;
  credential?: string;
  command?: string;
}

export interface RuntimeDependencyStatus {
  available: boolean;
  detail: string;
  status?: "retryable" | "unavailable";
}

export interface RuntimePreflightEnvironment {
  assetRoot?: RuntimeDependencyStatus;
  credentials?: Record<string, boolean>;
  credentialValidity?: Record<string, RuntimeDependencyStatus>;
  commands?: Record<string, RuntimeDependencyStatus>;
  connections?: Record<string, RuntimeDependencyStatus>;
  mediaLibrary?: RuntimeDependencyStatus;
  modelPermissions?: Record<string, RuntimeDependencyStatus>;
}

const mediaCapabilities = [
  { key: "b_roll", capability: "b_roll_generation" },
  { key: "narration", capability: "narration_generation" },
] as const;

const registeredAdapters = new Set([
  "codex:codex",
  "pexels:pexels_video",
  "google_tts:google_tts",
  "ffmpeg:ffmpeg_extract_audio",
  "freesound:freesound_preview",
  "hyperframes:hyperframes",
]);

export function runtimeCapabilitiesFromBlueprintPolicy(policy: unknown, seriesRules?: unknown): RuntimeCapability[] {
  const root = record(policy);
  const series = record(seriesRules);
  const executors = record(root.executors);
  const allowedTools = root.allowed_tools;
  const capabilities: RuntimeCapability[] = [
    capabilityFromExecutor("script_writing", record(executors.script_writing), allowedTools, "codex"),
    capabilityFromExecutor("visual_planning", record(executors.visual_planning), allowedTools, "codex"),
    capabilityFromExecutor("storyboard_planning", record(executors.storyboard_planning), allowedTools, "codex"),
    { capability: "review_rendering", provider: "hyperframes", model: "hyperframes@0.7.109", promptVersion: "review-render-v1", allowedTools: ["read", "write"], command: "hyperframes" },
    { capability: "final_rendering", provider: "hyperframes", model: "hyperframes@0.7.109", promptVersion: "final-render-v1", allowedTools: ["read", "write"], command: "hyperframes" },
  ];

  for (const mediaCapability of mediaCapabilities) {
    const blueprintValue = root[mediaCapability.key];
    if (blueprintValue === undefined || blueprintValue === null) continue;
    const configuredValue = series[mediaCapability.key] !== undefined && series[mediaCapability.key] !== null ? series[mediaCapability.key] : blueprintValue;
    if (configuredValue === undefined || configuredValue === null) continue;
    const config = record(configuredValue);
    const executor = record(config.executor);
    const provider = stringValue(executor.provider);
    capabilities.push({
      capability: mediaCapability.capability,
      provider,
      adapter: stringValue(executor.adapter),
      model: stringValue(executor.model),
      promptVersion: stringValue(executor.prompt_version),
      allowedTools: config.allowed_tools,
      credential: credentialEnvironmentForProvider(provider),
      command: runtimeCommandForProvider(provider),
    });
  }

  return capabilities;
}

export function runtimeCapabilityFromTask(taskPackage: WorkerTaskPackage): RuntimeCapability {
  const adapter = taskPackage.aRoll?.adapter ?? taskPackage.media?.adapter;
  return {
    capability: taskPackage.capability,
    provider: taskPackage.provider,
    ...(adapter ? { adapter } : {}),
    model: taskPackage.model,
    promptVersion: taskPackage.promptVersion,
    allowedTools: taskPackage.allowedTools,
    credential: credentialEnvironmentForProvider(taskPackage.provider),
    command: runtimeCommandForProvider(taskPackage.provider),
  };
}

export function createRuntimePreflight(capabilities: RuntimeCapability[], environment: RuntimePreflightEnvironment = {}): WorkerPreflightResult {
  const checks: WorkerPreflightResult["checks"] = [];
  for (const capability of capabilities) {
    const configurationError = configurationErrorFor(capability);
    if (configurationError) {
      checks.push({ capability: capability.capability, check: "blueprint_configuration", phase: "preflight", status: "blocked", reason: configurationError, action: "edit_blueprint", scope: "blueprint" });
      continue;
    }

    const registrationValid = capability.adapter
      ? registeredAdapters.has(`${capability.provider}:${capability.adapter}`)
      : capability.provider === "codex" || capability.provider === "hyperframes" || capability.provider === "ffmpeg";
    if (!registrationValid) {
      checks.push({ capability: capability.capability, check: "capability_registration", phase: "preflight", status: "unavailable", reason: `当前 Worker 未注册 ${capability.provider}/${capability.adapter ?? "default"} 执行路径。`, action: "contact_environment_admin", scope: "worker" });
      continue;
    }
    checks.push({ capability: capability.capability, check: "capability_registration", phase: "preflight", status: "passed", reason: `Worker 已注册 ${capability.provider}${capability.adapter ? `/${capability.adapter}` : ""} 执行路径。`, action: "none", scope: "worker" });

    const allowedTools = stringArray(capability.allowedTools);
    const missingTools = requiredToolsForProvider(capability.provider).filter((tool) => !allowedTools.includes(tool));
    if (missingTools.length) {
      checks.push({ capability: capability.capability, check: "tool_permission", phase: "preflight", status: "blocked", reason: `冻结工具白名单缺少 ${missingTools.join("、")}。`, action: "edit_blueprint", scope: "blueprint" });
    } else {
      checks.push({ capability: capability.capability, check: "tool_permission", phase: "preflight", status: "passed", reason: `冻结工具白名单包含 ${requiredToolsForProvider(capability.provider).join(" 和 ")}。`, action: "none", scope: "blueprint" });
    }

    if (capability.credential && environment.credentials && Object.prototype.hasOwnProperty.call(environment.credentials, capability.credential)) {
      const credentialAvailable = environment.credentials[capability.credential];
      checks.push({ capability: capability.capability, check: "credential_presence", phase: "preflight", status: credentialAvailable ? "passed" : "unavailable", reason: credentialAvailable ? `${capability.credential} 已在 Worker 环境中配置。` : `${capability.credential} 未配置。`, action: credentialAvailable ? "none" : "contact_environment_admin", scope: "worker" });
    }

    if (capability.command && environment.commands && Object.prototype.hasOwnProperty.call(environment.commands, capability.command)) {
      const commandStatus = environment.commands[capability.command];
      checks.push(dependencyCheck(capability.capability, "command_availability", commandStatus));
    }

    if (capability.model && environment.modelPermissions && Object.prototype.hasOwnProperty.call(environment.modelPermissions, capability.model)) {
      checks.push(dependencyCheck(capability.capability, "model_permission", environment.modelPermissions[capability.model]));
    }

    if (environment.connections && Object.prototype.hasOwnProperty.call(environment.connections, capability.provider)) {
      checks.push(dependencyCheck(capability.capability, "network_connectivity", environment.connections[capability.provider]));
    }

    if (capability.credential && environment.credentialValidity && Object.prototype.hasOwnProperty.call(environment.credentialValidity, capability.credential)) {
      checks.push(dependencyCheck(capability.capability, "credential_validity", environment.credentialValidity[capability.credential]));
    }
  }

  if (environment.assetRoot) {
    checks.push(dependencyCheck("worker_runtime", "asset_root", environment.assetRoot));
  }

  if (environment.mediaLibrary) {
    checks.push(dependencyCheck("worker_runtime", "media_library", environment.mediaLibrary));
  }

  return { version: "worker-preflight/v1", checks };
}

export function credentialEnvironmentForProvider(provider: string): string | undefined {
  if (provider === "google_tts") return "GOOGLE_TTS_API_KEY";
  if (provider === "pexels") return "PEXELS_API_KEY";
  if (provider === "freesound") return "FREESOUND_API_KEY";
  return undefined;
}

export function runtimeCommandForProvider(provider: string): string | undefined {
  if (provider === "codex") return "codex";
  if (provider === "ffmpeg") return "ffmpeg";
  if (provider === "hyperframes") return "hyperframes";
  return undefined;
}

export function runtimeCommandArguments(command: string): string[] {
  return command === "ffmpeg" ? ["-version"] : ["--version"];
}

function capabilityFromExecutor(capability: string, executor: Record<string, unknown>, allowedTools: unknown, defaultProvider: string): RuntimeCapability {
  const provider = stringValue(executor.provider) || defaultProvider;
  return {
    capability,
    provider,
    model: stringValue(executor.model),
    promptVersion: stringValue(executor.prompt_version),
    allowedTools,
    command: runtimeCommandForProvider(provider),
  };
}

function configurationErrorFor(capability: RuntimeCapability): string | undefined {
  if (!capability.provider || !capability.model || !capability.promptVersion) return `能力 ${capability.capability} 缺少 Provider、模型或 Prompt 版本。`;
  if (capability.adapter !== undefined && !capability.adapter) return `能力 ${capability.capability} 缺少 Adapter。`;
  return undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requiredToolsForProvider(provider: string): string[] {
  return provider === "freesound" ? ["network", "write"] : ["read", "write"];
}

function dependencyCheck(capability: string, check: string, dependency: RuntimeDependencyStatus): WorkerPreflightCheck {
  const status: WorkerPreflightStatus = dependency.available ? "passed" : dependency.status ?? "unavailable";
  return {
    capability,
    check,
    phase: "preflight" as const,
    status,
    reason: dependency.detail,
    action: dependency.available ? "none" as const : status === "retryable" ? "retry" as const : "contact_environment_admin" as const,
    scope: "worker" as const,
  };
}
