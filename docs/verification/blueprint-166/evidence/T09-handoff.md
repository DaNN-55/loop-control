# T09 / #175 handoff

## Branch and scope

- Worktree: `/Users/dan/.codex/worktrees/blueprint-166/t09`
- Branch: `codex/blueprint-166-t09`
- Final branch tip after latest integration merge: `2db3a6d3277903628f7dfdf32eb3774dbd173481`; authored implementation commit: `18dae57c8ff6b82abb7c8d37ccd1842e59a2f086`
- Precursor retirement-test deletion commit: `fb5cf9bd`; integration merge: `977b1c7c`.
- Merged integration `a789e5c59bda4230e8aa0dd2a270e445109d45b1`, then newly landed latest `c7baf8e6d67a81dbf7045d4f5c8dde9d4da1a744` (T01); `git merge-base --is-ancestor codex/blueprint-166-integration HEAD` exit 0. Worktree clean after commit.
- Migration reserved/added: `db/local/107-retire-blueprint-reviews.sql`. No existing migration modified. No daily database, paid Provider, service restart, push/deploy, or gh issue closure.

## Behavior delivered

- Blueprint page no longer edits review gates, shows blueprint readiness/preflight/results, or sends checkBlueprint requests. Save labels say 保存蓝图; creation progress no longer advertises whole-blueprint preflight. Media configuration and asset_root UI deliberately retained for T10/T07 integration.
- Historical approval_gates are preserved byte-for-byte as JSON values when editing rules; new form/default policies do not inject them.
- checkBlueprint account command retired. Owner/CSRF remains enforced before command dispatch.
- Create and explicit script confirmation only verify the required filesystem boundary, not unused media/planner configuration or Worker readiness. Execution paths retain their actual technical preflight, connection, input, budget and file checks.
- Migration107 removes the whole-blueprint fresh-Worker-preflight requirement from start_episode_production; script confirmation, owner, lifecycle state, actual file checks remain.
- Disabled legacy gate trigger becomes a no-op: no replacement review toggle, fabricated approval or automatic progression.
- Old storyboard_review orders explicitly preparing a workspace can record a `legacy-board` script/board baseline without retroactive review approval. SQL function locks owned input order, validates current script/latest non-invalidated board and readonly boundaries. Historical review packages/approvals remain unchanged.

## Files

- db/local/107-retire-blueprint-reviews.sql
- src/accounts/AccountWorkspace.tsx / AccountWorkspace.test.tsx
- src/platform/ConfigurationForms.tsx / configurationFormValues.ts / configurationForms.test.ts / blueprintPolicy.ts
- src/episodes/EpisodeForm.tsx / src/sharedViews.test.tsx
- src/local-app/LocalCatalogApp.tsx / LocalCatalogApp.account.test.tsx
- src/local-app/accountCommands.ts
- src/local-app/accountPreflightRoute.test.ts (removed: seven retired product-check expectations, replaced at actual Owner HTTP/real DB seam)
- src/local-app/episodeCommands.ts
- src/local-app/productionWorkspaceCommands.ts / productionWorkspace.fixture.ts
- src/local-app/blueprintReviewRetirement.integration.test.ts (two formal regressions + opt-in actual UI fixture)

## Red and green evidence

All reliable final commands below ran with explicit workdir `/Users/dan/.codex/worktrees/blueprint-166/t09`.
Common environment:
```
LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs
LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut
```

1. Red: `LOOP_FORMAL_ACCEPTANCE=1 ... npx vitest run src/local-app/blueprintReviewRetirement.integration.test.ts`, with pre-change episodeCommands restored from 3aef199c in isolated t09, then restored own green code. `T09-isolated-red.log`: create returns409 because unused storyboard/a_roll model and Prompt configuration missing. This is actual Owner HTTP / actual random DB / real filesystem failure.
2. Red: same command `-t 'old storyboard-review'`, before legacy continuation implementation. `T09-legacy-red.log`: prepareWorkspace409 请先确认脚本与分镜匹配基准。
3. Green: same full formal file on implementation: `T09-final-green.log`, 2 pass /1 browser opt-in skipped, 11.97s tests. Actual uploaded script + image -> explicit script confirmation -> preparation -> match -> real native export bytes -> export unconfirmed -> delivery denied409 -> explicit export confirm. Zero generated approval rows; legacy policy unchanged. Second test covers retired command400, missingCSRF403, missing session401; old unapproved storyboard continues with original review packages intact; archived/completed edits409.
4. Latest T01 integration merge check: `npm run check` and formal file rerun logged in T09-post-t01-check.log / T09-post-t01-green.log: typecheck exit0,2 pass /1 opt-in browser skipped,13.15s tests. Final ancestor check exit0 and status empty. Earlier post integration merge: `npm run check`, `T09-post-merge-check.log` exit0; repeat formal file in `T09-post-merge-green.log`: 2 pass /1 opt-in browser skipped,12.41s tests.
5. `npx vitest run src/accounts/AccountWorkspace.test.tsx src/platform/configurationForms.test.ts src/sharedViews.test.tsx src/local-app/LocalCatalogApp.account.test.tsx`: `T09-final-unit.log`, 81/81 pass. Existing file/asset fields, editing, failed save, local adapters, prompts, dirty state, and series tests retained; retired readiness race/display tests removed. LocalCatalogApp request assertion counts specifically checkBlueprint so T07 readAssetDirectory remains allowed.
6. `npm run check`, `npm run backend:build`, `npm run worker:build`: green logs T09-check3.log, T09-backend-build2.log, T09-worker-build2.log. Root subsequently authorized isolated `npm run runtime:prepare`; T09-runtime-prepare.log passes source/build integrity. No daily prepare/migrate/start/stop.
7. A broad unit run happened before removing obsolete accountPreflightRoute tests: `npm test -- --maxWorkers=2`, T09-all-unit.log:1151 pass /7 fail, all7 retired checkBlueprint200 expectations. Replaced them with actual Owner HTTP retirement/auth coverage above; did not rerun broad suite after focused green.

