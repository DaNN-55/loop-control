import { describe, expect, it } from "vitest";
import {
  blueprintFormToPolicy,
  blueprintPolicyToForm,
  seriesFormToRules,
  seriesRulesToForm,
  validateMediaAdapter,
  validateMediaAdapters,
  validateSeriesRules,
} from "./configurationFormValues";

describe("账号蓝图表单转换", () => {
  it("默认关闭可用媒体能力，并只保存已启用的能力", () => {
    const form = blueprintPolicyToForm({});

    expect(form.enabledMediaAdapters).toEqual([]);

    const result = blueprintFormToPolicy({
      ...form,
      enabledMediaAdapters: ["b_roll"],
      mediaAdapters: {
        ...form.mediaAdapters,
        b_roll: { ...form.mediaAdapters.b_roll, provider: "pexels", adapter: "pexels_video", model: "pexels-video-v1", promptVersion: "b-roll-v1", allowedTools: "read, write", perShotBudgetCents: "10", totalBudgetCents: "100", maxAttempts: "1", maxConcurrency: "1", providerMaxConcurrency: "1" },
      },
    });

    expect(result).toHaveProperty("b_roll");
    expect(result).not.toHaveProperty("narration");
    expect(result).not.toHaveProperty("soundtrack");
  });

  it("保留已有 A-roll 和配乐旧规则，但不把它们作为可用能力启用", () => {
    const form = blueprintPolicyToForm({ a_roll: { executor: { provider: "codex", adapter: "codex" } }, soundtrack: { budget_cents: 99 } });

    expect(form.enabledMediaAdapters).toEqual([]);
    const result = blueprintFormToPolicy(form) as Record<string, unknown>;

    expect(result.a_roll).toEqual(expect.objectContaining({ executor: { provider: "codex", adapter: "codex" } }));
    expect(result.soundtrack).toEqual(expect.objectContaining({ budget_cents: 99 }));
  });

  it("保留只含未表单化字段的媒体旧规则", () => {
    const form = blueprintPolicyToForm({ a_roll: { legacy_mode: "keep" }, soundtrack: { cue_source: "legacy" } });
    const result = blueprintFormToPolicy(form) as Record<string, unknown>;

    expect(result.a_roll).toEqual({ legacy_mode: "keep" });
    expect(result.soundtrack).toEqual({ cue_source: "legacy" });
  });

  it("保留旧媒体规则中的 network 工具", () => {
    const form = blueprintPolicyToForm({ a_roll: { allowed_tools: ["network"] }, soundtrack: { allowed_tools: ["network"] } });
    const result = blueprintFormToPolicy(form) as Record<string, unknown>;

    expect(result.a_roll).toEqual({ allowed_tools: ["network"] });
    expect(result.soundtrack).toEqual({ allowed_tools: ["network"] });
  });

  it("媒体能力工具不能超过账号级工具白名单", () => {
    const form = blueprintPolicyToForm({ allowed_tools: ["read"], b_roll: { allowed_tools: ["read", "write"] } });
    const result = blueprintFormToPolicy(form) as Record<string, unknown>;

    expect(result.b_roll).toMatchObject({ allowed_tools: ["read"] });
  });

  it("把旧媒体工具归一化到账号级白名单", () => {
    const form = blueprintPolicyToForm({
      allowed_tools: ["read"],
      b_roll: { allowed_tools: ["network"], executor: { provider: "pexels", adapter: "pexels_video", model: "pexels-video-v1", prompt_version: "b-roll-v1" }, per_shot_budget_cents: 10, total_budget_cents: 100, max_attempts: 1, max_concurrency: 1, provider_max_concurrency: 1 },
    });
    const result = blueprintFormToPolicy(form) as Record<string, unknown>;

    expect(form.mediaAdapters.b_roll.allowedTools).toBe("read");
    expect(result.b_roll).toMatchObject({ allowed_tools: ["read"] });
  });

  it("拒绝媒体工具与账号白名单没有交集的直接提交", () => {
    const form = blueprintPolicyToForm({});
    expect(() => blueprintFormToPolicy({
      ...form,
      allowedTools: ["read"],
      enabledMediaAdapters: ["b_roll"],
      mediaAdapters: {
        ...form.mediaAdapters,
        b_roll: { ...form.mediaAdapters.b_roll, provider: "pexels", adapter: "pexels_video", model: "pexels-video-v1", promptVersion: "b-roll-v1", allowedTools: "network", perShotBudgetCents: "10", totalBudgetCents: "100", maxAttempts: "1", maxConcurrency: "1", providerMaxConcurrency: "1" },
      },
    })).toThrow("账号级工具");
  });

  it("读取常用字段并保留高级规则", () => {
    const form = blueprintPolicyToForm({
      positioning: "越南民俗短视频",
      asset_root: "/Volumes/Media/dao",
      approval_gates: ["script", "qc"],
      allowed_tools: ["read", "write"],
      budgets: { script_writing_cents: 12, visual_planning_cents: 34, storyboard_planning_cents: 56, global_cap_cents: 99 },
      executors: { script_writing: { provider: "codex", model: "gpt-5.6", prompt_version: "script-v2", adapter: "codex", temperature: 0.2 } },
      soundtrack: { executor: { provider: "freesound" } },
    });

    expect(form.positioning).toBe("越南民俗短视频");
    expect(form.assetRoot).toBe("/Volumes/Media/dao");
    expect(form.budgets.scriptWritingCents).toBe("12");
    expect(form.mediaAdapters.soundtrack.provider).toBe("freesound");
    expect(form.advancedJson).not.toContain("soundtrack");
    expect(form.advancedJson).toContain("global_cap_cents");
    expect(form.advancedJson).toContain("temperature");
  });

  it("把媒体适配器从高级 JSON 提升为独立配置字段", () => {
    const form = blueprintPolicyToForm({
      a_roll: { executor: { provider: "codex", adapter: "codex", model: "video-model", prompt_version: "a-roll-v1" }, allowed_tools: ["read", "write"], budget_cents: 20, max_attempts: 2 },
      narration: { executor: { provider: "google_tts", adapter: "google_tts", model: "tts-model", prompt_version: "narration-v1" }, allowed_tools: ["network", "write"], budget_cents: 12, max_attempts: 1, voice: { language_code: "zh-CN", name: "voice-a", speaking_rate: 1 } },
    });

    expect(form.mediaAdapters.a_roll.adapter).toBe("codex");
    expect(form.mediaAdapters.a_roll.allowedTools).toBe("read, write");
    expect(form.mediaAdapters.narration.voiceName).toBe("voice-a");
    expect(form.advancedJson).not.toContain("a_roll");
    expect(form.advancedJson).not.toContain("narration");
  });

  it("用表单字段覆盖已知配置，但不丢失高级字段", () => {
    const result = blueprintFormToPolicy({
      positioning: "新的账号定位",
      assetRoot: "/Volumes/Media/new",
      approvalGates: ["script", "publish"],
      allowedTools: ["read", "write", "network"],
      budgets: { scriptWritingCents: "10", visualPlanningCents: "20", storyboardPlanningCents: "30" },
      executors: {
        script_writing: { provider: "codex", model: "model-a", promptVersion: "prompt-a" },
        visual_planning: { provider: "codex", model: "model-b", promptVersion: "prompt-b" },
        storyboard_planning: { provider: "codex", model: "model-c", promptVersion: "prompt-c" },
      },
      mediaAdapters: {
        a_roll: { provider: "codex", adapter: "codex", model: "video-model", promptVersion: "a-roll-v1", allowedTools: "read, write", budgetCents: "20", perShotBudgetCents: "", totalBudgetCents: "", maxAttempts: "2", maxConcurrency: "", providerMaxConcurrency: "", voiceLanguageCode: "", voiceName: "", voiceSpeakingRate: "" },
        b_roll: { provider: "pexels", adapter: "pexels_video", model: "pexels-video-v1", promptVersion: "b-roll-v1", allowedTools: "network, write", budgetCents: "", perShotBudgetCents: "10", totalBudgetCents: "100", maxAttempts: "2", maxConcurrency: "3", providerMaxConcurrency: "2", voiceLanguageCode: "", voiceName: "", voiceSpeakingRate: "" },
        narration: { provider: "google_tts", adapter: "google_tts", model: "tts-model", promptVersion: "narration-v1", allowedTools: "network, write", budgetCents: "12", perShotBudgetCents: "", totalBudgetCents: "", maxAttempts: "1", maxConcurrency: "", providerMaxConcurrency: "", voiceLanguageCode: "zh-CN", voiceName: "voice-a", voiceSpeakingRate: "0.8" },
        soundtrack: { provider: "freesound", adapter: "freesound_preview", model: "sound-model", promptVersion: "soundtrack-v1", allowedTools: "network, write", budgetCents: "", perShotBudgetCents: "", totalBudgetCents: "", maxAttempts: "", maxConcurrency: "", providerMaxConcurrency: "", voiceLanguageCode: "", voiceName: "", voiceSpeakingRate: "" },
      },
      advancedJson: '{"soundtrack":{"budget_cents":99}}',
    });

    expect(result).toMatchObject({ positioning: "新的账号定位", asset_root: "/Volumes/Media/new", approval_gates: ["script", "publish"], allowed_tools: ["read", "write"] });
    expect(result).toMatchObject({ budgets: { script_writing_cents: 10, visual_planning_cents: 20, storyboard_planning_cents: 30 } });
    expect(result).toMatchObject({ executors: { script_writing: { model: "model-a" }, visual_planning: { model: "model-b" }, storyboard_planning: { model: "model-c" } } });
    expect(result).toMatchObject({ a_roll: { executor: { adapter: "codex" }, budget_cents: 20, max_attempts: 2 }, b_roll: { executor: { adapter: "pexels_video" }, per_shot_budget_cents: 10, total_budget_cents: 100 }, narration: { voice: { language_code: "zh-CN", name: "voice-a", speaking_rate: 0.8 } }, soundtrack: { executor: { adapter: "freesound_preview" } } });
  });

  it("拒绝未完成的媒体适配器配置", () => {
    const form = blueprintPolicyToForm({ a_roll: { executor: { provider: "codex" } } });
    expect(() => validateMediaAdapters(form.mediaAdapters)).toThrow("A-roll适配器");
  });

  it("校验配乐必须使用已注册的 Freesound 适配器", () => {
    const form = blueprintPolicyToForm({ soundtrack: { executor: { provider: "freesound", adapter: "freesound_preview", model: "freesound-preview-v1", prompt_version: "soundtrack-v1" }, allowed_tools: ["read", "write"], budget_cents: 10, max_attempts: 1 } }).mediaAdapters.soundtrack;

    expect(() => validateMediaAdapter("soundtrack", form)).not.toThrow();
    expect(() => validateMediaAdapter("soundtrack", { ...form, adapter: "other" })).toThrow("freesound/freesound_preview/freesound-preview-v1");
  });
});

