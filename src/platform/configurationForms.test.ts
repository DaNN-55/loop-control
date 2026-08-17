import { describe, expect, it } from "vitest";
import {
  blueprintFormToPolicy,
  blueprintPolicyToForm,
  seriesFormToRules,
  seriesRulesToForm,
  validateSeriesRules,
} from "./configurationFormValues";

describe("账号蓝图表单转换", () => {
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
    expect(form.advancedJson).toContain("soundtrack");
    expect(form.advancedJson).toContain("global_cap_cents");
    expect(form.advancedJson).toContain("temperature");
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
      advancedJson: '{"soundtrack":{"budget_cents":99}}',
    });

    expect(result).toMatchObject({ positioning: "新的账号定位", asset_root: "/Volumes/Media/new", approval_gates: ["script", "publish"], allowed_tools: ["read", "write", "network"] });
    expect(result).toMatchObject({ budgets: { script_writing_cents: 10, visual_planning_cents: 20, storyboard_planning_cents: 30 } });
    expect(result).toMatchObject({ executors: { script_writing: { model: "model-a" }, visual_planning: { model: "model-b" }, storyboard_planning: { model: "model-c" } } });
    expect(result).toMatchObject({ soundtrack: { budget_cents: 99 } });
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
