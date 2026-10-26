# T02：固定样本与性能资源基线

**Stage:** A

**Status:** published — 已获Owner确认；GitHub Issue [#108](https://github.com/DaNN-55/loop-control/issues/108)，ready-for-agent；本地再次复审：验收满足且Owner已确认，最终loopback拓扑已补跑且T01前置已满足；云端 Issue 仍 open。

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
