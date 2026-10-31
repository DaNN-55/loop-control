# T10 / #176 handoff

Ready for integration review. Own worktree `/Users/dan/.codex/worktrees/blueprint-166/t10`, branch `codex/blueprint-166-t10`.

- Scoped implementation: `f196ca8d` (`feat: retire blueprint execution settings and move planning to preparation (#176)`).
- Final tip: `df6d92e3743b2e5f9eab2e32cf36f2ef666305ed`, merges latest integration `6be9da04b2872340da2a38e3c1e1411d62c576b9`.
- Merge changed only root-owned PLAN and existing report, no implementation conflicts. Latest integration is an ancestor; own tree clean. No push, deploy, GH closure or daily DB/files migration.

## Delivered contracts

New/current blueprint writes and the actual account form contain positioning and creative rules only. `creativeAccountRules` is the shared TS projection used by serializer, Owner HTTP, image/video/speech/audio/Pexels new snapshots; excludes all five media keys plus asset_root, review/approval_gates, allowed_tools, budgets, executors and capabilities. Secrets anywhere in the incoming policy still fail before projection. Raw incoming payload (before normalization) remains the idempotency authority, including changes solely in retired fields. Actual account directory controls remain independent. The creative JSON field cannot reintroduce the retired fields. Historical Episode repair gets the explicitly named legacy serializer; it does not supply current blueprint writes.

108 is the sole new migration. Current-write SQL projection and the existing external validator preserve exact existing historical snapshot copies rather than requiring formerly current connections to remain current. There is no blanket UPDATE rewriting policy history and no unconditional disabling of connection security in production migration. Additional root-directed stable-ID fix: updating a referenced current blueprint archives the **original ID/policy/version**, creates a new current ID with the next version, and updates the account pointer. Episodes, tasks, candidates and frozen context links do not get repointed or rewritten. Unreferenced current rules can still edit in place. Existing Owner account lock, revision, idempotency, audit and active-version semantics remain.

Ordinary planning remains the real registered Codex planner. `episode_planning_selections` persists the model, account-owned active Harness ID, nonnegative budget and allowed file tools before any workspace exists; RLS scopes reads to the owning account. Migration/new-Episode trigger initialize from old executor at most once, including null rows so later blueprint changes do not become fallbacks. Owner command `saveWorkspacePlanningSelection` uses `expectedSelectionRevision`. Workspace GET exposes the owned draft and account Prompt versions; the preparation entry reuses existing StageConfigurationDialog and PromptVersionManager and existing createPromptVersion Owner API. No text Provider or main-script generation was added.

The existing queue_workspace_planning signature/task contract is retained. New tasks freeze selected executor, complete Harness content/hash/version, budget/tools, script/material fingerprints and projected creative context. Existing current tasks return unchanged. Failed retry copies the original task's frozen A selection and input/context; edited draft B is not consulted. Explicit `replanWorkspace` with `planningTaskId` marks the old failed planning chain superseded via existing invalidation fields and submits B to the same queue, preserving old input snapshots. v2 script-segment preparation has no planner dependency. Existing compiled Worker planner and verifyReportedStoryboardArtifact remain the execution/verification boundary.

New formal image/video requests require explicit resolveProductionSelection; missing selection no longer chooses blueprint tools. New TTS drafts require an explicit speech service; no-selection generation is confined to a matching existing legacy retry request. Legacy queue/read/retry SQL and task snapshot protocols remain. Existing first-fill generateWorkspaceImage accepts the same explicit video selection. Worker error guidance for new selected/planning tasks points to preparation, account-root errors to account configuration. Historical stored blockers remain unchanged. Budget, reservations, ownership/CSRF, current script/native fences, connection qualification and unknown-submit guards remain.

## Red / green and actual evidence

Confirmed seam was supplied by root: real Owner HTTP + loop_app/loop_worker + disposable DB/tasks + controlled Codex/media/native files; no paid calls or fake internal collaborators.

- `T10-red-save.log`: original new-account save rejected retired external refs with409. Green now saves only creative rules without a service, rejects secrets, preserves raw idempotency and referenced old policy.
- `T10-red-stable-id.log`: real HTTP save retained joined Episode policy but overwrote its original blueprint ID. Green directly checks that original ID/policy/version are unchanged.
- `T10-red-media.log`: omitted selection still fell back to blueprint and returned409. Green rejects missing image/video/speech selection with explicit400 guidance; v2 prepares with a null planner selection.
- `T10-red-planner.log` is an early **fixture failure** (missing ordinary-script `## 正文`), not valid behavior-red evidence; do not cite it as product proof. Corrected fixture uses a valid ordinary script. Later real tests prove persistent A/B/retry/replan behavior and actual controlled Codex artifact verification.
- `T10-focused-final.log`:7 files /103 tests pass, covering current blueprint/legacy serializer separation, actual account form, planning controls, formal workspace UI and Worker/preflight. Existing asynchronous React act warnings occur in ProductionWorkspacePanel tests; browser page errors are empty.
- `T10-build-final.log`: build passes (includes TypeScript); existing >500KB chunk warning remains. `T10-check-final.log`: explicit check passes. `T10-runtime-final.log`: prepared after build, before final compiled Worker checks. `git diff --check` passes; no existing SQL migration bytes edited.
- Final real command (both SDK variables intentionally identical):

