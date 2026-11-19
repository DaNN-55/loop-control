import {creativeAccountRules} from '../creativeAccountRules';
import type { Json } from "../lib/database.types";

type JsonObject = Record<string, Json | undefined>;
export interface BlueprintFormValues {positioning:string;advancedJson:string}

export interface SeriesFormValues {
  advancedJson?: string;
  originalRulesJson?: string;
  positioning: string;
  format: string;
  characters: string;
  locations: string;
  visualStyle: string;
  narrativeStructure: string;
  restrictions: string;
}

const seriesKnownKeys = new Set(["positioning", "format", "characters", "locations", "visual_style", "narrative_structure", "restrictions"]);
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

function blueprintAdvancedJson(value: JsonObject): string {
  const rules = creativeAccountRules(value);
  if (typeof rules.positioning === "string") delete rules.positioning;
  return JSON.stringify(rules, null, 2);
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

export function blueprintPolicyToForm(policy:Json):BlueprintFormValues {
 const value=objectValue(policy);
 return {positioning:stringValue(value.positioning),advancedJson:blueprintAdvancedJson(value)};
}
export function blueprintFormToPolicy(form:BlueprintFormValues):Json {
 const rules=creativeAccountRules(parseAdvancedJson(form.advancedJson));
 const keepStructuredPositioning = "positioning" in rules && typeof rules.positioning !== "string" && !form.positioning.trim();
 return {...rules,...(keepStructuredPositioning ? {} : {positioning:form.positioning.trim()})} as Json;
}

export function seriesRulesToForm(rules: Json): SeriesFormValues {
  const value = objectValue(rules);
  return {
    originalRulesJson: JSON.stringify(value),
    advancedJson: JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => !seriesKnownKeys.has(key))), null, 2),
    positioning: displayValue(value.positioning),
    format: displayValue(value.format),
    characters: displayValue(value.characters),
    locations: displayValue(value.locations),
    visualStyle: displayValue(value.visual_style),
    narrativeStructure: displayValue(value.narrative_structure),
    restrictions: displayValue(value.restrictions),
  };
}

export function seriesFormToRules(form: SeriesFormValues): Json {
  const original = parseAdvancedJson(form.originalRulesJson ?? "{}");
  return {...parseAdvancedJson(form.advancedJson ?? "{}"), ...Object.fromEntries([
    ["positioning", parseSeriesField(form.positioning, original.positioning)],
    ["format", parseSeriesField(form.format, original.format)],
    ["characters", parseSeriesField(form.characters, original.characters)],
    ["locations", parseSeriesField(form.locations, original.locations)],
    ["visual_style", parseSeriesField(form.visualStyle, original.visual_style)],
    ["narrative_structure", parseSeriesField(form.narrativeStructure, original.narrative_structure)],
    ["restrictions", parseSeriesField(form.restrictions, original.restrictions)],
  ].filter(([, value]) => value !== undefined))} as Json;
}

function parseSeriesField(source: string, original?: Json): Json | undefined {
  if (source === displayValue(original)) return original;
  const value = source.trim();
  if (!value) return undefined;
  if (value.startsWith("{") || value.startsWith("[")) {
    try { return JSON.parse(value) as Json; } catch { return value; }
  }
  return value;
}

export function validateSeriesRules(rules: Json): void {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) throw new Error("系列规则必须为 JSON 对象。");
}
