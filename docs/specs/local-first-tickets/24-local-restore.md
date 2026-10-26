# T24：本地数据库、密钥绑定及媒体恢复闭环

**Stage:** D

**Status:** 本地备份、新隔离库/媒体恢复及继续操作已有验收（2026-10-26）。GitHub Issue [#130](https://github.com/DaNN-55/loop-control/issues/130) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

Owner可备份新本地版本，并在全新隔离环境恢复出可继续操作的Episode。

## Acceptance criteria

- [x] 承接早期备份行为，覆盖新增本地身份、队列与连接引用，检查事务一致性。
- [x] 实际恢复到新库与独立媒体目录，并按Keychain/重新录入方案恢复连接绑定。
- [x] 恢复后读取、审核及一个受控任务可继续；不迁移生产环境，不执行F阶段总体发布验收。

## Blocked by

- T22：本地QC、发布包与Episode生命周期
- T15：Keychain连接创建、验证与版本选择

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 当前证据与限制（2026-10-26）

[T24 报告](../../verification/stage-d-t24/README.md)及[当前主机默认部署](../../verification/stage-d-close/default-offline-deployment.md)记录恢复后的正常入口；不迁移生产或据此开展总体切换。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