```sh
LOOP_WORKSPACE_ACCEPTANCE=1 LOOP_FORMAL_ACCEPTANCE=1 \
LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs \
OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut \
LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut \
npx vitest run src/local-app/productionSelection.integration.test.ts src/local-app/workspaceVideoSelection.integration.test.ts src/local-app/speechSelection.integration.test.ts src/local-app/workspaceAudioSelection.integration.test.ts src/local-app/blueprintContraction.integration.test.ts src/local-app/formalWorkflow.integration.test.ts src/local-app/workspacePexels.integration.test.ts -t '^(?!first formal adoption)'
```

`T10-all-actual-final.log`: **7 files /24 pass /1 explicitly skipped**. Covers fresh content-only account and ordinary controlled compiled Codex Worker -> validated actual storyboard file -> explicit preparation confirmation; frozen A after draft B/retry; explicit replan B; v2 without planning; selected image/video/speech/audio/Pexels; exact credentials across rotation, budget/unknown-result/restart, actual PNG/MP3/video files and native adoption; legacy late reports without approval/advancement; invalid selection, owner/CSRF and archive guards.

The excluded `first formal adoption preserves the latest unsubmitted legacy Studio document` test still uses an obsolete JSON-store fixture and is already assigned to T11. It was **not** counted as passing. Existing first-fill/new TTS fixture calls in the affected formal/speech tests now supply the required actual selection/reservation; lineage-only setup uses manual/none. No business assertion or native protection was removed.

The new legacy image test seeds pre-108 data only in its disposable fixture (temporarily disables projection + external validation **during historical seed transaction only**, restores both immediately). It uses the retained real no-selection SQL queue, then real Owner HTTP content save: old task bytes and original blueprint ID/policy remain exact. After restart the actual Worker publishes a PNG; explicit new selection also publishes and freezes only creative rules. The existing scheduler appends runtime_constraints.resource_limits at claim; test verifies full bytes across content save, then all frozen execution fields across execution while excluding that existing runtime evidence field. This is not a product exception or a migration that disables security.

Final fixture correction:108 is requested through copyFixtureSchema's normal validated migration ledger. embeddedStudioFixture now establishes independent account directory identity before creating its Episode, so future source schemas containing108 do not depend on a stripped blueprint root. No test-only runtime feature flag or parallel pipeline.

## Actual browser

`agent-browser --session t10-176 --auto-connect false`, actual built formal app and disposable fresh content-only account. Logged in; saved positioning without media/planner configuration; observed independent actual account directory. Ordinary production preparation selected Codex model + account Harness +33-cent budget/tools; saved and refreshed, values restored before workspace creation. Registered a new Harness via actual existing manager/Owner API; model and budget survived Prompt directory refresh. Saved it and refreshed again. Clicked prepare and refresh result; public episode HTTP readback shows **one** ready draft_storyboard task with gpt-5.6-codex/budget33 (`T10-browser-submitted.txt`), no automatic service execution from selecting/saving.

Inspected actual rendered screenshots at1440x1100 and390x844; controls remain usable with normal section scrolling, long selected Harness label truncates in the native select. Existing narrow topbar overflow is outside this change. Removed inherited modal shadow from the reused inline planner panel and kept summary readable at390px.

Evidence: `T10-browser-blueprint-desktop.png`, `T10-browser-blueprint-narrow.png`, `T10-browser-planner-desktop.png`, `T10-browser-planner-narrow.png`, `T10-browser-submitted-desktop.png`; snapshots `T10-browser-blueprint.txt`, `T10-browser-planner.txt`; empty `T10-browser-errors.txt`. Named browser closed; own fixture process stopped and temporary root removed. External runner/config retained for reproducibility. No user browser, daily service or paid Provider was used.

## Diagnostics / limits

One early broad run started after further source edits had invalidated the prepared manifest: `T10-actual.log` contains those environment failures, not regression proof. Rebuilt and prepared before final tests. Legacy seed attempts initially hit Owner/readonly table rules, then the existing image candidate-before-task namespace guard; switched to faithful historical fixture seed plus existing real legacy queue. No production guard was weakened to make fixtures pass.

This establishes controlled execution and local persistence, not real paid supplier quality. No whole-repository suite claim, no daily migration/deploy/push. Root still owns final integration/T11, PLAN/CONTEXT/README/ADR index/report.

Required domain wording for root: blueprint = versioned creative account rules; ordinary Codex planning = existing preparation-owned model/Harness/budget/file-tool selection frozen per task; edited default/draft = prefill, immutable request/candidate = execution evidence; connections = registered capability catalog; account root/location = independent actual file ownership; A/B/media/review blueprint configuration = historical compatibility only. A referenced blueprint's original ID and policy remain stable; new current rules get a new ID/version. ADR0018 already records the approved ownership, and this implementation further narrows the obsolete ADR0005/0007/0016 configuration ownership without deleting their historical evidence or native/Owner guards.

Cleanup verification: SIGTERM ended vite-node before its asynchronous fixture disposer finished. Instead of claiming automatic cleanup, identified the **exact** disposable DB by the recorded new-account UUID and browser root: removed only `loop_studio_153_a792542e3da3`, `/private/tmp/loop-t06-volume-dHwNqa/mounted/loop-153-GBepc1`, detached its own mount, then removed `/private/tmp/loop-t06-volume-dHwNqa`. No other DB/volume/process was touched. Browser root removal now verified; handler credentials were synthetic and the fixture DB no longer exists.
