# T01 / #167 handoff

Ready for merge. Branch `codex/blueprint-166-t01`, worktree `/Users/dan/.codex/worktrees/blueprint-166/t01`.

- Scoped implementation commit: `9b0257cc` (`feat: group connections by registered production services (#167)`).
- Final tip: `0956e7cdc0dd4c3f99308acade77b6b8fbbd38f8` (merged latest integration `a789e5c5`; PLAN-only integration merge, no implementation conflicts).
- Verified before work that integration `3aef199c` descended captured baseline `d7430b11`; final `git merge-base --is-ancestor codex/blueprint-166-integration HEAD` succeeds. Working tree clean. No migration needed.

## Delivered

`registeredAdapters.productionChoices()` exposes the registry's canonical production declarations (`image`, `video`, `speech`, `music_sound`), actual models/presets, accepted inputs, parameter constraints, voices, authentication type and legacy read compatibility. Each Adapter can declare multiple actual functions without cloning a connection. Existing `choicesFor`/`resolve` and historical task execution remain unchanged. A-roll/B-roll become one video directory entry; search providers expose `mode:search`, no generation models. Input metadata lives on registered Adapter definitions, not a separate service capability table. Endpoint facts for existing OpenAI/Pexels registrations are explicit.

`GET /api/local/connections` adds `serviceCatalog:ProductionServiceCatalog` from `src/connections/serviceCatalog.ts`. Each exact connection/version remains distinct, even for the same Provider. Entries include `connectionId`, `connectionName`, `connectionVersionId`, `connectionVersion`, `status`, `executable` and `unavailableReason`. No secret is read to build the catalog. Missing/invalid/unverified/revoked/network-unavailable connections cannot be executable; local services need explicit readiness evidence.

`LocalConnectionsPanel` supplies this same catalog to the actual `ConnectionWorkspace`. Saved connections are grouped by canonical function; filter, provider, actual model/search service, verification and unavailable reasons use the directory. New connection types derive from the same registry. Unknown historical connections stay visible as unsupported. Rename and verification refresh the directory through the existing actions, preserving secret/version rules.

## Files

- `src/worker/registeredAdapters.ts`
- `src/connections/serviceCatalog.ts`
- `src/connections/ConnectionWorkspace.tsx`
- `src/connections/connections.css`
- `src/local-app/connections.ts`
- `src/local-app/LocalConnectionsPanel.tsx`
- `src/local-app/connectionCatalog.fixture.ts`
- `src/local-app/connectionCatalog.integration.test.ts`
- `src/connections/ConnectionServiceCatalog.test.tsx`
- `src/connections/ConnectionOrganization.test.tsx` (expect canonical speech group and actual model instead of former UI aliases)

## Verification

Confirmed seam: formal Owner HTTP -> real disposable PostgreSQL with `loop_app` permissions -> existing `createProviderProbe` -> loopback controlled HTTP provider. Synthetic secrets use the controlled immutable secret port; this does not assert real Keychain availability.

- Red: `LOOP_TEST_CONTEXT_MODULE=/private/tmp/loop-control-166-20261031/runtime-context.mjs npx vitest run src/local-app/connectionCatalog.integration.test.ts`: failed at missing `serviceCatalog.groups`. Evidence `T01-red.log`.
- Green: same command passes 1 integration test. Covers create/verify/rename, two same-Provider connections, invalid authentication, rotation retaining previous verified version, wrong Provider/Adapter authentication pair rejection, foreign Owner and CSRF rejection, absent secret echo, no catalog secret read, network-disabled reason, video deduplication and Pexels search constraints. Evidence `T01-green.log`.
- UI red before wiring: `npx vitest run src/connections/ConnectionServiceCatalog.test.tsx` failed because actual models/groups were absent. Evidence `T01-ui-red.log`.
- Green focused suite: `npx vitest run src/connections/ConnectionServiceCatalog.test.tsx src/connections/ConnectionOrganization.test.tsx src/connections/ConnectionWorkspace.test.tsx src/connections/ConnectionFeedback.test.tsx src/connections/ConnectionDanUi.test.tsx src/worker/registeredAdapters.test.ts src/local-app/connections.test.ts`: 7 files / 39 tests pass. Evidence `T01-ui-green.log`.
- `npm run check`, `npm run backend:build`, `npm run build`, `git diff --check`: pass. Build retains existing >500KB chunk warning. Logs `T01-check.log`, `T01-backend.log`, `T01-build.log`.
- Real isolated browser: unique `agent-browser --session t01-167 --auto-connect false` against a fresh disposable DB and built formal application. Logged in, created OpenAI connection, saved and controlled-verified it, renamed it via editor, refreshed and read it back. Added second OpenAI/other function fixtures through authenticated Owner HTTP; all four groups displayed with actual model or search label. Verified video-only filter, five retained v1 connections, no synthetic credential in rendered page. Browser/provider fixture was closed and disposable DB/files removed.
- Screenshots: `T01-browser-desktop.png`, `T01-browser-groups-full.png` (1440x1100, all groups), `T01-browser-narrow.png`, `T01-browser-narrow-scroll.png` (390x844; table has bounded local horizontal scrolling and test/more actions are accessible). Snapshots `T01-browser-groups.txt`, `T01-browser-filter.txt`.

## Limits and follow-up contracts

- No paid provider calls, daily data writes/migration, source-worktree modifications, push, deployment or issue closure. This ticket changes directory/read UI only, not historical task/blueprint execution sources.
- Current deployed registry has no Adapter spanning two *different* canonical production groups. Multiple-function declarations and shared exact connection references are supported, but no unsupported capability was invented to manufacture runtime coverage. Current historical a_roll+b_roll both correctly collapse to video.
- Local OpenChatCut directory entry is conservatively non-executable until the caller supplies actual readiness evidence through `buildProductionServiceCatalog({localReadiness})`; registration alone is not runtime readiness.
- At 390px the unrelated topbar tool row overflows its content pane by ~18px; connection controls remain visible and its table scrolls independently. Topbar source untouched, no scope expansion.
- Root-owned CONTEXT/ADR wording should replace the old one-capability-per-connection / blueprint-selected-service description with canonical function groups and per-request selection. No shared PLAN/ADR/index files edited by T01.
- Dependent resolver should consume `registeredAdapters.productionChoices()` / exported canonical normalization and service constraints. `inputModes` describes accepted input kinds; video `firstFrame.required:true` means a first frame is mandatory. Search uses query, not generation model fields. Existing budget, runtime and worker validation remain necessary at submission.
- Browser runner initially failed by loading daily Vite runtime config without compiled backend; after observing repeated identical cause switched to an explicit external Vite config and omitted vite-node `--script` (that option discards config). No daily runtime was started or modified. Repro runner/config retained outside repo with evidence.
