import { describe, expect, it } from "vitest";
import { blockersFromResult } from "./reviewSelectors";

describe("blockersFromResult", () => {
  it("从结构化 preflight 结果提取未通过检查", () => {
    expect(blockersFromResult({
      blockers: [],
      preflight: {
        version: "worker-preflight/v1",
        checks: [{
          capability: "b_roll_generation",
          check: "credential_presence",
          phase: "preflight",
          status: "unavailable",
          reason: "PEXELS_API_KEY 未配置。",
          action: "contact_environment_admin",
          scope: "worker",
        }],
      },
    })).toEqual([{
      code: "credential_presence",
      detail: "PEXELS_API_KEY 未配置。",
      capability: "b_roll_generation",
      check: "credential_presence",
      phase: "preflight",
      status: "unavailable",
      action: "contact_environment_admin",
      scope: "worker",
    }]);
  });
});
