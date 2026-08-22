import { describe, expect, it } from "vitest";
import { adapterRegistration, registeredAdaptersForCapability } from "./adapterRegistry";

describe("adapter registry", () => {
  it("查询 B-roll 目录时返回 Pexels 执行与连接契约", () => {
    expect(registeredAdaptersForCapability("b_roll_generation")).toEqual([
      expect.objectContaining({
        id: "pexels_video",
        provider: "pexels",
        connectionType: "pexels_api",
        requiresNetwork: true,
        configurationFields: ["per_shot_budget_cents", "total_budget_cents", "max_attempts", "max_concurrency", "provider_max_concurrency"],
      }),
    ]);
    expect(adapterRegistration("pexels", "pexels_video")?.connections).toEqual([
      { credentialRef: "pexels-default", environmentVariable: "PEXELS_API_KEY", label: "Pexels 默认连接" },
    ]);
  });
});
