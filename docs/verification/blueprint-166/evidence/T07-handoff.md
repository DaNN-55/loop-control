# T07 / #173 handoff

- Worktree: `/Users/dan/.codex/worktrees/blueprint-166/t07`
- Branch: `codex/blueprint-166-t07`
- Final HEAD: `286dee6e2923bd18f45a5c4dc4ddc9827be88d3e`
- Implementation: `b9798bf7`; merge of latest integration: `97bdad7c`; caption fixture compatibility: `286dee6e`.
- Integration `b817e5dfc4c3c4814ec89607b27ee6cc6318f324` is an ancestor of HEAD. Worktree clean after browser fixture cleanup.
- Original source and integration worktree were never edited. No daily migration/data move, global DB/secret change, paid call, push, deploy, main merge, or issue close.

## Delivered behavior

账号独立拥有真实目录；新生产单在插入时冻结独立位置，正文、受管导入、任务包、Studio SQLite/工程、导出、交付与读取都使用该位置。账号/生产单改名不改变稳定 ID 路径。目录保存验证不依赖蓝图就绪或 Provider。

- `readAssetDirectory` / `setAssetDirectory` Owner commands support explicit legacy takeover, actual path/status/history display, and account create `assetRoot`.
- Account claims are serialized globally and inspect other accounts across RLS, including historical blueprint/episode references. Same/parent/child roots and symlink aliases are refused; only existing canonical subdirectories of the established media authorization root are accepted; platform standalone Studio root is reserved.
- Missing directory config blocks new productions/writes while historical reads remain. Multiple historical roots are reported as conflict without guessing or moving data. A file/history-bearing account cannot switch its root by changing a pointer. Inode/device replacement is detected.
- Existing file access/deployment aliases remain controlled. Current actual paths are displayed; a chosen new root is never silently remapped elsewhere.
- Account deletion captures independent roots and still performs only existing guarded nonrecursive empty-directory cleanup. Episode deletion uses its stable root.
- Backup/restore reference inventory uses independent episode locations with an old-schema fallback. Explicit fresh restore rebases local account configuration to the restored actual path/device/inode and records `accountDirectoryRebindings`; immutable episode/business source references remain unchanged and resolve via approved restore mappings.

## Public interfaces for T08 / T10

- `local_identity.account_asset_directories(account_id PK FK accounts ON DELETE CASCADE, actual_root UNIQUE, device_id, inode_id, updated_at)`
- `local_identity.episode_asset_locations(episode_id PK FK episodes ON DELETE CASCADE, account_id FK accounts ON DELETE CASCADE, asset_root, created_at)`
- `local_identity.episode_asset_root(uuid)` resolves the stable location with controlled legacy fallback.
- `local_identity.account_asset_root_claims()` is a trusted local-service occupancy query across RLS.
- `requireAccountAssetRoot`, `resolveEpisodeAssetRoot`, `readAccountAssetDirectory`, `setAccountAssetDirectory` live in `src/local-app/accountAssetRoots.ts`.
- New independent account panel lives outside the creative blueprint form. Transitional blueprint asset/tool fields remain for T10 retirement; their values do not own new actual I/O. T08 full inventory/copy/verification/atomic switch/recovery workflow is deliberately not implemented here.

## Red / green evidence

Confirmed seam used: actual Owner HTTP → disposable real PostgreSQL and durable queue → controlled native SDK / actual Worker child → isolated actual files. No internal mock supplies the primary root proof.

1. `T07-red.log`: first directory takeover HTTP returned **400** (`账号本机操作无效`) where **200** was expected, before implementation. `T07-green-1.log`: 1 test passed after independent ownership/commands.
2. `T07-red-2.log`: createAccount accepted the input but `readAssetDirectory` returned `assetRoot:null,status:unset` instead of the selected actual path. `T07-green-2.log`: passed after atomic create-account directory ownership.
3. Expanded real file/native/backup coverage is in the final merged runs below. One isolated mount test initially hit the unchanged mountpoint guard; it was corrected to use an actual disposable APFS volume. Native document-edit fixture initially lacked `OPENCHATCUT_ROOT`; rerun used the existing approved SDK. Restore bootstrap fixture initially omitted credentials (correctly excluded by backup); it now supplies a fresh synthetic password and performs actual Owner login. These were fixture/environment corrections, not relaxed assertions.

