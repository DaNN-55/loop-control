# T11 integration merge receipt

- Integration: `/Users/dan/.codex/worktrees/blueprint-166/integration`, branch `codex/blueprint-166-integration`.
- Prior HEAD: `25960ffeb7f4427b369a9f342db2cda8726a5754`.
- Incoming: `eaecac7d80e69bdda42fc3b9170dea01f7eac085`, inspected product migration/metadata and fixture diff before merge.
- Merge: `7e560dad7d7f1ff678f535c6b50bd6ee0fdd488d` via `git merge --no-ff eaecac7d80e69bdda42fc3b9170dea01f7eac085 -m 'merge: integrate T11 formal production verification (#177)'`; exit 0, no conflicts.
- Baseline `d7430b11`: all 100 existing `db/local` files compare equal by Git blob hash; new migration 109 only for this ticket.
- No root PLAN/REPORT edits. Earlier integration/docs preserved.

## Sequential gate

1. `npm run build > /private/tmp/loop-control-166-20261031/T11-merge-build.log 2>&1`: exit 0; existing >500 kB Vite chunk warning.
2. `npm run runtime:prepare > /private/tmp/loop-control-166-20261031/T11-merge-prepare.log 2>&1`: exit 0, trusted Worker/backend manifest prepared and verified.
3. Actual 23-suite batch: exit1,24 executed files/137 cases,22 files/135 cases passed and2 files/2 cases failed. The23 actual integration files executed all110 cases (108pass/2fail); sharedViews27/27 passed. No actual case was skipped. This gate is RED pending root unified reviewfix. Both SDK env vars and runtime-context seam set. No build overlaps compiled Worker tests.
4. Correct panel filter separately: exit0,1 file/24 cases passed (T11-merge-panel.log). Full default `npm test -- --maxWorkers=2`: exit0,174 files/1138 cases passed (T11-merge-default.log),112.16s. This does not override the real integration failures.
5. `npm run check > /private/tmp/loop-control-166-20261031/T11-merge-check.log 2>&1`: exit 0. `git diff --check 25960ffe HEAD` and `git diff --check`: no findings. Final status clean and HEAD unchanged. All100 baseline migration blobs unchanged on final recheck.

## Explicit limitations

The current selection blank-placeholder UI cannot clear a saved image/default or supplemental native video selection; root owns the unified reviewfix. This merge is not evidence that blank/incompatible persistence acceptance is complete. No real paid supplier calls or quality claims. No daily data/schema/directory writes, daily services, main merge, push, deploy, issue closure.

An initial UI filter in the actual-suite command is `src/ProductionWorkspacePanel.test.tsx`, which does not exist; it is not counted as executed. The correct path `src/local-app/ProductionWorkspacePanel.test.tsx` was executed separately (24/24pass) and is also included in the default suite.

## Cleanup/release

All build/prepare/test/check processes finished. Existing fixture finally-close/drop/delete protocols completed. The added Pexels chain evidence reports migration completed, actual Worker completed, deletion cleanupPending=false; evidence sourceRoot and targetRoot both checked exists=false afterward. No application/service process is intentionally retained. Evidence and diagnostic artifacts remain outside the repository for review. Integration is clean and mutation ownership is released to root at HEAD `7e560dad7d7f1ff678f535c6b50bd6ee0fdd488d`. The real integration gate remains RED for the two diagnosed save regressions; root owns the unified reviewfix and rerun. No additional integration mutations are in progress.


## Two unresolved integration failures - diagnosed without repository edits

1. `workspaceCandidates.integration.test.ts:117:740`, final main-voice adoption case, second native save returns409 `当前工程身份或文件版本已变化。`.
2. `workspaceAudioProjection.integration.test.ts`, next save after canonical baseline, returns409 `Studio 会话或版本已失效，请重新打开当前工程。`; diagnostic reveals original error at `openchatcutStudio.ts:305`: `工作版本已变化，请重新打开当前工程后保存。`.

Both reproduce with one Worker, so they are not a parallel batch artifact. The external Vite transform only records requests/DB/files and the original caught error; it does not change execution behavior or repository files. Diagnosis proves the new delete/re-add in `withWorkspaceShotMetadata` reorders `loopControlShot` after source metadata in persisted snapshots, while native Studio file/receipt retains the SDK key order. Actual stored and Studio JSON are semantically equal but byte hashes differ.

