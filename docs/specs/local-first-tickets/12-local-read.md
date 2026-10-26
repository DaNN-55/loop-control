# T12：本地PostgreSQL导入与目录只读贯通

**Stage:** D

**Status:** 主体实现及空库/导入库验收已完成（2026-10-26）。GitHub Issue [#118](https://github.com/DaNN-55/loop-control/issues/118) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

独立导入数据在本地数据库中形成一致目录，Owner能经服务读取账号、系列与Episode摘要。

## Acceptance criteria

- [x] 按已记录契约适配SQL平台依赖，保留ID、快照、引用与历史；先在空库及导入库演练。
- [x] 通过服务读取的目录结果与备份样本一致，明确导入时点；不部署到生产Supabase。
- [x] 扩展本地后端与旧后端的显式选择，过渡阶段每个场景只有一个权威数据源，不做双写和静默回退。

## Blocked by

- T04：完整备份与空库恢复演练
- T10：生产单详情聚合读取与列表完整分页

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 当前证据与限制（2026-10-26）

[T12 报告](../../verification/stage-d-t12/README.md)记录平台依赖适配与目录读取；目录合同后续验收见[最新审计](../../verification/stage-d-close/ad-provider-recheck-20261026/report-149.md)。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
