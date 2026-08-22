import type { Json } from "../lib/database.types";
import type { WorkerPreflightAction, WorkerPreflightResult, WorkerPreflightStatus } from "../worker/contracts";
import { blueprintPolicyToForm, type ConfigurableMediaAdapterKey } from "./configurationFormValues";

const capabilityByMediaAdapter: Record<ConfigurableMediaAdapterKey, string> = { static_visual: "static_visual_generation", a_roll: "a_roll_generation", b_roll: "b_roll_generation", narration: "narration_generation", soundtrack: "soundtrack_generation" };

export type ExternalConnectionStatus = {
  action: WorkerPreflightAction;
  adapter: string;
  capability: string;
  check: string | null;
  key: ConfigurableMediaAdapterKey;
  provider: string;
  reason: string;
  status: WorkerPreflightStatus | "pending";
};

export function externalConnectionStatuses(policy: Json, preflight: WorkerPreflightResult | null): ExternalConnectionStatus[] {
  const form = blueprintPolicyToForm(policy);
  return (form.enabledMediaAdapters ?? []).map((key) => {
    const capability = capabilityByMediaAdapter[key];
    const checks = preflight?.checks.filter((check) => check.capability === capability) ?? [];
    const failedCheck = checks.find((check) => check.status !== "passed");
    const adapter = form.mediaAdapters[key];
    return {
      action: failedCheck?.action ?? "none",
      adapter: adapter.adapter,
      capability,
      check: failedCheck?.check ?? null,
      key,
      provider: adapter.provider,
      reason: failedCheck?.reason ?? (checks.length ? "Worker 已通过当前连接检查。" : "尚未执行连接检查。"),
      status: failedCheck?.status ?? (checks.length ? "passed" : "pending"),
    };
  });
}
