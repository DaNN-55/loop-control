import type { Json } from "../lib/database.types";
import { adapterRegistration } from "../worker/adapterRegistry";

type JsonObject = Record<string, Json | undefined>;
type ExecutorForm = { provider: string; model: string; promptVersion: string };

export const mediaAdapterKeys = ["a_roll", "b_roll", "narration", "soundtrack"] as const;
export type MediaAdapterKey = typeof mediaAdapterKeys[number];
export const configurableMediaAdapterKeys = ["b_roll", "narration"] as const;
export type ConfigurableMediaAdapterKey = typeof configurableMediaAdapterKeys[number];
export type MediaAdapterForm = {
  provider: string;
  adapter: string;
  credentialRef: string;
  model: string;
  promptVersion: string;
  allowedTools: string;
  budgetCents: string;
  perShotBudgetCents: string;
  totalBudgetCents: string;
  maxAttempts: string;
  maxConcurrency: string;
  providerMaxConcurrency: string;
  voiceLanguageCode: string;
  voiceName: string;
  voiceSpeakingRate: string;
};

export interface BlueprintFormValues {
  positioning: string;
  assetRoot: string;
  approvalGates: string[];
  allowedTools: string[];
  enabledMediaAdapters?: ConfigurableMediaAdapterKey[];
  budgets: { scriptWritingCents: string; visualPlanningCents: string; storyboardPlanningCents: string };
  executors: Record<"script_writing" | "visual_planning" | "storyboard_planning", ExecutorForm>;
  mediaAdapters: Record<MediaAdapterKey, MediaAdapterForm>;
  advancedJson: string;
}

export interface SeriesFormValues {
  positioning: string;
  format: string;
  characters: string;
  locations: string;
  visualStyle: string;
  narrativeStructure: string;
  restrictions: string;
  advancedJson: string;
}

const blueprintKnownKeys = new Set(["positioning", "asset_root", "approval_gates", "allowed_tools", "budgets", "executors", ...mediaAdapterKeys]);
const seriesKnownKeys = new Set(["positioning", "format", "characters", "locations", "visual_style", "narrative_structure", "restrictions"]);
const executorKeys = ["script_writing", "visual_planning", "storyboard_planning"] as const;
const visibleToolKeys = new Set(["read", "write"]);

function objectValue(value: Json | undefined): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function stringValue(value: Json | undefined): string {
  return typeof value === "string" ? value : "";
}

