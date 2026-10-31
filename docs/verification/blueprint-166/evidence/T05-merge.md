# T05 / #171 integration merge

- Integration worktree: `/Users/dan/.codex/worktrees/blueprint-166/integration`.
- Incoming: `42bc59fa95138c8d227104885d9fdcab31bea18b` (`codex/blueprint-166-t05`), already incorporating T03 integration `2e273812379489b6ba5d994449a55f73ec4709c8`.
- Merged with `git merge --no-ff codex/blueprint-166-t05 -m 'merge: integrate frozen per-request speech selection (#171)'`.
- Merge SHA: **`b6124f9124459bb6640cd30fe6b016f78cfdc4de`**. Parents are exactly the two tips above. No conflict or merge fix was needed.
- No PLAN, CONTEXT or docs changes; no daily worktree/data writes, paid calls, push, deploy, main merge or issue closure.

## Inspected contracts

- Selection is resolved from the registered shared speech catalog; defaults are editable prefills, independent shot drafts retain incompatible input. Request/task freeze selection, exact connection version, text/voice/language/rate, authorization, account/series context, target and Owner reservation.
- Selected speech queues/reserves through existing tasks/Worker/paid reservation mechanisms. A frozen task can run after editable defaults switch to B or its current connection version rotates; it keeps its exact verified secret reference and still requires qualification, binding, non-revocation, authorization and native target guards. Active/unknown protection remains.
- Selected results skip first-speech auto-adoption. Old A remains explicitly adoptable while current draft stays B, provided text/script/native target and actual bytes remain compatible.
- Live Studio preparation reads `inspectOpenChatCutStoredProject` before creating expected target/main-voice route evidence. `applyWorkspaceCandidate` still checks source/revision/window/route, the actual SDK write uses expected revision and ownership, LC native save validates pending text/source/target identity, and non-native adoption checks prepared project SHA. Actual full audio cannot be cropped by `keep-target`; full-duration adoption preserves other native edits and causes caption timing/text confirmation to expire when evidence changes. Persistent native-window warning is present.
- Migration composition retains 100, 101, 103, 105 and 107. The selected speech credential guard extends `input_task_connection` without replacing T03 image/video connection functions. T03 authorization/readback/explicit-video source code and prior migrations were unchanged by this merge.
- Existing candidate/narration fixture edits use actual SDK document/ownership HTTP instead of JSON backups and import real visuals to satisfy native placeholder requirements. Original business assertions remain; no acceptance skips or weakened expectations were introduced in this merge.

## Fresh verification at merge SHA

- `npm run check`: pass (`T05-integration-check.log`).
- `npm run runtime:prepare`: pass, Worker/backend build and trusted runtime integrity checks pass (`T05-integration-runtime.log`).
- `npx vite build --outDir /private/tmp/loop-control-166-20261031/T05-integration-ui-dist`: pass (`T05-integration-ui-build.log`). Output stays outside the prepared Worker dist. Existing >500 KB chunk warning remains.
- Same five-file combined acceptance/UI run: **5 files / 31 tests passed**, no skipped cases, duration **77.04s** (`T05-integration-final.log`): speech selection 3, existing candidates 7, existing narration 13, T03 video selection 3, speech UI 5.
- Command:

```sh
OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut LOOP_WORKSPACE_ACCEPTANCE=1 LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut npx vitest run src/local-app/speechSelection.integration.test.ts src/local-app/workspaceCandidates.integration.test.ts src/local-app/workspaceNarration.integration.test.ts src/local-app/workspaceVideoSelection.integration.test.ts src/local-app/WorkspaceNarrationPanel.test.tsx
```

- Initial run omitted `OPENCHATCUT_ROOT`. `studioDocument.fixture.ts` uses that variable separately from `LOOP_TEST_OPENCHATCUT_ROOT`, so native SDK bundling could not resolve two source modules in integration's absent local SDK directory. That setup failure is retained in `T05-integration-tests.log`; after setting the same existing read-only SDK root, all 31 cases passed without code changes. Future isolated runs need **both** root variables.
- Fresh `git diff --check` passed. Both input tips are ancestors of the merge. Final `git status --short` is empty.

## Browser evidence and limits

The incoming handoff's real authenticated Owner browser flow, desktop/narrow screenshots and persistent-warning DOM were reviewed; `T05-window-narrow.png` was visually opened and `T05-window-browser.txt` confirms the actual post-adoption warning while B remains selected and A is adopted. A fresh browser session was not started by the merger because there were no merge/UI fixes; the five UI tests above were rerun at the integration SHA. See `T05-handoff.md` for the original controlled browser walkthrough, fixture cleanup and remaining evidence files.

No product blocker found. The acceptance run retains an existing pg concurrent-query deprecation warning. Controlled Provider responses verify task/credential/native/caption behavior and actual files, not live vendor quality or billing. No wider unrelated test suite was rerun.
