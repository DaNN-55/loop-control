# T17：本地分镜规划、审核与修订闭环

**Stage:** D

**Status:** 主体实现、分镜/修订及真实 CLI 接续已有验收（2026-10-26）。GitHub Issue [#123](https://github.com/DaNN-55/loop-control/issues/123) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

Owner可由已确认脚本推进分镜，审核或请求结构修订，并保留旧审核依据。

## Acceptance criteria

- [x] 规划任务消费冻结上下文，结果通过统一服务进入分镜页面。
- [x] 审核、注释、结构修订和新旧版本引用保持原语义，旧证据不覆盖。
- [x] 用一个正常分镜和一个受控修订样本，验证HTTP操作、数据库状态和实际分镜产物。

## Blocked by

- T16：Episode脚本、视觉准备与Worker回写本地闭环

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 当前证据与限制（2026-10-26）

[T17 报告](../../verification/stage-d-t17/README.md)及[同单真实规划接续](../../verification/stage-d-close/ad-issue-implementation-20261025/report-142-final.md)分别记录正常规划/受控修订与真实 CLI。当前完整源码已完成本轮 3 镜头、221 字的真实规划及隔离功能全流程；有效 CLI 结果的中断恢复单独记录，详见[本轮报告](../../verification/tts-production-e2e-20261026/README.md)。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
