# T08 / #174 — verified account directory migration

- Worktree: `/Users/dan/.codex/worktrees/blueprint-166/t08`
- Branch: `codex/blueprint-166-t08`
- Final SHA: `8cf36d58cf1f3a2a1b4dd387ac7895842ff9124c` (clean worktree).
- Started from T07 integration `53f8c292`; merged integration through T03 `2e273812`, T05 `b6124f91` and T06 `5a8cc4d412bf95ab6a4cfb740c9dab7ddbb53e9f`. Merge `0516c125` contains that final source snapshot; all subsequent commits are T08-only. Root was explicitly informed of this fixed validation point. The 5a8cc4d4 integration snapshot is an ancestor of final HEAD; no conflicts occurred. Subsequent T04/Pexels source integration is left to root/T11 combination acceptance.
- No daily source/data writes, daily migration, paid requests, push, deployment, main merge or issue closure. Root owns PLAN/CONTEXT/ADR/report changes. All changes are scoped local commits for #174.

## Delivered workflow and public contract

Account directory panel supports actual inventory → review scope/conflicts → copy, verify and switch → durable recovery/rollback, with current actual path distinct from an unsaved target. It shows source/target roots, production titles/IDs, file count/bytes, reference count and expandable complete file paths/hashes/source roots. Latest receipts survive refresh/restart; errors and explicit recovery/rollback remain available.

Existing authenticated/CSRF-checked `/api/local/account-commands` adds:

- `planAssetDirectoryMigration {accountId,path}` → receipt `{id,status:'planned',targetRoot,targetIdentity,sources,logicalRoots,episodes,files,references,totalBytes,evidenceSha256,conflicts}`. Each file includes `sourceRoot,relativePath,fileSize,sha256`; roots include device/inode identity.
- `readAssetDirectoryMigrations {accountId}` → latest 20 durable receipts including status/error/full manifest.
- `executeAssetDirectoryMigration {accountId,migrationId}` → verified completed receipt with `originalsRetained:true`. Repeating a completed receipt is safe. Interrupted `copying` and `failed` receipts resume by the same command, after mount/permission/conflict restoration.
- `rollbackAssetDirectoryMigration {accountId,migrationId}` → stops an incomplete migration and unblocks the original current root. Original files and all target copies remain. Completed migration rollback is refused; a subsequent move requires a new reviewed inventory.

`db/local/106-account-directory-migrations.sql` adds local-only tables:

- `account_directory_migrations`: `planned/copying/failed/completed/rolled_back`, manifest, error, timestamps, account ownership/RLS.
- `account_directory_locations`: account-scoped logical/source root → verified effective root, linked to the receipt.

Business blueprints, tasks/packages, candidates, material provenance, episode locations and history remain byte-for-byte unchanged by migration. `episode_asset_root` and `account_mapped_asset_root` resolve frozen roots through controlled account mappings before existing deployment mapping. Current account root identity and all its mappings switch in one DB commit. Worker leases, actual reads/writes, native Studio, artifact/history reads, exports/delivery, backup reference inventory and fresh restore consume that effective location. Existing old-schema backup fallback remains.

## Filesystem, authorization and race boundaries

- Inventory includes the current owned root plus every historical blueprint/episode root and approved deployment aliases. Multiple historical roots are merged by relative path; identical files deduplicate, differing bytes produce a visible conflict. No latest-project-only shortcut.
- Inventory hashes every regular file, including input/script, managed media, candidates, native SQLite/recovery/uploads, captions, snapshots, exports and delivery files. Episode/workspace rows and nested snapshots/native JSON contribute actual file reference checks. Frozen output contracts and task output project declarations describe promised files and are excluded from existing-file references; registered artifacts/materials/candidates and all real input references remain checked. Missing/wrong-size/wrong-hash actual references prevent switching.
- Root metadata, historical roots and account location mappings are included in the evidence fingerprint, so even changing an empty account's root between plan and execute invalidates its previous plan. New files at the newly selected root cannot be omitted by a stale inventory.
- Targets must be existing, canonical, readable/writable authorized actual directories; platform roots, deployment display aliases, symlinks, hardlinks, foreign/shared/nested roots and any overlap with own current source are refused. Device/inode replacement and external mount identity are checked. Nonempty target content at planning is a conflict; unexpected target files at execution/recovery are retained and rejected.
- `assetPathWithin` uses path-segment boundaries; `accountAssetRootsOverlap` is shared by T07/T08. Real HTTP tests show that `/a/..name` cannot be claimed by another empty account or selected as its own migration target; an authorized media-root child `..alpha` remains usable. Account-empty cleanup and episode deletion scope use the same containment helper.
- Global root ownership advisory lock plus current account, all account episode and task row locks protect copy/cutover against Owner production, new episodes and Worker claims. A durable copying state and task trigger reject new/updated tasks in the gap or while copying. Existing active ready/running work, unresolved paid/submission outcomes, file leases and live Studio block migration without auto-cancellation. Already invalidated non-running ready attempts are inactive. A paid ledger still at submitting is released only when at least one submission protocol explicitly recorded rejected and no protocol has started/received unknown evidence; plain failure never bypasses unknown protection. The ledger is never rewritten for migration.
- Native Studio writes a small PID/episode receipt beside its actual runtime store. A still-live native child after host restart blocks migration; normal close removes the receipt. No native editor is cancelled by migration.
- SHA reads and file copies are sequential and streaming (256 KiB copy chunks), with fsync, capacity check and per-file source/destination verification. Limits: 128 actual source roots and 100,000 total files; native JSON metadata parsing is bounded to 32 MiB per JSON document. Media bytes are never accumulated as an entire account in memory.
- Publication uses an exclusive hard link from a verified receipt-scoped temporary file, then removes only that temporary name. This cannot replace a file created concurrently after the collision check. Recovery verifies and handles a crash between those two operations (the exact temp/published pair may briefly have two links). Other hardlinks remain refused. Target filesystem must support this safe publication; an unsupported filesystem preserves the old location and partial evidence rather than weakening overwrite protection.
- Original roots/external originals are never deleted, renamed or overwritten. A failure before the DB commit leaves the current root/mappings unchanged. The only automatic cleanup is the current receipt's recognized partial output names; full copies remain on failure/rollback. After successful migration, production deletion targets the effective new directory and leaves retained original copies alone.

