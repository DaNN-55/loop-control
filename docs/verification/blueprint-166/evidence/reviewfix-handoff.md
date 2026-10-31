# Final reviewfix handoff — #166 / #177

Commit **6fd02cbea0cac322ef6afa82f3971cd8f90b3539**, branch `codex/blueprint-166-reviewfix`, isolated worktree `/Users/dan/.codex/worktrees/blueprint-166/reviewfix`. Created and confirmed from pin `7e560dad7d7f1ff678f535c6b50bd6ee0fdd488d`; final `git merge codex/blueprint-166-integration` says Already up to date; integration remains an ancestor. Final status clean. Single fresh implementer handled all findings. Daily checkout, root docs/PLAN/README, services and data untouched; no migrations, real paid execution, push/deploy or main merge.

## Findings fixed

- P2: preparation image/video, native video, speech default/shot, audio and Pexels accept empty selection. Explicit clear is durable `null`; native restoration distinguishes absent field from saved null. Defaults only prefill missing choice; incompatible prompt/settings/voice/query stay unchanged, existing validation still blocks invalid submission. Clearing does not submit, adopt or change budgets.
- P3 UX: only the new inline planner opts out of full fixed Provider/Adapter fields. Canonical `codex` values and validation, editable model/Harness/budget/file tools remain. Historical/admin dialog keeps its default behavior. A concise Codex context remains.
- P3 duplication suggestion: minimal `productionModelSelection` resolves a real service/model choice or explicit null. Preparation image/video, native video and speech use it. No general form framework/dependency/refactor.
- Additional real integration regression: T11's global delete/reappend of `loopControlShot` changed persisted project bytes after SDK snapshotting, so returned Studio receipt/session hash differed from DB workspace hash. Restored helper assignment position; only temporary comparison clones normalize the owned extension's key position in `updateWorkspaceProject`. SDK bytes and global hash protocol remain intact; historical `content_sha256` is retained only for semantic equality. Real content changes still invalidate confirmation. Existing strict selection-only export confirmation passes.
- Final browser follow-up: inherited global select CSS hid Prompt Harness at font-size0/absolute position. Scoped planner CSS restores its necessary field label and normal flow, with no global select change. Normal existing drawer scrolling reaches the save button on narrow viewport.

## TDD evidence (all paths below in this notes directory)

Each slice used rendered public controls first, then minimal implementation; component fetch stubs supply catalog boundary only. Actual Owner/DB/Worker/SDK integration and browser verify the critical boundaries independently.

| Slice | Red | Green |
| --- | --- | --- |
| preparation image/video saved default -> clear -> target switch/reopen | reviewfix-visual-red.log (2fail) | reviewfix-visual-green.log (2pass) |
| native default -> clear -> switch/reopen | reviewfix-native-red.log (1fail) | reviewfix-native-green.log (1pass) |
| speech default/shot clear, incompatible voice retained | reviewfix-speech-red.log (1fail) | reviewfix-speech-green.log (1pass) |
| sound default -> clear -> switch/reopen | reviewfix-audio-red.log (1fail on reopening) | reviewfix-audio-green.log (1pass) |
| Pexels clear/query persistence | reviewfix-pexels-red.log (1fail) | reviewfix-pexels-green.log (1pass) |
| planner fixed identities hidden/canonical save | reviewfix-planner-red.log (1fail) | reviewfix-planner-green.log (1pass) |
| real SDK receipt parity and repeat save | reviewfix-receipt-red.log (actual mismatched hashes) | reviewfix-native-actual.log (12pass including new receipt/repeat assertions) |
| actual Harness label | reviewfix-harness-label-red.json (0px/absolute) | reviewfix-harness-label-green.json (12px/static) |

`workspaceCandidates.integration` retains the actual returned Studio receipt as next save's input, asserts receipt===workspace hash, executes an additional repeat save, then completes the existing native speech adoption. It does not substitute `w.project.sha256` to evade the real UI path.

## Verification actually run

