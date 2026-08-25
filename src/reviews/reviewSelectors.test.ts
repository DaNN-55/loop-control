import { describe, expect, it } from "vitest";
import { blockersFromResult, isReviewPackagePending, workerBlockers } from "./reviewSelectors";
import type { Database } from "../lib/database.types";

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

  it("把带结构化执行失败的 failed 任务也呈现为 Worker 阻塞项", () => {
    expect(workerBlockers([{
      id: "task-1",
      episode_id: "episode-1",
      task_type: "generate_script",
      status: "failed",
      last_result: {
        blockers: [{
          code: "network_connectivity",
          detail: "模型服务网络探测失败。",
          check: "network_connectivity",
          phase: "execution",
          status: "retryable",
          action: "retry",
          scope: "worker",
        }],
      },
    }], "episode-1")).toEqual([expect.objectContaining({ code: "network_connectivity", taskId: "task-1" })]);
  });

  it("不把自动审核渲染前的冻结包计为人工待审", () => {
    const reviewPackage = { context_snapshot: { approval_mode: "qc_only" }, id: "package-1", stage: "production_ready" } as unknown as Database["public"]["Tables"]["review_packages"]["Row"];
    const member = { member_key: "shot:shot-1", review_package_id: reviewPackage.id } as Database["public"]["Tables"]["pre_render_review_members"]["Row"];

    expect(isReviewPackagePending(reviewPackage, [member], [])).toBe(false);
  });
});
