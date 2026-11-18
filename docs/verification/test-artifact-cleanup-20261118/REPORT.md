# 历史测试产物清理（2026-11-18）

按用户明确要求清理全部历史验收生成产物，保留生产单、验收报告、当前应用资产、源测试输入与恢复资料。本次清理只处理工作区文件；没有数据库写入、服务停止、生产单删除、素材根操作、外置证据删除或Git历史重写。

## 结果

- `docs/verification` 清理 11594 个生成文件，被移除文件原始大小合计 553.69 MiB，其中Git可恢复文件 444.12 MiB，未跟踪文件 109.58 MiB 可恢复移入废纸篓。
- 旧 `.scratch` 移出 547 个截图／日志／Vite缓存文件，工作区减少 56.80 MiB；**可恢复移出工作区，未计作实际磁盘释放**。
- 历史验收目录清理前普通本地文件617.57 MiB，最终为64.10 MiB，目录净减少约553.47 MiB（前值按两位小数记录）。被移除文件累计大小与净变化约0.22 MiB差额来自保留报告新增说明及链接标记。统计不包含外置符号链接目标、另一agent新目录和本清理报告自身。
- 原有 844 个Markdown文件全部保留；最终更新 603 个已有Markdown中的清理说明或失效链接，共 3495 个删除附件引用。
- 这是工作区减少量；Git对象仍保留恢复历史，废纸篓仍占空间，不声称实际磁盘已释放相同数量。

## 保留边界

- 本清理任务未修改 `src/`、`scripts/`、`db/`、package/test配置及测试用例；另一agent的代码修改单独审查。SQL、源码、patch/diff、`.before`和恢复tar归档保留。
- `docs/verification/repo-cleanup-production-20261115/production/shiye-six-frames.png`、`qiaoqian-corrected-review.png`被当前应用直接import，内容哈希未变。
- `clean-sql-preflight-20261112/catalog-fingerprint.sql`为当前命令读取的SQL；`state-machines-56-20261111/browser-fixture.tsx`为现有测试输入，均保留。
- `node-demo-refinement-20261028/history-cleanup/`中恢复／物理保留索引保留；它们被归档恢复脚本读取，不属于可随意删除的纯截图日志。
- 保留明确源媒体样本、`media/`内夹具、tsconfig/package测试配置，以及账单结果汇总 `batch-real-qiaoqian-20261116/billing/per-generation-cost-ledger.csv`；清理的是截图、生成媒体副本、测量、响应／运行快照、回归log与交付下载副本。
- `.scratch`中dump、patch、源代码、JSON恢复快照与归属不清音频仍保留；旧外置档案和指向它们的符号链接未动。
- 另一agent当前目录 `script-adaptation-cleanup-20261118`（verification及scratch）完全排除，运行中打开文件排除。

## 可恢复位置

- tracked文件可由清理前Git提交 `b55286452c9963603fffeb7b8410ad28963ae084` 恢复；本次不执行git gc或历史重写。
- 未跟踪生成产物移入 `/Users/dan/.Trash/loop-control-test-artifacts-20261118T065040Z`，保留原项目相对路径。

## 验证

- 清理前静态扫描src、scripts、db、根package/test配置的具体verification路径与目录拼接；当前应用2图、SQL及源码fixture保留。
- 历史脚本读取其旧测量、窗口manifest、回归输出并不使这些输出成为活跃fixture；原脚本保留，重跑历史诊断需重新生成附件。
- 验证全部原有Markdown仍存在、明确样本与应用2图哈希未变；未暂存、未提交，交主agent审查。
- 对全仓Markdown扫描指向本次已删除文件的inline/reference链接及HTML媒体src，最终0个新断链；待主agent处理的保留所有权文件：无。
- 不为文件产物清理机械新增代码测试；主agent结合另一代码改动执行项目检查。

## 各历史验收目录清理量

