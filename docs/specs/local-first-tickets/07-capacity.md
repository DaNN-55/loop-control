# T07：多Episode持续消费、容量限制与公平调度

**Stage:** C

**Status:** committed locally — 本地实现与验收完成，Owner已认可，本次提交归档；开工核对 GitHub Issue [#113](https://github.com/DaNN-55/loop-control/issues/113) 为 OPEN / ready-for-agent，未修改云端。未推送或合并。

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

## 本地验收记录

见[实现与验证报告](../../verification/stage-c-t07/README.md)。verified 231→232；完整SQL22文件/249条通过；本轮默认5000ms单worker完整应用回归70文件/676项通过，Node2通过/1跳过。仍保留T06/B默认5秒曾未通过及未修时序不稳定的限制，不改写旧证据；三条既有RLS性能告警与A基线相同。真实DB/受控执行、普通HTTP/Worker/FFmpeg及真实Chrome状态/刷新分别留证。T08未开始。
