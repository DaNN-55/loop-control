# T07 / #173 integration merge

- Integration worktree: `/Users/dan/.codex/worktrees/blueprint-166/integration`
- Branch: `codex/blueprint-166-integration`
- Merge: `53f8c2926172509d759be0a074a0336acb896bf9`
- Parents: `e17ee3ca757d7180ec6038f7a312177def4406ae` (T02 integration) and `286dee6e2923bd18f45a5c4dc4ddc9827be88d3e` (T07).
- Root explicitly sent GO after T02 stopped verification. Preflight and pre-merge status were clean. Merge used `--no-ff`; no conflicts, follow-up source edits, or manual conflict resolutions. Final integration status is clean.

## Integration review

- New account directory ownership is independent of blueprint content. Account creation atomically establishes ownership; an episode insert freezes `episode_asset_locations` without modifying old blueprint/business rows. Legacy episode roots remain readable through the controlled fallback and mapping layer.
- Episode commands, script material loading, native Studio/workspace access, artifact downloads, history/live cleanup, Worker root checks, backup inventory, and fresh restore now consume independent actual episode/account locations. Existing historical records remain unchanged. Worker claim uses the stable episode root and the existing scheduler/lease protocol.
- Restore checks original archive rows/security/reference fingerprints before rebinding only local account root/device/inode records; immutable episode roots are resolved using approved restore mappings. The real restore test logs in with a fresh synthetic Owner credential and downloads matching original bytes.
- T02 resolver, image implementation, production workspace commands/fixture, and migration 100 remain byte-identical to the pre-T07 integration tip. Migration 107 remains byte-identical. The fixture composition preserves 100+105+107: `productionWorkspaceFixture` contributes 100 and 107, while `embeddedStudioFixture` inserts 105 and sorts/deduplicates the combined list.
- No conflicts affected UI or DB substitutes; no additional UI/mock rerun was needed. T07 handoff contains its already completed desktop/720 px browser acceptance.

## Executed validation

1. `npm run check` — exit 0; no TypeScript diagnostics. Log: `T07-merge-check.log`.
2. `npm run runtime:prepare` — exit 0; isolated worker/backend builds and trusted manifest source/output integrity check passed. Log: `T07-merge-prepare.log`.
3. `OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_WORKSPACE_ACCEPTANCE=1 LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut npx vitest run src/local-app/accountAssetRoots.integration.test.ts src/local-app/accountAssetRootsStorage.integration.test.ts src/local-app/productionWorkspace.integration.test.ts` — **3 files / 5 tests passed**, 18.63 s; exit 0. Log: `T07-merge-roots.log`.
   - Explicit legacy takeover, unset root/history read, multi-legacy conflict without original changes, nonempty root change refusal, empty-root account cleanup.
   - Two accounts and three same-title episodes; actual imported bytes and preserved source files; stable identity after account/episode rename and restart; foreign Owner refusal; overlap/symlink/root boundary checks; missing/replaced directory refusal.
   - Actual native SQLite header and native document edit; blueprint root removed; save/reopen and edited timeline persisted; actual MP4 export/confirmation; actual queue claim root and real Worker child delivery; artifact downloads verified.
   - Actual archive and fresh database/media restore; local directory identity rebound; fresh Owner login and actual restored artifact download verified against unchanged originals.
   - Existing workspace integration checks native entry gates, script replan invalidation, stale workspace refusal, immutable project history, and foreign Owner denial.
4. `git diff --check`, both-parent ancestry, unchanged T02/T09 paths, and final `git status --porcelain=v1` — passed/clean.

The full default suite was not repeated: T07's handoff records 173 files / 1152 passing, and this merge had no conflicts or further source changes. No daily data migration, daily source write, service restart, paid call, push, deployment, or issue closure was performed. PLAN/CONTEXT/report docs remain root-owned. No outstanding merge concern found; T08's separate verified migration/recovery workflow remains outside T07.
