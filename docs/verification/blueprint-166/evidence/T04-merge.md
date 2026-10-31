# T04 / #170 integration merge

- Integration worktree: `/Users/dan/.codex/worktrees/blueprint-166/integration`.
- Merge SHA: `6138b9f9744e22cf67206ae244df9b5a65681a75`.
- Parents: integration `634e5df49b63ee43bdf59d44a9aafc58f92292ab` and T04 `f09f2d9445624e9577bd1667c828ec82391a7f62`.
- Used `git merge --no-ff`; no conflicts or additional implementation edits. Both parent ancestry checks pass. Working tree clean; `git diff --check` passes.

## Reviewed contracts

- Migration102 creates episode/workspace-owned immutable Pexels requests, precise target snapshots, RLS, existing persistent media tasks and zero-cost search basis. New task request marker is `operation=search|preview`; it does not fabricate storyboard/visual basis/first frame. Legacy ordinary Pexels generation retains its storyboard guard.
- Search resolves owned/current/qualified connection; preview only accepts owned searchId/resultId and freezes the selected result; import only accepts owned previewId and verifies unchanged target plus downloaded bytes. Existing common command locks preserve Owner/CSRF/current workspace/revision/read-only protections. Arbitrary client URLs are excluded by command allowlists.
- Worker validates official source/media HTTPS hosts, refuses redirects, limits deadline/stream bytes/results, sends API authorization only to official search endpoint, validates MP4 signature and real ffprobe stream/dimensions. Existing publication/fingerprint/native-task namespace is retained. Import makes a managed material copy and an available candidate; prepare/adopt retains native project authority and source provenance.
- Per-target current-search/latest-preview read avoids global50 truncation; direct owned request lookup preserves explicit older-preview import. Ordinary reads use preview metadata; serving/import retain fingerprint verification.
- `mediaWorker.ts` preserves all three classifications: PexelsVideoError, FreesoundSearchError and ProviderOutcomeUnknownError.
- Fixture composition retains migrations100/101/102/103/104/107 in productionWorkspaceFixture and105/106 via embeddedStudioFixture.

## Fresh integration validation

Strict order: completed build -> completed runtime:prepare -> actual tests. No concurrent Vite build/test. All native fixtures set both OPENCHATCUT_ROOT and LOOP_TEST_OPENCHATCUT_ROOT to the same read-only SDK path from COMMON, plus LOOP_TEST_CONTEXT_MODULE and LOOP_WORKSPACE_ACCEPTANCE=1. Tests use disposable DB/files and controlled external responses.

- `npm run build`: pass; existing >500KB bundle warning. Log `T04-integration-build.log`.
- `npm run runtime:prepare`: pass, trusted compiled Worker/backend integrity prepared. Log `T04-integration-prepare.log`.
- `npx vitest run src/local-app/workspacePexels.integration.test.ts`: **5/5 pass**. Actual Owner HTTP/persistent compiled Worker -> real managed MP4 -> explicit candidate adoption -> native restart/reopen/export, safe/recoverable failures, frozen credential rotation, short-duration explicit choice, and51 other-shot queries with retained/direct imported preview. Log `T04-integration-pexels.log`.
- `npx vitest run src/local-app/workspaceAudioSelection.integration.test.ts`: **2/2 pass**. Log `T04-integration-audio.log`.
- Five files contracts/codexRunner/controlledMediaExecutor/WorkspaceVisualCandidatesPanel/ProductionWorkspacePanel: **102/102 pass**. Existing React act warnings remain. Log `T04-integration-unit.log`.
- `npm run check`: pass. Log `T04-integration-check.log`.
- No further source modifications after merge; no broad/full-suite rerun.

## Limits / release

No new blocking concern found. T04 implementation browser evidence remains the implementation branch's previously inspected desktop/narrow/embedded run; this merger did not repeat browser acceptance and does not claim a postmerge browser run. T11 still owns final combined Pexels + account migration/deletion proof; these directed tests do not claim that unrun combination. No daily worktree/data migration, paid/live Provider calls, push/deployment or issue closure.

Integration exclusive ownership is released after this report.
