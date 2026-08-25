import { workerPreflightVersion, type WorkerPreflightCheck, type WorkerPreflightResult, type WorkerPreflightStatus, type WorkerTaskPackage } from "./contracts.js";
import { adapterRegistration, externalAdapterForMediaCapability, isOwnerManagedConnection, mediaCapabilityForCapability, mediaCapabilityForKey, mediaCapabilityKeys, registeredAdaptersForCapability } from "./adapterRegistry.js";

export interface RuntimeCapability {
  capability: string;
  provider: string;
  adapter?: string;
  model?: string;
  promptVersion?: string;
  promptHarnessId?: string;
  requiresAdapter?: boolean;
  requiresPromptHarness?: boolean;
  allowedTools?: unknown;
  credentialRef?: string;
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
  connectionReferences?: Record<string, RuntimeDependencyStatus>;
  credentialValidity?: Record<string, RuntimeDependencyStatus>;
  commands?: Record<string, RuntimeDependencyStatus>;
  connections?: Record<string, RuntimeDependencyStatus>;
  mediaLibrary?: RuntimeDependencyStatus;
  modelPermissions?: Record<string, RuntimeDependencyStatus>;
}

const legacyRegisteredAdapters = new Set([
  "codex:codex",
  "hyperframes:hyperframes",
]);

export function runtimeCapabilitiesFromBlueprintPolicy(policy: unknown, _seriesRules?: unknown, requiredMediaCapabilities?: readonly string[]): RuntimeCapability[] {
  const root = record(policy);
  const executors = record(root.executors);
  const allowedTools = root.allowed_tools;
  const required = requiredMediaCapabilities ? new Set(requiredMediaCapabilities) : undefined;
  const capabilities: RuntimeCapability[] = [
    capabilityFromExecutor("visual_planning", record(executors.visual_planning), allowedTools, "codex", { adapter: true, promptHarness: true }),
    capabilityFromExecutor("storyboard_planning", record(executors.storyboard_planning), allowedTools, "codex", { adapter: true, promptHarness: true }),
    { capability: "review_rendering", provider: "hyperframes", model: "hyperframes@0.7.109", promptVersion: "review-render-v1", allowedTools: ["read", "write"], command: "hyperframes" },
    { capability: "final_rendering", provider: "hyperframes", model: "hyperframes@0.7.109", promptVersion: "final-render-v1", allowedTools: ["read", "write"], command: "hyperframes" },
  ];

  for (const key of mediaCapabilityKeys) {
    const mediaCapability = mediaCapabilityForKey(key);
    const blueprintValue = root[key];
    if (blueprintValue === undefined || blueprintValue === null) continue;
    const config = record(blueprintValue);
    const executor = record(config.executor);
    const provider = stringValue(executor.provider);
    const adapter = stringValue(executor.adapter);
    const credentialRef = stringValue(config.credential_ref);
    if (required ? !required.has(mediaCapability.capability) : !externalAdapterForMediaCapability(key, provider, adapter)) continue;
    const credential = credentialEnvironmentForReference(provider, adapter, credentialRef);
    capabilities.push({
      capability: mediaCapability.capability,
      provider,
      adapter,
      model: stringValue(executor.model),
      promptVersion: stringValue(executor.prompt_version),
      allowedTools: config.allowed_tools,
      ...(credentialRef ? { credentialRef } : {}),
      ...(credential ? { credential } : {}),
      command: runtimeCommandForProvider(provider),
    });
  }

  return capabilities;
}

