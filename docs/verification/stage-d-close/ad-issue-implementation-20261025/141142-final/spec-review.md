# #141 / #142 / #144 final Spec review (read-only)

## Critical issues

None found in the supplied final evidence. The final-source manifest matches the current SHA-256 values for 039–042 and each subsequently changed path it lists.

## Important improvements

None required before closing these three ticket scopes.

- **#141 / C10 — may close.** A normal Owner submission produced two real CLI planning outputs under the approved two-call/138.642s budget; the output contracts, refresh/readback, no-owner `401`, foreign `404`, missing configuration/command blocks, and a real failed-attempt callback rejection are recorded in `acceptance-handoff-result.json`, `http-preflight-negatives-result.json`, and `local-contract-negatives-result.json`. The remote-Provider authentication-failure path was deliberately not exercised; do not describe it as tested. The normal local authorization and preflight failures satisfy C10's stated blocking boundary.

- **#142 / C11 — may close, with the C18 continuity qualification.** One Owner/Episode/blueprint reaches `production_completed`; 21 artifacts read identically through owner HTTP and disk after a normal restart, with no additional CLI/Provider calls. Human Owner listening/text acceptance is real. QC is instead accurately an Agent frame/decode/FFT inspection followed by an authorized test-Owner API action, not a claim that a human watched the video. C11 requires a test Owner's normal UI/API action, so that distinction is valid. The final source manifest explicitly records changes after early planning. Thus state that C18 classified those changes and final affected paths were revalidated; **do not state that the whole chain began on aggregate SHA `207c…`** or that remote auth failure was exercised.

- **#144 / C13 — may close after its first-TTS reopen.** 040's real late-executor/accepted-bytes protection remains backed by the three real PostgreSQL/filesystem/Owner-HTTP recovery modes. 042 is applied only to the new isolated DB and covers the discovered first-TTS/auto-alignment future-task namespace gap while retaining old tasks, 30-minute policy, budgets, failed runs and Provider/CLI ledgers. It does not turn the old TTS into a newly namespaced artifact, which the follow-up report correctly preserves as a limitation.

## Optional notes

The two overwritten debug raw logs remain a declared C18 evidence gap; historical four failed runs remain intact. Neither prevents these ticket-scoped conclusions, but neither may be summarized as complete raw-log preservation. #146/#147 and the broader A–D/E/F gates remain open.

## Verification suggestions

Attach the final #142 public report and the in-progress credential scan/cleanup result before writing closure comments. Cite the above limitations verbatim enough to avoid silently broadening the claim.
