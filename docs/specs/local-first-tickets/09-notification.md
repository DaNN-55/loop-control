# T09：新事件提醒、健康与备份状态独立展示

**Stage:** C

**Status:** published — 已获Owner确认；GitHub Issue [#115](https://github.com/DaNN-55/loop-control/issues/115)，ready-for-agent；本地实现、真实数据库/HTTP/空库恢复验收及两轴复审已完成；最终默认5000ms回归690项和SQL258条通过，待Owner后续审阅。云端Issue仍OPEN，未推送/合并。详见 ../../verification/stage-c-t09/README.md。

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
