# T03 / #169 integration merge

- Incoming: `codex/blueprint-166-t03` at `7c097f353a1228642cb9a8c3ff8d5b4ce5364c4a`, based on integration `bd607943`.
- Integration merge: `2e273812379489b6ba5d994449a55f73ec4709c8` (`merge: integrate unified per-request video selection (#169)`). `--no-ff`, no conflicts, no source fix needed.
- Worktree: `/Users/dan/.codex/worktrees/blueprint-166/integration`. Final tracked working tree clean; `git diff --check` passed.

## Inspected contracts

Current preparation and embedded editor choose exact video connection/model through serviceCatalog; current added-shot A/B selector and confirm action removed. New selected submissions call shared `resolveProductionSelection` with video capability and generation-mode checks. Historical missing-selection transport remains compatibility only. The new 101 SQL freezes task execution/context/target/cost and preserves queues, budgets, unknown-result guards and exact-version credential lookup. Candidate validity ignores the current choice for selectionVersion1 and retains actual first-frame/native target/main-voice checks. Readback authorization uses current-script enabled + authorized_at, no obsolete blueprint execution fingerprint.

Fixture composition remains 100 + 101 + 107 in productionWorkspace.fixture and 105 in embeddedStudio.fixture; sorted unique application retained. No previous migration bytes changed.

## Executed verification at merge SHA

1. `npm run check` — passed (exit 0), `T03-integration-check.log`.
2. `npm run runtime:prepare` — passed (exit 0), Worker/backend compiled and trusted manifest prepared, `T03-integration-prepare.log`.
3. `npm run build` — passed (exit 0), `T03-integration-build.log`. Existing >500KB Vite chunk warning remains.
4. `npx vitest run src/local-app/WorkspaceVisualCandidatesPanel.test.tsx src/local-app/ProductionWorkspacePanel.test.tsx` — 2 files / 43 tests passed, `T03-integration-ui.log`. Existing React act warnings in async catalog tests remain.
5. `LOOP_WORKSPACE_ACCEPTANCE=1 LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut npx vitest run src/local-app/workspaceVideoSelection.integration.test.ts` — 1 file / 3 tests passed in 11.66s, `T03-integration-http.log`.

Actual test coverage is Owner HTTP -> real isolated database/tasks -> prepared compiled Worker -> actual video files/native adoption. It covers selected A exact synthetic credential after rotation, B different credential/model, real independent candidates, old A adoption after B choice, added-shot generate/adopt without type prerequisite, upload/adopt after authorization/connection disabled, restart readback, invalid model/inputs/Owner/CSRF/budget, idempotency, unknown POST single submission/reservation across restart/retry, adopted 16-second source overflow, actual 5-second source override of caller 12 seconds, and later native voice change adoption conflict preserving project SHA.

Browser not rerun by merger because the merge was conflict-free with no source correction; T03 handoff includes final merged-source desktop/narrow and actual embedded editor/native apply/save browser evidence. No broader unaffected green suite repeated.

## Next merge caution / scope

No narration source or narration adoption behavior modified here. Preserve T05's forthcoming future-candidate live-native voice correction when it merges; do not replace that with this branch's older context. Future fixture merges must keep 100/101/105/107 composition.

No paid calls, daily data writes/migrations, service restart, push, deploy or GitHub closure. Shared PLAN/CONTEXT/domain docs remain root-owned and untouched. Integration merge/build/test ownership released after this report.
