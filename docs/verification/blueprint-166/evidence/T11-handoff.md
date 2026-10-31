# T11 / #177 handoff

Ready for merger/review after the scoped local commit recorded below. Worktree `/Users/dan/.codex/worktrees/blueprint-166/t11`, branch `codex/blueprint-166-t11`. Started at integrationb37fadec; latest integration25960ffeb7f4427b369a9f342db2cda8726a5754 is already an ancestor. Root-owned PLAN/CONTEXT/ADR/README/report were not edited. No daily data/schema/file migration, paid call, service restart, push, deploy or GH closure.

Commit: `eaecac7d80e69bdda42fc3b9170dea01f7eac085` (`fix: verify formal production and preserve native delivery identity (#177)`).

## Product changes

- New109 only; no existing migration bytes changed. The existing guarded `public.delete_episode` removes only reservations whose task belongs to this Episode before its managed-material cascade. This fixes the real `paid_generation_reservations_material_revision_id_fkey` failure observed after successful selected image/video production and delivery. Owner/archive/task locks and transactional filesystem rollback stay in the original protocol. The formal rollback snapshot now includes real paid reservations, Pexels requests and deliveries.
-109 also preserves an existing completed speech task for the same workspace/shot/inputFingerprint. Deleting/replacing a visual range no longer turns a repeated unchanged voice request into another paid task. Selection/model/voice/text still participate in the fingerprint; different inputs produce independent candidates. Pending/unknown/rejected retry guards remain. The original one-voice/task-ID/submission-count assertions pass.
- `withWorkspaceShotMetadata` deletes/re-adds only the owned extension before replacing it, putting that field at a stable key position. Actual SDK writes had placed it before source metadata while legacy backfill appended it, so JSON.stringify treated equal content as an edit. The existing hash protocol and preservation of historical `row.content_sha256` remain. Exact selection-only revision/confirmed-export assertions now pass; real content edit/tamper/missing-input/retry guards still pass.
- Read source review confirms the current local Episode detail mounts the one `ProductionWorkspacePanel` four-step entry; current blueprints remain creative rules and independent actual account directory configuration. No new production pipeline or current fallback media authority was added. Necessary old history/read/recovery endpoints remain.

## Existing fixture maintenance

- `formalWorkflow.integration` edits the actual Studio document through `editStudioDocument`/SDK HTTP. Original denied first prepare, preserve decision, x=19 current project and recovery x=19 assertions all remain.
- The fresh content-only formal delivery chain now actually chooses imageA/B, AI video, speech and Freesound; all results are real files and remain candidates until explicit adoption. It saves/reopens actual SQLite documents, retimes real voice/captions, confirms exact export bytes, executes the compiled delivery Worker, verifies manifest and Owner downloads, then tests deletion rollback/success while another production remains.
- Explicitly named test-only `chosenRequest`/`chosenSend` choose actual registered synthetic connection versions and valid voice/language/rate/reservations at positive callsites. Raw request/send remains for missing-selection and permission negative cases. The helper does not authorize or create budgets. Existing success setups explicitly set their budget via Owner HTTP; speech no-budget and unknown-result assertions remain409.
- Selected speech no longer auto-adopts. Tests that need an initial adopted voice use the actual `prepareWorkspaceCandidate`/`adoptWorkspaceCandidate` Owner HTTP helper. Obsolete automatic visual stretching/ripple expectations were updated to the selected-speech contract while retaining complete audio, unchanged visual windows, duration conflicts, stale/caption/source/none and native-edit protections. Actual native edits are made through SDK HTTP; SDK canonical migration is setup before strict unchanged-node comparisons.
- True legacy-running speech/soundtrack cases seed pre108 historical policy only in their disposable DB, restore both triggers immediately, then use existing real legacy RPC/Worker paths. No production security/validation trigger was disabled by109 and no new account approval was fabricated.
- Controlled Provider response audio lives in an independent fixture file. It no longer overwrites the original registered voice.mp3 and invalidates immutable migration references. Duration-altering test setups target that independent file.
- The existing structure integration test now writes new evidence to the requested temp evidence directory or its own fixture root, rather than overwriting historical tracked verification files. Original historical JSON/MP4 are restored; repo docs have no local diff.

## Combined Pexels acceptance

The added case lives in the existing `accountDirectoryMigration.integration.test.ts`, reusing `workspacePexelsFixture`, actual isolated APFS volume, normal Owner handlers and real Worker/SDK boundaries:

search→explicit result preview→actual MP4 Owner download→managed import→explicit adoption→native SDK edit/save/close→verified account migration→original root renamed offline→restart→preview/provenance readback→native reopen/edit/save→actual export→exact final confirmation→compiled delivery Worker→manifest/download hashes→completed read-only rejection→archive→delete-plan ownership/CSRF checks→trigger-induced transaction failure→identical DB/file rollback→successful deletion of only the new owned Episode copy.

Migration preserves blueprint/task/candidate/approval snapshots. Rollback snapshots explicitly include actual `workspace_pexels_requests` AND `workspace_deliveries`; successful deletion asserts both cascaded. Original tree hashes, another production/material, and repository fixture media bytes remain intact. No SQL fake approvals or queued/202-as-completion assertions.