## Red / green evidence

Confirmed primary seam: actual Owner HTTP → disposable real PostgreSQL/tasks → actual isolated files/native SQLite/SDK/Worker, never internal mocks for migration proof.

1. `T08-red-1.log`: planning HTTP returned **400** `账号本机操作无效。` instead of 200 before implementation. `T08-green-1.log`: plan passed after implementation.
2. `T08-overlap-red.log`: own nested `..nested-target` migration path returned **200** instead of 409. Shared segment check fixes it.
3. `T08-cross-account-overlap-red.log`: an empty foreign account accepted another account's nested `..owned-child` root (**200** instead of 409). The stronger test uses an empty account so the old nonempty-root migration guard cannot mask the occupancy bug. Shared overlap now refuses it explicitly as overlap.
4. `T08-authorized-root-cleanup-red.log`: legitimate `..alpha` root deletion planning returned **409** `删除目录超出媒体部署范围。` instead of 200. Both cleanup containment paths now use the segment helper, and the same HTTP scenario also deletes only the legitimate empty `..empty-account` root.
5. `T08-scope-red.log`: a stale empty-account inventory cut over (**200**) after the account had selected another root containing a real new file. The evidence fingerprint now includes current directory/location/legacy-root metadata; execute returns 409, preserves that current root/file, and explicit rollback/new inventory copies the complete actual scope.
6. `T08-publication-red.log`: actual interrupted streaming copy followed by a real filesystem temp/published hard-link pair could not resume (**409** `迁移暂存文件身份无效。`). Exclusive publication recovery now validates that exact pair, removes its own temp name, verifies the remaining full file and completes.

7. `T08-platform-red.log`: a legacy blueprint pointed at the platform openchatcut root, and planning incorrectly returned 200 with a public runtime file in its scope. Platform roots are now rejected for sources as well as targets; the original runtime file remains and never appears in the migrated account.
8. `T08-invalidated-red.log`: an invalidated inactive ready attempt incorrectly blocked a valid historical migration. The active-task predicate now matches its actual execution eligibility; running and uncertain submissions remain blocked.
9. `T08-definite-reject-red.log`: actual controlled TTS HTTP 400 → actual Worker failed/rejected → paid ledger still submitting incorrectly blocked migration, and its never-generated frozen output was mistaken for an existing-file reference. `T08-definite-reject-green.log`: 2 passed. The actual Owner/Worker cases preserve submitting ledgers, allow real migration after definite rejection, retain blocking after a transport-unknown started outcome and restart, and refuse contradictory received evidence from another submission protocol. This also verifies that promised output paths do not count as completed artifacts. A too-small test reservation initially hit the real fee validator; the fixture now supplies sufficient synthetic reservation without weakening it.

The first copy implementation using a FileHandle-backed pipeline did not finish; it was replaced with a bounded explicit streaming write loop. Its actually terminated runner left a real copying receipt and partial file. A completely fresh Owner HTTP server later resumed that exact saved receipt, downloaded matching bytes, and retained originals: `T08-actual-process-recovery.log` **1 passed**. This recovery used disposable DB `loop_studio_153_611de88a13d0` and exact root `/private/tmp/loop-153-LC4a3z`, verified the binding first, then cleaned only those exact test resources. The one-off harness was removed; committed interrupted-copy/restart tests remain reproducible.

Additional initial issues corrected without weakening assertions: JSONB key ordering required canonical metadata hashing; DB evidence query needed text/UUID compatibility for old deletion receipt tables; actual delivery exposed missing loop_worker read access to the migration status table, now granted with SELECT RLS. No source-string or mock-only proof substitutes for the real boundary.

## Validation

