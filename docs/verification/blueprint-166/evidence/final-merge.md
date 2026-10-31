# Final reviewfix merge receipt — #166 / #177

Integration `/Users/dan/.codex/worktrees/blueprint-166/integration`, branch `codex/blueprint-166-integration`.

- Prior HEAD: `7e560dad7d7f1ff678f535c6b50bd6ee0fdd488d`.
- Incoming: `6fd02cbea0cac322ef6afa82f3971cd8f90b3539` (`codex/blueprint-166-reviewfix`). Incoming and integration were clean; prior HEAD was verified as incoming ancestor.
- Merge: **`1f8525d61691531f7305ed6c3f20da96482e5bd6`**, command `git merge --no-ff 6fd02cbea0cac322ef6afa82f3971cd8f90b3539 -m 'merge: integrate final blueprint review fixes (#166)'`; exit 0, no conflicts.
- Personally inspected all 16 changed files (60 additions/19 deletions), including rendered-control regressions, nullable draft persistence, small service/model resolver, inline-only fixed identity opt-out, scoped Harness label CSS, metadata comparison and the actual returned-receipt test chain. No additional source repair/refactoring was needed.
- Final tree equals incoming whole tree (`git diff --quiet 6fd02cbe HEAD`: exit 0). No SQL/root docs/dependency changes in this incoming commit. All prior integration/root work preserved.

## Problems resolved

1. Image/video preparation, native video, speech, sound and Pexels accept explicit blank selections and serialize `null`; missing draft alone permits default prefill. Native restoration checks field presence, retaining saved null. Prompt/settings/voice/query remain, and clearing never submits/adopts or changes budgets.
2. Only the new inline preparation planner hides fixed Provider/Adapter fields. Canonical Codex data and validation remain; model, Harness, budget and file tools stay editable. Scoped CSS restores the necessary Harness label; old/admin dialog behavior stays intact.
3. Persisted native SDK bytes no longer receive delete/reappend reordering of `loopControlShot`. Stable metadata key position is applied only to temporary comparison clones, preserving raw Studio receipt/session/native file/DB identity and historical semantic content identity. Real content changes still invalidate confirmation. Candidate integration retains actual returned receipt for repeated saves and completes native adoption; delivery retains strict selection-only revision/confirmation behavior.

## Strict sequential verification

Every command ran with explicit workdir `/Users/dan/.codex/worktrees/blueprint-166/integration`. Build completed before runtime:prepare; preparation completed before actual Worker tests; no build ran concurrently with compiled Worker. All actual/default invocations set BOTH SDK variables plus the runtime-context seam from COMMON.

| Gate | Actual result | Evidence |
| --- | --- | --- |
| `npm run build` | exit 0; inherited Vite >500 kB warning | `final-merge-build.log` |
| `npm run runtime:prepare` | exit 0, trusted manifest prepared and verified | `final-merge-prepare.log` |
| Actual 23-file matrix, all six acceptance flags, maxWorkers2 | **23 files /110 cases passed, zero skipped, exit 0**, 345.06s | `final-merge-actual.log` |
| Full ordinary `npm test -- --maxWorkers=2`, exactly once | **174 files /1144 cases passed, exit 0**, 59.78s | `final-merge-default.log` |
| `npm run check` | exit 0 | `final-merge-check.log` |
| `git diff --check 7e560dad HEAD`, working and cached diff checks | exit 0, no findings | personally read empty output |
| Existing migration byte preservation vs `d7430b1136b9109df7b10287b952061dd8fb5003` | **100 files, zero changed Git blobs**, rechecked after all tests | `final-merge-migration-check.json` |
| Final `assertPreparedRuntime(process.cwd())` | valid; source and compiled output fingerprints still match | `final-merge-source-hashes.json` |

The actual matrix includes Candidates **7/7**, AudioProjection **1/1** and Delivery **4/4**, including the two formerly red native save regressions, raw receipt equality/repeated save/adoption, stale fences and confirmation. Formal **6/6** and fresh formal delivery **1/1** pass. Pexels managed adoption → native edit → directory migration → originals offline → real Worker delivery → deletion rollback/owned-copy removal passes (74.25s). New evidence lives in `final-merge-evidence/` and `final-merge-formal-evidence/`; old T11 and reviewfix logs, red diagnostics and artifacts remain intact. No nonexistent UI filter is included: the ordinary suite covers panel/shared/new clear-control tests.

The final prepared manifest contains 154 source fingerprints and 223 output fingerprints; all match disk. Recorded source fingerprints equal the reviewfix browser-validated final manifest; all 16 reviewfix file SHA256 values were captured and rechecked unchanged after tests. Git whole-tree equality provides the final source parity. See `final-merge-source-hashes.json`.

## Existing actual browser evidence inspected

I inspected prior actual browser screenshots and JSON/text evidence; I did **not** operate the browser in this merger run. Source conflicts were absent, final tree matches the final browser-built reviewfix tree, and new final build/prepare are verified above.

