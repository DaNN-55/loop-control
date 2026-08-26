import { describe, expect, it } from "vitest";
import { repairTargetForBlocker } from "./repairTarget";

describe("可修复目标", () => {
  it("直接使用 Worker 给出的可编辑能力，不读取错误文案", () => {
    expect(repairTargetForBlocker({ action: "edit_blueprint", capability: "b_roll_generation", code: "blueprint_configuration", detail: "配置需要更新。" })).toEqual({ kind: "media", key: "b_roll" });
  });

  it("不把明确的运行环境故障误导为配置修复", () => {
    expect(repairTargetForBlocker({ action: "contact_environment_admin", capability: "a_roll_generation", code: "a_roll_executor_unavailable", detail: "A-roll 适配器未注册。" })).toBeNull();
  });

  it("只为旧结果在一处保留文字识别", () => {
    expect(repairTargetForBlocker({ code: "legacy", detail: "旁白适配器未配置。" })).toEqual({ kind: "media", key: "narration" });
  });
});