## Browser evidence

Command: `LOOP_T09_BROWSER=1 ... npx vitest run src/local-app/blueprintReviewRetirement.integration.test.ts -t 'serves the formal blueprint'`.
T09-browser.log:1 pass /2 skipped,78.76s. Real LocalCatalogApp/main.tsx served by isolated Vite at temporary loopback origin, real Owner auth and random DB, no mocked app fetch. Session `loop-t09-166` closed and done signal released fixture; DB/directory fixture cleaned. Temporary login credential metadata removed by fixture.

- Signed in; opened 账号蓝图; no 审核设置/重新检查/就绪 rail; media table retained.
- Edited positioning, clicked 保存蓝图 -> 确认保存蓝图, reloaded, reentered blueprint; persisted new text observed.
- Rendered and inspected1440x1100 and720x950. Both no horizontal overflow.
- Screenshots: T09-blueprint-desktop.png, T09-blueprint-narrow.png.
- Snapshot T09-browser-reload-snapshot.txt includes saved value and 保存蓝图.
- Initial fixture attempts failed due setup (handler unavailable during formal fixture create; existing default prompt version1 collided). Adjusted to base fixture then handler installation and independent prompt version100. These were fixture failures, not acceptance results.

## Compatibility limitations for T11

Command after isolated runtime:prepare:
```
LOOP_FORMAL_ACCEPTANCE=1 LOOP_WORKSPACE_ACCEPTANCE=1 ... npx vitest run src/local-app/formalWorkflow.integration.test.ts src/local-app/workspaceCandidates.integration.test.ts -t 'late legacy render|candidate'
```
`T09-compat-prepared.log`:3 pass /3 fail /7 skipped. Passed:
- late legacy render reports retain artifacts without advancing or approving the adopted workspace
- completed local speech versions stay immutable and rejecting a candidate preserves the native project
- prepared old speech and changed candidate bytes cannot overwrite a newer input

Failed existing src/local-app/workspaceCandidates.integration.test.ts:
- `explicit candidate duration changes only the stable main voice and stale attempts preserve the saved edit`, line21: openWorkspaceStudio409 `{error:"请先采用有效图片或视频：shot-1、shot-2。"}` expected200.
- `a saved native candidate can recover its missing adoption receipt after restart without regenerating speech`, line80: openWorkspaceStudio409 expected200.
- `explicit main-voice candidate adoption switches source and none atomically while preserving native sounds`, line101: openWorkspaceStudio409 expected200.
These tests enter Studio with narration fixture placeholders still unmatched, before their obsolete JSON-store edit steps. No expectations/assertions weakened or files changed here; T11/root to reproduce and repair proper visual setup/native-authority fixture. Earlier T09-compat.log had the same3 plus prepared-manifest problem; resolved only build issue through authorized isolated prepare.

## Daily source correction (explicit incident record)

Early tool commands accidentally omitted workdir and wrote only my3 previously clean tracked paths (episodeCommands.ts, productionWorkspace.fixture.ts, AccountWorkspace.test.tsx) and2 new T09 files in daily source. Immediately copied exact authored bytes to t09, restored only those3 from daily HEAD (initial status proved clean), and removed only my2 new files. No user-edited file or business data changed. `cmp original.patch T09-original-after.patch` exit0 confirms exact original tracked diff preserved; original after-status recorded T09-original-after-status.txt. Early T09-red.log/T09-green1.log/T09-ui-red.log thus are not isolated-worktree evidence; rely on isolated/final logs above.

## Integration notes

- Root owns PLAN/ADR index: note migration107, retired product gates and explicit baseline preparation; CONTEXT currently still describes configurable approval gates and needs final T10 terminology reconciliation.
- T07 AccountDirectoryPanel changes will add a fieldset; adjust the exact visible fieldset order assertion when merging, not business assertions. Existing T09 local catalog test allows readAssetDirectory by checking command specifically.
- Do not drop media configuration in T09; T10 owns final retirement.
