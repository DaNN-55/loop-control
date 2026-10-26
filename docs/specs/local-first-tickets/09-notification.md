# T09：新事件提醒、健康与备份状态独立展示

**Stage:** C

**Status:** 本地实现、真实隔离验收与复审已完成（2026-10-26）。GitHub Issue [#115](https://github.com/DaNN-55/loop-control/issues/115) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

Owner只收到新审核/状态/阻塞事件的提醒，能分别查看调度、健康和备份结果。

## Acceptance criteria

- [x] 提醒统一消费事件并保存去重位置，重复检查与重启不重复发送同一事件。
- [x] 日检显式上海时区，健康、备份、通知成功与失败分别可查；限制空闲成功记录开销。
- [x] 过渡期沿用n8n触发，可替代职责有明确契约；后续直接接管时复用这些行为验证。

## Blocked by

- T06：即时与定时派发共用一条持久执行路径

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 当前证据与限制（2026-10-26）

[T09 报告](../../verification/stage-c-t09/README.md)覆盖提醒去重、上海时区及健康/备份独立结果；D 后续接管与真实通知送达见[最新审计](../../verification/stage-d-close/ad-provider-recheck-20261026/report-149.md)。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
