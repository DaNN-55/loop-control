# Compact connection and secret settings migration

2026-11-11. Approved compact prototype migrated to production components; the prototype is not imported by the application.

## Result

- Owner settings connection list opens one fixed detail surface. Connection, models, usage/billing and history occupy the same area. Save/Cancel stay at the lower right; only the body scrolls.
- A connection's key actions replace that surface with `SecretDetailPane`. The parent header supplies its single Back action; no nested credential form or settings dialog is created.
- Global secret administration keeps search, categories, paging, system metadata, historical references, unreferenced entries and links back to real connections. Details replace the list rather than expanding below a row.
- Existing standalone connection pickers and the default model/billing dialogs keep their default presentation. Embedded mode reuses their actual requests, validations, version/revision guards and separate save APIs.

## Preserved contracts

- Saving connection metadata, testing authentication, saving enabled models and saving billing credentials are separate actions. A new production key uses the existing immutable create/rotate API; it is not silently tested.
- The existing rotate API moves the connection's current pointer to the new **unverified** version. This migration does not introduce an activation API or change saved production selections. Existing tasks retain their recorded version. A current version is not evidence of production readiness.
- Owner capability checks, optional secret administration capability, reauthentication, scoped secret references, Keychain transport and reveal/copy expiry stay in place. The compact page does not grant secret reveal just because the owner can edit a connection.
- Bailian workspace encoding, MiniMax region encoding and dedicated region changes, raw Kling legacy credentials, official endpoint binding, model discovery and unsupported models remain available.
- Billing keys remain separate from production keys. Provider-specific Admin Key / AccessKey fields, permission links, supplier usage, refresh and disconnect use the same real APIs.
- Historical reference counts, revoke confirmation, absent-impact blocking, missing-key rebind and optional unreferenced draft deletion remain reachable. Current and historical key lookup must match connection ID and version before reveal.
- Service endpoints remain read-only because the real backend binds them to registered adapters; an editable demo field was not turned into a fake save control.

## Regression corrections found during migration

1. Replaced the standalone model body's grid in embedded mode: it could shrink the model list to a few pixels under the fixed footer.
2. Discarding billing then opening models for the first time now mounts the model panel.
3. Explicitly discarded model drafts are removed; reopening does not restore abandoned selections.
4. Historical key rebind input is protected on tab change and return to the version list.
5. Billing tab discard clears only billing input and preserves independent connection edits.
6. The owner shell receives billing dirty state; connection/model edits continue through the existing workspace draft guard. This prevents duplicate confirmations.
7. Once the workspace has approved browser Back, the compact surface applies the resulting URL instead of blocking it again on retained dirty edits.
8. Long connection names are limited to two header lines, retain their full title and do not push the footer off screen.

## Verification

- `targeted-tests.log`: final targeted command passed **72 tests in 8 test files**, including real `LocalCatalogApp` Owner settings and browser Back/Forward/session expiry integration, compact flows, existing model/billing behavior, locale, global secrets and shared sensitive details.
- `targeted-types.log`: dependency-scoped TypeScript validation with the application's Vite declarations, zero diagnostics. Root agent owns final full-project checks/build.
- `layout-scan.json`: Impeccable layout scan, no findings.
- `browser/a11y-models.json` and `browser/a11y-billing.json`: real rendered components in the settings shell, zero axe violations and zero incomplete checks.
- Live browser checks used the existing 5210 isolated server and a transport fixture which never forwards to the production API. Checked 1348/768/390 widths, Chinese/English, light/dark, long unbroken names, fixed footers, tab switching, separate model saves, billing discard, key scope and absence of nested forms or extra settings dialogs. Connection-local sensitive verification was also exercised with a failed synthetic password, an emptied retry field, successful retry and explicit hide.
- Secret-specific evidence: `secrets/REPORT.md` (26 tests plus browser checks).

Screenshots: `browser/connection-wide.png`, `models-wide.png`, `billing-wide.png`, `history-wide.png`, `detail-narrow-en-dark.png`, `models-narrow-en-dark.png`, `secret-medium-en-dark.png`, `billing-dirty-narrow.png`.

No service restart, production database mutation, actual Keychain read/write, provider generation, commit or push was performed by this task. The root agent controls final integration and deployment.

## Full-suite follow-up

The root's full suite exposed legacy menu selectors in `LocalConnectionsPanel.reading.test.tsx` and old close-confirmation text in `LocalCatalogApp.workspace.test.tsx`. These tests now exercise the fixed detail tabs and stay on the model pane after a confirmed save.

During adaptation, a real presentation gap was found: a successful model save followed by a failed directory GET generated the correct parent error, but it was hidden while the models tab was active. With the root's approval, a single fixed feedback row and an accessible refresh icon now render above every tab. Refresh invokes only the existing directory read callback.

- `full-suite-ui-followup.log`: **34 tests in 3 files passed** (6 directory/read-acknowledgement tests, 12 workspace tests, 16 compact tests).
- The acknowledgement test asserts a single POST across two explicit directory retries, exactly one model read and four directory GETs. Pending follow-up reads do not delay acknowledging the saved model settings.
- Browser fixture `?directoryError=1` reproduced the actual component path. Saved model write count remained 1 after clicking refresh. Both 1348 and 390 widths preserved the footer, with no document horizontal overflow.
- Evidence: `browser/model-ack-directory-error-wide.png`, `browser/model-ack-directory-error-narrow.png`.

No receipt/client/root behavior or service state was modified in this follow-up.

## Global secret grouping completion

The approved global grouping is now complete: compact connection/use groups replace the legacy four-column flat table, with a fixed group-entry list before the existing sensitive details. Latest evidence and honest server-page count handling are documented in `secrets/GROUPED-REPORT.md`. This follow-up passed 39 targeted tests and browser checks; it changes no backend contracts.

## 主Agent正式启用回执

2026-11-11：正式5174已启用紧凑连接与全局分组密钥；主Agent实看实际连接/模型、35条真实密钥元数据的按ID/用途分组、制作/账务条目、固定详情与逐级返回。未显示或复制真实秘密，未测试真实连接或请求真实生成。[正式截图](secrets/production-group.png)。回执163最终启用及全部验证见[主交付报告](../receipt-rules-implementation-20261111/REPORT.md)；代码迁移前完整检查点32514cb623ea。
