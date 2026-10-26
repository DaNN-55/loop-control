# T07：多Episode持续消费、容量限制与公平调度

**Stage:** C

**Status:** 本地交付并获 Owner 认可（2026-10-26）。GitHub Issue [#113](https://github.com/DaNN-55/loop-control/issues/113) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

多个Episode的待执行任务持续推进，空出槽位后立即领取下一条，长生产单不会独占队列。

## Acceptance criteria

- [x] 同时限制全机槽位与Provider/Adapter/连接资源组，保留保守最小值原则。
- [x] 用真实数据库和受控执行器验证持续取队列、公平轮转、重启、取消/失败容量释放和有界退避。
- [x] 详情能区分排队与运行；满载不盲目启动新进程，不提前承诺稳定生产单数量。

## Blocked by

- T06：即时与定时派发共用一条持久执行路径

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 历史本地验收记录（2026-10-23）

见[实现与验证报告](../../verification/stage-c-t07/README.md)。verified 231→232；完整SQL22文件/249条通过；本轮默认5000ms单worker完整应用回归70文件/676项通过，Node2通过/1跳过。仍保留T06/B默认5秒曾未通过及未修时序不稳定的限制，不改写旧证据；三条既有RLS性能告警与A基线相同。真实DB/受控执行、普通HTTP/Worker/FFmpeg及真实Chrome状态/刷新分别留证。T08未开始。

## 当前证据与限制（2026-10-26）

[T07 报告](../../verification/stage-c-t07/README.md)覆盖全机/资源容量、公平与持续消费；当前默认 5000ms 稳定性已[补修通过](../../verification/stage-d-close/default-5s-stability.md)。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
