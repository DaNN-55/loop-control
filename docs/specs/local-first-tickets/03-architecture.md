# T03：用最小生产路径固定调度及本地化契约

**Stage:** A

**Status:** 本地交付并获 Owner 认可；ADR 已接受（2026-10-26）。GitHub Issue [#109](https://github.com/DaNN-55/loop-control/issues/109) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

以现有Episode提交、领取和结果回写演练为依据，形成可供后续小票实现的服务、事务及迁移契约。

## Acceptance criteria

- [x] 记录统一服务边界、全机/资源容量、租约、结果串代防护和恢复流程的ADR，保留现有业务语义。
- [x] 明确PostgreSQL、本地Owner会话、Keychain、常驻调度器和逐段迁移方案，以及必要依赖与运行方式。
- [x] 按已认可的HTTP主边界、真实数据库及真实产物边界列出代表请求与可观察结果；不在本票重写系统。

## Blocked by

- T02：固定样本与性能资源基线

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 本地交付证据

见[阶段A报告](../../verification/stage-a/README.md)。T03 ADR已由Owner批准为Accepted，未提前实施后续阶段或切换生产。

最终修复、再次复审及证据见 [A阶段四项修复报告](../../verification/stage-a/fixes/README.md)。

## 当前证据与限制（2026-10-26）

[ADR-0008](../../adr/0008-local-execution-and-migration-contract.md)为 Accepted；[A 阶段终验](../../verification/stage-a/fixes/README.md)记录设计与代表路径，不等于生产切换。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