## Final validation (personally read)

- `npx tsc -b --pretty false` — passed; `T07-final-tsc.log` has no diagnostics.
- `npm test` — **173 files / 1152 tests passed**, 28.25 s. `T07-final-default-tests.log`.
- `npx vitest run src/local-app/captionTextConfirmationRoute.test.ts` — **11 passed**. The existing DB transport substitute now returns the independent root query and real filesystem device/inode; all old caption/Owner assertions remain. `T07-caption-guard.log`.
- `npm run runtime:prepare` — passed in this worktree only. `T07-merged-prepare.log`.
- `OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_WORKSPACE_ACCEPTANCE=1 LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut npx vitest run src/local-app/accountAssetRoots.integration.test.ts src/local-app/accountAssetRootsStorage.integration.test.ts src/local-app/productionWorkspace.integration.test.ts` — **3 files / 5 tests passed**, 22.48 s; `T07-merged-roots.log`.
  - Unset root preserves historical read and blocks new writes; explicit takeover; multiple legacy roots refuse takeover and retain originals; nonempty path switch rejected; empty account deletion cleans only its root.
  - Two accounts / three same-title productions; actual managed import copies; original files unchanged; account/episode rename; foreign Owner download refusal; nested, shared, symlink and media-root refusal; restart; missing/replaced directory refusal and restoration.
  - Actual SQLite header and native SDK project-document edit; Owner save/reopen retains that native edit even after the blueprint root is removed; actual MP4 export, explicit confirmation, queue claim actual root, real Worker child delivery, and downloaded artifacts verified.
  - Real native archive and fresh DB/media restore; source originals unchanged; restored independent account actual root is ready after fresh Owner login; original artifact downloaded through actual restored Owner HTTP.
- Browser: unique headless sessions `loop-t07-166` and `loop-t07-final`, explicitly `--auto-connect false`, unique localhost fixture ports. First run created an account with actual directory. Final merged run verified desktop/720 px panel, visible unsaved path vs current actual location, and migration error for a file-bearing account. `T07-final-browser.log`: fixture completed/cleaned; screenshots `T07-final-desktop.png`, `T07-final-narrow.png`, `T07-final-path-error.png`; first creation screenshot `T07-narrow.png`. No daily browser/session/cookies were used.
- `git diff --check` and ancestry check passed. Relevant default tests were not repeated after the final all-green run; browser and final commits did not modify runtime behavior afterwards.

## Scope / limits

- New roots stay inside the existing local media authorization boundary; this does not add arbitrary full-disk permissions.
- Device/inode identity changes deliberately block ordinary writes/save. The explicit fresh-restore path rebases that local identity. T08 may provide the later verified migration/recovery flow.
- No supplier quality or paid API execution is claimed. Native local SDK/ffmpeg/Worker and controlled services only.
- Root owns PLAN.md and ADR/index. Suggested progress note: T07 actual-root ownership and its real HTTP/native/backup acceptance are complete; T08 can now consume the stable account/episode location interfaces; T10 removes the transitional blueprint directory field.

## Exact files different from integration b817e5df

- `db/local/105-account-asset-directories.sql`
- `scripts/storage/backup.mjs`
- `scripts/storage/restore.mjs`
- `src/accounts/AccountDirectoryPanel.tsx`
- `src/accounts/AccountForm.tsx`
- `src/accounts/AccountWorkspace.test.tsx`
- `src/accounts/AccountWorkspace.tsx`
- `src/local-app/LocalCatalogApp.account.test.tsx`
- `src/local-app/accountAssetRoots.browser.integration.test.ts`
- `src/local-app/accountAssetRoots.integration.test.ts`
- `src/local-app/accountAssetRoots.ts`
- `src/local-app/accountAssetRootsStorage.integration.test.ts`
- `src/local-app/accountCommands.ts`
- `src/local-app/captionTextConfirmationRoute.test.ts`
- `src/local-app/configurationCommands.ts`
- `src/local-app/embeddedStudio.fixture.ts`
- `src/local-app/episodeCommands.ts`
- `src/local-app/episodeLifecycle.ts`
- `src/local-app/episodeReads.ts`
- `src/local-app/localRoute.ts`
- `src/local-app/localWorkerCli.ts`
- `src/local-app/scriptProductionStore.ts`
