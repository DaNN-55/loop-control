# T06 / #172 integration merge review

Integration: `/Users/dan/.codex/worktrees/blueprint-166/integration`, branch `codex/blueprint-166-integration`.
Incoming tip: `1f3d9554bd9b332f09f7ca778ec05f59760c4630`.
Base: `7f8a7940`. No-conflict `--no-ff` merge: `5a8cc4d412bf95ab6a4cfb740c9dab7ddbb53e9f`.

## Scope and review

- Read incoming 11-file diff, migration104, actual HTTP/native integration assertions, UI code, safe Provider failure handling, and fixture migration composition.
- New searches use the shared production-selection resolver and preparation request snapshot; queue104 no longer reads blueprint soundtrack. Independent preparations retain each request's connection/query/context/target/cost intent. Public selection is search capability, with no exposed music-generation model.
- Failed-task retry clones the original execution snapshot, connection, query, budget and attempt allowance; only operational output/configuration/runtime metadata changes. No current selector or blueprint re-routing. Queue current authorization and script/archive checks remain; Worker wrapper retains exact frozen version ownership, non-revocation, qualification, live evidence and local binding, allowing current-version rotation without changing credentials.
- Migration104 delegates non-audio tasks through the original media-connection function; T05 speech migration103 and live-native/explicit-speech candidate code remain incorporated. Fixture composition retains100/101/103/104/107 and embedded fixture105. No caller API relaxation or old migration-byte edits.
- Manual upload validates actual MP3 files and does not resolve an external connection. Original extraction validates actual source/window/rate/fps/SHA and uses local runtime. Explicit adoption preserves native timing/gain/trim/rate and independent multi-SFX identities/BGM slot.
- FreesoundSearchError carries only locally authored configuration/HTTP-status/format/no-results text. Arbitrary Provider payloads and thrown transport errors remain behind the generic safe media error; no credential-bearing URL is surfaced by this change.
- UI uses the existing service catalog, explicit available choice, session-scoped drafts/defaults, individual provenance, MP3 audition and explicit adoption. Old preparations remain returned, not replaced by a newer request; legacy task input is not updated.

## Merger verification

- `git diff --check`: pass; `npm run check`: pass (`T06-integration-check.log`).
- `npm run build`: pass (`T06-integration-build.log`), existing >500KB chunk warning.
- `npm run runtime:prepare`: pass (`T06-integration-runtime.log`), after frontend build to regenerate Worker/backend and trusted manifest.
- All runtime preparation and acceptance commands used COMMON's context module and BOTH SDK environment names pointing to the same existing read-only OpenChatCut SDK. No daily migration, normal start/stop, deployment, push or paid call.
- Acceptance command: `LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_WORKSPACE_ACCEPTANCE=1 npx vitest run src/local-app/workspaceAudioSelection.integration.test.ts src/local-app/workspaceAudio.integration.test.ts src/local-app/WorkspaceAudioPanel.test.tsx src/worker/mediaProviders.test.ts`.
- Acceptance result: **4 files / 28 tests passed**, exit0,69.10s (`T06-integration-tests.log`). Read actual results: new audio selection2, existing audio integration8, UI panel8, Provider10. Actual compiled Worker, Owner HTTP, DB/tasks, MP3 byte audition, retry/restart, native spectral render, source window, SDK save/reopen and explicit narration/late-result fences all passed. Existing UI shot-switch test emits one React `act` warning; no skipped acceptance assertions.

## Browser evidence and concerns

Merger reviewed worker's `T06-browser-final.txt`, `T06-browser-observations.json`, desktop `T06-browser-upload-adopted.png` and narrow `T06-browser-narrow.png`; this is evidence review, not a second browser execution. Visible catalog choice B coexists with A/B provenance and individually adopted effects; narrow form controls fit the visible column with normal drawer scrolling. Canonical observations show two adopted effects and manual BGM.

One handoff wording correction: browser canonical JSON/screenshots put BOTH SFX at0.2s (duration0.4s, gain-19/-6); the handoff claim of0.2s/0.4s is inaccurate. The separate actual SDK integration test moves A to0.4s and verifies gain-17 after save/reopen. Do not conflate these evidence states.

Observed inherited UI limitation: adopted BGM candidate still says 可用 / 重新采用 because candidate inline sound lookup only matches SFX. Canonical native mix correctly contains BGM. This predates the incoming change and was not modified or treated as a T06 blocker.

Controlled service/actual-byte/native acceptance does not claim live Freesound availability or quality. No root-owned PLAN/CONTEXT/ADR documents changed by merger. No daily worktree/data modifications. Final integration HEAD remains `5a8cc4d412bf95ab6a4cfb740c9dab7ddbb53e9f`; worktree clean. **Integration released to root after final test readback.**