- `reviewfix-components.log`: 5files /67pass (visual24, speech6, audio9, planner1, shared27). Existing React act warnings only.
- `reviewfix-default.log`: full ordinary `npm test -- --maxWorkers=2`, **174files /1144pass /0fail**. This full invocation was green, unlike earlier T11 default snapshots.
- Build -> runtime:prepare -> actual compiled test sequence completed before Worker tests; no build ran during those tests. Actual commands set BOTH `OPENCHATCUT_ROOT` and `LOOP_TEST_OPENCHATCUT_ROOT` to `/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut`, and `LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs`.
- `reviewfix-native-actual.log`: **3files /12pass** = Candidates7 + AudioProjection1 + Delivery4. Preserves raw receipt chain, source/none routing, unchanged native sounds, stale/adoption/immutability guards, strict selection-only revision and exact confirmed export, real compiled delivery Worker/tamper/retry boundaries.
- `reviewfix-formal-actual.log`: **3files /10pass** = formal6 + fresh formal delivery1 + productionSelection3. Flags `LOOP_WORKSPACE_ACCEPTANCE=1 LOOP_FORMAL_ACCEPTANCE=1 LOOP_FORMAL_DELIVERY=1`, maxWorkers2. Actual ordinary Codex planner, v2, fresh service-selected delivery, raw missing-selection rejection, unsupported/incompatible/Owner/CSRF/budget/unknown/rotation and frozen task/candidate guards pass.
- After backend tests, only the scoped Harness-label CSS changed. Final actual browser uses that final built CSS; `reviewfix-build-final.log` and `reviewfix-prepare-final.log` exit0. Final `npm run check` exit0 (`reviewfix-check-final.log`); `git diff --check` and cached diff check clean.
- Did not rerun all110 backend cases here: final merger owns that one full matrix. No backend behavior changed after the12+10actual green runs. Large bundle and pg concurrency deprecation warnings remain inherited.

## Actual browser

Used the agent-browser skill/installed CLI core; unique `--session reviewfix-166 --auto-connect false`. Real final built app, Owner HTTP, disposable fresh creative-only account, real native SDK and isolated account files. Runner/config: `reviewfix-browser-runner.ts`, `reviewfix-vite.config.mjs`; no T11 runner/evidence/credentials overwritten. Two runner setup validation failures were diagnosed and cleaned (`reviewfix-runner-setup-notes.md`); no product guard was changed to bypass them.

- Ordinary planner desktop1440x1100 and narrow390x844: fixed identities absent, model/Harness/budget/read/write present. `reviewfix-planner-desktop-final.png`, `reviewfix-planner-narrow-final.png`, `reviewfix-planner-narrow-scrolled.png`. Actual computed Harness label12px/static. Normal `.episode-detail-drawer` scroll550 yields saveTop265/saveBottom301 within844 (`reviewfix-planner-scroll.json`); no force click/global scrolling change.
- Formal preparation: chose real imageA, saved per-period default, cleared, switched shots/back, reloaded, reselected original shot; blank persists and prompt retained. Same actual sequence for videoA. `reviewfix-image-cleared.txt`, `reviewfix-image-refreshed.txt`, `reviewfix-video-refreshed.txt`, image desktop/narrow screenshots. Choice-only task baseline0/current0 (`reviewfix-choice-no-tasks.json`). Generate stays disabled.
- Imported real versioned PNG bytes and explicitly adopted images for both shots, with one extra unadopted candidate; no generated media or paid call. Entered actual embedded SDK.
- Clicked Save twice: HTTP200 both, first receipt=workspaceSHA and second requestSHA=first receipt, second receipt=workspaceSHA (`reviewfix-native-save-receipts.json`). Actual native videoA -> clear -> target switch/back -> browser reload -> automatic real editor reopen -> supplemental panel still blank and prompt retained (`reviewfix-native-cleared.txt`, `reviewfix-native-refreshed.txt`, desktop/narrow screenshots). Task count stays0.
- Clicked actual native candidate adoption after saves/reload: save200 -> prepareWorkspaceVisualCandidate200 -> actual SDK edit -> save200 -> adoptWorkspaceVisualCandidate(nativeApplied:true)200; then clicked Save again200 using the latest receipt. Every save receipt=workspaceSHA. `reviewfix-native-adoption-http.json`, actual adopted readback `reviewfix-native-adopted.json`, screenshot `reviewfix-native-after-adoption.png`. New candidate status adopted; final tasks0 (`reviewfix-browser-final-tasks.json`). Browser errors file empty.
- Speech/audio/Pexels clear persistence was verified in rendered component tests, not separately exercised in this actual browser. Native desktop editor at390px remains constrained; no full narrow editing usability claim. Unrelated inherited topbar/step overflow unchanged.

## Cleanup / scope

Returned from the editor via real UI, closed only owned browser session, POSTed owned `/__reviewfix_finish`; runner exit0 and cleanup log confirms. `reviewfix-cleanup.json`: root=false, mountPath=false. All actual fixtures execute their own close/drop/cleanup. Synthetic browser credentials file removed; sanitized IDs/paths retained in `reviewfix-browser-fixture.json`. Runner/config/evidence are intentionally retained outside repo for review. Symlinked existing shared node_modules only. No daily DB/schema/services touched.

Commit contains exactly16 source/test/CSS files. No SQL/root doc/dependency changes. Ready for fresh final merger per `FINAL-MERGE-INSTRUCTIONS.md`.
