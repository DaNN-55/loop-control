# T10 / #176 integration merge acceptance

Integration worktree: `/Users/dan/.codex/worktrees/blueprint-166/integration`.

- Incoming: `df6d92e3743b2e5f9eab2e32cf36f2ef666305ed` (`codex/blueprint-166-t10`).
- Prior integration: `6be9da04b2872340da2a38e3c1e1411d62c576b9`.
- Clean `--no-ff` merge: **`b37fadecb4e046f5fdf1482aab83645230c92268`** (`merge: integrate content-only blueprints and preparation planning (#176)`).
- Both parents preserved. No conflict, follow-up product fix, acceptance assertion removal, root-owned documentation edit or daily checkout edit was needed. Integration is clean and released to root.

## Read source review

Reviewed COMMON, T10 handoff/contraction notes, issue #166/#176, ADR0018, changed current serializers/forms, Owner write/command routing, planning selection store/UI, migration108, creative context call sites and Worker guidance.

- Current account/blueprint create/update serialization projects to creative rules; secrets are rejected before projection and the original raw payload is hashed for idempotency. Historical repair uses the named legacy serializer. Independent actual account directory configuration remains separate.
- Migration108 preserves the original referenced blueprint ID, policy and version; an edit archives that row and creates a new current row/version. It does not repoint Episodes/tasks/candidates/context or blanket-update historical policy. Preservation snapshots retain exact old bytes without revalidating formerly current connection references.
- The migration diff is only the added108 file;100–107 bytes are unchanged, and the fixture requests108 through its existing validated ledger after105/106.
- New image/video/TTS requests require explicit service selection. Old SQL queue/read/retry paths remain for frozen legacy requests. New image/video/speech/audio/Pexels snapshots share the TS creative-account projection; planning applies the corresponding SQL projection to its existing prompt context.
- The Episode-owned preworkspace selection freezes the real existing Codex Adapter, model, active account Harness content/hash/version, budget, file tools and actual input fingerprints into the existing planning task. Retry copies frozen A, while explicit replan supersedes the failed chain and submits saved draft B. The v2 direct preparation branch remains independent of unused planning settings.
- Existing Owner/account/script/CSRF/budget/unknown-submit/native protections remain; no new planner/text Provider or parallel task pipeline was introduced. Late legacy completion remains artifact history without automatic approval/advancement.

Historical activation detail: existing `activateBlueprint` changes active/current pointers and does not update `policy`;108 therefore leaves an old activated version's policy bytes intact. Current execution still requires explicit selections, and legacy planner settings are only a one-time Episode prefill. This is compatible historical retention, not a second current media execution authority. No activation policy rewrite was introduced.

## Verification personally run/read

Required sequential boundary completed in this order:

1. `npm run build` — exit0 (`T10-merge-build.log`); TypeScript/Vite complete, existing >500KB bundle warning only.
2. `npm run runtime:prepare` — exit0 (`T10-merge-runtime.log`); both compiled builds and trusted manifest integrity completed before Worker tests.
3. Actual acceptance command below — exit0 (`T10-merge-actual.log`), **7 files /24 passed /1 explicitly unselected**.

```sh
LOOP_WORKSPACE_ACCEPTANCE=1 LOOP_FORMAL_ACCEPTANCE=1 \
LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs \
OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut \
LOOP_TEST_OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut \
npx vitest run src/local-app/productionSelection.integration.test.ts src/local-app/workspaceVideoSelection.integration.test.ts src/local-app/speechSelection.integration.test.ts src/local-app/workspaceAudioSelection.integration.test.ts src/local-app/blueprintContraction.integration.test.ts src/local-app/formalWorkflow.integration.test.ts src/local-app/workspacePexels.integration.test.ts -t '^(?!first formal adoption)'
```

Read results cover actual selected image/video/speech/audio/Pexels files and explicit native adoption, invalid selections/ownership/budget/unknown-submit/restart, exact credential rotation, original stable legacy blueprint/task evidence, content-only save, A/B/frozen retry/replan, real controlled compiled Codex planning artifact verification, planner-independent v2, and late legacy Worker guards.

The known `first formal adoption preserves the latest unsubmitted legacy Studio document` JSON-store fixture remains **unselected, not passed**; T11 owns its native fixture repair. No other acceptance was skipped by this invocation.

Focused command: `npx vitest run src/worker/codexRunner.test.ts src/platform/configurationForms.test.ts src/worker/runtimePreflight.test.ts src/platform/ConfigurationForms.local.test.tsx src/local-app/WorkspacePlanningSelection.test.tsx src/accounts/AccountWorkspace.test.tsx src/local-app/ProductionWorkspacePanel.test.tsx` — exit0, **7 files /103 passed** (`T10-merge-focused.log`). Existing React `act(...)` warnings only.

`npm run check` — exit0 (`T10-merge-check.log`). `git diff --check` — clean. Final `git status --short` — empty.

Personally inspected existing T10 desktop-blueprint and390px-planner screenshots; they show content-only account rules and usable preparation planning controls. This merger did not rerun browser interaction and does not claim new browser evidence.

No whole-repository-suite or real paid-supplier-quality claim. No paid calls, daily data/schema migration, service restart, push, deploy, GH close or root doc edits. Root retains final domain/PLAN/ADR/README/report and T11 acceptance ownership.
