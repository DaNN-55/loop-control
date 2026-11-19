import { describe, expect, it } from "vitest";
import {
  blueprintFormToPolicy as creativeBlueprintFormToPolicy,
  blueprintPolicyToForm,
  seriesFormToRules,
  seriesRulesToForm,
  validateSeriesRules,
} from "./configurationFormValues";

describe("当前账号与系列创作规则转换", () => {
  it("当前蓝图只保存创作规则，不从高级 JSON 重新引入技术配置",()=>{const form=blueprintPolicyToForm({positioning:"纪实",tone:"克制",asset_root:"/old",allowed_tools:["read"],approval_gates:[],executors:{},static_visual:{}});form.advancedJson=JSON.stringify({tone:"明亮",budgets:{storyboard_planning_cents:1},narration:{credential_ref:"old"}});expect(creativeBlueprintFormToPolicy(form)).toEqual({positioning:"纪实",tone:"明亮"});});
});

describe("系列规则表单转换", () => {
  it("只读取表单支持的创作基线字段", () => {
    const form = seriesRulesToForm({ positioning: "雨夜志怪", format: "短视频", visual_style: "写实", characters: [{ name: "林砚" }], b_roll: { executor: { provider: "pexels" } } });

    expect(form.positioning).toBe("雨夜志怪");
    expect(form.format).toBe("短视频");
    expect(form.characters).toContain("林砚");
    expect(form.advancedJson).toContain("b_roll");
  });

  it("保留未单独展示的系列扩展规则", () => {
    expect(() => validateSeriesRules({ extension: { nested: ["preserved"] } })).not.toThrow();
  });

  it("往返保存 JSON 数组形式的角色设定", () => {
    const result = seriesFormToRules({ positioning: "", format: "", characters: '[{"name":"林砚"}]', locations: "", visualStyle: "", narrativeStructure: "", restrictions: "" });
    expect(result).toMatchObject({ characters: [{ name: "林砚" }] });
  });
});

it('keeps structured positioning and non-string series values when saving another rule',()=>{
 const positioning={audience:['读者'],topics:{primary:'自然'}};
 const blueprint=blueprintPolicyToForm({positioning,tone:'自然'});expect(creativeBlueprintFormToPolicy(blueprint)).toEqual({positioning,tone:'自然'});
 const rules={positioning:false,format:3,characters:null,locations:['山间'],restrictions:{content:['禁止造假']},extension:{enabled:true}};
 expect(seriesFormToRules(seriesRulesToForm(rules))).toEqual(rules);
});