| 目录 | 文件数 | 被移除原始大小MiB |
| --- | ---: | ---: |
| `acceptance-cleanup-20261112` | 1 | 0.00 |
| `account-blueprint-a-20261029` | 6 | 0.18 |
| `account-delete-studio-ui-20261027` | 3 | 0.17 |
| `account-deletion-migration-20261110` | 6 | 0.00 |
| `account-deletion-review-20261110` | 22 | 0.72 |
| `account-edit-lock-20261101` | 7 | 0.12 |
| `account-empty-directory-cleanup-20261027` | 4 | 0.00 |
| `account-height-history-20261101` | 7 | 0.11 |
| `account-hierarchy-unassigned-20261101` | 14 | 0.18 |
| `account-rules-compact-20261101` | 26 | 0.64 |
| `account-series-delivery-e2e-20261101` | 52 | 6.93 |
| `account-sidebar-owned-series-20261101` | 7 | 0.14 |
| `adoption-menu-20261108` | 1 | 0.12 |
| `api-assets-delivery-20261101` | 45 | 13.27 |
| `audio-chips-20261108` | 2 | 0.07 |
| `audio-composer-20261108` | 3 | 0.15 |
| `audio-single-input-20261108` | 5 | 0.31 |
| `audio-switches-20261108` | 3 | 0.18 |
| `automatic-reservation-20261102` | 6 | 0.16 |
| `automation-status-20261027` | 2 | 0.00 |
| `bailian-video-account-settings-20261101` | 12 | 0.40 |
| `batch-production-20261116` | 37 | 1.31 |
| `batch-real-qiaoqian-20261116` | 349 | 11.60 |
| `batch-retirement-20261116` | 5 | 0.00 |
| `batched-delivery-20261111` | 1 | 0.06 |
| `blueprint-166` | 43 | 1.72 |
| `browser-comments-20261111` | 9 | 0.58 |
| `browser-comments-followup-20261111` | 2 | 0.00 |
| `caption-preparation-20261112` | 6 | 0.54 |
| `clean-sql-baseline-20261112` | 15 | 0.20 |
| `clean-sql-preflight-20261112` | 8 | 0.01 |
| `cleanup-20261027` | 5 | 0.14 |
| `cleanup-recovery-migration-20261110` | 8 | 0.00 |
| `cleanup-recovery-review-20261110` | 30 | 1.13 |
| `cleanup-second-20261027` | 7 | 0.13 |
| `codex-planning-retirement-20261112` | 14 | 0.17 |
| `compact-connection-migration-20261111` | 42 | 1.53 |
| `compact-history-node-rail-20261028` | 15 | 0.46 |
| `compact-workflow-migration-20261030` | 177 | 6.61 |
| `compact-workflow-round2-20261030` | 62 | 2.88 |
| `compact-workflow-round3-20261030` | 35 | 1.52 |
| `compact-workflow-round4-20261030` | 30 | 1.14 |
| `compact-workflow-round5-20261030` | 14 | 0.37 |
| `compact-workflow-round6-20261030` | 30 | 0.74 |
| `compact-workflow-round7-20261030` | 28 | 1.44 |
| `compact-workflow-round8-20261030` | 10 | 0.27 |
| `composer-controls-20261109` | 7 | 0.49 |
| `composer-sizing-20261108` | 3 | 0.16 |
| `connection-billing-20261101` | 6 | 0.36 |
| `connection-content-width-20261101` | 3 | 0.14 |
| `connection-detail-demo-v4-20261111` | 21 | 0.64 |
| `connection-model-settings-20261101` | 12 | 0.49 |
| `connection-organization-20261027` | 3 | 0.10 |
| `connection-preparation-layout-20261031` | 10 | 0.34 |
| `connection-retry-helper-cleanup-20261113` | 25 | 1.03 |
| `connection-usage-layout-20261101` | 4 | 0.15 |
| `connections-polish-20261101` | 10 | 0.19 |
| `current-flow-cleanup-20261110` | 39 | 2.67 |
| `current-workflow-replacement-20261113` | 739 | 9.91 |
| `d-closeout-20261026` | 43 | 1.55 |
| `daily-clean-sql-20261113` | 7 | 0.01 |
| `daily-forward-migrations-20261115` | 9 | 0.01 |
| `daily-upgrade-20261112` | 3 | 0.09 |
| `dan-ui-connections-20261027` | 15 | 0.68 |
| `dan-ui-history-20261027` | 16 | 0.70 |
| `dan-ui-rollout-20261027` | 128 | 6.58 |
| `deletion-scope-review-20261110` | 21 | 0.65 |
| `delivery-hierarchy-20261102` | 4 | 0.36 |
| `delivery-review-20261110` | 39 | 6.30 |
| `detail-refinement-migration-20261110` | 19 | 0.49 |
| `directory-account-layout-20261101` | 5 | 0.16 |
| `disconnected-prerender-20261113` | 26 | 0.83 |
| `dropdown-filters-20261102` | 4 | 0.28 |
| `editor-connection-caption-fix-20261030` | 31 | 0.90 |
| `editor-modules-20261108` | 2 | 0.12 |
| `editor-toolbar-review-20261110` | 40 | 3.05 |
| `episode-deletion-tail-cleanup-20261027` | 3 | 0.00 |
| `episode-list-polish-20261028` | 4 | 0.16 |
| `episode-metrics-20261102` | 45 | 2.83 |
| `first-batch-experience-20261109` | 11 | 0.52 |
| `four-step-workflow-prototype-20261029` | 7 | 0.65 |
| `generated-gallery-20261031` | 12 | 0.48 |
| `generated-script-chain-retirement-20261113` | 5 | 0.03 |
| `generation-composer-20261107` | 9 | 0.25 |
| `git-delivery-20261116` | 1 | 0.01 |
| `gpt-image-25-20261108` | 13 | 0.25 |
| `gpt-image-26-20261108` | 12 | 0.66 |
| `gpt-image-input-estimate-20261102` | 2 | 0.00 |
| `health-check-details-20261029` | 6 | 0.12 |
| `health-history-20261027` | 8 | 0.10 |
| `health-recheck-20261029` | 5 | 0.08 |
| `history-cleanup-20261101` | 1 | 0.04 |
| `history-connections-reference-20261028` | 7 | 0.30 |
| `history-deletion-20261029` | 14 | 0.26 |
| `history-management-entry-cleanup-20261113` | 30 | 1.05 |
| `history-organization-20261027` | 4 | 0.10 |
| `image-controls-refinement-20261108` | 10 | 0.87 |
| `image-download-20261108` | 2 | 0.14 |
| `impeccable-connection-audit-20261027` | 5 | 0.35 |
| `impeccable-migration-20261028` | 96 | 4.44 |
| `initialization-entry-cleanup-20261113` | 24 | 0.84 |
| `integration-six-fixes-20261113` | 13 | 0.02 |
| `interaction-refinement-20261110` | 11 | 0.11 |
| `isolated-production-and-legacy-review-20261113` | 28 | 1.18 |
| `issue-153-embedded-studio-20261029` | 16 | 0.56 |
| `issue-154-draft-workflow` | 10 | 0.18 |
| `issue-155-workspace-video` | 12 | 0.44 |
| `issue-156-workspace-images` | 6 | 0.16 |
| `issue-157-workspace-narration` | 6 | 0.32 |
| `issue-158-workspace-audio` | 29 | 1.23 |
| `issue-159-workspace-captions` | 6 | 0.15 |
| `issue-160-workspace-candidates` | 65 | 1.80 |
| `issue-161-workspace-visuals` | 21 | 1.40 |
| `issue-162-workspace-editing` | 28 | 1.35 |
| `issue-163-workspace-export` | 6 | 0.28 |
| `issue-164-workspace-delivery` | 13 | 2.61 |
| `issue-165-formal-workflow` | 51 | 1.25 |
| `issue-178-main-e2e-20261101` | 538 | 23.05 |
| `issue-178-ticket-publication-20261031` | 1 | 0.01 |
| `legacy-episode-delete-20261027` | 8 | 0.09 |
| `legacy-episode-restore-20261029` | 8 | 0.33 |
| `legacy-flow-retirement-20261112` | 2 | 0.19 |
| `legacy-four-step-content-20261030` | 1 | 0.00 |
| `legacy-narration-retirement-20261112` | 1 | 0.01 |
| `legacy-native-editing-20261030` | 1 | 0.00 |
| `legacy-residual-final-scan-20261113` | 1 | 0.00 |
| `legacy-retirement-round2-20261112` | 18 | 0.29 |
| `live-production-20261112` | 54 | 4.49 |
| `local-closeout-20261108` | 11 | 0.15 |
| `local-daily-runtime-20261026` | 32 | 1.10 |
| `local-final-acceptance-20261026` | 188 | 24.41 |
| `local-first-review-20261026` | 9 | 0.01 |
| `local-main-batches-20261030` | 14 | 0.32 |
| `local-main-batches-20261112` | 2 | 0.02 |
| `local-main-billing-closeout-20261101` | 6 | 0.03 |
| `local-main-clean-baseline-batches-20261112` | 3 | 0.19 |
| `local-main-closeout-20261101` | 5 | 0.43 |
| `log-viewer-migration-20261111` | 13 | 0.85 |
| `login-visual-20261027` | 7 | 0.32 |
| `lucide-and-toolchain-20261112` | 4 | 0.16 |
| `main-four-step-update-20261030` | 11 | 0.05 |
| `maintenance-episode-navigation-20261027` | 9 | 0.29 |
| `maintenance-five-steps-20261111` | 135 | 1.84 |
| `maintenance-followup-20261028` | 10 | 0.50 |
| `markdown-shot-table-20261031` | 13 | 0.37 |
| `material-composer-polish-20261108` | 5 | 0.41 |
| `material-shelf-test-20261110` | 6 | 0.27 |
| `media-fresh-start-20261101` | 3 | 0.16 |
| `minimax-balance-20261102` | 12 | 0.09 |
| `minimax-error-20261109` | 6 | 0.12 |
| `minimax-h3-models-20261109` | 17 | 0.35 |
| `minimax-region-retry-20261101` | 3 | 0.17 |
| `model-menu-grouping-20261109` | 1 | 0.05 |
| `model-settings-20261109` | 17 | 0.38 |
| `multi-directory-deletion-20261027` | 6 | 0.05 |
| `narration-control-test-20261110` | 7 | 0.28 |
| `narration-editor-20261108` | 3 | 0.13 |
| `narration-single-source-20261108` | 5 | 0.17 |
| `narration-structure-20261108` | 2 | 0.14 |
| `narration-tags-20261108` | 4 | 0.22 |
| `narration-toolbar-20261108` | 3 | 0.15 |
| `narrow-window-review-20261110` | 19 | 0.84 |
| `native-postgres-captions-20261112` | 6 | 0.55 |
| `native-save-readback-20261102` | 2 | 0.09 |
| `native-studio-fixes-20261101` | 21 | 2.74 |
| `native-studio-primary-20261030` | 26 | 0.91 |
| `node-demo-refinement-20261028` | 6 | 0.30 |
| `node-sidebar-topbar-20261028` | 13 | 0.24 |
| `old-create-episode-audit-20261113` | 3 | 0.01 |
| `openchatcut-upgrade-20261030` | 64 | 3.89 |
| `orchestration-shell-cleanup-20261113` | 3 | 0.00 |
| `owner-credentials-embedded-20261111` | 6 | 0.25 |
| `owner-menu-comment-20261111` | 1 | 0.01 |
| `owner-preferences-20261029` | 8 | 0.34 |
| `owner-settings-demo-20261111` | 4 | 0.00 |
| `owner-settings-migration-20261111` | 87 | 4.23 |
| `page-consistency-20261028` | 91 | 7.11 |
| `production-interactions-20261029` | 8 | 0.79 |
| `production-metrics-ab-20261113` | 2 | 0.01 |
| `production-metrics-c-20261113` | 10 | 0.46 |
| `production-metrics-c-main-integration-20261113` | 11 | 0.22 |
| `production-metrics-shot-withdrawal-20261113` | 13 | 0.01 |
| `production-node-migration-20261028` | 12 | 0.35 |
| `production-order-replacement-review-20261114` | 31 | 1.60 |
| `production-plan-audit-191-20261113` | 22 | 1.20 |
| `production-readiness-20261112` | 50 | 2.98 |
| `production-readiness-merge-20261112` | 1 | 0.00 |
| `production-replacement-assessment-193-20261114` | 23 | 1.43 |
| `production-replacement-assessment-195-20261114` | 22 | 1.27 |
| `production-replacement-assessment-196-20261114` | 23 | 1.30 |
| `production-replacement-assessment-197-20261114` | 33 | 1.41 |
| `production-replacement-assessment-20261114` | 22 | 1.30 |
| `production-replacement-assessment-runtime5-20261114` | 18 | 1.26 |
| `production-replacement-current-assessment-20261113` | 9 | 0.25 |
| `production-replacement-current-proposal-20261114` | 17 | 0.44 |
| `production-replacement-final-proposal-20261114` | 18 | 1.53 |
| `production-replacement-recheck-20261113` | 8 | 0.25 |
| `production-replacement-render-assessment-20261114` | 27 | 1.57 |
| `production-replacement-source-audit-20261114` | 21 | 1.44 |
| `production-replacement-visual-draft-assessment-20261114` | 28 | 0.40 |
| `program-fixes-20261102` | 13 | 0.22 |
| `project-file-cleanup-20261028` | 9 | 0.15 |
| `prompt-reference-wiring-20261109` | 7 | 0.02 |
| `prototype-alignment-20261028` | 24 | 0.46 |
| `provider-price-review-20261102` | 4 | 0.08 |
| `provider-retirement-feedback-20261027` | 5 | 0.10 |
| `receipt-rules-implementation-20261111` | 69 | 1.60 |
| `recycle-bin-compact-20261111` | 19 | 0.73 |
| `recycle-bin-migration-20261111` | 50 | 2.64 |
| `reference-budget-20261101` | 17 | 0.28 |
| `reference-row-20261108` | 3 | 0.18 |
| `release-closeout-20261110` | 13 | 0.21 |
| `remaining-legacy-sql-20261113` | 21 | 0.68 |
| `remove-account-budgets-20261101` | 11 | 0.06 |
| `render-cache-retention-20261116` | 1 | 0.00 |
| `repo-cleanup-delivery-20261110` | 35 | 0.43 |
| `repo-cleanup-production-20261115` | 326 | 12.87 |
| `residual-helper-cleanup-20261113` | 37 | 1.11 |
| `retired-cloud-rpc-20261113` | 19 | 0.82 |
| `retired-sql-runtime-compat-20261113` | 20 | 0.74 |
| `retired-trigger-cleanup-20261113` | 4 | 0.02 |
| `review-test-refresh-20261029` | 6 | 0.03 |
| `rizhao-resume-editing-20261030` | 12 | 0.34 |
| `runtime-schema-repair-20261031` | 5 | 0.00 |
| `runtime-version-legacy-20261111` | 17 | 0.45 |
| `runtime-version-visibility-20261102` | 7 | 0.30 |
| `script-chat-polish-20261118` | 17 | 1.06 |
| `script-confirmation-chat-20261118` | 16 | 0.57 |
| `script-confirmation-compact-20261118` | 14 | 0.70 |
| `script-confirmation-followup-20261117` | 20 | 0.95 |
| `script-confirmation-polish-20261118` | 11 | 0.69 |
| `script-confirmation-ui-20261117` | 16 | 0.86 |
| `script-editor-20261029` | 6 | 0.21 |
| `script-preview-20261029` | 4 | 0.14 |
| `script-production-v2-20261028` | 3 | 0.17 |
| `script-real-models-20261118` | 238 | 43.72 |
| `script-shot-models-20261118` | 15 | 0.66 |
| `second-batch-experience-20261109` | 108 | 4.45 |
| `secret-administration-20261027` | 1 | 0.04 |
| `secret-management-a-20261029` | 6 | 0.32 |
| `series-context-review-20261110` | 19 | 0.65 |
| `series-footer-height-20261101` | 3 | 0.11 |
| `series-refinement-20261029` | 7 | 0.25 |
| `series-settings-unified-20261101` | 9 | 0.20 |
| `series-sidebar-simplify-20261101` | 7 | 0.16 |
| `series-version-labels-footer-20261101` | 9 | 0.17 |
| `settings-comments-20261111` | 148 | 6.46 |
| `settings-layout-v3` | 34 | 2.24 |
| `shelf-upload-feedback-20261109` | 13 | 0.33 |
| `shot-controls-formal-20261029` | 13 | 0.70 |
| `shot-forms-formal-20261029` | 7 | 0.48 |
| `shot-layout-refinement-20261029` | 12 | 0.83 |
| `shot-preparation-entry-cleanup-20261113` | 19 | 0.83 |
| `shot-protocol-cleanup-20261110` | 36 | 1.63 |
| `shot-protocol-migration-20261110` | 3 | 0.02 |
| `shot-review-entry-cleanup-20261113` | 21 | 0.67 |
| `shot-workspace-c-formal-20261029` | 6 | 0.29 |
| `shot-workspace-redesign-20261029` | 7 | 0.41 |
| `sidebar-light-20261108` | 3 | 0.14 |
| `sidebar-refinement-20261028` | 6 | 0.05 |
| `slider-frame-fit-20261109` | 6 | 0.29 |
| `sound-compact-20261108` | 7 | 0.28 |
| `spec-152-integration` | 113 | 2.76 |
| `speech-refresh-protection-20261102` | 1 | 0.00 |
| `stage-a` | 41 | 0.48 |
| `stage-abc-merge-20261026` | 2 | 0.03 |
| `stage-b` | 42 | 0.46 |
| `stage-c-followup` | 74 | 3.85 |
| `stage-c-t06` | 9 | 0.03 |
| `stage-c-t06-followup` | 18 | 0.71 |
| `stage-c-t07` | 29 | 0.56 |
| `stage-c-t08` | 23 | 0.06 |
| `stage-c-t09` | 20 | 0.04 |
| `stage-c-t10` | 14 | 0.06 |
| `stage-c-t11` | 22 | 0.06 |
| `stage-d-close` | 1265 | 5.25 |
| `stage-d-t12` | 6 | 0.02 |
| `stage-d-t13` | 4 | 0.02 |
| `stage-d-t14` | 13 | 0.15 |
| `stage-d-t15` | 9 | 0.15 |
| `stage-d-t15-keychain` | 23 | 0.06 |
| `stage-d-t15-pexels` | 37 | 0.71 |
| `stage-d-t16` | 56 | 0.61 |
| `stage-d-t17` | 47 | 0.73 |
| `stage-d-t18` | 72 | 1.45 |
| `stage-d-t19` | 122 | 3.50 |
| `stage-d-t19-timeout-comparison` | 27 | 0.59 |
| `stage-d-t20` | 88 | 1.00 |
| `stage-d-t21` | 59 | 0.64 |
| `stage-d-t22` | 107 | 1.10 |
| `stage-d-t23` | 94 | 0.50 |
| `stage-d-t24` | 87 | 0.38 |
| `stage-d-t25` | 109 | 0.58 |
| `state-machines-0-4-20261111` | 37 | 0.61 |
| `state-machines-111213-20261111` | 29 | 1.08 |
| `state-machines-20261110` | 8 | 0.55 |
| `state-machines-20261111` | 14 | 0.50 |
| `state-machines-56-20261111` | 25 | 0.50 |
| `state-machines-78-20261111` | 19 | 0.59 |
| `state-machines-910-20261111` | 15 | 0.52 |
| `state-machines-batch12-20261110` | 17 | 0.47 |
| `state-machines-batch3-20261110` | 20 | 0.26 |
| `state-machines-batch4-20261110` | 38 | 0.49 |
| `state-machines-batch5-20261110` | 34 | 0.85 |
| `state-machines-followup12-20261110` | 29 | 0.97 |
| `state-machines-followup345-20261110` | 29 | 0.48 |
| `status-and-episode-deletion-20261027` | 7 | 0.21 |
| `storage-layout-sqlite-20261031` | 30 | 0.44 |
| `story-e2e-20261102` | 21 | 1.18 |
| `storyboard-layout-restore-20261116` | 33 | 1.42 |
| `subtitle-tabs-20261108` | 9 | 0.45 |
| `surface-polish-migration-20261110` | 18 | 0.67 |
| `system-status-drawer-20261029` | 2 | 0.09 |
| `table-column-spacing-20261102` | 22 | 2.08 |
| `template-sections-20261107` | 5 | 0.31 |
| `template-settings-20261116` | 176 | 65.70 |
| `third-batch-closeout-20261110` | 3 | 0.00 |
| `tts-production-e2e-20261026` | 69 | 11.17 |
| `ui-audit-20261102` | 34 | 2.19 |
| `ui-optimization-20261102` | 217 | 16.96 |
| `ui-timing-failures-20261113` | 47 | 2.09 |
| `umbrella-live-20261102` | 23 | 20.19 |
| `upload-feedback-20261108` | 6 | 0.25 |
| `upload-recovery-20261109` | 14 | 0.23 |
| `video-api-live-20261101` | 61 | 5.89 |
| `video-unified-20261108` | 7 | 0.52 |
| `videojs-media-20261102` | 5 | 0.10 |
| `visual-audit-20261028` | 306 | 19.57 |
| `visual-fixes-20261028` | 389 | 23.46 |
| `visual-input-placement-20261029` | 10 | 0.41 |
| `visual-preparation-20261030` | 15 | 0.32 |
| `visual-tabs-restore-20261108` | 2 | 0.07 |
| `voice-compact-20261108` | 9 | 0.53 |
| `voice-picker-20261108` | 4 | 0.40 |
| `voice-simple-20261108` | 3 | 0.14 |
| `whisperx-human-long-20261112` | 20 | 1.38 |
| `whisperx-real-20261112` | 9 | 0.03 |
| `workbench-inline-search-20261028` | 6 | 0.24 |
| `workbench-reference-20261028` | 8 | 0.22 |
| `worker-concurrency-and-audit-20261112` | 7 | 0.04 |
| `worker-outcomes-20261102` | 2 | 0.17 |
| `workflow-audio-consistency-20261111` | 31 | 0.88 |
| `workflow-header-20261108` | 2 | 0.09 |
| `workflow-node-demo-20261028` | 12 | 0.54 |
| `workflow-rules-implementation-20261111` | 76 | 1.03 |
| `workspace-call-confirmation-20261102` | 6 | 0.14 |
| `workspace-comments-20261102` | 3 | 0.23 |
| `workspace-height-caption-drag-20261030` | 41 | 2.00 |
| `workspace-shot-review-20261102` | 13 | 1.36 |
| `workspace-three-fixes-20261101` | 79 | 6.56 |

