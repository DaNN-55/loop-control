# T02 / #168 integration merge

- Integration worktree: `/Users/dan/.codex/worktrees/blueprint-166/integration`.
- Baseline: `b817e5dfc4c3c4814ec89607b27ee6cc6318f324`.
- Incoming: `codex/blueprint-166-t02` at `e468a9e2fb58a19c1dbb701b068e8e161f825a11`.
- No-fast-forward merge: `e17ee3ca757d7180ec6038f7a312177def4406ae` (`merge: integrate per-request image selections (#168)`). No conflicts. Worktree clean after verification.

## Reviewed contracts

Reviewed frozen `ProductionSelection`, `resolveProductionSelection(c,value,capability)`, Owner command field allowance, compatible execution snapshot, selection/context/target/cost provenance, image candidate freshness compatibility, and migration100's SQL enqueue/credential boundary. The resolver validates capability/provider/adapter/model/preset and exact owned current verified connection against `registeredAdapters.productionChoices()` and returns `{choice,selection,connection,execution}` without credential values or secret refs. Request fields and constraints remain channel-specific.

New image requests freeze an exact connection version and creative context without requiring blueprint image authority. SQL retains current owned verified connection checks at enqueue, live workspace/script authorization, budget including unreserved queued image tasks, and same-shot pending/unknown submission guard. Exact queued image versions may execute after connection rotation while revocation/qualification/keychain binding remain enforced. Legacy image requests retain the blueprint compatibility read path; non-image channels delegate to the prior credential implementation. No merge-time behavior edits were needed.

## Verified on integration merge

- `npm run check`: passed; `T02-merge-check.log`.
- `npm run runtime:prepare`: passed; trusted compiled Worker/backend prepared in integration only; `T02-merge-runtime.log`.
- `LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_WORKSPACE_ACCEPTANCE=1 npx vitest run src/local-app/productionSelection.integration.test.ts src/local-app/workspaceImageGeneration.integration.test.ts`: **2 files / 3 tests passed**; `T02-merge-image.log`. Actual Owner HTTP, disposable DB, compiled Worker, controlled synthetic credentials/provider, PNG candidates and native adoption. Includes A/B connection freezing, A rotation, legacy batch, unknown-submit restart/no duplicate reservation, boundary rejects and idempotency.
- `npx vitest run src/local-app/WorkspaceVisualCandidatesPanel.test.tsx src/local-app/WorkspaceImageMatch.test.tsx src/local-app/WorkspaceGenerationBudget.test.tsx src/worker/registeredAdapters.test.ts`: **4 files / 27 tests passed**; `T02-merge-unit.log`.
- `git diff --check`: passed.

## Limits and downstream notes

- Handoff's previous actual browser desktop/narrow verification remains T02's browser evidence; this merge adds no UI edits and did not repeat browser checks.
- Did not repeat unrelated documented legacy placeholder/SDK fixture failures or claim those suites passed.
- Integration image run emitted existing pg concurrent-query deprecation warning; assertions all passed. No issue requiring a merge block was found.
- T03/T05/T06 can import the shared selection and resolver contracts above, use exact registry constraints, freeze the returned compatible execution and channel provenance, and retain existing runtime readiness/secret checks.
- Root owns PLAN/CONTEXT/ADR/report updates. No edits to daily checkout, services, daily data/migrations, GitHub issue state, push, deploy or paid calls.
