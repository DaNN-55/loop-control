# T05：Worker中断后的租约回收和安全重试

**Stage:** B

**Status:** 本地交付并获 Owner 认可；自然租约补验通过（2026-10-26）。GitHub Issue [#111](https://github.com/DaNN-55/loop-control/issues/111) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

Worker中断后任务能释放容量并重试；正常执行和新一轮结果不受旧尝试干扰。

## Acceptance criteria

- [x] 先复现仅有过期running任务、过期任务占满同组容量，再在相同路径验证修复。
- [x] 活跃续租不被回收；过期任务按尝试次数进入可重试或终止状态，历史保留。
- [x] 真实事务竞争与旧结果迟到验证通过；不出现双重领取或跨尝试覆盖。

## Blocked by

- T04：完整备份与空库恢复演练

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 当前证据与限制（2026-10-26）

[B 阶段验收](../../verification/stage-b/README.md)及[真实自然 30 分钟租约补验](../../verification/stage-d-close/worker-lease-natural-expiry.md)覆盖回收、续租、竞争及旧尝试围栏；不扩写为秒级故障切换。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
