# T09 / #175 integration merge

## Result

All repository commands used explicit workdir `/Users/dan/.codex/worktrees/blueprint-166/integration`, branch `codex/blueprint-166-integration`.

- Incoming: `2db3a6d3277903628f7dfdf32eb3774dbd173481`.
- Prior integration: `c7baf8e6d67a81dbf7045d4f5c8dde9d4da1a744`.
- Command: `git merge --no-ff 2db3a6d3277903628f7dfdf32eb3774dbd173481 -m 'Merge #175 blueprint review retirement into integration'`.
- Merge SHA: `c0538019639e876e7df1bfefa9bb0bb820120195`.
- Clean ort merge; no conflict or integration-only source edits. Only the 17 incoming T09 files changed. No PLAN.md / CONTEXT.md edits. No daily worktree/data changes, paid calls, daily migration, service restart, push, deploy or issue closure.

## Validation

Integration commands used `LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut` (ENV below). Logs are in this notes directory.

- `npm run check`: exit0; T09-merge-check.log.
- `npx vitest run src/accounts/AccountWorkspace.test.tsx src/platform/configurationForms.test.ts src/sharedViews.test.tsx src/local-app/LocalCatalogApp.account.test.tsx`: 4 files,81/81 pass; T09-merge-unit.log.
- `npm run runtime:prepare`: exit0; isolated worker/backend build and trusted source/build integrity passed; T09-merge-runtime-prepare.log.
- `LOOP_FORMAL_ACCEPTANCE=1 ENV npx vitest run src/local-app/blueprintReviewRetirement.integration.test.ts`:2 pass,1 browser opt-in skipped; T09-merge-formal.log. Actual Owner HTTP/random DB/files/native export: unused unavailable tool does not prevent create/script confirmation; missing script409; wrong Owner404/missingCSRF403; actual export unconfirmed; premature delivery409; explicit final confirmation succeeds. Retired command400/missingCSRF403/no session401. Old storyboard-review order prepares without fabricated approvals; original review packages preserved; archived/completed edits409.
- `LOOP_T09_BROWSER=1 ENV npx vitest run src/local-app/blueprintReviewRetirement.integration.test.ts -t 'serves the formal blueprint'`:1 pass,2 unselected skipped; T09-merge-browser.log. agent-browser isolated session loop-t09-merge-166 logged into real fixture UI, edited positioning, saved through 确认保存蓝图, reloaded/reopened and observed 合并复验保存成功. Inspected screenshots at1440x1100 and720x950; document scrollWidth equals viewport width in both. No审核设置/重新检查/readiness rail; media table and asset directory retained. Browser closed; done signal released fixture; random DB/paths/credential metadata cleaned by fixture. Evidence: T09-merge-browser-reload-snapshot.txt, T09-merge-blueprint-desktop.png, T09-merge-blueprint-narrow.png. One guessed success-toast wait timed out (actual indicator is 已保存); subsequent inspection and reload verified save persistence.
- `LOOP_FORMAL_ACCEPTANCE=1 LOOP_WORKSPACE_ACCEPTANCE=1 ENV npx vitest run src/local-app/formalWorkflow.integration.test.ts src/local-app/workspaceCandidates.integration.test.ts -t 'late legacy render|candidate'`:3 pass,3 fail,7 unselected skipped; T09-merge-compat.log. Failures exactly match T09-handoff; no expectations/assertions/fixtures edited here.

## Existing candidate fixture failures, distinct from T09

All3 stop at openWorkspaceStudio before obsolete JSON-store editing: narration fixture placeholders have no valid adopted visuals and current technical guard returns409 instead of expected200. First error says 请先采用有效图片或视频：shot-1、shot-2。

- workspaceCandidates.integration.test.ts:21: explicit candidate duration changes only the stable main voice and stale attempts preserve the saved edit.
- workspaceCandidates.integration.test.ts:80: a saved native candidate can recover its missing adoption receipt after restart without regenerating speech.
- workspaceCandidates.integration.test.ts:101: explicit main-voice candidate adoption switches source and none atomically while preserving native sounds.

Passed compatibility cases: late legacy render cannot advance/approve adopted workspace; completed speech stays immutable/reject preserves project; stale/tampered candidate cannot overwrite newer input. T11/root should repair actual visual/native-authority setup without weakening assertions.

## Technical guard review

Only blueprint-wide readiness and start-time fresh Worker preflight prerequisites retired. Create/start retain actual filesystem and script/material-byte checks. Operation-time preflight/connection checking, media/narration readiness and storyboard budget checks remain. Script reconfirmation, candidate implementation, final export and delivery validators are unchanged by this merge: hashes, caption timing/completeness and explicit current final-file confirmation remain. Formal HTTP proves premature delivery rejected and zero fabricated approvals. Historical approval_gates remains opaque legacy JSON; migration107 makes disabled-gate auto-advance a no-op and adds explicit legacy preparation baseline without rewriting historical reviews/approvals.

Broad unit suite not rerun. No new unresolved T09 failure found.