export function runtimeCapabilityFromTask(taskPackage: WorkerTaskPackage): RuntimeCapability {
  const sharedPlanning = taskPackage.capability === "visual_planning" || taskPackage.capability === "storyboard_planning";
  const adapter = taskPackage.aRoll?.adapter ?? taskPackage.media?.adapter ?? (sharedPlanning ? taskPackage.promptHarness?.adapter : undefined);
  return {
    capability: taskPackage.capability,
    provider: taskPackage.provider,
    ...(adapter ? { adapter } : {}),
    model: taskPackage.model,
    promptVersion: taskPackage.promptVersion,
    ...(sharedPlanning && taskPackage.promptHarness ? { promptHarnessId: taskPackage.promptHarness.id } : {}),
    ...(sharedPlanning ? { requiresAdapter: true, requiresPromptHarness: true } : {}),
    allowedTools: taskPackage.allowedTools,
    ...(taskPackage.credentialRef ? { credentialRef: taskPackage.credentialRef } : {}),
    credential: credentialEnvironmentForReference(taskPackage.provider, adapter, taskPackage.credentialRef),
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

    const mediaCapability = mediaCapabilityForCapability(capability.capability);
    const registrationValid = mediaCapability?.workerAvailable === false ? false : capability.adapter
      ? registeredAdaptersForCapability(capability.capability).some((registration) => registration.provider === capability.provider && registration.id === capability.adapter) || legacyRegisteredAdapters.has(`${capability.provider}:${capability.adapter}`)
      : capability.provider === "codex" || capability.provider === "hyperframes" || capability.provider === "ffmpeg";
    if (!registrationValid) {
      checks.push({ capability: capability.capability, check: "capability_registration", phase: "preflight", status: "unavailable", reason: `当前 Worker 未注册 ${capability.provider}/${capability.adapter ?? "default"} 执行路径。`, action: "contact_environment_admin", scope: "worker" });
      continue;
    }
    checks.push({ capability: capability.capability, check: "capability_registration", phase: "preflight", status: "passed", reason: `Worker 已注册 ${capability.provider}${capability.adapter ? `/${capability.adapter}` : ""} 执行路径。`, action: "none", scope: "worker" });

    const allowedTools = stringArray(capability.allowedTools);
    const missingTools = requiredTools().filter((tool) => !allowedTools.includes(tool));
    if (missingTools.length) {
      checks.push({ capability: capability.capability, check: "tool_permission", phase: "preflight", status: "blocked", reason: `冻结工具白名单缺少 ${missingTools.join("、")}。`, action: "edit_blueprint", scope: "blueprint" });
    } else {
      checks.push({ capability: capability.capability, check: "tool_permission", phase: "preflight", status: "passed", reason: `冻结工具白名单包含 ${requiredTools().join(" 和 ")}。`, action: "none", scope: "blueprint" });
    }

    if (capability.credential && environment.credentials && Object.prototype.hasOwnProperty.call(environment.credentials, capability.credential)) {
      const credentialAvailable = environment.credentials[capability.credential];
      checks.push({ capability: capability.capability, check: "credential_presence", phase: "preflight", status: credentialAvailable ? "passed" : "unavailable", reason: credentialAvailable ? `${capability.credential} 已在 Worker 环境中配置。` : `${capability.credential} 未配置。`, action: credentialAvailable ? "none" : "contact_environment_admin", scope: "worker" });
    }

    if (capability.credentialRef && environment.connectionReferences && Object.prototype.hasOwnProperty.call(environment.connectionReferences, capability.credentialRef)) {
      checks.push(connectionReferenceCheck(capability.capability, environment.connectionReferences[capability.credentialRef]));
    }

    if (capability.credentialRef && environment.credentials && Object.prototype.hasOwnProperty.call(environment.credentials, capability.credentialRef)) {
      const available = environment.credentials[capability.credentialRef];
      checks.push({ capability: capability.capability, check: "credential_presence", phase: "preflight", status: available ? "passed" : "unavailable", reason: available ? "外部连接秘密已由 Worker 解析。" : "外部连接秘密不可用，请管理该连接。", action: available ? "none" : "manage_connection", scope: "connection" });
    }

    if (capability.command && environment.commands && Object.prototype.hasOwnProperty.call(environment.commands, capability.command)) {
      const commandStatus = environment.commands[capability.command];
      checks.push(dependencyCheck(capability.capability, "command_availability", commandStatus));
    }

    if (capability.model && environment.modelPermissions && Object.prototype.hasOwnProperty.call(environment.modelPermissions, capability.model)) {
      checks.push(capability.provider === "openai" && capability.adapter === "openai_images" ? openAiModelPermissionCheck(capability.capability, environment.modelPermissions[capability.model]) : dependencyCheck(capability.capability, "model_permission", environment.modelPermissions[capability.model]));
    }

    if (environment.connections && Object.prototype.hasOwnProperty.call(environment.connections, capability.provider)) {
      checks.push(dependencyCheck(capability.capability, "network_connectivity", environment.connections[capability.provider]));
    }

    if (capability.credential && environment.credentialValidity && Object.prototype.hasOwnProperty.call(environment.credentialValidity, capability.credential)) {
      checks.push(dependencyCheck(capability.capability, "credential_validity", environment.credentialValidity[capability.credential]));
    }
    if (capability.credentialRef && environment.credentialValidity && Object.prototype.hasOwnProperty.call(environment.credentialValidity, capability.credentialRef)) {
      checks.push(connectionCredentialValidityCheck(capability.capability, environment.credentialValidity[capability.credentialRef]));
    }
  }

  if (environment.assetRoot) {
    checks.push(dependencyCheck("worker_runtime", "asset_root", environment.assetRoot));
  }

  if (environment.mediaLibrary) {
    checks.push(dependencyCheck("worker_runtime", "media_library", environment.mediaLibrary));
  }

  return { version: workerPreflightVersion, checks };
}

