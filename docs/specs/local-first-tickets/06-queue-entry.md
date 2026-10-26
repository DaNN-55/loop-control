# T06：即时与定时派发共用一条持久执行路径

**Stage:** C

**Status:** 本地实现、真实隔离验收与复审已完成（2026-10-26）。GitHub Issue [#112](https://github.com/DaNN-55/loop-control/issues/112) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

同一测试任务无论由按钮还是定时器触发，都通过统一队列领取、执行并回写到Episode详情。

## Acceptance criteria

- [x] 先扩展统一提交/执行入口，再迁移现有按任务、按Episode及定时调用；过渡期不保留绕过容量的入口。
- [x] 重复触发同一任务仅有一次有效执行，调用及时返回可查询状态。
- [x] 保留现有Worker结果与预检契约；用HTTP入口演示从提交到结果，不为内部模块新增重复公开API。

## Blocked by

- T05：Worker中断后的租约回收和安全重试

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 当前证据与限制（2026-10-26）

[T06 报告](../../verification/stage-c-t06/README.md)覆盖即时/定时持久路径；默认 5000ms 稳定性后来已[补修通过](../../verification/stage-d-close/default-5s-stability.md)，不改判旧失败。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