Candidate proof from first successful save: native/API receipt `2364331c0d372b2ca2090e0ced5ab4040657bcff01aeb7fe8738e34114141b4f`, persisted row/project `95e56afea3a70a95b83ea68f7243beb1102dce3b97b7e98edb0be53bccc2ffc9`. The next real save uses the receipt and fails the row guard. Projection proof: native receipt `e6a38ff33e891ccbba71db1468d74f60183ff2335daa262fb1612c0101ac1903`, persisted row `61cf9f386a598bc116aca5a853313d84da637952c798abf71b69f42266eeafbc`. Passing the persisted hash instead clears the row guard but fails the Studio session check, so adjusting fixture expected hash cannot fix this actual UI save protocol regression.

Evidence: `T11-merge-diagnostic.log`, external instrumentation `T11-merge-diagnostic.config.mjs`, and `T11-merge-diagnostic/*-26-saveWorkspaceStudio-after-{stored,studio}.json` plus projection `*-8-saveWorkspaceStudio-after-*`. Diagnostic command: exit1,2 failed/6 deliberately filtered skipped. Original aggregate red remains intact. Root notified; all source repairs belong to the fresh unified reviewfixer. No source changes or extra commits were made after merge.

## Exact test commands

All commands execute with explicit workdir `/Users/dan/.codex/worktrees/blueprint-166/integration`.

```sh
env OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs LOOP_WORKSPACE_ACCEPTANCE=1 LOOP_FORMAL_ACCEPTANCE=1 LOOP_FORMAL_DELIVERY=1 LOOP_REVIEW_FIX_DELETE=1 LOOP_LEGACY_WORKSPACE_ACCEPTANCE=1 LOOP_REVIEW_FIXES=1 LOOP_T11_EVIDENCE_DIR=/private/tmp/loop-control-166-20261031/T11-merge-evidence LOOP_T13_EVIDENCE_DIR=/private/tmp/loop-control-166-20261031/T11-merge-formal-evidence npx vitest run src/local-app/formalWorkflow.integration.test.ts src/local-app/formalWorkflow.delivery.integration.test.ts src/local-app/productionSelection.integration.test.ts src/local-app/workspaceVideoSelection.integration.test.ts src/local-app/speechSelection.integration.test.ts src/local-app/workspaceAudioSelection.integration.test.ts src/local-app/workspacePexels.integration.test.ts src/local-app/workspaceCandidates.integration.test.ts src/local-app/workspaceNarration.integration.test.ts src/local-app/accountAssetRoots.integration.test.ts src/local-app/accountDirectoryMigration.integration.test.ts src/local-app/accountDirectoryMigrationStorage.integration.test.ts src/local-app/legacyWorkspaceEntry.integration.test.ts src/local-app/blueprintContraction.integration.test.ts src/local-app/workspaceVisualCandidates.integration.test.ts src/local-app/workspaceImageGeneration.integration.test.ts src/local-app/workspaceAudioProjection.integration.test.ts src/local-app/workspaceShots.integration.test.ts src/local-app/workspaceFirstVideo.integration.test.ts src/local-app/workspaceDelivery.integration.test.ts src/local-app/workspaceReviewFixes.integration.test.ts src/local-app/workspaceAudio.integration.test.ts src/local-app/accountDirectoryMigrationSubmissions.integration.test.ts src/ProductionWorkspacePanel.test.tsx src/sharedViews.test.tsx --maxWorkers=2 > /private/tmp/loop-control-166-20261031/T11-merge-actual.log 2>&1

env OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs LOOP_WORKSPACE_ACCEPTANCE=1 npx vitest run --config /private/tmp/loop-control-166-20261031/T11-merge-diagnostic.config.mjs src/local-app/workspaceCandidates.integration.test.ts src/local-app/workspaceAudioProjection.integration.test.ts -t 'explicit main-voice candidate adoption|native workspace projection' --maxWorkers=1 > /private/tmp/loop-control-166-20261031/T11-merge-diagnostic.log 2>&1

env OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs npx vitest run src/local-app/ProductionWorkspacePanel.test.tsx --maxWorkers=2 > /private/tmp/loop-control-166-20261031/T11-merge-panel.log 2>&1

env OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs npm test -- --maxWorkers=2 > /private/tmp/loop-control-166-20261031/T11-merge-default.log 2>&1
```