export function credentialEnvironmentForProvider(provider: string): string | undefined {
  if (provider === "openai") return "OPENAI_API_KEY";
  if (provider === "google_tts") return "GOOGLE_TTS_API_KEY";
  if (provider === "freesound") return "FREESOUND_API_KEY";
  return undefined;
}

export function credentialEnvironmentForReference(provider: string, adapter: string | undefined, credentialRef: string | undefined): string | undefined {
  if (isConnectionId(credentialRef)) return undefined;
  const registration = adapter ? adapterRegistration(provider, adapter) : undefined;
  if (registration) return registration.connections.find((connection) => connection.credentialRef === credentialRef)?.environmentVariable;
  return credentialEnvironmentForProvider(provider);
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

function capabilityFromExecutor(capability: string, executor: Record<string, unknown>, allowedTools: unknown, defaultProvider: string, requirements: { adapter?: boolean; promptHarness?: boolean } = {}): RuntimeCapability {
  const provider = stringValue(executor.provider) || defaultProvider;
  const adapter = stringValue(executor.adapter);
  const promptHarnessId = stringValue(executor.harness_id);
  return {
    capability,
    provider,
    ...(adapter ? { adapter } : {}),
    model: stringValue(executor.model),
    promptVersion: stringValue(executor.prompt_version),
    ...(promptHarnessId ? { promptHarnessId } : {}),
    ...(requirements.adapter ? { requiresAdapter: true } : {}),
    ...(requirements.promptHarness ? { requiresPromptHarness: true } : {}),
    allowedTools,
    command: runtimeCommandForProvider(provider),
  };
}

function configurationErrorFor(capability: RuntimeCapability): string | undefined {
  if (!capability.provider || !capability.model || !capability.promptVersion) return `能力 ${capability.capability} 缺少 Provider、模型或 Prompt 版本。`;
  if (capability.requiresAdapter && !capability.adapter) return `能力 ${capability.capability} 缺少已注册 Adapter。`;
  if (isOwnerManagedConnection(capability.provider, capability.adapter ?? "") && !isConnectionId(capability.credentialRef)) return `${capability.provider === "openai" ? "OpenAI Images" : capability.provider === "google_tts" ? "Google TTS" : capability.provider === "freesound" ? "Freesound" : "Pexels"} 必须选择已验证的外部连接版本。`;
  if (capability.requiresPromptHarness && !capability.promptHarnessId) return `能力 ${capability.capability} 缺少 Prompt Harness。`;
  const registration = capability.adapter ? adapterRegistration(capability.provider, capability.adapter) : undefined;
  if (registration?.connections.length && !registration.connections.some((connection) => connection.credentialRef === capability.credentialRef) && !isConnectionId(capability.credentialRef)) return `能力 ${capability.capability} 缺少可用的外部连接引用。`;
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

function requiredTools(): string[] {
  return ["read", "write"];
}

function isConnectionId(value: string | undefined): boolean {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
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

function connectionReferenceCheck(capability: string, dependency: RuntimeDependencyStatus): WorkerPreflightCheck {
  const status: WorkerPreflightStatus = dependency.available ? "passed" : dependency.status ?? "unavailable";
  return {
    capability,
    check: "connection_reference",
    phase: "preflight",
    status,
    reason: dependency.detail,
    action: dependency.available ? "none" : status === "retryable" ? "retry" : "manage_connection",
    scope: "connection",
  };
}

function connectionCredentialValidityCheck(capability: string, dependency: RuntimeDependencyStatus): WorkerPreflightCheck {
  const status: WorkerPreflightStatus = dependency.available ? "passed" : dependency.status ?? "unavailable";
  return {
    capability,
    check: "credential_validity",
    phase: "preflight",
    status,
    reason: dependency.detail,
    action: dependency.available ? "none" : status === "retryable" ? "retry" : "manage_connection",
    scope: status === "retryable" ? "worker" : "connection",
  };
}

function openAiModelPermissionCheck(capability: string, dependency: RuntimeDependencyStatus): WorkerPreflightCheck {
  const status: WorkerPreflightStatus = dependency.available ? "passed" : dependency.status ?? "unavailable";
  return {
    capability,
    check: "model_permission",
    phase: "preflight",
    status,
    reason: dependency.detail,
    action: dependency.available ? "none" : status === "retryable" ? "retry" : "edit_blueprint",
    scope: dependency.available || status === "retryable" ? "worker" : "blueprint",
  };
}
