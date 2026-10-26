# #149 Owner-exception Spec review (read-only)

## Critical issues

No implementation or acceptance-evidence defect found. The new one-shot authorization expressly allows one unchanged-configuration recheck per Provider and, if still unavailable, an accepted skip before #149. Google and Freesound each made exactly one verification GET and remained unavailable (403 `BILLING_DISABLED`; 401); Cloudflare failed its existing local format precondition and OpenAI lacked an existing test connection, so each correctly made zero Provider requests (`provider-recheck.md:3-16`; `v2-provider-retry-results.json`). All four GitHub records are `CLOSED` / `NOT_PLANNED`, `passed:false`, with an Owner exception (`github-provider-closures.json:3-40`).

## Important improvements

**#149 may close as a completed audit once the pending index append and final credential/index scan succeed.** C18’s start condition is C01–C17 completed **or** an Owner-accepted applicability conclusion (issue 18:13); the explicit exception and per-ticket closure evidence meet the latter. The report correctly preserves the difference: this is not four Provider passes, restored services, full media acceptance, zero-risk production readiness, or E/F authorization (`report-149.md:5,16-19,49-51`).

The current `evidence-index.json` still contains the prior SQL-closeout snapshot (including #149 OPEN) and has no `adProviderRecheck20261026` section. C18 requires public evidence/index verification (issue 18:20). This is an in-progress closeout prerequisite, not a source defect: append the new public/private entries, retain old gate metadata as history, scan the final files, then record #149’s new `completed` audit state and the four `NOT_PLANNED` exceptions.

## Optional notes

`credentialUnchanged` properly means the registered reference/version and no write in this run; it is not a claim about historical secret bytes (`provider-recheck.md:12-14`). The report says so. No business-source change occurred since the 46-file final manifest, so carrying 894/894, SQL 8/8, build, and the fresh read-only RLS 4/4 is consistent with C18’s affected-path rule (`149-source-continuity.json:3-30`).

## Verification suggestions

The #149 closure comment must say “audit completed under Owner exceptions,” enumerate the four unavailable capabilities and historical failures, and explicitly retain the no-E/F/no-Provider-enable boundary. Do not rewrite old OPEN-gate snapshots or label all 18 functional paths passed.
