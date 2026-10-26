## #143 / C12 final spec review

### Closing assessment

**C12 can close within its stated scope.** The evidence distinguishes interface acceptance, Owner-visible delivery, executable-boundary denial, interruption, and unreadability; it does not relabel old uncertain records as success.

### Criteria evidence

- A third, normal-application event was seen by the Owner (`a99b…`); the two earlier unseen events and the later explanation that notifications may have been disabled remain retained. No notification setting was changed.
- The denial path is a real `osascript` process-execution `EPERM`, producing one `uncertain` record. Before and after the normal restart, every ledger check passed and the fingerprint stayed the same: no automatic replay occurred. This is an actual permission/error boundary, not a controlled sender result.
- For interruption, the actual `osascript` child was `SIGSTOP` before only the verified owned detached Vite process group was killed. Its record stayed `reserved` with the same fingerprint through normal restart. Historical `reserved`/`uncertain` rows remain unresolved.
- The system-status page independently renders scheduling, notification, health, and backup. It marks eight notification outcomes as requiring attention and expressly does not claim read receipts. The imported-clock health/backup history is used only for the displayed-status criterion, not as a new-run claim.

### Retained limits

- Two full-sandbox `npm start` receipts failed because process identity inspection was sandbox-restricted; they are preserved and are not evidence of successful startup. A separate normal `npm` restart supplied the same-record verification.
- The denial is not a test that toggles macOS notification authorization. C12 says “cover permission denial,” not “change the user’s notification setting”; the actual executable `EPERM` covers failure handling without altering OS settings. If the intended reading requires the literal system-consent toggle, that would be an additional, user-authorized test and #143 should remain open. On the written ticket scope, it is not necessary.

No Provider request, old-ledger mutation, SQL change, or E/F work is implied by this assessment.
