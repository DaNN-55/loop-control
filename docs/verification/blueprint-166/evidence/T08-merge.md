# T08 / #174 integration merge

- Integration worktree: `/Users/dan/.codex/worktrees/blueprint-166/integration`.
- Before merge: `b1fa3eb1` (integration `5a8cc4d4` plus later documentation only).
- Incoming: `8cf36d58cf1f3a2a1b4dd387ac7895842ff9124c`, branch `codex/blueprint-166-t08`.
- Merge: `634e5df49b63ee43bdf59d44a9aafc58f92292ab`, `--no-ff`, no conflicts or corrective source edits.
- Verified both incoming final SHA and integration `5a8cc4d4` are ancestors. The diff of SQL104 and existing production-workspace/narration/audio/selection modules against premerge integration is empty. T02/T03/T05/T06 task guards remain incorporated.
- No PLAN/CONTEXT/ADR edits, daily source/data writes, daily migration, paid calls, push, deploy, main merge or issue closure.

## Reviewed boundaries

- SQL106 persists complete manifests and recovery state separately from business records. Its dynamic evidence inventory includes all episode-scoped base tables plus workspace-scoped tables without `episode_id`, with current account directory, mappings and blueprint-root metadata appended. An empty-account root change therefore invalidates an old plan.
- All actual source roots are inventoried, not only the latest workspace. Each file is hashed with streaming reads, copies use bounded 256 KiB chunks, target capacity is checked, and source/destination fingerprints plus actual references are verified before cutover.
- Exclusive hard-link publication cannot replace a concurrently created destination. Recovery accepts only this receipt's exact temporary/published inode pair, removes only its recognized temporary name and retains full copies and originals.
- Shared `assetPathWithin` rejects only parent traversal segments, so a legitimate `..alpha` child is usable. `accountAssetRootsOverlap` catches nested `..owned-child` cross-account claims as overlaps. The actual test uses an empty foreign account, avoiding a nonempty-root guard masking this boundary.
- Expected output contracts and task output declarations are excluded from existing-file checks. Real artifact/material/candidate paths, input snapshots and nested native JSON references remain verified. The actual failed/rejected Worker case permits never-generated promised output; the historical artifact fingerprint mismatch still blocks.
- SQL106 scans every submission protocol before considering paid reservations: any `started`/`received` evidence on an unfinished task blocks, including contradictory evidence in another protocol. A definite `rejected` result can release a lingering `submitting` ledger only when no unknown evidence exists. The ledger itself is not rewritten.
- Account/episode/task row locks, global ownership lock, durable `copying` state and task trigger preserve Owner/Worker race guards. Live Studio sessions and persisted live child PID receipts block migration; neither native editing nor paid work is automatically cancelled. Invalidated inactive ready attempts are excluded, while running work remains blocking.
- Effective account location mappings and current root identity publish in one database commit. Blueprint/task/package/history bytes remain frozen; actual reads, new writes, native editing, exports/delivery, backup/restore and deletion consume the effective location. Cleanup changes preserve exact scope and originals.

## Actual validation at merge SHA

1. `npm run check` — passed, no diagnostics. Log: `T08-merge-check.log`.
2. `npm run runtime:prepare` — passed, Worker/backend build and trusted source/output integrity checks. Log: `T08-merge-prepare.log`.
3. Actual Owner HTTP / disposable PostgreSQL / isolated files / native SQLite / controlled Worker integration — **4 files, 12 tests passed**, **29.60 s**. Log: `T08-merge-integration.log`.

```sh
OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_WORKSPACE_ACCEPTANCE=1 LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut npx vitest run src/local-app/accountDirectoryMigration.integration.test.ts src/local-app/accountDirectoryMigrationSubmissions.integration.test.ts src/local-app/accountDirectoryMigrationStorage.integration.test.ts src/local-app/accountAssetRoots.integration.test.ts
```

The run personally read back passed all six migration cases, both reject/unknown Worker cases, real backup/fresh restore, and three actual-root isolation/native export/delivery cases. It includes source-offline restart reads, postmove writes and effective-root deletion, mount and collision recovery, real interrupted streaming copy plus publication-link recovery, immutable historical references, stale metadata invalidation, `..name` containment and actual native SQLite edits/reopen/export/delivery.

`git diff --check`, final clean worktree and ancestry checks passed. No full default suite rerun: incoming handoff already records 173 files / 1147 tests passed at identical source bytes relative to the integration base, and the merge had no source conflict or correction. No additional UI/unit conflict run was required.

## Evidence limits / next combination

- Browser UI was not rerun in this merge pass; incoming `T08-browser.log` and desktop/narrow/completion captures remain the UI evidence. This merge did not change those UI bytes.
- T04's new Pexels tables/artifacts are not merged here. Dynamic episode/workspace evidence and whole-root file inventory cover their schema/path shape by inspection, but actual Pexels + migration/deletion combination remains T11/root acceptance.
- No daily migration or real paid Provider behavior was exercised. SQL106 still requires the ordinary forward migration workflow when deployment is authorized.

Integration exclusive ownership is released after this report and clean-status verification.