Evidence: `T11-evidence/pexels-migration-delivery-delete.json`, actual plan/receipt/search/preview/candidate/frozen inputs/export/manifest/Worker result/rollback snapshots/retained-original hashes. `T11-formal-evidence/` contains the separate fresh-account final MP4, immutable package files, downloads/metadata/workspace/late-result ledger.

## Final unique integration matrix

There are **23 distinct integration files /110 distinct cases** below. These are not sums of overlapping command totals. Each row points to that file's latest successful execution during this ticket. Batches with earlier failures are retained; the green file rows in a mixed batch remain evidence only for those rows. After the final metadata product fix, the affected critical formal/delivery/migration files were rerun in `T11-metadata-final.log`.

| Integration file in src/local-app | Cases | Latest green log |
| --- | ---: | --- |
| formalWorkflow.integration.test.ts |6|T11-metadata-final.log|
| formalWorkflow.delivery.integration.test.ts |1|T11-metadata-final.log|
| productionSelection.integration.test.ts |3|T11-actual-final.log|
| workspaceVideoSelection.integration.test.ts |3|T11-actual-final.log|
| speechSelection.integration.test.ts |3|T11-targeted-final.log|
| workspaceAudioSelection.integration.test.ts |2|T11-actual-final.log|
| workspacePexels.integration.test.ts |5|T11-actual-final.log|
| workspaceCandidates.integration.test.ts |7|T11-actual-final.log|
| workspaceNarration.integration.test.ts |13|T11-targeted-final.log|
| accountAssetRoots.integration.test.ts |3|T11-actual-final.log|
| accountDirectoryMigration.integration.test.ts |7|T11-metadata-final.log|
| accountDirectoryMigrationStorage.integration.test.ts |1|T11-actual-final.log|
| legacyWorkspaceEntry.integration.test.ts |3|T11-targeted-final.log|
| blueprintContraction.integration.test.ts |3|T11-actual-final.log|
| workspaceVisualCandidates.integration.test.ts |14|T11-old-visual-image.log|
| workspaceImageGeneration.integration.test.ts |1|T11-old-visual-image.log|
| workspaceAudioProjection.integration.test.ts |1|T11-native-canonical-final.log|
| workspaceShots.integration.test.ts |10|T11-affected-remaining.log|
| workspaceFirstVideo.integration.test.ts |3|T11-affected-remaining.log|
| workspaceDelivery.integration.test.ts |4|T11-metadata-final.log|
| workspaceReviewFixes.integration.test.ts |7|T11-targeted-final.log|
| workspaceAudio.integration.test.ts |8|T11-targeted-final.log|
| accountDirectoryMigrationSubmissions.integration.test.ts |2|T11-affected-remaining.log|

The ordinary-script row executes the actual selected compiled Codex planning task, verifies its real storyboard artifact and preparation confirmation. The direct v2 row has no used planner selection. Current image/video/speech/audio A/B, invalid choices, Owner/CSRF, budget, rotation, unknown result/restart, explicit adoption, immutable task/context and actual files are covered by the corresponding selected suites. No real paid supplier quality claim.

## Red → green and build/default states

- Native legacy0vs19: `T11-native-red.log`→`T11-native-green.log`, then complete formal6/6 in metadata-final.
- Fresh delivery omitted selection/old JSON/first automatic adoption: delivery-red and early delivery-green attempts→fresh actual all-services success in actual-final, then metadata-final.
- Real delete FK: all-services-2 / deletion-diagnostic-3 expose the exact paid reservation constraint→109; formal rollback/success green in actual-final and metadata-final.
- Main14-file actual-final had57pass/3fail. Speech failure came from a fixture authorize helper accidentally creating a budget; that side effect was removed and the original409 assertions pass in targeted-final. Legacy GET now matches the added read-only planningSelection metadata, with no enrollment writes. Same-shot completed-task dedup passes the original task-ID/call-count assertions after109.
- Extra affected7-file batch had24pass/11fail. FirstVideo/Shots/MigrationSubmissions were already green there; audio8 and reviewFixes7 are green in targeted-final; projection is green in native-canonical-final; delivery is green in metadata-final. No old red row remains unresolved.
- SDK equality/selection-only attempts remained red until actual before/after evidence identified the key-order bug. Evidence: `T11-evidence/delivery-approved-project.json` and `delivery-selection-saved-project.json`. Strict revision/confirmed expectations were not weakened. Final delivery4/4green.
- Full default suite ran once: `T11-default.log`,174files/1138cases,1137pass/1fail. The stale sharedViews assertion required saving retired soundtrack execution settings. It now checks current creative visual_style preservation and unchanged historical soundtrack input; targeted27/27pass in targeted-final and metadata-final. Do not describe the original full default invocation as fully green. Root merger will rerun it after integration.
- Latest meaningful product-change sequence: `npm run build` exit0 (`T11-metadata-build.log`)→`npm run runtime:prepare` exit0/trusted manifest (`T11-metadata-prepare.log`)→actual compiled Worker checks (`T11-metadata-final.log`), **6files/69pass**:18 integration cases plus ProductionWorkspacePanel24 and sharedViews27. The command also included a nonexistent `src/workspaceShots.test.ts` filter; it did not execute and is not counted as passing. Existing React act warnings and >500KB chunk warning remain.
- Final TypeScript check and diff check recorded in `T11-check-final.log` / handoff completion below. No build/test ran concurrently.