describe("系列规则表单转换", () => {
  it("将常用文本字段和高级 JSON 分开读取", () => {
    const form = seriesRulesToForm({ positioning: "雨夜志怪", format: "短视频", visual_style: "写实", characters: [{ name: "林砚" }], b_roll: { executor: { provider: "pexels" } } });

    expect(form.positioning).toBe("雨夜志怪");
    expect(form.format).toBe("短视频");
    expect(form.characters).toContain("林砚");
    expect(form.advancedJson).toContain("b_roll");
  });

  it("将表单保存为对象并保留高级规则", () => {
    const result = seriesFormToRules({
      positioning: "新的系列",
      format: "三段式",
      characters: "林砚、铜铃",
      locations: "古宅",
      visualStyle: "电影感",
      narrativeStructure: "冲突—选择—余韵",
      restrictions: "不使用现代品牌",
      advancedJson: '{"b_roll":{"executor":{"provider":"pexels"}}}',
    });

    expect(result).toMatchObject({ positioning: "新的系列", format: "三段式", visual_style: "电影感", b_roll: { executor: { provider: "pexels" } } });
    expect((result as Record<string, unknown>).characters).toBe("林砚、铜铃");
  });

  it("拒绝系列覆盖账号硬约束", () => {
    expect(() => validateSeriesRules({ allowed_tools: ["network"] })).toThrow("系列规则不能覆盖账号硬约束");
  });

  it("往返保存 JSON 数组形式的角色设定", () => {
    const result = seriesFormToRules({ positioning: "", format: "", characters: '[{"name":"林砚"}]', locations: "", visualStyle: "", narrativeStructure: "", restrictions: "", advancedJson: "{}" });
    expect(result).toMatchObject({ characters: [{ name: "林砚" }] });
  });
});
