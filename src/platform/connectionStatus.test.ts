import { describe, expect, it } from "vitest";
import { externalConnectionStatuses } from "./connectionStatus";
import type { WorkerPreflightResult } from "../worker/contracts";

const preflight: WorkerPreflightResult = {
  version: "worker-preflight/v1",
  checks: [
    { action: "none", capability: "b_roll_generation", check: "capability_registration", phase: "preflight", reason: "Pexels 已注册", scope: "worker", status: "passed" },
    { action: "contact_environment_admin", capability: "b_roll_generation", check: "credential_presence", phase: "preflight", reason: "缺少 PEXELS_API_KEY", scope: "worker", status: "unavailable" },
    { action: "contact_environment_admin", capability: "narration_generation", check: "credential_presence", phase: "preflight", reason: "缺少 GOOGLE_TTS_API_KEY", scope: "worker", status: "unavailable" },
  ],
};

describe("externalConnectionStatuses", () => {
  it("只返回蓝图已启用的外部连接", () => {
    const statuses = externalConnectionStatuses({ b_roll: { executor: { provider: "pexels", adapter: "pexels_video" } } }, preflight);

    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ capability: "b_roll_generation", provider: "pexels", status: "unavailable" });
    expect(statuses[0]).not.toHaveProperty("narration_generation");
  });

  it("没有执行检查时标记为待检查", () => {
    const statuses = externalConnectionStatuses({ narration: { executor: { provider: "google_tts", adapter: "google_tts" } } }, null);

    expect(statuses[0]).toMatchObject({ capability: "narration_generation", provider: "google_tts", status: "pending", action: "none" });
  });
});
