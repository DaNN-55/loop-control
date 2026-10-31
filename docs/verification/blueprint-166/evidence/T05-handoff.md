# T05 / #171 handoff

Implementation commit `b553fa79` (`feat: freeze per-request speech selections and explicit adoption (#171)`). Own branch `codex/blueprint-166-t05`, worktree `/Users/dan/.codex/worktrees/blueprint-166/t05`.

Final merge tip `42bc59fa95138c8d227104885d9fdcab31bea18b` incorporates integration `2e273812` (T03 included). Only conflict was the fixture migration list; both migration101 and migration103 retained. Root owns PLAN, CONTEXT and ADR index; no independent edits there. Incoming root documentation preserved by merge.

## Contracts

- Current UI reads the shared `/api/local/connections.serviceCatalog` speech group and uses the existing `ProductionSelection` + `resolveProductionSelection`. Only deployed Volcengine `volcengine_tts` / `seed-tts-2.0` is offered. A/B means two controlled connections to this actual registered service. No vendor/model invention.
- New `saveWorkspaceNarrationDefaults` persists `{selection,voice,languageCode,speakingRate}` in `production_workspaces.narration_defaults`. It only prefills; it does not supersede tasks, generate, adopt or touch the native project. Each shot has its independent editable selection. Session drafts retain selection, voice/language/rate, text, preparation mode/manual source and reservation across reopening/refresh; unavailable choices/input remain visible and incompatible rather than replaced. `使用本期默认` explicitly restores the prefills.
- `saveWorkspaceNarration` accepts `selection` and `languageCode` for the new path; confirmation fingerprint includes selection. Registered voice/locale/rate validation runs at save, request and adoption. Unsupported models and foreign/mars/moon voices fail clearly; actual controlled outgoing `X-Api-Resource-Id` is asserted `seed-tts-2.0` for both A/B, and exact distinct credential references are observed. Existing legacy model compatibility reads remain.
- Forward migration103 adds the editable selection/default/request evidence and queues new speech through existing `public.tasks`, `generate_narration`, `narrationWorker`, audio_tracks and candidate machinery. Request/task freezes canonical selection, connection label/id/version, execution, exact text/voice/language/rate, account + series context, script/preparation/workspace/shot/project identity and Owner reservation/cost basis. No secret value is stored. New requests are independent of blueprint narration enable/provider/model/hash, while current-script Owner authorization, real registered connection/runtime, archive/read-only and budget checks remain.
- Submission reservation checks the immutable request + current script/authorization/native target, not the latest UI draft/choice. Queued A can execute after B is saved. Same-shot active/unknown submission protection remains, and exact verified task connection versions can execute after current-version rotation without switching credentials. Revocation/qualification/binding protections remain. Uses the existing paid_generation_reservations ledger, including completion state; no second executor or ledger. Definite retries create explicit new tasks; unknown submissions never resend.
- New selected requests are skipped by `adoptFirstWorkspaceNarration`, including refresh/poll/default or generate-image callers. Results remain candidates until Owner explicitly adopts. Legacy first-assembly compatibility remains for old requests.
- Candidate availability no longer compares mutable connection/model/voice choices; current text/script and real target/source/native-save protections still apply. Each candidate exposes its frozen speech provenance. Old A can be adopted while current draft stays B. Preparing against a live Studio reads its actual current document before freezing route/target, so native schema normalization of track IDs/source revisions does not produce a false match or overwrite edits.
- Adoption revalidates registered frozen voice/language/rate, actual MP3 fingerprint and measured duration. New speech cannot be cropped by `keep-target` when actual full frames exceed the actual current native window. `use-candidate` preserves full audio and unrelated native visuals/editing. Readback/UI retain a `windowWarning` when the selected native voice and visual window differ; captions become stale and text confirmation clears naturally from actual source/window fingerprint, without manufacturing new timing evidence.
- Manual/no-voice choices remain available without unused speech connections. Explicit manual adoption retains the existing direct guarded path. Existing legacy paths are retained as compatibility rather than rewritten.

## Verification

Confirmed primary seam: public Owner HTTP + real disposable PostgreSQL/task lease/result + controlled actual Provider MP3/MP4 bytes + actual native documents and files. No paid requests or daily data writes.

