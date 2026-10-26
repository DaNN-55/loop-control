# T01：隔离环境启动与最小生产单演练

**Stage:** A

**Status:** 本地交付并获 Owner 认可（2026-10-26）。GitHub Issue [#107](https://github.com/DaNN-55/loop-control/issues/107) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

在优化环境启动控制台并读取一条独立测试 Episode，启停与演练均不接触当前生产。

## Acceptance criteria

- [x] 使用独立配置、端口、数据库、媒体、运行状态和日志；配置缺失或指向生产资源时拒绝执行。
- [x] 准备与现有SQL依赖兼容的测试数据库；不用纯PostgreSQL盲跑含Auth/Vault依赖的历史迁移。
- [x] 通过现有HTTP入口完成一次测试Episode读取并验证启停只作用于优化服务；不复制生产凭据作为默认值。

## Blocked by

None（阶段A可开始）

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 本地交付证据

见[阶段A报告](../../verification/stage-a/README.md)。T03 ADR已由Owner批准为Accepted，未提前实施后续阶段或切换生产。

最终修复、再次复审及证据见 [A阶段四项修复报告](../../verification/stage-a/fixes/README.md)。

## 当前证据与限制（2026-10-26）

[A 阶段四项修复与再次复审](../../verification/stage-a/fixes/README.md)。独立配置、数据库、媒体、端口与启停围栏已有验收；不操作生产。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
