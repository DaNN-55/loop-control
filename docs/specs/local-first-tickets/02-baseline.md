# T02：固定样本与性能资源基线

**Stage:** A

**Status:** 本地交付并获 Owner 认可（2026-10-26）。GitHub Issue [#108](https://github.com/DaNN-55/loop-control/issues/108) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

提供可重复的页面读取、任务派发与本地产物演练，后续可用同样本比较优化结果。

## Acceptance criteria

- [x] 覆盖一个最小样本与一个多镜头样本，记录数据规模、环境和执行条件。
- [x] 分别记录请求数、载荷、排队、执行与总耗时，以及CPU、内存和磁盘；小样本保留原始计时。
- [x] 模拟执行与真实执行分开标记；未执行的在线生成或渲染明确列出，不宣称正式产能。

## Blocked by

- T01：隔离环境启动与最小生产单演练

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 本地交付证据

见[阶段A报告](../../verification/stage-a/README.md)。T03 ADR已由Owner批准为Accepted，未提前实施后续阶段或切换生产。

最终修复、再次复审及证据见 [A阶段四项修复报告](../../verification/stage-a/fixes/README.md)。

## 当前证据与限制（2026-10-26）

[A 阶段基线](../../verification/stage-a/README.md)及[修复终验](../../verification/stage-a/fixes/README.md)。固定最小/多镜头样本已有请求、耗时及资源原始记录；不推导正式产能。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