- Red: `T05-red.log` shows real Owner HTTP400 rejecting new selection/locale fields before implementation.
- UI red: `T05-ui-red.log` shows missing per-shot choice; `T05-adopt-ui-red.log` catches the actual candidate button sending an unsupported clipId. Fixed the caller, without broadening the candidate command allowlist.
- Native diagnosis: `T05-native-diagnostic.log` records the actual native track/sourceRevision normalization mismatch. Fixture editing now uses `editStudioDocument` (actual SDK HTTP ownership/write API), and placeholder setup imports/matches actual 4s video, preserving all existing business assertions. Both workspaceCandidates and workspaceNarration old JSON fixture paths corrected; no skips or assertion weakening.
- Persistent post-adoption warning red: `T05-window-warning-red.log`.
- Before integration merge: `T05-final.log`: **4 files / 27 tests pass**. After the final window/actual-frame protection addition: `T05-final-window.log`: **3 files / 14 tests pass** (speech3, candidates7, UI4); final panel persistence checks `T05-ui-final.log`: **5 tests pass**. Full legacy narration suite passed13 in the earlier combined run, including actual rendered video/audio and unchanged native-edit assertions.
- Type check: `T05-final-check.log`, `T05-merge-check.log` pass. `runtime:prepare` passes (`T05-merge-runtime.log`). `git diff --check` passes.
- UI build passes (`T05-build-2.log`, `T05-final-ui-build.log`); existing >500KB bundle warning. Final UI builds target an isolated notes-directory dist so they do not delete the prepared Worker outputs. Earlier build/prepare overlap and later stale-manifest attempts are recorded in intermediate logs as failed setup, never counted as product passes.

Post-merge focused combined run is recorded in `T05-merge-final.log` (speech, candidates, narration, T03 video selection and UI). See final result below.

## Real browser

Unique `agent-browser --session t05-171 --auto-connect false` and `t05-171-final`, isolated formal app/DB/files, controlled connections. Used the actual built app and authenticated Owner UI.

- Saved A default, prepared A, changed shot/default to B while A pending, refreshed and retained B voice/text/reservation, executed actual A then B through the controlled Worker, compared both candidates, explicitly adopted old A while selector remained B. A/B provenance and adopted state visible. Actual command field failure discovered and fixed; the full action was rerun successfully. No page errors after fix.
- Desktop1440x1100 and narrow390x844 inspected. `T05-browser-candidates.png`, `T05-browser-adopted.png`, `T05-browser-narrow.png`, `T05-browser-final.txt`. Model names truncate within native selects; candidate provenance wraps; audio controls fit narrow panel.
- Final actual readback fixture explicitly adopted A, retained B draft/default, and rendered the persistent actual-native-window warning. `T05-window-desktop.png`, `T05-window-narrow.png`, `T05-window-browser.txt`. Browser DOM confirms `实际口播与画面窗口时长不同，请调整画面或拆镜，并重新核对字幕。` after adoption. No page errors.
- Browser sessions closed and fixture processes stopped. Fresh cleanup inspection found both browser fixture DBs/APFS images still present after SIGTERM, so only those exact known disposable databases and mounted paths were explicitly dropped/detached/removed. External reproduction runner/config and evidence logs remain in the shared notes directory.

Operate mode follows the existing surface brief; no new design interview/redesign. Impeccable reported existing sidecar/buildPath metadata drift; left untouched because it is outside this task.

## Limits / root follow-up

- Controlled Provider responses prove request freezing/auth/resource parameters, actual bytes/durations, native integration and recovery; they do not prove live vendor voice quality or billing.
- Historical calls without `selection` intentionally keep the legacy compatibility path; new UI always sends an explicit selection. No daily migration, paid call, push, deploy, main merge or issue closure.
- Root may extend ADR/CONTEXT to mention persistent speech defaults as editable prefills, selected tasks as immutable speech/cost/native-target provenance, and explicit adoption with persistent native-window/caption mismatch evidence. T03's chosen-video constraints/readback and new authorization behavior were preserved on merge.

## Final post-merge result

`T05-merge-final.log`: **5 files / 31 tests pass** (speech selection3, existing candidates7, existing narration13, T03 video selection3, speech UI5). Duration78.24s. Only an existing fixture pg concurrent-query deprecation warning remains; no failed assertions or skipped acceptance cases in this run.

Final `git status --short` is empty; `git diff --check` and `git merge-base --is-ancestor codex/blueprint-166-integration HEAD` succeed. Branch tip remains `42bc59fa95138c8d227104885d9fdcab31bea18b`.
