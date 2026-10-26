import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/wanClaimedTask.json";
import { runCodexWorker, type ClaimedWorkerTask } from "./codexRunner";

// Captured from request_wan_shot_video -> claim_next_worker_task in a rolled-back
// database transaction. No provider HTTP call or persistent fixture was created.
describe("Wan database-to-Worker contract", () => {
  it.each(["a_roll", "b_roll"])("%s 的真实领取快照可进入执行器", async (kind) => {
    const snapshot = structuredClone(fixture.input_snapshot);
    snapshot.capability = `${kind}_generation`;
    snapshot.shot.shotType = kind;
    snapshot.output.required_artifact_types = [kind === "a_roll" ? "a_roll_video" : "b_roll_asset"];
    const execute = vi.fn().mockRejectedValue(new Error("stop before any provider call"));
    const task: ClaimedWorkerTask = { taskId: fixture.task_id, taskType: `generate_${kind}`, provider: "bailian", model: fixture.model, promptVersion: fixture.prompt_version, attempt: fixture.attempt, maxAttempts: fixture.max_attempts, budgetLimitCents: fixture.budget_limit_cents, episodeId: fixture.episode_id, accountId: fixture.account_id, blueprintVersionId: fixture.blueprint_version_id, title: fixture.title, allowedAssetRoot: fixture.allowed_asset_root, inputSnapshot: snapshot };
    await runCodexWorker({ claimNextTask: async () => task, execute, reportResult: vi.fn(), verifyAssetRoot: async () => {}, verifyArtifacts: async () => {}, actualCostCents: 0 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({ capability: `${kind}_generation`, media: { adapter: "wan_video", wanVideo: { durationSeconds: 5, imageMime: "image/png" } }, output: { contentType: "video/mp4" }, budget: { attempt: 0 } });
  });
});