function displayValue(value: Json | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function stringArray(value: Json | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function commaSeparatedValues(source: string): string[] {
  return source.split(",").map((item) => item.trim()).filter(Boolean);
}

function advancedJson(value: JsonObject, knownKeys: Set<string>, nestedKeys: Record<string, Set<string>> = {}): string {
  const extra = Object.fromEntries(Object.entries(value).filter(([key]) => !knownKeys.has(key)));
  for (const [parentKey, childKeys] of Object.entries(nestedKeys)) {
    const parent = objectValue(value[parentKey]);
    const nestedExtra = Object.fromEntries(Object.entries(parent).filter(([key]) => !childKeys.has(key)));
    if (Object.keys(nestedExtra).length) extra[parentKey] = nestedExtra;
  }
  return JSON.stringify(extra, null, 2);
}

function blueprintAdvancedJson(value: JsonObject): string {
  const extra = Object.fromEntries(Object.entries(value).filter(([key]) => !blueprintKnownKeys.has(key)));
  const budgets = objectValue(value.budgets);
  const budgetExtra = Object.fromEntries(Object.entries(budgets).filter(([key]) => !new Set(["script_writing_cents", "visual_planning_cents", "storyboard_planning_cents"]).has(key)));
  if (Object.keys(budgetExtra).length) extra.budgets = budgetExtra;
  const executors = objectValue(value.executors);
  const executorExtra: JsonObject = {};
  for (const [key, rawExecutor] of Object.entries(executors)) {
    const executor = objectValue(rawExecutor);
    const fields = Object.fromEntries(Object.entries(executor).filter(([field]) => !new Set(["provider", "model", "prompt_version"]).has(field)));
    if (Object.keys(fields).length) executorExtra[key] = fields;
  }
  if (Object.keys(executorExtra).length) extra.executors = executorExtra;
  for (const key of mediaAdapterKeys) {
    const mediaAdapter = objectValue(value[key]);
    const mediaAdapterExtra: JsonObject = {};
    for (const [field, rawValue] of Object.entries(mediaAdapter)) {
      if (field !== "executor" && field !== "credential_ref" && field !== "allowed_tools" && field !== "budget_cents" && field !== "per_shot_budget_cents" && field !== "total_budget_cents" && field !== "max_attempts" && field !== "max_concurrency" && field !== "provider_max_concurrency" && field !== "voice") mediaAdapterExtra[field] = rawValue;
    }
    const mediaExecutor = objectValue(mediaAdapter.executor);
    const mediaExecutorExtra = Object.fromEntries(Object.entries(mediaExecutor).filter(([field]) => !new Set(["provider", "adapter", "model", "prompt_version"]).has(field)));
    if (Object.keys(mediaExecutorExtra).length) mediaAdapterExtra.executor = mediaExecutorExtra;
    if (Object.keys(mediaAdapterExtra).length) extra[key] = mediaAdapterExtra;
  }
  return JSON.stringify(extra, null, 2);
}

function parseAdvancedJson(source: string): JsonObject {
  if (!source.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("高级规则必须是有效的 JSON 对象。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("高级规则必须是 JSON 对象。");
  return parsed as JsonObject;
}

function nonNegativeInteger(source: string, label: string): number {
  const value = Number(source || "0");
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label}必须是大于等于 0 的整数。`);
  return value;
}

function formExecutor(value: Json | undefined): ExecutorForm {
  const executor = objectValue(value);
  return { provider: stringValue(executor.provider) || "codex", model: stringValue(executor.model) || "gpt-5.6-codex", promptVersion: stringValue(executor.prompt_version) || "unversioned" };
}

function formMediaAdapter(value: Json | undefined, fallbackAllowedTools: readonly string[] = [], filterAllowedTools = true): MediaAdapterForm {
  const mediaAdapter = objectValue(value);
  const executor = objectValue(mediaAdapter.executor);
  const voice = objectValue(mediaAdapter.voice);
  const allowedTools = stringArray(mediaAdapter.allowed_tools);
  const visibleAllowedTools = filterAllowedTools ? allowedTools.filter((tool) => visibleToolKeys.has(tool)) : allowedTools;
  return {
    provider: stringValue(executor.provider),
    adapter: stringValue(executor.adapter),
    credentialRef: stringValue(mediaAdapter.credential_ref),
    model: stringValue(executor.model),
    promptVersion: stringValue(executor.prompt_version),
    allowedTools: (visibleAllowedTools.length ? visibleAllowedTools : fallbackAllowedTools).join(", "),
    budgetCents: displayValue(mediaAdapter.budget_cents),
    perShotBudgetCents: displayValue(mediaAdapter.per_shot_budget_cents),
    totalBudgetCents: displayValue(mediaAdapter.total_budget_cents),
    maxAttempts: displayValue(mediaAdapter.max_attempts),
    maxConcurrency: displayValue(mediaAdapter.max_concurrency),
    providerMaxConcurrency: displayValue(mediaAdapter.provider_max_concurrency),
    voiceLanguageCode: stringValue(voice.language_code),
    voiceName: stringValue(voice.name),
    voiceSpeakingRate: displayValue(voice.speaking_rate),
  };
}

export function defaultMediaAdapterForm(key: ConfigurableMediaAdapterKey): MediaAdapterForm {
  const empty: MediaAdapterForm = { provider: "", adapter: "", credentialRef: "", model: "", promptVersion: "", allowedTools: "read, write", budgetCents: "", perShotBudgetCents: "", totalBudgetCents: "", maxAttempts: "1", maxConcurrency: "1", providerMaxConcurrency: "1", voiceLanguageCode: "", voiceName: "", voiceSpeakingRate: "1" };
  if (key === "b_roll") return { ...empty, provider: "pexels", adapter: "pexels_video", credentialRef: "pexels-default", model: "pexels-video-v1", promptVersion: "b-roll-v1" };
  return { ...empty, provider: "google_tts", adapter: "google_tts", model: "standard", promptVersion: "narration-v1" };
}

function mediaAdapterHasValues(form: MediaAdapterForm): boolean {
  return Object.values(form).some((value) => value.trim() !== "");
}

function positiveInteger(source: string, label: string): number {
  const value = Number(source);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label}必须是大于 0 的整数。`);
  return value;
}

function positiveNumber(source: string, label: string): number {
  const value = Number(source);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label}必须是大于 0 的数字。`);
  return value;
}

export function validateMediaAdapter(key: MediaAdapterKey, form: MediaAdapterForm): void {
  if (!mediaAdapterHasValues(form)) return;
  const labels: Record<MediaAdapterKey, string> = { a_roll: "A-roll", b_roll: "B-roll", narration: "旁白", soundtrack: "配乐 / 音效" };
  const label = labels[key];
  if (!form.provider.trim() || !form.adapter.trim() || !form.model.trim() || !form.promptVersion.trim()) throw new Error(`${label}适配器的 Provider、Adapter、模型和 Prompt 版本不能为空。`);
  if (!commaSeparatedValues(form.allowedTools).length) throw new Error(`${label}适配器至少需要一个允许工具。`);
  if (key === "a_roll") {
    positiveInteger(form.budgetCents, `${label}预算`);
    positiveInteger(form.maxAttempts, `${label}最大尝试次数`);
  }
  if (key === "b_roll") {
    const registration = adapterRegistration(form.provider.trim(), form.adapter.trim());
    if (!registration || registration.capability !== "b_roll_generation") throw new Error("B-roll 必须选择已注册的 Adapter。");
    if (!registration.connections.some((connection) => connection.credentialRef === form.credentialRef.trim())) throw new Error("B-roll 必须选择可用的外部连接。");
    positiveInteger(form.perShotBudgetCents, `${label}单镜头预算`);
    positiveInteger(form.totalBudgetCents, `${label}总预算`);
    positiveInteger(form.maxAttempts, `${label}最大尝试次数`);
    positiveInteger(form.maxConcurrency, `${label}最大并发数`);
    positiveInteger(form.providerMaxConcurrency, `${label}供应商并发上限`);
  }
  if (key === "narration") {
    positiveInteger(form.budgetCents, `${label}预算`);
    positiveInteger(form.maxAttempts, `${label}最大尝试次数`);
    if (!form.voiceLanguageCode.trim() || !form.voiceName.trim()) throw new Error("旁白适配器必须填写语言和声音名称。");
    positiveNumber(form.voiceSpeakingRate, "旁白语速");
  }
  if (key === "soundtrack") {
    if (form.provider !== "freesound" || form.adapter !== "freesound_preview" || form.model !== "freesound-preview-v1") throw new Error("配乐 / 音效适配器必须使用 freesound/freesound_preview/freesound-preview-v1。");
    positiveInteger(form.budgetCents, `${label}预算`);
    positiveInteger(form.maxAttempts, `${label}最大尝试次数`);
  }
}

export function validateMediaAdapters(mediaAdapters: Record<MediaAdapterKey, MediaAdapterForm>): void {
  for (const key of mediaAdapterKeys) validateMediaAdapter(key, mediaAdapters[key]);
}

export function validateEnabledMediaAdapters(mediaAdapters: Record<MediaAdapterKey, MediaAdapterForm>, enabledKeys: readonly ConfigurableMediaAdapterKey[]): void {
  const labels: Record<MediaAdapterKey, string> = { a_roll: "A-roll", b_roll: "B-roll", narration: "旁白", soundtrack: "配乐 / 音效" };
  for (const key of enabledKeys) {
    if (!mediaAdapterHasValues(mediaAdapters[key])) throw new Error(`${labels[key]}能力已启用，但配置为空。`);
    validateMediaAdapter(key, mediaAdapters[key]);
  }
}

export function mediaAdapterStatus(key: MediaAdapterKey, form: MediaAdapterForm): "未配置" | "待补齐" | "已配置" {
  if (!mediaAdapterHasValues(form)) return "未配置";
  try {
    validateMediaAdapter(key, form);
    return "已配置";
  } catch {
    return "待补齐";
  }
}

function mediaAdapterToPolicy(form: MediaAdapterForm, existing: JsonObject, accountAllowedTools?: readonly string[]): JsonObject {
  const policy: JsonObject = { ...existing };
  const executorValues: Array<[keyof MediaAdapterForm, string]> = [["provider", "provider"], ["adapter", "adapter"], ["model", "model"], ["promptVersion", "prompt_version"]];
  if (executorValues.some(([formKey]) => form[formKey].trim())) {
    const executor = objectValue(existing.executor);
    for (const [formKey, policyKey] of executorValues) if (form[formKey].trim()) executor[policyKey] = form[formKey].trim();
    policy.executor = executor;
  }
  if (form.allowedTools.trim()) {
    const requestedTools = commaSeparatedValues(form.allowedTools);
    const effectiveTools = accountAllowedTools ? requestedTools.filter((tool) => accountAllowedTools.includes(tool)) : requestedTools;
    if (accountAllowedTools && !effectiveTools.length) throw new Error("媒体能力至少需要一个账号级工具。");
    policy.allowed_tools = effectiveTools;
  }
  if (form.credentialRef.trim()) policy.credential_ref = form.credentialRef.trim();
  else delete policy.credential_ref;
  const numericFields: Array<[keyof MediaAdapterForm, string]> = [["budgetCents", "budget_cents"], ["perShotBudgetCents", "per_shot_budget_cents"], ["totalBudgetCents", "total_budget_cents"], ["maxAttempts", "max_attempts"], ["maxConcurrency", "max_concurrency"], ["providerMaxConcurrency", "provider_max_concurrency"]];
  for (const [formKey, policyKey] of numericFields) {
    if (form[formKey].trim()) policy[policyKey] = Number(form[formKey]);
    else delete policy[policyKey];
  }
  if (form.voiceLanguageCode.trim() || form.voiceName.trim() || form.voiceSpeakingRate.trim()) {
    policy.voice = { ...objectValue(existing.voice), language_code: form.voiceLanguageCode.trim(), name: form.voiceName.trim(), speaking_rate: Number(form.voiceSpeakingRate) };
  } else {
    delete policy.voice;
  }
  return policy;
}

export function blueprintPolicyToForm(policy: Json): BlueprintFormValues {
  const value = objectValue(policy);
  const budgets = objectValue(value.budgets);
  const executors = objectValue(value.executors);
  const accountAllowedTools = stringArray(value.allowed_tools).filter((tool) => visibleToolKeys.has(tool));
  const fallbackMediaAdapterTools = accountAllowedTools.length ? accountAllowedTools : ["read", "write"];
  const enabledMediaAdapters = configurableMediaAdapterKeys.filter((key) => value[key] !== undefined && value[key] !== null);
  return {
    positioning: stringValue(value.positioning),
    assetRoot: stringValue(value.asset_root),
    approvalGates: stringArray(value.approval_gates).length ? stringArray(value.approval_gates) : ["script", "visual", "storyboard", "qc", "publish"],
    allowedTools: fallbackMediaAdapterTools,
    enabledMediaAdapters,
    budgets: {
      scriptWritingCents: String(budgets.script_writing_cents ?? 0),
      visualPlanningCents: String(budgets.visual_planning_cents ?? 0),
      storyboardPlanningCents: String(budgets.storyboard_planning_cents ?? 0),
    },
    executors: {
      script_writing: formExecutor(executors.script_writing),
      visual_planning: formExecutor(executors.visual_planning),
      storyboard_planning: formExecutor(executors.storyboard_planning),
    },
    mediaAdapters: {
      a_roll: formMediaAdapter(value.a_roll, [], false),
      b_roll: formMediaAdapter(value.b_roll, fallbackMediaAdapterTools),
      narration: formMediaAdapter(value.narration, fallbackMediaAdapterTools),
      soundtrack: formMediaAdapter(value.soundtrack, [], false),
    },
    advancedJson: blueprintAdvancedJson(value),
  };
}

export function blueprintFormToPolicy(form: BlueprintFormValues): Json {
  const advanced = parseAdvancedJson(form.advancedJson);
  const existingBudgets = objectValue(advanced.budgets);
  const existingExecutors = objectValue(advanced.executors);
  const existingMediaAdapters = Object.fromEntries(mediaAdapterKeys.map((key) => [key, objectValue(advanced[key])])) as Record<MediaAdapterKey, JsonObject>;
  delete advanced.budgets;
  delete advanced.executors;
  for (const key of mediaAdapterKeys) delete advanced[key];
  const result: JsonObject = {
    ...advanced,
    positioning: form.positioning.trim(),
    asset_root: form.assetRoot.trim(),
    approval_gates: form.approvalGates,
    allowed_tools: form.allowedTools.filter((tool) => visibleToolKeys.has(tool)),
    budgets: {
      ...existingBudgets,
      script_writing_cents: nonNegativeInteger(form.budgets.scriptWritingCents, "脚本预算"),
      visual_planning_cents: nonNegativeInteger(form.budgets.visualPlanningCents, "视觉预算"),
      storyboard_planning_cents: nonNegativeInteger(form.budgets.storyboardPlanningCents, "分镜预算"),
    },
    executors: {
      ...existingExecutors,
      ...Object.fromEntries(executorKeys.map((key) => [key, {
        ...objectValue(existingExecutors[key]),
        provider: form.executors[key].provider.trim(),
        model: form.executors[key].model.trim(),
        prompt_version: form.executors[key].promptVersion.trim(),
      }])),
    },
  };
  const enabledMediaAdapters = form.enabledMediaAdapters ?? configurableMediaAdapterKeys;
  for (const key of mediaAdapterKeys) {
    const isConfigurable = configurableMediaAdapterKeys.includes(key as ConfigurableMediaAdapterKey);
    if (isConfigurable && !enabledMediaAdapters.includes(key as ConfigurableMediaAdapterKey)) continue;
    const hasFormValues = mediaAdapterHasValues(form.mediaAdapters[key]);
    const hasLegacyFields = !isConfigurable && Object.keys(existingMediaAdapters[key]).length > 0;
    if (hasFormValues || hasLegacyFields) {
      const accountAllowedTools = isConfigurable ? form.allowedTools.filter((tool) => visibleToolKeys.has(tool)) : undefined;
      result[key] = hasFormValues ? mediaAdapterToPolicy(form.mediaAdapters[key], existingMediaAdapters[key], accountAllowedTools) : existingMediaAdapters[key];
    }
  }
  return result as Json;
}

export function seriesRulesToForm(rules: Json): SeriesFormValues {
  const value = objectValue(rules);
  return {
    positioning: displayValue(value.positioning),
    format: displayValue(value.format),
    characters: displayValue(value.characters),
    locations: displayValue(value.locations),
    visualStyle: displayValue(value.visual_style),
    narrativeStructure: displayValue(value.narrative_structure),
    restrictions: displayValue(value.restrictions),
    advancedJson: advancedJson(value, seriesKnownKeys),
  };
}

export function seriesFormToRules(form: SeriesFormValues): Json {
  const advanced = parseAdvancedJson(form.advancedJson);
  for (const key of seriesKnownKeys) delete advanced[key];
  const known = Object.fromEntries([
    ["positioning", parseSeriesField(form.positioning)],
    ["format", parseSeriesField(form.format)],
    ["characters", parseSeriesField(form.characters)],
    ["locations", parseSeriesField(form.locations)],
    ["visual_style", parseSeriesField(form.visualStyle)],
    ["narrative_structure", parseSeriesField(form.narrativeStructure)],
    ["restrictions", parseSeriesField(form.restrictions)],
  ].filter(([, value]) => value !== undefined));
  return { ...advanced, ...known } as Json;
}

function parseSeriesField(source: string): Json | undefined {
  const value = source.trim();
  if (!value) return undefined;
  if (value.startsWith("{") || value.startsWith("[")) {
    try { return JSON.parse(value) as Json; } catch { return value; }
  }
  return value;
}

export function validateSeriesRules(rules: Json): void {
  const value = objectValue(rules);
  const forbidden = ["asset_root", "allowed_tools", "approval_gates", "publishing", ...mediaAdapterKeys].filter((key) => value[key] !== undefined);
  if (forbidden.length) throw new Error(`系列规则不能覆盖账号硬约束：${forbidden.join("、")}。`);
}