- Viewed `reviewfix-planner-desktop-final.png`, `reviewfix-planner-narrow-scrolled.png`: concise Codex context, model/Harness/budget/read/write present, no redundant fixed identity inputs; narrow normal scroll exposes save. Computed label 12px/static and saveTop265/saveBottom301 within844 are recorded in JSON.
- Viewed preparation clear desktop/narrow and native clear desktop/adoption screenshots. Refreshed image/video/native text snapshots retain blank selection and prompt/action input. Choice and final task counts remain0.
- Read `reviewfix-native-save-receipts.json`: two actual HTTP200 saves, receipt===workspaceSHA, second request===first receipt (`2486f0e3...`). Read `reviewfix-native-adoption-http.json`: save200 → prepare200 → SDK edit/save200 → adopt nativeApplied:true200 → save200; each receipt===workspaceSHA, latest `bd8409e7...`. Adopted readback has status adopted.
- Speech/audio/Pexels clear persistence has rendered component coverage, not separate actual browser interaction here. Narrow native editor usability and inherited topbar/step overflow remain outside this acceptance claim. Inherited React act, Vite bundle and pg concurrency deprecation warnings remain.

## Cleanup and limits

All this merger's build/prepare/test/check processes finished; no application/service was started or intentionally retained. Tests await fixture close/drop/remove protocols. Pexels new evidence has migration completed/originalsRetained=true, deletion localRemoved=true/cleanupPending=false; its sourceRoot and targetRoot both currently absent (`final-merge-pexels-cleanup-check.json`). Browser runner previously exited0 and reported cleanup complete; its root/assetRoot/mountPath are now all absent (`final-merge-browser-cleanup-check.json`), browser fixture DB is absent.

A read-only catalog inventory found two other random studio DBs (`loop_studio_153_67d9f590d5c3`, `loop_studio_153_a3be4e25cdc7`). Ownership was not established, so they were retained and reported to root, rather than treated as owned cleanup targets (`final-merge-db-cleanup-check.json`). No daily schema/data writes, daily service changes, paid Provider calls, root PLAN/REPORT edits, push, main merge, deploy, issue closure or worktree removal occurred. Evidence/config/runner files remain outside the repository for review.

Two optional read commands initially used unmatched zsh globs; switched to `rg --files` and explicit paths. These did not mutate files or affect any gate. No test failure occurred in final verification, no retry or extra suite was run after success.

## Exact commands

```sh
npm run build > /private/tmp/loop-control-166-20261031/final-merge-build.log 2>&1
npm run runtime:prepare > /private/tmp/loop-control-166-20261031/final-merge-prepare.log 2>&1
env OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs LOOP_WORKSPACE_ACCEPTANCE=1 LOOP_FORMAL_ACCEPTANCE=1 LOOP_FORMAL_DELIVERY=1 LOOP_REVIEW_FIX_DELETE=1 LOOP_LEGACY_WORKSPACE_ACCEPTANCE=1 LOOP_REVIEW_FIXES=1 LOOP_T11_EVIDENCE_DIR=/private/tmp/loop-control-166-20261031/final-merge-evidence LOOP_T13_EVIDENCE_DIR=/private/tmp/loop-control-166-20261031/final-merge-formal-evidence npx vitest run src/local-app/formalWorkflow.integration.test.ts src/local-app/formalWorkflow.delivery.integration.test.ts src/local-app/productionSelection.integration.test.ts src/local-app/workspaceVideoSelection.integration.test.ts src/local-app/speechSelection.integration.test.ts src/local-app/workspaceAudioSelection.integration.test.ts src/local-app/workspacePexels.integration.test.ts src/local-app/workspaceCandidates.integration.test.ts src/local-app/workspaceNarration.integration.test.ts src/local-app/accountAssetRoots.integration.test.ts src/local-app/accountDirectoryMigration.integration.test.ts src/local-app/accountDirectoryMigrationStorage.integration.test.ts src/local-app/legacyWorkspaceEntry.integration.test.ts src/local-app/blueprintContraction.integration.test.ts src/local-app/workspaceVisualCandidates.integration.test.ts src/local-app/workspaceImageGeneration.integration.test.ts src/local-app/workspaceAudioProjection.integration.test.ts src/local-app/workspaceShots.integration.test.ts src/local-app/workspaceFirstVideo.integration.test.ts src/local-app/workspaceDelivery.integration.test.ts src/local-app/workspaceReviewFixes.integration.test.ts src/local-app/workspaceAudio.integration.test.ts src/local-app/accountDirectoryMigrationSubmissions.integration.test.ts --maxWorkers=2 > /private/tmp/loop-control-166-20261031/final-merge-actual.log 2>&1
env OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs npm test -- --maxWorkers=2 > /private/tmp/loop-control-166-20261031/final-merge-default.log 2>&1
npm run check > /private/tmp/loop-control-166-20261031/final-merge-check.log 2>&1
git diff --check 7e560dad HEAD
git diff --check
git diff --cached --check
```

Final HEAD **`1f8525d61691531f7305ed6c3f20da96482e5bd6`**, final `git status --porcelain=v1` empty. **Mutation ownership is released to root.** No integration mutations remain in progress. Root owns final documentation/issue closure and any separately authorized cleanup.
