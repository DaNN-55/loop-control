import type { Json } from "../lib/database.types";

type JsonObject = Record<string, Json | undefined>;
type ExecutorForm = { provider: string; model: string; promptVersion: string };

export interface BlueprintFormValues {
  positioning: string;
  assetRoot: string;
  approvalGates: string[];
  allowedTools: string[];
  budgets: { scriptWritingCents: string; visualPlanningCents: string; storyboardPlanningCents: string };
  executors: Record<"script_writing" | "visual_planning" | "storyboard_planning", ExecutorForm>;
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

const blueprintKnownKeys = new Set(["positioning", "asset_root", "approval_gates", "allowed_tools", "budgets", "executors"]);
const seriesKnownKeys = new Set(["positioning", "format", "characters", "locations", "visual_style", "narrative_structure", "restrictions"]);
const executorKeys = ["script_writing", "visual_planning", "storyboard_planning"] as const;

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

export function blueprintPolicyToForm(policy: Json): BlueprintFormValues {
  const value = objectValue(policy);
  const budgets = objectValue(value.budgets);
  const executors = objectValue(value.executors);
  return {
    positioning: stringValue(value.positioning),
    assetRoot: stringValue(value.asset_root),
    approvalGates: stringArray(value.approval_gates).length ? stringArray(value.approval_gates) : ["script", "visual", "storyboard", "qc", "publish"],
    allowedTools: stringArray(value.allowed_tools).length ? stringArray(value.allowed_tools) : ["read", "write"],
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
    advancedJson: blueprintAdvancedJson(value),
  };
}

export function blueprintFormToPolicy(form: BlueprintFormValues): Json {
  const advanced = parseAdvancedJson(form.advancedJson);
  const existingBudgets = objectValue(advanced.budgets);
  const existingExecutors = objectValue(advanced.executors);
  delete advanced.budgets;
  delete advanced.executors;
  return {
    ...advanced,
    positioning: form.positioning.trim(),
    asset_root: form.assetRoot.trim(),
    approval_gates: form.approvalGates,
    allowed_tools: form.allowedTools,
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
  } as Json;
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
  const forbidden = ["asset_root", "allowed_tools", "approval_gates", "publishing"].filter((key) => value[key] !== undefined);
  if (forbidden.length) throw new Error(`系列规则不能覆盖账号硬约束：${forbidden.join("、")}。`);
}