All actual commands used BOTH SDK variables pointing at the same read-only existing SDK:

```sh
OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut
LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut
LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs
```

The main actual command enabled LOOP_WORKSPACE_ACCEPTANCE, LOOP_FORMAL_ACCEPTANCE, LOOP_FORMAL_DELIVERY, LOOP_REVIEW_FIX_DELETE, LOOP_LEGACY_WORKSPACE_ACCEPTANCE; review cases use LOOP_REVIEW_FIXES. Existing test flags were enabled rather than adding skips or weakening timeouts/assertions. `--maxWorkers=2` limits isolated runtime contention.

## Actual browser and remaining UI reviewfix

`agent-browser --session t11-177 --auto-connect false`, real built app and a disposable fresh content-only account. Logged in, confirmed script, prepared v2, chose a current image connection/default without generating, uploaded and explicitly adopted actual image bytes, entered the real embedded SDK, opened supplemental candidate controls, saved/returned, opened the fourth check/delivery page, and edited/saved content-only account positioning. No media/review blueprint configuration was required. Browser errors file is empty.

Inspected1440x1100 and390x844 screenshots: script/preparation/adopted/native editor/check-delivery/account settings. Narrow preparation/account controls remain reachable; the desktop-native editor is constrained at390px and is not claimed to offer full desktop editing usability there. No redesign was introduced.

**Confirmed unresolved UI issue assigned by root to unified reviewfix:** after saving current image defaultA, selecting the blank placeholder immediately restoresA; refresh still showsA. Native supplemental video similarly cannot clear selectedA. Do NOT claim blank/incompatible selection persistence passed. Evidence `T11-browser-preparation-cleared.txt`, `T11-browser-preparation-refreshed.txt`, `T11-browser-editor-selected.txt`, `T11-browser-editor-cleared.txt`; screenshots `T11-browser-*`. Actual disabled incompatible/unconnected model options were observed; no request was generated by choice alone. Root owns the clear-selection and planning UI reviewfix after this merge.

Repro runner: `/private/tmp/loop-control-166-20261031/T11-browser-runner.ts`, config `T11-vite.config.mjs`. Start from own worktree using the SDK/context env above and `npx vite-node --config <config> <runner>`. It writes synthetic credentials/isolated IDs to T11-browser.json; `/__finish` POST is its own teardown route. No live fixture is retained. Named browser closed; runner completion log confirms cleanup; exact rootExists=false and mountExists=false. All test fixtures await their own close/drop/delete; original-source retention assertions happen before disposable fixture cleanup.

## Scope and limits

Product files: `db/local/109-workspace-generation-deletion.sql`, `src/workspaceShots.ts`. Remaining changed files are the existing23-suite fixtures/tests plus sharedViews. No new dependency, parallel acceptance framework, existing SQL edit, root doc edit, fake Owner/CSRF/idempotency/unknown-result guard, daily-data migration or real Provider execution. The browser clearing defect is explicitly pending root reviewfix. Root owns final docs, two-axis review, integration acceptance and any later issue closure.

## Final receipt

- Latest integration25960ffe is an ancestor; final worktree status is clean.
- Final `npm run check` exit0 and `git diff --check` clean.
- Commit contains exactly22 scoped files below; only109 is a new migration. No root docs diff.

- `db/local/109-workspace-generation-deletion.sql`
- `src/local-app/accountDirectoryMigration.integration.test.ts`
- `src/local-app/formalWorkflow.delivery.integration.test.ts`
- `src/local-app/formalWorkflow.fixture.ts`
- `src/local-app/formalWorkflow.integration.test.ts`
- `src/local-app/legacyWorkspaceEntry.integration.test.ts`
- `src/local-app/productionWorkspace.fixture.ts`
- `src/local-app/speechSelection.integration.test.ts`
- `src/local-app/workspaceAudio.integration.test.ts`
- `src/local-app/workspaceAudioProjection.integration.test.ts`
- `src/local-app/workspaceCandidates.integration.test.ts`
- `src/local-app/workspaceDelivery.integration.test.ts`
- `src/local-app/workspaceFirstVideo.integration.test.ts`
- `src/local-app/workspaceImageGeneration.integration.test.ts`
- `src/local-app/workspaceNarration.fixture.ts`
- `src/local-app/workspaceNarration.integration.test.ts`
- `src/local-app/workspacePexels.fixture.ts`
- `src/local-app/workspaceReviewFixes.integration.test.ts`
- `src/local-app/workspaceShots.integration.test.ts`
- `src/local-app/workspaceVisualCandidates.integration.test.ts`
- `src/sharedViews.test.tsx`
- `src/workspaceShots.ts`