## 旧scratch移出量

| 目录 | 文件数 |
| --- | ---: |
| `artifact-cleanup-20261116` | 7 |
| `batch-production-20261116` | 26 |
| `batch-real-qiaoqian-20261116` | 23 |
| `batch-residue-cleanup-20261116` | 8 |
| `batch-retirement-20261116` | 14 |
| `business-quality-retirement-20261117` | 12 |
| `chrome-devtools-mcp-20261117` | 3 |
| `daily-upgrade-20261112` | 2 |
| `git-delivery-20261116` | 31 |
| `render-cache-cleanup-20261116` | 16 |
| `repo-cleanup-production-20261115` | 7 |
| `script-format-fallback-20261117` | 226 |
| `script-studio-20261117` | 154 |
| `storyboard-layout-restore-20261116` | 18 |

## 保留的明确媒体样本

- `docs/verification/impeccable-migration-20261028/media/synthetic-preview.mp4`
- `docs/verification/issue-158-workspace-audio/evidence/source.mp4`
- `docs/verification/stage-d-t19/evidence/sample-local-a_roll_video.mp4`
- `docs/verification/stage-d-t19/evidence/sample-local-b_roll_asset.mp4`
- `docs/verification/visual-audit-20261028/media/sample.mp4`
- `docs/verification/visual-audit-20261028/media/sample.wav`


