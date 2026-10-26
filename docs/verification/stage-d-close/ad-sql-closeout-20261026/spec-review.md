# #146/#147 SQL increment and #149 Spec review

## Critical issues

None found in the reviewed increment.

## Important improvements

None before the in-progress final integration evidence is read. Do not treat that pending test/index/scan work as a permanent failure.

- **#146 / C15:** `catalogContract.integration.test.ts:97-159` compares the normal local HTTP catalog with the retained RPC under the same `loop_app` Owner identity, then exercises page bounds, ordering, filters, totals, operation sub-pages, unauthenticated access, foreign Owner and worker-member boundaries. The red mutation (`20 → 19`) produces two failures and is byte-restored; the final run is 4/4 green. This satisfies C15’s comparison and demonstrated-drift requirements (issue 15:17-19), without production-SQL scope creep. It correctly limits the claim to an isolated compatibility schema—not deployed Supabase/Auth/PostgREST.

- **#147 / C16:** `043-owner-policy-initplans.sql:3-23` is a forward `ALTER POLICY` only: it preserves the three policy predicates, commands and roles while wrapping Owner identity as an uncorrelated subquery. `ownerRls.integration.test.ts:34-71` verifies two Owners’ exact 32-row projections, missing/foreign identity emptiness, worker/anonymous denial, unchanged security inventory, and real `EXPLAIN` InitPlans with one loop. The recorded three-red/four-green sequence establishes current applicability and a controlled plan improvement, not a production-latency claim. This matches C16 (issue 16:17-19); no unrequested policy or role expansion is visible.

- **Registration scope:** relative to the preserved D-state source copies, `migrate.mjs` and `native-restore.mjs` add forward registration only; the current review attributes the 043 addition to this SQL increment and does not reopen previously accepted 041/042 work.

## Optional notes

`043` was applied only to `loop_t24_restore_sql20261026`; reports retain first-run/bootstrap failures, the C15 red mutation, C16 red plans, historic migrations and old databases. No Provider request is present.

## Verification suggestions

Keep #149 OPEN until the final source-diff/affected joint checks, default-timeout test/build results, evidence index and credential scan finish. Its final matrix must mark C06–C09 as Owner-approved skips—not passes—and preserve the zero-residual/E-F gate as open, per C18 (issue 18:13,17-20).
