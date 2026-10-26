# #146/#147 final Spec re-review (read-only)

## Critical issues

None. The current 46-file manifest hashes and aggregate match the working tree; all 264 SQL-closeout public/private index entries that are meant to be itemized match their recorded SHA-256. The final receipt deliberately excludes itself from itemization to avoid a circular digest and records that fact (`final-integrity-receipt.json:39-40`).

## Important improvements

None required for #146/#147.

- **#146 / C15:** The test compares normal Owner HTTP catalog output and the retained RPC projection within the same `loop_app` Owner/RLS context (`catalogContract.integration.test.ts:97-107`), then asserts independent fixed expectations for ordering, page bounds, filters, totals and operation summaries (`:111-137`) plus Owner/non-Owner boundaries (`:140-159`). The 20→19 mutation yields two red failures before byte restoration, so it is not merely two implementations agreeing on the same defect. This satisfies C15’s same-sample/contract and demonstrated-drift requirements (issue 15:17-18). The report correctly limits the legacy RPC adaptation to an isolated schema, rather than claiming deployed Supabase validation (`report-146.md:13-15`).

- **#147 / C16:** 043 changes only the three RLS policy expressions to cache Owner identity as an uncorrelated subquery (`043-owner-policy-initplans.sql:3-23`). The integration test proves exact two-Owner rows, unchanged permissions/security inventory, missing/foreign identity empty results, and worker/anonymous denial (`ownerRls.integration.test.ts:43-71`); three pre-migration plan reds and four post-migration greens support the controlled InitPlan claim. This meets C16 (issue 16:17-19) without claiming production latency improvement (`report-147.md:17-21`).

## Optional notes

First fixture/bootstrap failures and red evidence remain indexed; historical gate metadata is retained. The global index actually labels #137–#140 “Owner-approved skipped, OPEN, not passed” and #149 OPEN. No Provider rerun has happened yet, so it is not evidence in this review.

## Verification suggestions

After the newly authorized four Provider retries, #149 must use only their new recorded outcomes and Owner’s new conditional waiver; it may not relabel the historical failures as passes or delete them. That later work is outside this #146/#147 result.