## 主agent最终核查

独立扫描全仓1042个Markdown：本次删除目标的新inline／reference／HTML媒体src断链为0；Git删除清单中没有Markdown（10347个tracked附件删除）。两张活跃应用图片与HEAD逐字节一致。清理后前端build及运行包准备通过；10个生产单、83个素材修订、73个任务、77个产物和28个脚本请求回执等8表前后数量及SHA未变。清理范围没有扩展到真实业务数据库或素材根。

另一子任务的新增验证日志／runner在结果核查后也已删除，只保留其Markdown报告。该次新临时文件清理不计入上面针对旧产物的统计。

## 恢复与防复活依据复核

主agent复核指出，日常恢复说明要求核对旧删除范围；这类JSON不是普通测试快照。本轮从清理前Git逐字节恢复14个文件，累计1.66 MiB，恢复相关文档中的2个有效链接。未执行任何恢复或历史投影命令。

| 保留依据 | 文件 |
| --- | --- |
| 防止第一轮已删账号／生产单恢复复活；绑定删留身份和实际完成 | `cleanup-20261027/scope.json`、`commit-result.json`、`completion.json` |
| 第二轮222个生产单／31个账号的原始身份与Owner保留边界；来源与媒体删留映射 | `health-history-20261027/further-cleanup-proposal.json`；`cleanup-second-20261027/preflight.json`、`current-structure.json`、`media-plan.json`、`dry-run-result.json`、`commit-result.json`、`completion.json`、`media-history-result.json` |
| 限定源码恢复和定位恢复归档 | `project-file-cleanup-20261028/manifest.json`、`project-cleanup-20261102/cleanup-manifest.json` |
| 已删除旧连接的具体身份，防止重投影重新启用 | `old-test-connections-cleanup-20261027/result.json` |

依据：`docs/local-daily-runtime.md`明确禁止已删账号／生产单因手动历史投影重新出现；`cleanup-second-20261027/execute.mjs`读取proposal/preflight/current-structure确定精确删留身份，`media.mjs`读取media-plan和执行回执限定媒体范围；`project-file-cleanup-20261028/REPORT.md`要求保留删除／恢复范围JSON并按manifest限定恢复。普通窗口manifest、测量及回归输出仍清理。


## 后续恢复边界更新（2026-11-18）

分批发布时已将主要功能整理入main；原52提交的临时本地恢复分支随后按用户要求删除。本文早期所写“可由清理前提交恢复”是当时状态，不再承诺长期保留无用截图、日志的恢复入口。上节列明的14份必要恢复JSON、现行SQL/补丁及明确恢复归档仍保留，并已核对当前Git内容和文件摘要。没有删除正式生产数据、媒体或备份，没有强制清理Git历史对象。
