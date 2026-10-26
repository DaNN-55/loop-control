## Spec

### Critical issues

- **#144 / C13 remains blocked until the publication fix lands.** C13 requires failed files never become effective business artifacts. The current implementation publishes canonical files before `report_worker_result` and `COMMIT` ([nativeAttemptOutput.ts:55-65](/Users/dan/.codex/worktrees/local-first-optimization/loop-control/src/local-app/nativeAttemptOutput.ts:55)); a registration failure can leave new bytes at an old indexed path. This is the independently reported Standards P1 and is being repaired; do not close #144 from the otherwise-valid late-executor evidence.

### Important improvements

- **#136 / C05 is implemented but not acceptance-complete.** The route tests prove identity rejection and preview gating ([captionTextConfirmationRoute.test.ts:50-66](/Users/dan/.codex/worktrees/local-first-optimization/loop-control/src/local-app/captionTextConfirmationRoute.test.ts:50)), and UI tests cover the historical 0.838 mismatch. They use a DB transport substitute and fixture audio. C05 still requires actual current audio, silence, and mismatch samples plus save/refresh/late-result validation in the approved isolated database. The current report correctly keeps this gate open; historical WhisperX output must not be re-labeled as a new run.
- **#143 / C12 is not closable.** The normal consumer records interface acceptance but explicitly says it does not establish visibility or read state ([nativeAutomation.ts:81-83](/Users/dan/.codex/worktrees/local-first-optimization/loop-control/src/local-app/nativeAutomation.ts:81)). Owner did not see either sent test notification; permission-denied evidence is also absent. The historical `reserved`/`uncertain` rows correctly remain unresolved and must not be converted to accepted.

### Optional notes

- No additional spec deviation found for #132, #134, or #148. Their code and the scoped evidence match C01/C03/C17: default 5000ms/current-source collection, real HTTP account/session fencing, and lock-network rotation/rebind behavior. The public report appropriately defers their Issue closure until the final review completes.

### Verification suggestions

- After #144 repair, rerun the existing-canonical registration-failure and multi-file failure cases, then repeat the live late-executor check against the final source.
- Run #136 through current real isolated audio/silence/mismatch inputs and record the real page/HTTP result. Keep #143 open unless an Owner sees a notification or the failure is otherwise diagnosed without changing OS settings.