Final source snapshot: own HEAD `8cf36d58` contains integration `5a8cc4d4` plus final T08 changes. Source did not change during these final verification commands; committing only recorded the verified bytes.

- `npm run check` — passed, no diagnostics (`T08-reject-check.log`).
- `npm run runtime:prepare` — passed; Worker/backend builds and source/output integrity checks passed (`T08-handoff-prepare.log`).
- `npm test` — **173 files / 1147 tests passed**, 40.15 s (`T08-handoff-default.log`). Counts reflect the incorporated T03/T05/T06 tests, rather than the earlier T07 baseline count.
- `OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_WORKSPACE_ACCEPTANCE=1 LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut npx vitest run src/local-app/accountDirectoryMigration.integration.test.ts src/local-app/accountDirectoryMigrationSubmissions.integration.test.ts src/local-app/accountDirectoryMigrationStorage.integration.test.ts src/local-app/accountAssetRoots.integration.test.ts` — **4 files / 12 tests passed**, 46.93 s (`T08-handoff-integration.log`). Personally read all results.
- `git diff --check`, final clean status, and `git merge-base --is-ancestor 5a8cc4d412bf95ab6a4cfb740c9dab7ddbb53e9f HEAD` passed.
- An earlier run in `T08-final-green.log` correctly refused two actual Worker children after the concurrent T06 integration changed trusted source bytes mid-run. This was an invalidated runtime-manifest snapshot, not a relaxed assertion or passing run; the final prepare and 12-test run above supersede it.

- Browser: `T08-browser.log` **1 fixture passed**, unique headless session `loop-t08-166`, explicit `--auto-connect false`, unique fixture origin. Actual login, account page, target input, inventory, visible full scope and execute through the real API. Visually inspected `T08-desktop.png` (1280 wide), `T08-narrow.png` (720 × 960) and `T08-complete.png`; completion shows actual new root, original retained, correct counts and no duplicate-submit action. Fixture and its generated entry were cleaned. Later changes were backend directory boundary/recovery guards; the UI source did not change after this capture.
- Default suite after the path-boundary fix: `T08-boundary-final-default.log` **173 files / 1153 passed**, prior to the latest T03 merge.
- Merged T03 UI/Owner guard checks: `T08-merged-ui-guards.log` **4 files / 63 passed** (AccountWorkspace, WorkspaceVisualCandidatesPanel, caption confirmation Owner route, mediaPaths). Existing React act warnings were not treated as pass/fail changes.
- Repeated actual T07/T08/backup checks after each new boundary fix are in `T08-boundary-final-green.log` (4 files / 12 passed), `T08-final-merged-integration.log` (3 / 9), `T08-scope-green.log` (3 / 10), and `T08-publication-green.log` (3 / 10). The final run below supersedes these snapshots.

## Root-owned documentation suggestions

Mark T08 complete with inventory/copy/hash+reference verification/atomic local mapping/recovery delivered and originals retained. Record that stable episode/business roots remain frozen and SQL/local deployment resolution handles moved locations, and that the actual native/edit/export/delivery/backup/fresh-restore acceptance passed. Migration 106 must be applied through the existing forward migration workflow; no daily migration was performed here. T10 can retain/remove transitional blueprint fields without owning the actual directories.


## T04 / T11 integration seam

T04's future `local_identity.workspace_pexels_requests` has episode/workspace FKs, so the runtime evidence query includes it automatically. Full root inventory does not filter artifact types: `pexels_search_results` JSON, `pexels_video_preview` MP4 and actual imported material/candidates are copied and hashed. Artifact/material references are read by path/hash/size, and nested JSON inputs are checked. No T08 explicit table/artifact-type enumeration must be extended. Root/T11 owns the final Pexels + migration/deletion combined proof; this handoff does not claim that not-yet-merged scenario ran here.

## Exact T08 files against integrated 5a8cc4d4

`db/local/106-account-directory-migrations.sql`; `scripts/storage/backup.mjs`; `scripts/storage/restore.mjs`; `src/accounts/AccountDirectoryPanel.tsx`; `src/local-app/accountAssetRoots.integration.test.ts`; `src/local-app/accountAssetRoots.ts`; `src/local-app/accountCommands.ts`; `src/local-app/accountDirectoryCleanup.ts`; `src/local-app/accountDirectoryMigration.browser.integration.test.ts`; `src/local-app/accountDirectoryMigration.integration.test.ts`; `src/local-app/accountDirectoryMigration.ts`; `src/local-app/accountDirectoryMigrationStorage.integration.test.ts`; `src/local-app/accountDirectoryMigrationSubmissions.integration.test.ts`; `src/local-app/captionTextConfirmationRoute.test.ts`; `src/local-app/embeddedStudio.fixture.ts`; `src/local-app/episodeDeletionTargets.ts`; `src/local-app/mediaDeployment.ts`; `src/local-app/mediaPaths.ts`; `src/ui/impeccable/configuration.css`; `src/worker/openchatcutStudio.ts`.
